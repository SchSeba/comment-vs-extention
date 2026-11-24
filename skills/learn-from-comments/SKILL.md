---
name: learn-from-comments
description: Derive reusable project guidance from completed Local Review threads. Use when asked what to learn from a local review or when publish-review-learnings needs evidence-backed guidance.
---

# Learn from comments

1. Identify the reviewed worktree, branch, and project. Use the repository name from the canonical Git remote for the project directory, or the worktree name if there is no remote. Ask if multiple destinations are plausible. Call `list_review_history` with the absolute worktree root and the review scope if supplied. Keep the returned scope for any reread. If the user identifies specific threads, restrict the evidence to them. Read each thread in order, including follow-ups.
2. Read [ai-plugins retrospective](https://github.com/SchSeba/ai-plugins/blob/main/skills/retrospective/SKILL.md) from the supplied ai-plugins clone when available, or from the upstream repository. Use the local thread history in place of its merged-PR intake. Follow **Derive durable lessons**, using the final reviewed changes to verify each candidate. A Local Review reply is evidence of a fix. Confirm the lesson against the code and existing project guidance.
3. Report the lessons by default. If the caller supplies an ai-plugins clone for updates, read its instructions and follow **Update guidance** for the project identified in step 1. Keep any private details, secrets, source excerpts, and raw feedback out of the files under `projects/<project>/`. If nothing merits updating, report why and leave the clone clean.
