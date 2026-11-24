const projectGuidance = [
    'Before fetching or addressing comments, read the review checkout’s AGENTS.md and any CODING.md, VALIDATION.md, and REVIEWING.md in .ai-rules/.',
    'Identify the project by its canonical Git remote’s repository name, or the worktree name if there is no remote.',
    'Use an available checkout of https://github.com/SchSeba/ai-plugins, or clone it into a temporary directory.',
    'Read projects/<project>/CODING.md, REVIEWING.md, and VALIDATION.md there when present, and apply the guidance to the fixes and their verification.',
    'Give the review checkout’s own instructions precedence. If the shared guidance is unavailable, say so and use the checkout’s guidance.'
].join(' ');

module.exports = { projectGuidance };
