---
name: clean-review
description: Clear all Local Review comments and replies when the user explicitly asks to clean the current VS Code Git worktree's review.
---

# Clean Local Review

Use the worktree the user specifies or find the current absolute Git worktree root with `git rev-parse --show-toplevel`. Ask which worktree to use if the target is ambiguous.

Call the `local-review` MCP server's `clean_review` tool with that root as `repository` and the `scope` from the user's prompt if provided. This clears the current branch's review. Only call when the user explicitly requests clearing it. Report the number of comments removed. If the tool is missing, tell the user to resume Codex after upgrading Local Review.
