# Working on Local Review

Local Review is a VS Code workspace extension and a local MCP server for Codex. A user adds comments to the built-in Git Source Control diff and submits a follow-up in their existing Codex chat. Codex reads pending comments, applies and verifies fixes, and records one summary per addressed comment. The native Comments UI displays those replies. See [README.md](README.md) for installation and use, including how to install into a running VS Code on behalf of a user.

Use the current source and README for shipped behavior. [The implementation plan](docs/IMPLEMENTATION_PLAN.md) and [startup brief](docs/START_HERE.md) describe a broader design. Active scope is per-worktree feedback and summaries. [Bridge validation](docs/BRIDGE_VALIDATION.md) records the boundary for automatic chat submission and the tested CLI, IDE, and browser configurations.

## Source map

| File | Responsibility |
| --- | --- |
| `package.json` | Extension identity `local-review.local-review`, activation, command and menu contributions, dependencies, and npm commands |
| `extension.cjs` | Native comment controller, built-in Git API, diff anchors, thread refresh, follow-up clipboard action, and Codex integration diagnostics |
| `review-store.cjs` | Shared worktree-scoped storage, atomic comment/reply publication, resolution, and cleanup |
| `review-context.cjs` | Bounded surrounding lines, worktree-scoped current file reads, and conservative anchor matching |
| `mcp.cjs` | Stdio server `local-review` with pending comments, fresh context, replies, bulk resolve, and cleanup |
| `skills/` | User-facing Codex workflows `$handle-comments`, `$mark-resolved-review`, and `$clean-review` |
| `tests/mcp.test.cjs` | Node test runner and real stdio MCP client against temporary directories |
| `Dockerfile.codeserver`, `docker/start-codeserver.sh` | Task Tracker-derived local test IDE, pinned official Codex extension, VSIX install, and user-level MCP registration |

## Behavior to preserve

- Use native VS Code diff and comment APIs. Keep the real working-file URI on the working side of the diff. Keep the original excerpt and line range when code moves or changes, and display a detached reference when relocation is uncertain.
- Capture nearby lines from the exact editor document at creation. Keep them separate from the selected excerpt. `get_comment_context` refreshes a pending comment by ID before each fix. It reads only the stored working file inside the requested worktree and reports uncertain matches without a confirmed line. Saved excerpts and IDs are immutable.
- Identify worktrees by the real absolute Git root. Storage uses its SHA-256 hash under `$CODEX_HOME/local-review` (default `~/.codex/local-review`). A comment UUID identifies a directory with `comment.json`, an optional `reply.json`, and an optional `resolved.json` marker. Keep review metadata outside the reviewed repository.
- The editor may be open on a parent folder with multiple Git repositories. Route each comment through the Git API for its file. In Codex, derive the target from the requested worktree or the CLI's current Git root.
- The first reply for a comment wins atomically. Retries return that reply. A reply removes the comment from the pending tool results and leaves it visible as **Addressed** until resolved or dismissed. Resolve preserves the comment and reply. Bulk resolve selects answered comments only. Bulk cleanup removes review records only for the target worktree. Treat bulk actions as explicit user requests.
- Keep setup on the workspace host under the user and `CODEX_HOME` shared by the extension and Codex. Preserve unrelated config, credentials, and permissions. Use the existing user-submitted follow-up unless a verified provider interface is available. Integration diagnostics should report capabilities without reading credentials or submitting a prompt.
- Keep repository edits and Git actions in the user's control. Use disposable fixtures for validation. Test-only baseline commits belong in those fixtures. Leave existing user worktrees, staging, branches, and remotes alone.
- Use the pinned dependencies and the CommonJS modules already in the project. Keep MCP stdout reserved for protocol messages. Update the README and bridge evidence if setup, user behavior, or the tested environment changes.

## Validate changes

Use Node.js 22 or later and npm. Follow host instructions for command wrappers, including RTK where required.

```sh
npm ci
node --check extension.cjs
node --check review-store.cjs
node --check review-context.cjs
node --check mcp.cjs
sh -n docker/start-codeserver.sh
npm test
npm run package
sh scripts/verify-vsix.sh
```

The package command writes `local-review.vsix` at the root. The VSIX includes the workspace extension, its MCP entry point, runtime dependencies, and the Codex shortcuts. Use `.vscodeignore` to exclude contributor files. The generated VSIX and `node_modules` are ignored by Git. When changing runtime dependencies, update the lockfile and run `npm audit --audit-level=moderate`.

GitHub Actions builds downloadable VSIX artifacts for PRs and pushes to `main`. The release workflow publishes a VSIX and checksum when a version tag on `main` matches `package.json`. Signed-in browser validation runs separately.

Use the [README's Podman setup](README.md#local-testing-with-podman) for the browser and Codex checks. The running test container is conventionally named `local-review-codeserver` on `127.0.0.1:18765`. Its named volumes hold login and review data, editor settings, and disposable worktrees. Reuse the volumes when recreating the test container. Keep this password-free deployment on loopback.

Check that `codex mcp get local-review` finds the enabled server, code-server lists `local-review.local-review`, and Codex lists all three shortcuts under `/skills`. For a full signed-in test, run separate disposable clones through the integrated terminal and official sidebar. Make an initial edit, add two comments in the native diff, submit the follow-up in the same conversation, and check both edits, both final summaries, and both inline replies after reopening. To verify worktree routing, open a common parent of two disposable Git repos, comment in both, and run Codex from just one. Check the other repo's files and review records after feedback and bulk actions. Use the user's authorization for authenticated tests and let them complete any required sign-in. Report tool discovery, fixture-driven checks, and real model tests separately. Record the exact client versions and any incomplete checks in [docs/BRIDGE_VALIDATION.md](docs/BRIDGE_VALIDATION.md).
