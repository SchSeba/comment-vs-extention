const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { z } = require('zod');
const { cleanReview, getComment, isPendingComment, listComments, recordReply, resolveAnsweredComments } = require('./review-store.cjs');
const { readWorkingContext } = require('./review-context.cjs');
const { version } = require('./package.json');

const server = new McpServer({ name: 'local-review', version });
const repository = z.string().min(1).describe('Absolute Git worktree root (git rev-parse --show-toplevel).');
const result = value => ({ content: [{ type: 'text', text: JSON.stringify(value) }] });

function reviewPayload(comment) {
    return {
        id: comment.id,
        file: comment.file,
        side: comment.side,
        firstLine: comment.firstLine,
        lastLine: comment.lastLine,
        excerpt: comment.excerpt,
        feedback: comment.feedback,
        ...(comment.truncated && { excerptTruncated: true }),
        ...(comment.context && { context: comment.context })
    };
}

server.registerTool('list_pending_comments', {
    description: 'List pending Local Review feedback and its original saved context for this Git worktree. Call get_comment_context before addressing each comment to account for edits since it was written.',
    inputSchema: { repository },
    annotations: { readOnlyHint: true, openWorldHint: false }
}, async ({ repository }) => {
    const comments = await listComments(repository);
    return result(comments.filter(isPendingComment).map(reviewPayload));
});

server.registerTool('get_comment_context', {
    description: 'Refresh a pending comment by ID immediately before addressing it, including after editing another comment in the same file. The original snapshot is historical. A changed range is an area to inspect. Ambiguous, deleted, or unlocated text has no confirmed current line.',
    inputSchema: { repository, id: z.string().uuid() },
    annotations: { readOnlyHint: true, openWorldHint: false }
}, async ({ repository, id }) => {
    const comment = await getComment(repository, id);
    if (!comment || !isPendingComment(comment)) throw new Error('This comment is no longer pending in the specified worktree.');
    return result({ ...reviewPayload(comment), current: await readWorkingContext(repository, comment) });
});

server.registerTool('record_comment_reply', {
    description: 'Save one short, user-visible summary after applying and verifying a Local Review comment. Use the exact ID returned by list_pending_comments. Leave blocked or unapplied comments pending and explain them in your Codex response.',
    inputSchema: {
        repository,
        id: z.string().uuid(),
        summary: z.string().trim().min(1).max(1500)
    },
    annotations: { idempotentHint: true, destructiveHint: false, openWorldHint: false }
}, async ({ repository, id, summary }) => result(await recordReply(repository, id, { summary })));

server.registerTool('mark_resolved_review', {
    description: 'Mark answered Local Review comments as resolved in the specified worktree. Only call when the user explicitly requests it. Unanswered comments and all replies are preserved.',
    inputSchema: { repository },
    annotations: { idempotentHint: true, destructiveHint: false, openWorldHint: false }
}, async ({ repository }) => result({ resolved: await resolveAnsweredComments(repository) }));

server.registerTool('clean_review', {
    description: 'Remove all Local Review comments and replies in the specified worktree. Only call when the user explicitly requests clearing this worktree. Git files are unaffected.',
    inputSchema: { repository },
    annotations: { idempotentHint: true, destructiveHint: true, openWorldHint: false }
}, async ({ repository }) => result({ removed: await cleanReview(repository) }));

server.connect(new StdioServerTransport()).catch(error => {
    console.error(error.message);
    process.exitCode = 1;
});
