const fs = require('node:fs/promises');
const { constants } = require('node:fs');
const path = require('node:path');

const nearbyLines = 3;
const maxNearbyLineLength = 250;
const maxExcerptLength = 4000;
const maxWorkingFileSize = 1024 * 1024;

const usableNeighbour = neighbour => !neighbour.truncated && Boolean(neighbour.text.trim());

function captureNearbyLines(lineAt, lineCount, firstLine, lastLine) {
    function capture(from, to) {
        const lines = [];
        for (let line = from; line <= to; line++) {
            const text = lineAt(line);
            lines.push({
                line,
                text: text.slice(0, maxNearbyLineLength),
                ...(text.length > maxNearbyLineLength && { truncated: true })
            });
        }
        return lines;
    }
    return {
        before: capture(Math.max(1, firstLine - nearbyLines), firstLine - 1),
        after: capture(lastLine + 1, Math.min(lineCount, lastLine + nearbyLines))
    };
}

function uniqueBoundary(lines, neighbours) {
    for (const neighbour of neighbours) {
        if (!usableNeighbour(neighbour)) continue;
        const position = lines.indexOf(neighbour.text);
        if (position !== -1 && position === lines.lastIndexOf(neighbour.text)) return position + 1;
    }
}

function contextBounds(lines, comment) {
    if (!comment.context) return undefined;
    const above = uniqueBoundary(lines, [...comment.context.before].reverse());
    const below = uniqueBoundary(lines, comment.context.after);
    // Two nearby, individually unique lines can bracket edited or deleted text.
    if (!above || !below || above >= below || below - above > comment.lastLine - comment.firstLine + 13) {
        return undefined;
    }
    return { firstLine: above + 1, lastLine: below - 1 };
}

function contextScore(lines, comment, range) {
    if (!comment.context) return 0;
    const matches = (neighbours, original, current) => neighbours.filter(neighbour =>
        usableNeighbour(neighbour) &&
        lines[current + neighbour.line - original - 1] === neighbour.text).length;
    return matches(comment.context.before, comment.firstLine, range.firstLine) +
        matches(comment.context.after, comment.lastLine, range.lastLine);
}

function exactMatch(text, lines, comment, bounds) {
    if (comment.truncated || !comment.excerpt) return {};
    const excerpt = comment.excerpt.replace(/\r\n/g, '\n');
    const length = excerpt.split('\n').length;
    const file = `\n${text}\n`;
    const needle = `\n${excerpt}\n`;
    let line = 1;
    let lineStart = 0;
    let range;
    let bestScore = -1;
    let ambiguous = false;
    for (let index = file.indexOf(needle); index !== -1; index = file.indexOf(needle, index + 1)) {
        while (lineStart < index) {
            lineStart = file.indexOf('\n', lineStart + 1);
            line++;
        }
        const candidate = { firstLine: line, lastLine: line + length - 1 };
        if (bounds && (candidate.firstLine < bounds.firstLine || candidate.lastLine > bounds.lastLine)) continue;
        const score = contextScore(lines, comment, candidate);
        if (score > bestScore) {
            range = candidate;
            bestScore = score;
            ambiguous = false;
        } else if (score === bestScore) {
            ambiguous = true;
        }
    }
    // With context available, a lone copy elsewhere is not evidence that the original survived.
    if (!bounds && !ambiguous && bestScore === 0 && comment.context &&
        [...comment.context.before, ...comment.context.after].some(usableNeighbour)) return {};
    return { range, ambiguous };
}

function describeWorkingContext(comment, source) {
    const text = source.replace(/\r\n/g, '\n');
    const lines = text.split('\n');
    const bounds = contextBounds(lines, comment);
    const { range, ambiguous } = exactMatch(text, lines, comment, bounds);
    if (ambiguous) return { status: 'ambiguous' };
    if (!range && !bounds) return { status: 'unlocated' };

    const { firstLine, lastLine } = range ?? bounds;
    const context = captureNearbyLines(line => lines[line - 1], lines.length, firstLine, lastLine);
    if (lastLine < firstLine) return { status: 'deleted', context };
    const excerpt = lines.slice(firstLine - 1, lastLine).join('\n');
    const status = range ? (firstLine === comment.firstLine ? 'unchanged' : 'moved') : 'changed';
    return {
        status,
        firstLine,
        lastLine,
        excerpt: excerpt.slice(0, maxExcerptLength),
        ...(excerpt.length > maxExcerptLength && { excerptTruncated: true }),
        context
    };
}

function isInWorktree(root, file) {
    const relative = path.relative(root, file);
    const parts = relative.split(path.sep);
    return relative && !path.isAbsolute(relative) && parts[0] !== '..' &&
        !parts.some(part => part.toLowerCase() === '.git');
}

async function readWorkingContext(repository, comment) {
    if (comment.side !== 'working') return { status: 'original-side' };
    try {
        const root = await fs.realpath(repository);
        const file = path.resolve(root, comment.file);
        if (!isInWorktree(root, file)) return { status: 'unavailable' };
        const target = await fs.realpath(file);
        if (!isInWorktree(root, target)) return { status: 'unavailable' };
        const handle = await fs.open(target, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
        try {
            const stat = await handle.stat();
            if (!stat.isFile() || stat.size > maxWorkingFileSize) return { status: 'unavailable' };
            const bytes = Buffer.alloc(stat.size + 1);
            let length = 0;
            while (length < bytes.length) {
                const { bytesRead } = await handle.read(bytes, length, bytes.length - length, length);
                if (bytesRead === 0) break;
                length += bytesRead;
            }
            const after = await handle.stat();
            if (length !== stat.size || after.mtimeMs !== stat.mtimeMs || after.ctimeMs !== stat.ctimeMs) {
                return { status: 'unavailable' };
            }
            const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, length));
            return text.includes('\0') ? { status: 'unavailable' } : describeWorkingContext(comment, text);
        } finally {
            await handle.close();
        }
    } catch (error) {
        if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return { status: 'missing' };
        if (['EACCES', 'EPERM', 'ELOOP', 'ERR_ENCODING_INVALID_ENCODED_DATA'].includes(error.code)) {
            return { status: 'unavailable' };
        }
        throw error;
    }
}

module.exports = { captureNearbyLines, describeWorkingContext, maxExcerptLength, readWorkingContext };
