const vscode = require('vscode');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { captureNearbyLines, isInWorktree, maxExcerptLength } = require('./review-context.cjs');
const {
    addComment, addFollowUp, adoptLegacyComments, cleanReview, dismissComment, fileBelongsToReview, getComment, getReviewScope,
    isPendingComment, listComments, listLegacyComments, maxFeedbackLength, requireReviewScope,
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
    const output = vscode.window.createOutputChannel('Local Review');
    const threads = new Map();
    const ids = new WeakMap();
    const controllers = new Map();
    const repositoryListeners = new Map();
    let queue = Promise.resolve();
    let refreshPending = false;

    function controllerFor(repository, scope) {
        const previous = controllers.get(repository);
        if (previous?.scope.key === scope.key) return previous.controller;
        if (previous) {
            previous.controller.dispose();
            for (const [key, item] of threads) {
                if (item.repository === repository) threads.delete(key);
            }
        }
        const controller = vscode.comments.createCommentController(`local-review-${scope.key}`, 'Local Review');
        controller.options = { prompt: 'What should Codex change?', placeHolder: 'Write review feedback' };
        controller.commentingRangeProvider = {
            provideCommentingRanges(document) {
                if (location(git, document.uri)?.repository !== repository) return [];
                return [new vscode.Range(0, 0, document.lineCount - 1, 0)];
            }
        };
        controllers.set(repository, { controller, scope });
        return controller;
    }

    function serialize(operation) {
        const result = queue.then(operation);
        queue = result.catch(error => output.appendLine(error.message));
        return result;
    }

    function refreshThread(repository, scope, entries, newThread) {
        const [comment] = entries;
        const uri = vscode.Uri.parse(comment.uri);
        const document = vscode.workspace.textDocuments.find(item => item.uri.toString() === comment.uri);
        const range = locateAnchor(comment, document);
        const key = `${scope.key}:${comment.id}`;
        const existing = threads.get(key);
        const thread = existing?.thread ?? newThread ?? controllerFor(repository, scope).createCommentThread(uri, range, []);
        const item = existing ?? { thread, repository, scope, id: comment.id };
        if (!existing) {
            threads.set(key, item);
            ids.set(thread, key);
            thread.collapsibleState = newThread ? vscode.CommentThreadCollapsibleState.Expanded : vscode.CommentThreadCollapsibleState.Collapsed;
        }
        const pending = entries.some(isPendingComment);
        const last = entries.at(-1);
        const canReply = !comment.resolved && !pending && Boolean(last.reply);
        item.lastId = last.id;
        if (thread.canReply !== canReply) thread.canReply = canReply;
        const label = ['Local Review'];
        if (comment.resolved) label.push('Resolved');
        else if (canReply) label.push('Addressed');
        if (!range) label.push(`Originally lines ${comment.firstLine}–${comment.lastLine}`);
        const state = comment.resolved ? vscode.CommentThreadState.Resolved : vscode.CommentThreadState.Unresolved;
        const contextValue = comment.resolved ? 'resolved' : canReply ? 'addressed' : 'saved';
        if (thread.state !== state) thread.state = state;
        if (thread.contextValue !== contextValue) thread.contextValue = contextValue;
        const version = JSON.stringify(entries.map(entry => [entry.id, entry.reply?.summary]));
        if (item.version !== version) {
            thread.comments = entries.flatMap(entry => {
                const messages = [{ author: { name: 'You' }, body: plainText(entry.feedback), mode: vscode.CommentMode.Preview }];
                if (entry.reply) messages.push({ author: { name: 'Codex' }, body: plainText(entry.reply.summary), mode: vscode.CommentMode.Preview });
                return messages;
            });
            item.version = version;
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
                    try {
                        const scope = await getReviewScope(repository);
                        const groups = new Map();
                        for (const comment of await listComments(scope)) {
                            const owner = location(git, vscode.Uri.parse(comment.uri));
                            if (owner && owner.repository !== repository) continue;
                            const root = comment.threadId ?? comment.id;
                            if (!groups.has(root)) groups.set(root, []);
                            const entries = groups.get(root);
                            if (comment.threadId) entries.push(comment);
                            else entries.unshift(comment);
                        }
                        await requireReviewScope(repository, scope.key);
                        controllerFor(repository, scope);
                        for (const [id, entries] of groups) {
                            const key = `${scope.key}:${id}`;
                            if (active.has(key) || entries[0].id !== id) continue;
                            refreshThread(repository, scope, entries);
                            active.add(key);
                        }
                    } catch (error) {
                        output.appendLine(error.message);
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

    async function saveFeedback({ thread, text }) {
        if (!thread?.uri) throw new Error('The review changed. Reopen the diff and try again.');
        const existing = ids.has(thread);
        const item = threads.get(ids.get(thread));
        if (existing && !item) throw new Error('This review thread is no longer open.');
        const lastId = item?.lastId;
        const target = location(git, thread.uri);
        if (!target && !item) throw new Error('Open a Git worktree file before adding feedback.');
        const repository = item?.repository ?? target.repository;
        const scopeKey = item?.scope.key ?? controllers.get(repository)?.scope.key;
        if (!scopeKey) throw new Error('The review is still loading. Reopen the diff and try again.');
        const scope = await requireReviewScope(repository, scopeKey);
        await serialize(async () => {
            await requireReviewScope(repository, scope.key);
            if (item && (!thread.canReply || item.lastId !== lastId)) throw new Error('This review thread already has pending feedback.');
            const document = vscode.workspace.textDocuments.find(doc => doc.uri.toString() === thread.uri.toString());
            const previous = item && await getComment(scope, lastId);
            if (item && !previous) throw new Error('This review thread is no longer open.');
            if (!previous && (!document || !thread.range)) throw new Error('Open a Git worktree file before adding feedback.');
            const feedback = text.trim();
            if (!feedback || feedback.length > maxFeedbackLength) {
                throw new Error(`Write feedback between 1 and ${maxFeedbackLength} characters.`);
            }
            const file = previous?.file ?? target.file;
            const workingPath = path.resolve(scope.root, file);
            let snapshot = previous;
            if (document && thread.range) {
                const canonical = await fs.realpath(workingPath).catch(error => {
                    if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') throw error;
                });
                if ((canonical && !isInWorktree(scope.root, canonical)) || !await fileBelongsToReview(scope, workingPath) ||
                    (canonical && canonical !== workingPath && !await fileBelongsToReview(scope, canonical))) {
                    throw new Error('Open this file from the Git repository that owns it.');
                }
                snapshot = captureSnapshot(thread, document);
            }
            const { firstLine, lastLine, excerpt, truncated, digest, context } = snapshot;
            await requireReviewScope(repository, scope.key);
            const data = {
                uri: thread.uri.toString(), file,
                side: thread.uri.scheme === 'git' ? 'original' : 'working',
                firstLine, lastLine, excerpt, truncated, digest, context, feedback, createdAt: new Date().toISOString()
            };
            if (item) {
                await addFollowUp(scope, lastId, data);
                thread.canReply = false;
            } else {
                const record = await addComment(scope, data);
                refreshThread(repository, scope, [record], thread);
            }
            refresh();
        });
    }
    register('add', saveFeedback);
    register('followUp', saveFeedback);

    function captureSnapshot(thread, document) {
        const first = thread.range.start.line;
        const last = thread.range.end.line;
        const excerpt = document.getText(lineRange(document, first, last));
        const context = {
            languageId: document.languageId,
            unsaved: document.isDirty,
            ...captureNearbyLines(line => document.lineAt(line - 1).text, document.lineCount, first + 1, last + 1)
        };
        return {
            firstLine: first + 1, lastLine: last + 1, excerpt: excerpt.slice(0, maxExcerptLength),
            truncated: excerpt.length > maxExcerptLength, digest: hash(excerpt), context
        };
    }

    register('dismiss', thread => serialize(async () => {
        const id = ids.get(thread);
        const item = threads.get(id);
        if (!item) return;
        await requireReviewScope(item.repository, item.scope.key);
        await dismissComment(item.scope, item.id);
        thread.dispose();
        threads.delete(id);
    }));

    register('resolve', thread => serialize(async () => {
        const id = ids.get(thread);
        const item = threads.get(id);
        if (!item) return;
        await requireReviewScope(item.repository, item.scope.key);
        await resolveComment(item.scope, item.id);
        refresh();
    }));

    async function pickReview(sourceControl) {
        const uri = sourceControl?.rootUri;
        const active = vscode.window.activeTextEditor?.document.uri;
        const editor = active && location(git, active);
        let repo = uri && git.getRepository(uri);
        if (!uri && editor) repo = git.getRepository(vscode.Uri.file(editor.repository));
        if (!repo && git.repositories.length === 1) [repo] = git.repositories;
        if (!repo && git.repositories.length > 1) {
            repo = (await vscode.window.showQuickPick(git.repositories.map(item => ({ label: item.rootUri.fsPath, item })),
                { placeHolder: 'Choose the worktree with review comments' }))?.item;
        }
        if (!repo) return;
        const repository = repo.rootUri.fsPath;
        return { repository, scope: await getReviewScope(repository) };
    }

    register('mark-resolved-review', async sourceControl => {
        const review = await pickReview(sourceControl);
        if (!review) return;
        const count = await serialize(async () =>
            resolveAnsweredComments(await requireReviewScope(review.repository, review.scope.key)));
        refresh();
        await vscode.window.showInformationMessage(count
            ? `Marked ${count} answered review thread(s) as resolved.`
            : 'No fully answered review threads to resolve on this branch.');
    });

    register('clean-review', async sourceControl => {
        const review = await pickReview(sourceControl);
        if (!review) return;
        const { repository, scope } = review;
        const action = await vscode.window.showWarningMessage(
            `Remove all Local Review comments and replies for ${scope.branch} in ${repository}?`, { modal: true }, 'Clean Review');
        if (action !== 'Clean Review') return;
        const count = await serialize(async () => cleanReview(await requireReviewScope(repository, scope.key)));
        refresh();
        await vscode.window.showInformationMessage(count
            ? `Removed ${count} review comment(s) from this branch.`
            : 'No Local Review comments to remove on this branch.');
    });

    register('adopt-legacy', async () => {
        const review = await pickReview();
        if (!review) return;
        const { repository, scope } = review;
        const ids = await listLegacyComments(scope);
        if (!ids.length) {
            await vscode.window.showInformationMessage('No older Local Review comments to import for this folder.');
            return;
        }
        const action = await vscode.window.showWarningMessage(
            `Assign ${ids.length} older Local Review comment(s) from this folder to ${scope.branch} in ${repository}? Older comments have no branch information.`,
            { modal: true }, 'Import Comments');
        if (action !== 'Import Comments') return;
        const count = await serialize(async () => adoptLegacyComments(await requireReviewScope(repository, scope.key)));
        refresh();
        await vscode.window.showInformationMessage(`Imported ${count} review comment(s) into ${scope.branch}.`);
    });

    register('copyPrompt', async sourceControl => {
        const review = await pickReview(sourceControl);
        if (!review) return;
        const { repository, scope } = review;
        const comments = await listComments(scope);
        await requireReviewScope(repository, scope.key);
        if (!comments.some(isPendingComment)) {
            await vscode.window.showInformationMessage('No pending Local Review comments on this branch.');
            return;
        }
        await vscode.env.clipboard.writeText([
            `Address my pending Local Review comments in the Git worktree ${JSON.stringify(repository)} on ${JSON.stringify(scope.branch)}. Use review scope ${scope.key}.`,
            'Call local-review list_pending_comments with that worktree root as repository and the review scope as scope. Pass both to every Local Review tool call, and stop if the checkout or branch changed.',
            'Work through comments on the same file in listed order and call get_comment_context for each ID just before addressing it.',
            'Inspect the current file. Treat saved line numbers as historical, and check whether earlier edits already satisfy later feedback. Preserve existing edits.',
            'After verifying each fix, call record_comment_reply once with its ID and a short summary, including when earlier edits already satisfied it.',
            'Finish with one short line per comment naming the file and what changed or what blocked it. Leave blocked comments pending.'
        ].join(' '));
        await vscode.window.showInformationMessage('Follow-up copied. Paste it into your current Codex chat or terminal session.');
    });

    register('inspectCodex', () => inspectCodex(output));
    function watchRepository(repo) {
        repositoryListeners.set(repo, repo.state.onDidChange(refresh));
        refresh();
    }

    function closeRepository(repo) {
        repositoryListeners.get(repo)?.dispose();
        repositoryListeners.delete(repo);
        const repository = repo.rootUri.fsPath;
        controllers.get(repository)?.controller.dispose();
        controllers.delete(repository);
        refresh();
    }

    const timer = setInterval(refresh, 1500);
    context.subscriptions.push(output, git.onDidOpenRepository(watchRepository), git.onDidCloseRepository(closeRepository),
        vscode.workspace.onDidOpenTextDocument(refresh), vscode.workspace.onDidChangeTextDocument(refresh),
        { dispose: () => {
            clearInterval(timer);
            for (const listener of repositoryListeners.values()) listener.dispose();
            for (const { controller } of controllers.values()) controller.dispose();
        } });
    for (const repo of git.repositories) watchRepository(repo);
    refresh();
}

module.exports = { activate };
