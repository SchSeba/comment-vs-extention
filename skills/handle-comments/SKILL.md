---
name: handle-comments
description: Address pending Local Review comments from the VS Code Source Control diff when the user asks to handle, check, or fix their Local Review comments.
---

# Handle Local Review comments

1. Find the absolute Git worktree root with `git rev-parse --show-toplevel`. If the user specifies a worktree, use that worktree. If the target is ambiguous, ask which worktree they mean.
2. Call the `local-review` MCP server's `list_pending_comments` tool with that root as `repository` and the `scope` from the user's prompt if provided. If the tool is unavailable, tell the user to check `/mcp` and resume their session after configuring the server. If the result is empty, report that there are no pending comments on the current branch.
3. Work through comments on the same file in listed order. Call `get_comment_context` with the worktree root and that comment's ID just before addressing it, even if you already read the file for an earlier comment. Inspect the current file against the saved excerpt and nearby lines. Saved line numbers refer to the original snapshot. A changed range is an area to inspect. For ambiguous or missing anchors, act only when you can verify the target from the current code and the feedback.
4. Pass each pending item's `scope` to `get_comment_context` and `record_comment_reply`. Stop if the checkout or branch changed. For a follow-up, use the preceding feedback and summary returned by `get_comment_context`. Check whether earlier edits already satisfy the feedback. Verify that outcome or apply and verify the remaining fix while preserving existing edits. Record a short summary with the exact pending ID. Leave blocked comments pending.
5. Give the user one short line per comment with the file and the fix or blocker.
