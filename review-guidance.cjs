const projectGuidance = [
    'On the first comment-handling round for this review in the current chat, read the checkout’s README and applicable AGENTS.md files. Establish what the project does and how it is used and tested. Read any CODING.md, VALIDATION.md, and REVIEWING.md in .ai-rules/.',
    'Identify the project by its canonical Git remote’s repository name, or the worktree name if there is no remote.',
    'Use an available checkout of https://github.com/SchSeba/ai-plugins, or clone it into a temporary directory.',
    'Read projects/<project>/CODING.md, REVIEWING.md, and VALIDATION.md there when present, and apply the guidance to the fixes and their verification.',
    'Give the review checkout’s own instructions precedence. If the shared guidance is unavailable, say so and use the checkout’s guidance.'
].join(' ');

const changeGuidance = [
    'On that first round, before fetching feedback, inspect the full relevant Git diff independently of comment excerpts. Use the comparison requested in this chat.',
    'For a branch or PR, inspect the committed patch from the merge base of the target and review head to the review head (or use the supplied commit range). Clarify the comparison if different plausible bases give different changes. For a local Source Control review, start with the checkout’s uncommitted changes.',
    'Check git status, read the staged and unstaged patches separately and inspect relevant untracked files. Include paths without comments and read AGENTS.md files governing changed paths.',
    'Trace the affected entry points, callers and tests to understand the feature or bug, why the approach was chosen, and how behavior flows before and after the change.',
    'Write a brief account in chat before acting on comments. Identify the comparison, intent, rationale, implementation flow and test coverage. Distinguish inferred intent from established facts.',
    'Ask a specific question when unresolved intent would change the expected behavior or fix. Wait for the answer before taking dependent action. Proceed when intent is clear.',
    'On later rounds in this chat, reuse that account for the same review. Check for changes to the range, patches, instructions or reviewer decisions, inspect what changed and update the account when needed. Rebuild it for a different review or missing context.'
].join(' ');

const handlingGuidance = [
    'Read the AGENTS.md files that apply to the affected paths. Use the repository’s prescribed validation commands.',
    'Work through comments on the same file in listed order. Call get_comment_context for each ID before addressing it and refresh it immediately before editing.',
    'Read its thread history, including earlier decisions and reverts. Compare the historical excerpt with the current diff and verify uncertain locations.',
    'Investigate the reviewer’s premise using callers, tests, and pinned dependencies where relevant. Answer questions from that evidence.',
    'For requested changes, plan the fix and a case that would expose a wrong fix. Implement the request, preserve existing edits, and answer any accompanying question.',
    'Run focused tests for changed behavior and add regression coverage when needed. Inspect the resulting text for wording edits. Run required repository checks on the final changes.',
    'Before recording any replies, recheck each target against the final diff and rerun checks affected by later edits.',
    'Use record_comment_reply with the pending ID and revision from get_comment_context when present. Cite the file or symbol, the finding or fix, and the actual test command and result when tested.',
    'If feedback changed, refresh it and verify the updated request before replying. Leave blocked items pending, including those affected by a failed or unavailable required check. Continue with independent items.',
    'Recap each comment with its file and reply or the specific blocker.'
].join(' ');

function copiedFollowUp(repository, scope) {
    return [
        `Address my pending Local Review comments in the Git worktree ${JSON.stringify(repository)} on ${JSON.stringify(scope.branch)}. Use review scope ${scope.key}.`,
        projectGuidance,
        changeGuidance,
        'Call local-review list_pending_comments with that worktree root as repository and the review scope as scope. Pass both to every Local Review tool call, and stop if the checkout or branch changed.',
        handlingGuidance
    ].join(' ');
}

module.exports = { projectGuidance, changeGuidance, handlingGuidance, copiedFollowUp };
