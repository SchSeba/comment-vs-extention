---
name: clean-review
description: Clear all Local Review comments and replies when the user explicitly asks to clean the current VS Code Git worktree's review.
---

# Clean Local Review

Use the worktree the user specifies or find the current absolute Git worktree root with `git rev-parse --show-toplevel`. Ask which worktree to use if the target is ambiguous.

Call the `local-review` MCP server's `clean_review` tool with that root as `repository` only when the user's message explicitly requests clearing the review. Report the number of comments removed. If the tool is missing, tell the user to resume Codex after upgrading Local Review.
