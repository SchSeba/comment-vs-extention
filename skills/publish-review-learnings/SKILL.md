---
name: publish-review-learnings
description: Publish guidance from a completed Local Review in an ai-plugins pull request. Use when the user asks to publish lessons from their review.
---

# Publish review learnings

1. Keep the original review worktree as the source. Clone [SchSeba/ai-plugins](https://github.com/SchSeba/ai-plugins) into a fresh temporary directory and base a topic branch on its remote default branch.
2. Use [learn-from-comments](../learn-from-comments/SKILL.md) with the original review worktree as input and the temporary clone as the destination for guidance. If it produces no updates, report why and stop.
3. Follow **Validate and publish** in the clone's `skills/retrospective/SKILL.md` in manual mode. Check that the diff contains only project guidance suitable for this public repository. Keep the reviewed repository and its Git state intact. Publish from the temporary clone's topic branch and target the ai-plugins default branch explicitly when opening the PR.
4. Report the PR URL, lessons, and validation results. If access prevents publication, retain the validated changes and report their path and the blocker.
