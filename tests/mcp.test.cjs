const { after, before, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');
const { addComment, dismissComment, listComments, resolveComment } = require('../review-store.cjs');
const { captureNearbyLines } = require('../review-context.cjs');

let temp;
let repository;
let otherRepository;
let client;

before(async () => {
    temp = await fs.mkdtemp(path.join(os.tmpdir(), 'local-review-'));
    process.env.CODEX_HOME = path.join(temp, 'codex');
    repository = path.join(temp, 'repo');
    otherRepository = path.join(temp, 'other');
    await Promise.all([fs.mkdir(repository), fs.mkdir(otherRepository)]);
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

test('MCP lists worktree comments and preserves the first summary across concurrent replies', async () => {
    assert.deepEqual((await client.listTools()).tools.map(tool => tool.name).sort(),
        ['clean_review', 'get_comment_context', 'list_pending_comments', 'mark_resolved_review', 'record_comment_reply']);
    const comment = await addComment(repository, {
        file: 'src/main.js', side: 'working', firstLine: 4, lastLine: 5,
        excerpt: 'return old;', feedback: 'Use the new value', createdAt: new Date().toISOString()
    });
    assert.deepEqual(await fs.readdir(repository), []);
    assert.deepEqual(await call('list_pending_comments', { repository: otherRepository }), []);
    assert.deepEqual(await call('list_pending_comments', { repository }), [{
        id: comment.id, file: comment.file, side: comment.side, firstLine: 4, lastLine: 5,
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
    assert.deepEqual(await fs.readdir(repository), []);
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
