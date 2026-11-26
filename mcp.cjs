const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { z } = require('zod');
const { cleanReview, fileBelongsToReview, getCommentThread, isPendingComment, listComments, recordReply, requireReviewScope, resolveAnsweredComments } = require('./review-store.cjs');
const { readWorkingContext } = require('./review-context.cjs');
const { projectGuidance, changeGuidance, handlingGuidance } = require('./review-guidance.cjs');
const { version } = require('./package.json');

const server = new McpServer({ name: 'local-review', version }, {
    instructions: `When addressing pending Local Review comments, use this workflow. ${projectGuidance} ${changeGuidance} ${handlingGuidance}`
});
const repository = z.string().min(1).describe('Absolute Git worktree root (git rev-parse --show-toplevel).');
const scope = z.string().regex(/^[0-9a-f]{64}$/).optional()
    .describe('Review scope from the copied prompt or pending comment. Pass it to subsequent calls to detect a checkout or branch change.');
const result = value => ({ content: [{ type: 'text', text: JSON.stringify(value) }] });

function reviewPayload(comment, scope) {
    return {
        id: comment.id,
        scope: scope.key,
        branch: scope.branch,
        ...(comment.threadId && { threadId: comment.threadId }),
        file: comment.file,
        side: comment.side,
        firstLine: comment.firstLine,
        lastLine: comment.lastLine,
        excerpt: comment.excerpt,
        feedback: comment.feedback,
        ...(comment.revision && { revision: comment.revision }),
        ...(comment.truncated && { excerptTruncated: true }),
        ...(comment.context && { context: comment.context })
    };
}

server.registerTool('list_pending_comments', {
    description: 'List pending Local Review feedback for the current Git checkout and branch. First follow the server instructions to establish or refresh the change context in chat. Pass each returned scope to subsequent calls, and call get_comment_context just before addressing each comment.',
    inputSchema: { repository, scope },
    annotations: { readOnlyHint: true, openWorldHint: false }
}, async ({ repository, scope }) => {
    const current = await requireReviewScope(repository, scope);
    const comments = await listComments(current);
    await requireReviewScope(repository, current.key);
    return result(comments.filter(isPendingComment)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
        .map(comment => reviewPayload(comment, current)));
});

server.registerTool('list_review_history', {
    description: 'List feedback and verified reply summaries from completed Local Review threads in the current Git checkout and branch, including resolved threads. Threads with unanswered follow-ups are omitted. Use as local evidence for review learnings.',
    inputSchema: { repository, scope },
    annotations: { readOnlyHint: true, openWorldHint: false }
}, async ({ repository, scope }) => {
    const current = await requireReviewScope(repository, scope);
    const comments = await listComments(current);
    await requireReviewScope(repository, current.key);
    const incomplete = new Set(comments.filter(comment => !comment.reply).map(comment => comment.threadId ?? comment.id));
    return result(comments.filter(comment => !incomplete.has(comment.threadId ?? comment.id))
        .map(comment => ({
            id: comment.id,
            threadId: comment.threadId ?? comment.id,
            scope: current.key,
            branch: current.branch,
            file: comment.file,
            feedback: comment.feedback,
            summary: comment.reply.summary,
            resolved: comment.resolved
        })));
});

server.registerTool('get_comment_context', {
    description: 'Refresh a pending comment by ID immediately before addressing it, including after editing another comment in the same file. Follow-ups include earlier feedback and reply summaries in thread order. The original snapshot is historical. A changed range is an area to inspect. Ambiguous, deleted, or unlocated text has no confirmed current line.',
    inputSchema: { repository, scope, id: z.string().uuid() },
    annotations: { readOnlyHint: true, openWorldHint: false }
}, async ({ repository, scope, id }) => {
    const review = await requireReviewScope(repository, scope);
    const thread = await getCommentThread(review, id);
    const comment = thread.find(entry => entry.id === id);
    if (!comment || !isPendingComment(comment)) throw new Error('This comment is no longer pending in the current review.');
    const history = thread.filter(entry => entry.reply)
        .map(entry => ({ feedback: entry.feedback, summary: entry.reply.summary }));
    const current = await readWorkingContext(review.root, comment, file => fileBelongsToReview(review, file));
    await requireReviewScope(repository, review.key);
    return result({
        ...reviewPayload(comment, review),
        ...(history.length && { history, previous: history.at(-1) }),
        current
    });
});

server.registerTool('record_comment_reply', {
    description: 'Save one short, user-visible summary with the verified answer or fix and observed evidence after checking the final diff. Use the ID and revision from get_comment_context. If feedback changed, refresh it and verify the updated request before replying. Leave blocked comments pending.',
    inputSchema: {
        repository,
        scope,
        id: z.string().uuid(),
        revision: z.number().int().nonnegative().optional().describe('Pass the revision returned by get_comment_context when present.'),
        summary: z.string().trim().min(1).max(1500)
    },
    annotations: { idempotentHint: true, destructiveHint: false, openWorldHint: false }
}, async ({ repository, scope, id, revision, summary }) =>
    result(await recordReply(await requireReviewScope(repository, scope), id, { summary }, revision)));

server.registerTool('mark_resolved_review', {
    description: 'Mark fully answered Local Review threads as resolved for the current checkout and branch. Only call when the user explicitly requests it. Threads with pending follow-ups and all replies are preserved.',
    inputSchema: { repository, scope },
    annotations: { idempotentHint: true, destructiveHint: false, openWorldHint: false }
}, async ({ repository, scope }) => result({ resolved: await resolveAnsweredComments(await requireReviewScope(repository, scope)) }));

server.registerTool('clean_review', {
    description: 'Remove Local Review comments and replies for the current checkout and branch. Only call when the user explicitly requests clearing this review. Git files are unaffected.',
    inputSchema: { repository, scope },
    annotations: { idempotentHint: true, destructiveHint: true, openWorldHint: false }
}, async ({ repository, scope }) => result({ removed: await cleanReview(await requireReviewScope(repository, scope)) }));

server.connect(new StdioServerTransport()).catch(error => {
    console.error(error.message);
    process.exitCode = 1;
});
