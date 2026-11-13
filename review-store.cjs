const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { createHash, randomUUID } = require('node:crypto');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const idPattern = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const maxFeedbackLength = 8000;
const runGit = promisify(execFile);
const hash = text => createHash('sha256').update(text).digest('hex');
const gitEnv = () => Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.toUpperCase().startsWith('GIT_')));

const isPendingComment = comment => !comment.reply && !comment.resolved;

function storeRoot() {
    return path.resolve(process.env.CODEX_HOME || path.join(os.homedir(), '.codex'), 'local-review');
}

async function getReviewScope(repository) {
    if (!path.isAbsolute(repository)) throw new Error('Use the absolute Git worktree root.');
    const root = await fs.realpath(repository);
    const env = gitEnv();
    const { stdout } = await runGit('git', ['-C', root, 'rev-parse', '--show-toplevel', '--absolute-git-dir'],
        { env, windowsHide: true });
    const lines = stdout.slice(0, -1);
    const prefix = process.platform === 'win32' ? root.replace(/\\/g, '/') : root;
    const separator = lines.indexOf('\n', prefix.length);
    if (separator < 0 || await fs.realpath(lines.slice(0, separator)) !== root) {
        throw new Error('Use the absolute Git worktree root.');
    }
    const gitDir = await fs.realpath(lines.slice(separator + 1));
    const identity = await fs.stat(gitDir, { bigint: true });
    const git = async (...args) => (await runGit('git', ['-C', root, ...args], { env, windowsHide: true })).stdout.trim();
    const symbolicHead = () => git('symbolic-ref', '-q', '--no-recurse', 'HEAD').catch(error => {
        if (error.code !== 1) throw error;
    });
    let head = await symbolicHead();
    if (!head) {
        const commit = await git('rev-parse', '--verify', 'HEAD');
        head = await symbolicHead() ?? commit;
    }
    const branch = head.startsWith('refs/heads/') ? head.slice('refs/heads/'.length) : head;
    const key = hash(JSON.stringify([root, gitDir, String(identity.dev), String(identity.ino), String(identity.birthtimeNs), head]));
    const legacyStore = path.join(storeRoot(), hash(root));
    return { root, key, branch, legacyStore, store: path.join(legacyStore, 'scopes', key) };
}

async function requireReviewScope(repository, expectedScope) {
    const scope = await getReviewScope(repository);
    if (expectedScope && expectedScope !== scope.key) throw new Error('The checkout or branch changed. Start the review again.');
    return scope;
}

async function fileBelongsToReview(scope, file) {
    try {
        const { stdout } = await runGit('git', ['-C', path.dirname(file), 'rev-parse', '--show-toplevel'],
            { env: gitEnv(), windowsHide: true });
        return await fs.realpath(stdout.slice(0, -1)) === scope.root;
    } catch {
        return false;
    }
}

async function repositoryStore(repository) {
    return typeof repository === 'string' ? (await getReviewScope(repository)).store : repository.store;
}

async function readJson(file) {
    try {
        return JSON.parse(await fs.readFile(file, 'utf8'));
    } catch (error) {
        if (error.code !== 'ENOENT') throw error;
    }
}

// Publish complete files atomically. Hard links also ensure that retries and
// concurrent responders cannot overwrite the first saved reply.
async function createJson(file, value) {
    const temporary = `${file}.${randomUUID()}.tmp`;
    await fs.writeFile(temporary, `${JSON.stringify(value)}\n`, { mode: 0o600, flag: 'wx' });
    try {
        await fs.link(temporary, file);
        return true;
    } catch (error) {
        if (error.code !== 'EEXIST') throw error;
        return false;
    } finally {
        await fs.rm(temporary, { force: true });
    }
}

async function addComment(repository, comment) {
    const store = await repositoryStore(repository);
    const record = { ...comment, id: randomUUID() };
    const directory = path.join(store, record.id);
    await fs.mkdir(directory, { recursive: true, mode: 0o700 });
    await createJson(path.join(directory, 'comment.json'), record);
    return record;
}

async function addFollowUp(scope, id, comment) {
    const previous = await getComment(scope, id);
    if (!previous?.reply || previous.resolved) throw new Error('Open an answered review thread before adding a follow-up.');
    const threadId = previous.threadId ?? previous.id;
    const record = await addComment(scope, { ...comment, threadId, previousId: id });
    try {
        if (!await createJson(path.join(scope.store, id, 'next.json'), record.id)) {
            throw new Error('This review thread already has a follow-up or was resolved.');
        }
        if (!await getComment(scope, record.id)) throw new Error('This review thread was dismissed.');
        return record;
    } catch (error) {
        await fs.rm(path.join(scope.store, record.id), { recursive: true, force: true });
        throw error;
    }
}

async function commentIds(store) {
    try {
        const entries = await fs.readdir(store, { withFileTypes: true });
        return entries.filter(entry => entry.isDirectory() && idPattern.test(entry.name)).map(entry => entry.name);
    } catch (error) {
        if (error.code === 'ENOENT') return [];
        throw error;
    }
}

async function readComment(directory) {
    const comment = await readJson(path.join(directory, 'comment.json'));
    if (!comment) return undefined;
    const reply = await readJson(path.join(directory, 'reply.json'));
    const resolved = Boolean(await readJson(path.join(directory, 'resolved.json')));
    const next = await readJson(path.join(directory, 'next.json'));
    return { ...comment, reply, resolved, next };
}

async function getComment(repository, id) {
    if (!idPattern.test(id)) throw new Error('Invalid review comment ID.');
    const store = await repositoryStore(repository);
    const comment = await readComment(path.join(store, id));
    if (!comment) return;
    const root = comment.threadId ? await readComment(path.join(store, comment.threadId)) : comment;
    if (!root) return;
    return (await readThread(root, next => readComment(path.join(store, next)))).find(entry => entry.id === id);
}

async function readThread(root, getNext) {
    const entries = [root];
    let last = root;
    // Appending and resolving compete for the same immutable slot.
    while (typeof last.next === 'string' && idPattern.test(last.next)) {
        const child = await getNext(last.next);
        if (!child || child.threadId !== root.id || child.previousId !== last.id) break;
        entries.push(child);
        last = child;
    }
    const resolved = root.resolved || last.next === true;
    return entries.map(comment => ({ ...comment, resolved }));
}

async function listComments(repository) {
    const store = await repositoryStore(repository);
    const comments = await Promise.all((await commentIds(store)).map(id => readComment(path.join(store, id))));
    const byId = new Map(comments.filter(Boolean).map(comment => [comment.id, comment]));
    const roots = [...byId.values()].filter(comment => !comment.threadId)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
    const threads = await Promise.all(roots.map(root =>
        readThread(root, next => byId.get(next) ?? readComment(path.join(store, next)))));
    return threads.flat();
}

async function recordReply(repository, id, reply) {
    if (!idPattern.test(id)) throw new Error('Invalid review comment ID.');
    const directory = path.join(await repositoryStore(repository), id);
    const comment = await getComment({ store: path.dirname(directory) }, id);
    if (!comment || (comment.resolved && !comment.reply)) throw new Error('This comment is no longer available in the current review.');
    const file = path.join(directory, 'reply.json');
    if (await createJson(file, reply)) return { status: 'recorded', reply };
    const saved = await readJson(file);
    if (!saved) throw new Error('This comment was dismissed.');
    return { status: 'already_recorded', reply: saved };
}

async function dismissComment(repository, id) {
    if (!idPattern.test(id)) throw new Error('Invalid review comment ID.');
    const store = await repositoryStore(repository);
    let directory = path.join(store, id);
    let entryId = id;
    while (directory) {
        const discarded = path.join(store, `dismissed-${randomUUID()}`);
        try {
            await fs.rename(directory, discarded);
        } catch (error) {
            if (error.code !== 'ENOENT') throw error;
            return;
        }
        const next = await readJson(path.join(discarded, 'next.json'));
        await fs.rm(discarded, { recursive: true, force: true });
        if (typeof next !== 'string' || !idPattern.test(next) || next === entryId) return;
        entryId = next;
        directory = path.join(store, next);
    }
}

async function resolveComment(repository, id) {
    if (!idPattern.test(id)) throw new Error('Invalid review comment ID.');
    const store = await repositoryStore(repository);
    const root = await readComment(path.join(store, id));
    if (!root || root.threadId) return false;
    const last = (await readThread(root, next => readComment(path.join(store, next)))).at(-1);
    return closeThread(store, last);
}

async function closeThread(store, last) {
    if (last.resolved) return false;
    try {
        return await createJson(path.join(store, last.id, 'next.json'), true);
    } catch (error) {
        if (error.code === 'ENOENT') return false; // The comment was dismissed concurrently.
        throw error;
    }
}

async function resolveAnsweredComments(repository) {
    const store = await repositoryStore(repository);
    const comments = await listComments({ store });
    const answered = comments.filter(comment => comment.reply && !comment.resolved && comment.next === undefined);
    const results = await Promise.all(answered.map(comment => closeThread(store, comment)));
    return results.filter(Boolean).length;
}

async function cleanReview(repository) {
    const store = await repositoryStore(repository);
    const ids = await commentIds(store);
    await Promise.all(ids.map(id => fs.rm(path.join(store, id), { recursive: true, force: true })));
    return ids.length;
}

async function listLegacyComments(scope) {
    return commentIds(scope.legacyStore);
}

async function adoptLegacyComments(scope) {
    await requireReviewScope(scope.root, scope.key);
    if (!(await listLegacyComments(scope)).length) return 0;
    const claim = path.join(scope.legacyStore, 'legacy-import.json');
    if (!await createJson(claim, scope.key) && await readJson(claim) !== scope.key) {
        throw new Error('Older comments were already assigned to another review. Resume the import on that branch.');
    }
    await fs.mkdir(scope.store, { recursive: true, mode: 0o700 });
    let moved = 0;
    for (const id of await listLegacyComments(scope)) {
        try {
            await fs.rename(path.join(scope.legacyStore, id), path.join(scope.store, id));
            moved++;
        } catch (error) {
            if (error.code !== 'ENOENT') throw error;
        }
    }
    return moved;
}

module.exports = {
    addComment, addFollowUp, adoptLegacyComments, cleanReview, dismissComment, fileBelongsToReview, getComment, getReviewScope,
    isPendingComment, listComments, listLegacyComments, maxFeedbackLength, recordReply, requireReviewScope,
    resolveAnsweredComments, resolveComment, storeRoot
};
