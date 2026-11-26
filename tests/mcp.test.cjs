const { after, before, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');
const { addComment, addFollowUp, adoptLegacyComments, dismissComment, editFeedback, getReviewScope, listComments, recordReply, resolveComment, storeRoot } = require('../review-store.cjs');
const { captureNearbyLines } = require('../review-context.cjs');

const { copiedFollowUp } = require('../review-guidance.cjs');

let temp;
let repository;
let otherRepository;
let client;
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
const feedback = { file: 'app.txt', side: 'working', firstLine: 1, lastLine: 1, excerpt: 'base',
    feedback: 'Change the value', createdAt: '2026-01-01T00:00:00.000Z' };

before(async () => {
    temp = await fs.mkdtemp(path.join(os.tmpdir(), 'local-review-'));
    process.env.CODEX_HOME = path.join(temp, 'codex');
    repository = path.join(temp, 'repo');
    otherRepository = path.join(temp, 'other');
    await Promise.all([fs.mkdir(repository), fs.mkdir(otherRepository)]);
    for (const root of [repository, otherRepository]) git(root, 'init', '-qb', 'main');
    client = new Client({ name: 'local-review-test', version: '1.0.0' });
    await client.connect(new StdioClientTransport({
        command: process.execPath,
        args: [path.join(__dirname, '../mcp.cjs')],
        env: { CODEX_HOME: process.env.CODEX_HOME }
    }));
});

after(async () => {
    await client?.close();
    if (temp) await fs.rm(temp, { recursive: true, force: true });
});

async function call(name, args) {
    const result = await client.callTool({ name, arguments: args });
    assert.equal(result.isError, undefined, result.content[0]?.text);
    return JSON.parse(result.content[0].text);
}

test('all handling entry points put the change in chat before processing feedback', async () => {
    const scope = await getReviewScope(repository);
    const prompt = copiedFollowUp(repository, scope);
    assert.ok(prompt.includes(JSON.stringify(repository)) && prompt.includes(scope.key));
    const shortcut = await fs.readFile(path.join(__dirname, '../skills/handle-comments/SKILL.md'), 'utf8');
    for (const instructions of [client.getInstructions(), prompt, shortcut]) {
        const overview = instructions.search(/account in chat/i);
        const feedback = instructions.search(/list_pending_comments|get_comment_context/);
        assert.ok(overview >= 0 && feedback > overview);
        const preparation = instructions.slice(0, overview);
        for (const concept of [/current chat/i, /README/, /AGENTS\.md/, /merge base/, /staged|--cached/,
            /unstaged|`git diff`/, /untracked files/, /without comments/, /callers and tests/]) {
            assert.match(preparation, concept);
        }
        const discussion = instructions.slice(overview, feedback);
        assert.match(discussion, /specific question/i);
        assert.match(discussion, /wait/i);
        assert.match(discussion, /later rounds in this chat.*reuse/is);
    }
});

test('MCP lists worktree comments and preserves the first summary across concurrent replies', async () => {
    assert.deepEqual((await client.listTools()).tools.map(tool => tool.name).sort(),
        ['clean_review', 'get_comment_context', 'list_pending_comments', 'list_review_history', 'mark_resolved_review', 'record_comment_reply']);
    assert.match(client.getInstructions(), /github\.com\/SchSeba\/ai-plugins.*CODING\.md, REVIEWING\.md, and VALIDATION\.md/);
    const comment = await addComment(repository, {
        file: 'src/main.js', side: 'working', firstLine: 4, lastLine: 5,
        excerpt: 'return old;', feedback: 'Use the new value', createdAt: new Date().toISOString()
    });
    assert.deepEqual(await fs.readdir(repository), ['.git']);
    assert.deepEqual(await call('list_pending_comments', { repository: otherRepository }), []);
    assert.deepEqual(await call('list_pending_comments', { repository }), [{
        id: comment.id, scope: (await getReviewScope(repository)).key, branch: 'main',
        file: comment.file, side: comment.side, firstLine: 4, lastLine: 5,
        excerpt: comment.excerpt, feedback: comment.feedback
    }]);

    const wrongWorktree = await client.callTool({ name: 'record_comment_reply', arguments: {
        repository: otherRepository, id: comment.id, summary: 'Wrong worktree'
    } });
    assert.equal(wrongWorktree.isError, true);
    const results = await Promise.all(['Updated the return value', 'Second report'].map(summary =>
        call('record_comment_reply', { repository, id: comment.id, summary })));
    assert.deepEqual(results.map(result => result.status).sort(), ['already_recorded', 'recorded']);
    assert.deepEqual(results[0].reply, results[1].reply);
    assert.deepEqual(await call('list_pending_comments', { repository }), []);
    assert.deepEqual((await listComments(repository))[0].reply, results[0].reply);

    await dismissComment(repository, comment.id);
    assert.deepEqual(await listComments(repository), []);
    const lateReply = await client.callTool({ name: 'record_comment_reply', arguments: {
        repository, id: comment.id, summary: 'Late report'
    } });
    assert.equal(lateReply.isError, true);
});

test('review history includes only fully answered threads in the requested review scope', async () => {
    const repository = await fs.mkdtemp(path.join(temp, 'review-history-'));
    git(repository, 'init', '-qb', 'main');
    const scope = await getReviewScope(repository);
    const root = await addComment(scope, feedback);
    const unfinished = await addComment(scope, feedback);
    const summary = 'Updated the value';
    for (const entry of [root, unfinished]) await recordReply(scope, entry.id, { summary });
    const followUp = await addFollowUp(scope, root.id, { ...feedback, feedback: 'Use the canonical value' });
    await recordReply(scope, followUp.id, { summary: 'Used the canonical value' });
    await resolveComment(scope, root.id);
    await addFollowUp(scope, unfinished.id, { ...feedback, feedback: 'Pending correction' });
    await resolveComment(scope, unfinished.id);

    const history = await call('list_review_history', { repository, scope: scope.key });
    const expected = { threadId: root.id, scope: scope.key, branch: scope.branch, file: root.file, resolved: true };
    assert.deepEqual(history, [
        { ...expected, id: root.id, feedback: root.feedback, summary },
        { ...expected, id: followUp.id, feedback: followUp.feedback, summary: 'Used the canonical value' }
    ]);
    assert.deepEqual(await call('list_review_history', { repository: otherRepository }), []);
    git(repository, 'switch', '-qc', 'different');
    assert.deepEqual(await call('list_review_history', { repository }), []);
    const stale = await client.callTool({ name: 'list_review_history', arguments: { repository, scope: scope.key } });
    assert.equal(stale.isError, true);
    assert.match(stale.content[0].text, /checkout or branch changed/);
});

test('resolution keeps replies and cleanup only removes the selected worktree review', async () => {
    const comment = {
        file: 'src/main.js', side: 'working', firstLine: 4, lastLine: 4,
        excerpt: 'return old;', feedback: 'Use the new value', createdAt: new Date().toISOString()
    };
    const manual = await addComment(repository, comment);
    const answered = await addComment(repository, comment);
    const unanswered = await addComment(repository, comment);
    const other = await addComment(otherRepository, comment);

    assert.equal(await resolveComment(repository, manual.id), true);
    assert.equal(await resolveComment(repository, manual.id), false);
    const summary = 'Updated the return value.';
    await call('record_comment_reply', { repository, id: answered.id, summary });
    assert.equal((await listComments(repository)).find(item => item.id === answered.id).resolved, false);
    assert.deepEqual(await call('mark_resolved_review', { repository }), { resolved: 1 });
    assert.deepEqual(await call('mark_resolved_review', { repository }), { resolved: 0 });
    const review = await listComments(repository);
    assert.equal(review.find(item => item.id === manual.id).resolved, true);
    assert.equal(review.find(item => item.id === answered.id).resolved, true);
    assert.deepEqual(review.find(item => item.id === answered.id).reply, { summary });
    assert.equal(review.find(item => item.id === unanswered.id).resolved, false);
    assert.deepEqual((await call('list_pending_comments', { repository })).map(item => item.id), [unanswered.id]);

    assert.deepEqual(await call('clean_review', { repository }), { removed: 3 });
    assert.deepEqual(await call('clean_review', { repository }), { removed: 0 });
    assert.deepEqual(await listComments(repository), []);
    assert.deepEqual((await call('list_pending_comments', { repository: otherRepository })).map(item => item.id), [other.id]);
    assert.deepEqual(await fs.readdir(repository), ['.git']);
});

test('refreshing later comments detects edits and movement in the same file', async () => {
    const original = ['header', 'greeting', 'old marker', 'punctuation', 'footer'];
    const file = 'same-file.txt';
    const filename = path.join(repository, file);
    await fs.writeFile(filename, original.join('\r\n'));
    async function commentAt(line, feedback) {
        return addComment(repository, {
            file, side: 'working', firstLine: line, lastLine: line, excerpt: original[line - 1],
            context: {
                languageId: 'plaintext', unsaved: false,
                ...captureNearbyLines(number => original[number - 1], original.length, line, line)
            },
            feedback, createdAt: new Date().toISOString()
        });
    }
    const first = await commentAt(2, 'Insert a line and update the marker.');
    const changed = await commentAt(3, 'Update the marker.');
    const moved = await commentAt(4, 'Update punctuation.');

    const list = await call('list_pending_comments', { repository });
    assert.deepEqual(list.find(item => item.id === changed.id).context.before,
        [{ line: 1, text: 'header' }, { line: 2, text: 'greeting' }]);
    const refresh = async id => call('get_comment_context', { repository, id });
    assert.equal((await refresh(first.id)).current.status, 'unchanged');

    await fs.writeFile(filename, ['header', 'inserted', 'greeting', 'new marker', 'punctuation', 'footer'].join('\n'));
    await call('record_comment_reply', { repository, id: first.id, summary: 'Inserted a line and updated the marker.' });
    const afterEdit = await refresh(changed.id);
    assert.equal(afterEdit.excerpt, 'old marker');
    assert.equal(afterEdit.firstLine, 3);
    assert.equal(afterEdit.current.status, 'changed');
    assert.equal(afterEdit.current.firstLine, 4);
    assert.equal(afterEdit.current.excerpt, 'new marker');
    const relocated = (await refresh(moved.id)).current;
    assert.equal(relocated.status, 'moved');
    assert.equal(relocated.firstLine, 5);
    assert.equal(relocated.excerpt, 'punctuation');

    await fs.writeFile(filename, ['header', 'inserted', 'greeting', 'punctuation', 'footer', 'old marker'].join('\n'));
    const deleted = (await refresh(changed.id)).current;
    assert.equal(deleted.status, 'deleted');
    assert.equal(deleted.firstLine, undefined);
    const wrongWorktree = await client.callTool({
        name: 'get_comment_context', arguments: { repository: otherRepository, id: changed.id }
    });
    assert.equal(wrongWorktree.isError, true);
});

test('fresh context avoids claiming a location for legacy duplicates or out-of-scope files', async () => {
    const record = {
        side: 'working', firstLine: 1, lastLine: 1, excerpt: 'duplicate',
        feedback: 'Inspect this line.', createdAt: new Date().toISOString()
    };
    const legacy = await addComment(repository, { ...record, file: 'duplicates.txt' });
    await fs.writeFile(path.join(repository, legacy.file), 'duplicate\nother\nduplicate\n');
    const ambiguous = await call('get_comment_context', { repository, id: legacy.id });
    assert.equal(ambiguous.context, undefined);
    assert.deepEqual(ambiguous.current, { status: 'ambiguous' });
    const original = await addComment(repository, { ...record, file: legacy.file, side: 'original' });
    assert.deepEqual((await call('get_comment_context', { repository, id: original.id })).current, { status: 'original-side' });
    const escaped = await addComment(repository, { ...record, file: '../other/private.txt' });
    await fs.writeFile(path.join(otherRepository, 'private.txt'), 'duplicate');
    assert.deepEqual((await call('get_comment_context', { repository, id: escaped.id })).current, { status: 'unavailable' });
    const missing = await addComment(repository, { ...record, file: 'missing.txt' });
    assert.deepEqual((await call('get_comment_context', { repository, id: missing.id })).current, { status: 'missing' });
});

test('fresh context does not follow a symlink outside the worktree', async t => {
    const file = 'link.txt';
    try {
        await fs.symlink(path.join(otherRepository, 'private.txt'), path.join(repository, file), 'file');
    } catch (error) {
        if (process.platform === 'win32' && error.code === 'EPERM') {
            t.skip('This Windows account cannot create symlinks.');
            return;
        }
        throw error;
    }
    const comment = await addComment(repository, {
        file, side: 'working', firstLine: 1, lastLine: 1, excerpt: 'duplicate',
        feedback: 'Inspect this line.', createdAt: new Date().toISOString()
    });
    assert.deepEqual((await call('get_comment_context', { repository, id: comment.id })).current, { status: 'unavailable' });
});

test('branch switches, detached HEAD, linked worktrees and replacement checkouts isolate reviews', async () => {
    const root = await fs.mkdtemp(path.join(temp, 'checkout-'));
    git(root, 'init', '-qb', 'main');
    await fs.writeFile(path.join(root, feedback.file), 'base\n');
    git(root, 'add', feedback.file);
    git(root, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'Initial commit');
    const main = await addComment(root, feedback);
    const [pending] = await call('list_pending_comments', { repository: root });
    const linked = path.join(temp, 'linked');
    git(root, 'worktree', 'add', '-qb', 'linked', linked);
    assert.deepEqual(await call('list_pending_comments', { repository: linked }), []);
    git(root, 'switch', '-qc', 'feature');
    assert.deepEqual(await call('list_pending_comments', { repository: root }), []);
    for (const name of ['list_pending_comments', 'get_comment_context', 'record_comment_reply', 'mark_resolved_review', 'clean_review']) {
        const args = { repository: root, scope: pending.scope };
        if (name === 'get_comment_context' || name === 'record_comment_reply') args.id = main.id;
        if (name === 'record_comment_reply') args.summary = 'Wrong branch';
        const response = await client.callTool({ name, arguments: args });
        assert.equal(response.isError, true);
        assert.match(response.content[0].text, /checkout or branch changed/);
    }
    const feature = await addComment(root, feedback);
    assert.deepEqual((await call('list_pending_comments', { repository: root })).map(comment => comment.id), [feature.id]);
    assert.deepEqual(await call('clean_review', { repository: root }), { removed: 1 });
    git(root, 'switch', '--detach', '-q');
    assert.deepEqual(await call('list_pending_comments', { repository: root }), []);
    git(root, 'switch', '-q', 'main');
    assert.deepEqual((await call('list_pending_comments', { repository: root })).map(comment => comment.id), [main.id]);
    await fs.rename(root, root + '-old');
    await fs.mkdir(root);
    git(root, 'init', '-qb', 'main');
    assert.deepEqual(await call('list_pending_comments', { repository: root }), []);
});

test('editing pending feedback preserves its snapshot and rejects replies to stale revisions', async () => {
    const repository = await fs.mkdtemp(path.join(temp, 'edit-feedback-'));
    git(repository, 'init', '-qb', 'main');
    const scope = await getReviewScope(repository);
    const first = await addComment(scope, feedback);
    const original = await call('get_comment_context', { repository, id: first.id });

    await assert.rejects(editFeedback(scope, first.id, ' ', 0), /Write feedback/);
    await editFeedback(scope, first.id, 'Updated request', 0);
    await assert.rejects(editFeedback(scope, first.id, 'Stale edit', 0), /Feedback changed/);
    await editFeedback(scope, first.id, 'Final request', 1);
    const updated = await call('get_comment_context', { repository, id: first.id });
    assert.deepEqual(updated, { ...original, feedback: 'Final request', revision: 2 });
    const reply = { repository, id: first.id, summary: 'Updated the value' };
    const stale = await client.callTool({ name: 'record_comment_reply', arguments: reply });
    assert.equal(stale.isError, true);
    assert.match(stale.content[0].text, /Feedback changed/);
    assert.equal((await call('list_pending_comments', { repository }))[0].feedback, 'Final request');
    assert.equal((await call('record_comment_reply', { ...reply, revision: updated.revision })).status, 'recorded');
    assert.equal((await call('record_comment_reply', { ...reply, revision: updated.revision })).status, 'already_recorded');
    await assert.rejects(editFeedback(scope, first.id, 'Too late', updated.revision), /Only pending feedback/);
    assert.deepEqual(await call('list_pending_comments', { repository }), []);
});

test('a concurrent edit and reply cannot both claim the same feedback revision', async () => {
    const repository = await fs.mkdtemp(path.join(temp, 'edit-race-'));
    git(repository, 'init', '-qb', 'main');
    const scope = await getReviewScope(repository);
    const comment = await addComment(scope, feedback);
    const reply = { summary: 'Answered the original request' };
    const [edit, answer] = await Promise.allSettled([
        editFeedback(scope, comment.id, 'Updated request', 0),
        recordReply(scope, comment.id, reply)
    ]);
    assert.notEqual(edit.status, answer.status);
    const [saved] = await listComments(scope);
    if (edit.status === 'fulfilled') {
        assert.match(answer.reason.message, /Feedback changed/);
        assert.equal(saved.feedback, 'Updated request');
        assert.equal(saved.reply, undefined);
    } else {
        assert.match(edit.reason.message, /Only pending feedback|was edited or answered/);
        assert.equal(saved.feedback, feedback.feedback);
        assert.deepEqual(saved.reply, reply);
    }
});

test('successive follow-ups are pending with fresh IDs and preserve the thread history', async () => {
    const repository = await fs.mkdtemp(path.join(temp, 'follow-up-'));
    git(repository, 'init', '-qb', 'main');
    const scope = await getReviewScope(repository);
    const first = await addComment(scope, feedback);
    await call('record_comment_reply', { repository, id: first.id, summary: 'First fix' });
    const next = await addFollowUp(scope, first.id, {
        ...feedback, feedback: 'Try another value', createdAt: '2025-12-31T23:59:59.000Z'
    });
    const list = await call('list_pending_comments', { repository });
    assert.equal(list.find(comment => comment.id === first.id), undefined);
    assert.equal(list.find(comment => comment.id === next.id).threadId, first.id);
    const nextContext = await call('get_comment_context', { repository, id: next.id });
    assert.equal(nextContext.feedback, 'Try another value');
    assert.deepEqual(nextContext.previous, { feedback: feedback.feedback, summary: 'First fix' });
    assert.deepEqual(await call('mark_resolved_review', { repository }), { resolved: 0 });
    await editFeedback(scope, next.id, 'Try this exact value', 0);
    await call('record_comment_reply', { repository, id: next.id, revision: 1, summary: 'Second fix' });
    const final = await addFollowUp(scope, next.id, { ...feedback, feedback: 'One more change' });
    const finalContext = await call('get_comment_context', { repository, id: final.id });
    assert.equal(finalContext.threadId, first.id);
    assert.deepEqual(finalContext.history, [nextContext.previous, { feedback: 'Try this exact value', summary: 'Second fix' }]);
    assert.deepEqual(finalContext.previous, { feedback: 'Try this exact value', summary: 'Second fix' });
    await call('record_comment_reply', { repository, id: final.id, summary: 'Third fix' });
    const entries = await listComments(scope);
    const ids = [first.id, next.id, final.id];
    assert.deepEqual(entries.map(comment => comment.id), ids);
    assert.equal(entries.find(comment => comment.id === first.id).reply.summary, 'First fix');
    assert.equal(entries.find(comment => comment.id === next.id).reply.summary, 'Second fix');
    assert.deepEqual(await call('mark_resolved_review', { repository }), { resolved: 1 });
    assert.ok((await listComments(scope)).every(comment => comment.resolved));
    await dismissComment(scope, first.id);
    assert.deepEqual(await listComments(scope), []);
});

test('older unscoped records are preserved and require explicit import', async () => {
    const root = await fs.realpath(await fs.mkdtemp(path.join(temp, 'legacy-')));
    git(root, 'init', '-qb', 'main');
    const id = 'e8dcac62-d682-4f94-b5e1-2f7b710c46aa';
    const legacy = path.join(storeRoot(), createHash('sha256').update(root).digest('hex'), id);
    await fs.mkdir(legacy, { recursive: true });
    await fs.writeFile(path.join(legacy, 'comment.json'), JSON.stringify({ ...feedback, id }));
    assert.deepEqual(await call('list_pending_comments', { repository: root }), []);
    assert.deepEqual(await call('clean_review', { repository: root }), { removed: 0 });
    assert.equal(await adoptLegacyComments(await getReviewScope(root)), 1);
    assert.deepEqual((await call('list_pending_comments', { repository: root })).map(comment => comment.id), [id]);
    assert.equal(await adoptLegacyComments(await getReviewScope(root)), 0);
    const scope = await getReviewScope(root);
    const reply = { summary: 'Existing answer' };
    await fs.writeFile(path.join(scope.store, id, 'reply.json'), JSON.stringify(reply));
    assert.deepEqual(await call('list_pending_comments', { repository: root }), []);
    assert.deepEqual(await recordReply(scope, id, { summary: 'Retry' }), { status: 'already_recorded', reply });
});

test('reftable checkouts isolate symbolic and detached HEAD', async t => {
    const root = await fs.mkdtemp(path.join(temp, 'reftable-'));
    const init = spawnSync('git', ['init', '-qb', 'main', '--ref-format=reftable'], { cwd: root, encoding: 'utf8' });
    if (init.status !== 0 && /unknown option/.test(init.stderr)) {
        t.skip('This Git version does not support reftable.');
        return;
    }
    assert.equal(init.status, 0, init.stderr);
    git(root, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '--allow-empty', '-qm', 'Initial commit');
    const comment = await addComment(root, feedback);
    git(root, 'switch', '-qc', 'feature');
    assert.deepEqual(await call('list_pending_comments', { repository: root }), []);
    git(root, 'switch', '--detach', '-q');
    assert.deepEqual(await call('list_pending_comments', { repository: root }), []);
    git(root, 'switch', '-q', 'main');
    assert.equal((await call('list_pending_comments', { repository: root }))[0].id, comment.id);
});

test('bulk resolution and concurrent follow-ups compete for the same thread state', async () => {
    const repository = await fs.mkdtemp(path.join(temp, 'thread-race-'));
    git(repository, 'init', '-qb', 'main');
    const scope = await getReviewScope(repository);
    const root = await addComment(scope, feedback);
    await call('record_comment_reply', { repository, id: root.id, summary: 'First fix' });
    const [a, b, resolve] = await Promise.allSettled([
        addFollowUp(scope, root.id, feedback),
        addFollowUp(scope, root.id, feedback),
        call('mark_resolved_review', { repository })
    ]);
    assert.equal(resolve.status, 'fulfilled');
    const pending = await call('list_pending_comments', { repository });
    const appended = [a, b].filter(outcome => outcome.status === 'fulfilled').map(outcome => outcome.value.id);
    assert.equal(appended.length + resolve.value.resolved, 1);
    assert.deepEqual(pending.map(comment => comment.id), appended);
});

test('fresh context respects nested repository ownership', async () => {
    const nested = path.join(repository, 'nested');
    await fs.mkdir(nested);
    await fs.writeFile(path.join(nested, 'app.txt'), 'base\n');
    const comment = await addComment(repository, { ...feedback, file: 'nested/app.txt' });
    assert.equal((await call('get_comment_context', { repository, id: comment.id })).current.status, 'unchanged');
    git(nested, 'init', '-qb', 'main');
    assert.deepEqual((await call('get_comment_context', { repository, id: comment.id })).current, { status: 'unavailable' });
});
