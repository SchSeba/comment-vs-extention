const vscode = require('vscode');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { captureNearbyLines, maxExcerptLength } = require('./review-context.cjs');
const {
    addComment, cleanReview, dismissComment, isPendingComment, listComments, maxFeedbackLength,
    resolveAnsweredComments, resolveComment
} = require('./review-store.cjs');

const hash = text => createHash('sha256').update(text).digest('hex');

function fileFor(uri) {
    if (uri.scheme === 'file') return uri;
    if (uri.scheme === 'git') {
        try {
            const query = JSON.parse(uri.query);
            if (typeof query.path === 'string' && path.isAbsolute(query.path)) return vscode.Uri.file(query.path);
        } catch {
            return undefined;
        }
    }
}

function location(git, uri) {
    const file = fileFor(uri);
    if (!file || !vscode.workspace.getWorkspaceFolder(file)) return undefined;
    const repository = git.getRepository(file)?.rootUri.fsPath;
    if (!repository) return undefined;
    const relative = path.relative(repository, file.fsPath);
    const segments = relative.split(path.sep);
    if (!relative || path.isAbsolute(relative) || segments[0] === '..' || segments.includes('.git')) return undefined;
    return { repository, file: segments.join('/') };
}

function lineRange(document, first, last) {
    return new vscode.Range(document.lineAt(first).range.start, document.lineAt(last).range.end);
}

function locateAnchor(comment, document) {
    if (!document) return new vscode.Range(comment.firstLine - 1, 0, comment.lastLine - 1, 0);
    const first = comment.firstLine - 1;
    const last = comment.lastLine - 1;
    if (last < document.lineCount) {
        const range = lineRange(document, first, last);
        if (hash(document.getText(range)) === comment.digest) return range;
    }
    if (!comment.excerpt || comment.truncated) return undefined;
    const text = document.getText();
    const excerpt = document.eol === vscode.EndOfLine.CRLF ? comment.excerpt.replace(/\r?\n/g, '\r\n') : comment.excerpt;
    const index = text.indexOf(excerpt);
    if (index < 0 || text.indexOf(excerpt, index + 1) >= 0) return undefined;
    const range = new vscode.Range(document.positionAt(index), document.positionAt(index + excerpt.length));
    if (range.start.character === 0 && range.end.isEqual(document.lineAt(range.end.line).range.end)) return range;
}

function plainText(text) {
    const markdown = new vscode.MarkdownString();
    markdown.appendText(text);
    return markdown;
}

async function inspectCodex(output) {
    const provider = vscode.extensions.getExtension('openai.chatgpt');
    const exported = await provider?.activate();
    const descriptors = exported && Object.getOwnPropertyDescriptors(exported);
    const commands = (await vscode.commands.getCommands(true)).filter(command => command.startsWith('chatgpt.'));
    output.clear();
    output.appendLine(JSON.stringify({
        vscode: vscode.version,
        extensionHost: process.platform,
        uiKind: vscode.env.uiKind === vscode.UIKind.Web ? 'web' : 'desktop',
        remote: vscode.env.remoteName ?? null,
        codex: provider?.packageJSON.version ?? null,
        active: provider?.isActive ?? false,
        exports: descriptors ? Object.fromEntries(Object.entries(descriptors)
            .map(([key, descriptor]) => [key, descriptor.get ? 'getter' : typeof descriptor.value])) : null,
        commands,
        registeredManifestCommands: provider?.packageJSON.contributes?.commands?.map(item => item.command) ?? []
    }, null, 2));
    output.show(true);
}

async function activate(context) {
    const gitExtension = vscode.extensions.getExtension('vscode.git');
    if (!gitExtension) return;
    const git = (await gitExtension.activate()).getAPI(1);
    const controller = vscode.comments.createCommentController('local-review', 'Local Review');
    const output = vscode.window.createOutputChannel('Local Review');
    const threads = new Map();
    const ids = new WeakMap();
    let queue = Promise.resolve();
    let refreshPending = false;

    controller.options = { prompt: 'What should Codex change?', placeHolder: 'Write review feedback' };
    controller.commentingRangeProvider = {
        provideCommentingRanges(document) {
            if (!location(git, document.uri)) return [];
            return [new vscode.Range(0, 0, document.lineCount - 1, 0)];
        }
    };

    function serialize(operation) {
        const result = queue.then(operation);
        queue = result.catch(error => output.appendLine(error.message));
        return result;
    }

    function refreshThread(repository, comment, newThread) {
        const uri = vscode.Uri.parse(comment.uri);
        const document = vscode.workspace.textDocuments.find(item => item.uri.toString() === comment.uri);
        const range = locateAnchor(comment, document);
        const existing = threads.get(comment.id);
        const thread = existing?.thread ?? newThread ?? controller.createCommentThread(uri, range, []);
        const item = existing ?? { thread, repository };
        if (!existing) {
            threads.set(comment.id, item);
            ids.set(thread, comment.id);
            thread.canReply = false;
            thread.collapsibleState = newThread ? vscode.CommentThreadCollapsibleState.Expanded : vscode.CommentThreadCollapsibleState.Collapsed;
        }
        const summary = comment.reply?.summary;
        const label = ['Local Review'];
        if (comment.resolved) label.push('Resolved');
        else if (summary) label.push('Addressed');
        if (!range) label.push(`Originally lines ${comment.firstLine}–${comment.lastLine}`);
        const state = comment.resolved ? vscode.CommentThreadState.Resolved : vscode.CommentThreadState.Unresolved;
        const contextValue = comment.resolved ? 'resolved' : 'saved';
        if (thread.state !== state) thread.state = state;
        if (thread.contextValue !== contextValue) thread.contextValue = contextValue;
        if (!existing || item.summary !== summary) {
            const comments = [{ author: { name: 'You' }, body: plainText(comment.feedback), mode: vscode.CommentMode.Preview }];
            if (summary) comments.push({ author: { name: 'Codex' }, body: plainText(summary), mode: vscode.CommentMode.Preview });
            thread.comments = comments;
            item.summary = summary;
        }
        const current = thread.range;
        if (range ? !current?.isEqual(range) : current) thread.range = range;
        const title = label.join(' · ');
        if (thread.label !== title) thread.label = title;
    }

    function refresh() {
        if (refreshPending) return;
        refreshPending = true;
        void serialize(async () => {
            try {
                const active = new Set();
                for (const repo of git.repositories) {
                    const repository = repo.rootUri.fsPath;
                    for (const comment of await listComments(repository)) {
                        refreshThread(repository, comment);
                        active.add(comment.id);
                    }
                }
                for (const [id, item] of threads) {
                    if (active.has(id)) continue;
                    item.thread.dispose();
                    threads.delete(id);
                }
            } finally {
                refreshPending = false;
            }
        });
    }

    function register(name, handler) {
        context.subscriptions.push(vscode.commands.registerCommand(`localReview.${name}`, async argument => {
            try {
                return await handler(argument);
            } catch (error) {
                await vscode.window.showErrorMessage(`Local Review: ${error.message}`);
            }
        }));
    }

    register('add', ({ thread, text }) => serialize(async () => {
        if (ids.has(thread)) return;
        const target = location(git, thread.uri);
        const document = vscode.workspace.textDocuments.find(item => item.uri.toString() === thread.uri.toString());
        if (!target || !document || !thread.range) throw new Error('Open a Git worktree file before adding feedback.');
        const feedback = text.trim();
        if (!feedback || feedback.length > maxFeedbackLength) {
            throw new Error(`Write feedback between 1 and ${maxFeedbackLength} characters.`);
        }
        const first = thread.range.start.line;
        const last = thread.range.end.line;
        const excerpt = document.getText(lineRange(document, first, last));
        const context = {
            languageId: document.languageId,
            unsaved: document.isDirty,
            ...captureNearbyLines(line => document.lineAt(line - 1).text, document.lineCount, first + 1, last + 1)
        };
        const record = await addComment(target.repository, {
            uri: thread.uri.toString(), file: target.file, side: thread.uri.scheme === 'git' ? 'original' : 'working',
            firstLine: first + 1, lastLine: last + 1, excerpt: excerpt.slice(0, maxExcerptLength),
            truncated: excerpt.length > maxExcerptLength, digest: hash(excerpt), context, feedback, createdAt: new Date().toISOString()
        });
        refreshThread(target.repository, record, thread);
    }));

    register('dismiss', thread => serialize(async () => {
        const id = ids.get(thread);
        const item = threads.get(id);
        if (!item) return;
        await dismissComment(item.repository, id);
        thread.dispose();
        threads.delete(id);
    }));

    register('resolve', thread => serialize(async () => {
        const id = ids.get(thread);
        const item = threads.get(id);
        if (!item) return;
        await resolveComment(item.repository, id);
        refresh();
    }));

    async function pickWorktree(sourceControl) {
        const uri = sourceControl?.rootUri ?? vscode.window.activeTextEditor?.document.uri;
        const file = uri && fileFor(uri);
        let repo = file && git.getRepository(file);
        if (!repo && git.repositories.length === 1) [repo] = git.repositories;
        if (!repo && git.repositories.length > 1) {
            repo = (await vscode.window.showQuickPick(git.repositories.map(item => ({ label: item.rootUri.fsPath, item })),
                { placeHolder: 'Choose the worktree with review comments' }))?.item;
        }
        return repo?.rootUri.fsPath;
    }

    register('mark-resolved-review', async sourceControl => {
        const repository = await pickWorktree(sourceControl);
        if (!repository) return;
        const count = await serialize(() => resolveAnsweredComments(repository));
        refresh();
        await vscode.window.showInformationMessage(count
            ? `Marked ${count} answered review comment(s) as resolved.`
            : 'No answered review comments to resolve in this worktree.');
    });

    register('clean-review', async sourceControl => {
        const repository = await pickWorktree(sourceControl);
        if (!repository) return;
        const action = await vscode.window.showWarningMessage(
            `Remove all Local Review comments and replies from ${repository}?`, { modal: true }, 'Clean Review');
        if (action !== 'Clean Review') return;
        const count = await serialize(() => cleanReview(repository));
        refresh();
        await vscode.window.showInformationMessage(count
            ? `Removed ${count} review comment(s) from this worktree.`
            : 'No Local Review comments to remove in this worktree.');
    });

    register('copyPrompt', async sourceControl => {
        const repository = await pickWorktree(sourceControl);
        if (!repository) return;
        const comments = await listComments(repository);
        if (!comments.some(isPendingComment)) {
            await vscode.window.showInformationMessage('No pending Local Review comments in this worktree.');
            return;
        }
        await vscode.env.clipboard.writeText([
            `Address my pending Local Review comments in the Git worktree ${JSON.stringify(repository)}.`,
            'Call local-review list_pending_comments with that worktree root. Work through comments on the same file in listed order and call get_comment_context for each ID just before addressing it.',
            'Inspect the current file. Treat saved line numbers as historical, and check whether earlier edits already satisfy later feedback. Preserve existing edits.',
            'After verifying each fix, call record_comment_reply once with its ID and a short summary, including when earlier edits already satisfied it.',
            'Finish with one short line per comment naming the file and what changed or what blocked it. Leave blocked comments pending.'
        ].join(' '));
        await vscode.window.showInformationMessage('Follow-up copied. Paste it into your current Codex chat or terminal session.');
    });

    register('inspectCodex', () => inspectCodex(output));
    const timer = setInterval(refresh, 1500);
    context.subscriptions.push(controller, output, git.onDidOpenRepository(refresh), git.onDidCloseRepository(refresh),
        vscode.workspace.onDidOpenTextDocument(refresh), vscode.workspace.onDidChangeTextDocument(refresh),
        { dispose: () => clearInterval(timer) });
    refresh();
}

module.exports = { activate };
