const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { createHash, randomUUID } = require('node:crypto');

const idPattern = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const maxFeedbackLength = 8000;

const isPendingComment = comment => !comment.reply && !comment.resolved;

function storeRoot() {
    return path.resolve(process.env.CODEX_HOME || path.join(os.homedir(), '.codex'), 'local-review');
}

async function repositoryStore(repository) {
    if (!path.isAbsolute(repository)) throw new Error('Use the absolute Git worktree root.');
    const canonical = await fs.realpath(repository);
    return path.join(storeRoot(), createHash('sha256').update(canonical).digest('hex'));
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
    return { ...comment, reply, resolved };
}

async function getComment(repository, id) {
    if (!idPattern.test(id)) throw new Error('Invalid review comment ID.');
    return readComment(path.join(await repositoryStore(repository), id));
}

async function listComments(repository) {
    const store = await repositoryStore(repository);
    const comments = await Promise.all((await commentIds(store)).map(id => readComment(path.join(store, id))));
    return comments.filter(Boolean).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

async function recordReply(repository, id, reply) {
    if (!idPattern.test(id)) throw new Error('Invalid review comment ID.');
    const directory = path.join(await repositoryStore(repository), id);
    if (!await readJson(path.join(directory, 'comment.json'))) {
        throw new Error('This comment is no longer available in the specified worktree.');
    }
    const file = path.join(directory, 'reply.json');
    if (await createJson(file, reply)) return { status: 'recorded', reply };
    const saved = await readJson(file);
    if (!saved) throw new Error('This comment was dismissed.');
    return { status: 'already_recorded', reply: saved };
}

async function dismissComment(repository, id) {
    if (!idPattern.test(id)) throw new Error('Invalid review comment ID.');
    await fs.rm(path.join(await repositoryStore(repository), id), { recursive: true, force: true });
}

async function resolveComment(repository, id) {
    if (!idPattern.test(id)) throw new Error('Invalid review comment ID.');
    const directory = path.join(await repositoryStore(repository), id);
    if (!await readJson(path.join(directory, 'comment.json'))) return false;
    try {
        return await createJson(path.join(directory, 'resolved.json'), true);
    } catch (error) {
        if (error.code === 'ENOENT') return false; // The comment was dismissed concurrently.
        throw error;
    }
}

async function resolveAnsweredComments(repository) {
    const answered = (await listComments(repository)).filter(comment => comment.reply && !comment.resolved);
    const results = await Promise.all(answered.map(comment => resolveComment(repository, comment.id)));
    return results.filter(Boolean).length;
}

async function cleanReview(repository) {
    const store = await repositoryStore(repository);
    const ids = await commentIds(store);
    await Promise.all(ids.map(id => fs.rm(path.join(store, id), { recursive: true, force: true })));
    return ids.length;
}

module.exports = {
    addComment, cleanReview, dismissComment, getComment, isPendingComment, listComments, maxFeedbackLength,
    recordReply, resolveAnsweredComments, resolveComment, storeRoot
};
