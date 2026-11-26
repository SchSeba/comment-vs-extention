const projectGuidance = [
    'Before fetching or addressing comments, read the review checkout’s AGENTS.md and any CODING.md, VALIDATION.md, and REVIEWING.md in .ai-rules/.',
    'Identify the project by its canonical Git remote’s repository name, or the worktree name if there is no remote.',
    'Use an available checkout of https://github.com/SchSeba/ai-plugins, or clone it into a temporary directory.',
    'Read projects/<project>/CODING.md, REVIEWING.md, and VALIDATION.md there when present, and apply the guidance to the fixes and their verification.',
    'Give the review checkout’s own instructions precedence. If the shared guidance is unavailable, say so and use the checkout’s guidance.'
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

module.exports = { projectGuidance, handlingGuidance };
