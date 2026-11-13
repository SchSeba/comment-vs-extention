---
name: mark-resolved-review
description: Mark answered Local Review comments as resolved when the user explicitly asks to resolve Codex's answered comments in their VS Code Git worktree.
---

# Resolve answered Local Review comments

Use the worktree the user specifies or find the current absolute Git worktree root with `git rev-parse --show-toplevel`. Ask which worktree to use if the target is ambiguous.

Call the `local-review` MCP server's `mark_resolved_review` tool with that root as `repository` and the `scope` from the user's prompt if provided. Report the number of threads resolved on the current branch. The tool preserves replies and leaves threads with pending feedback open. If the tool is missing, tell the user to resume Codex after upgrading Local Review.
