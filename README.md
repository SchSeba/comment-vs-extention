# Local Review for VS Code

Leave inline comments on uncommitted Git changes in VS Code, then ask Codex to address them in your current terminal session or the official Codex sidebar. Codex reads the pending comments, makes the fixes, and writes a short summary for each comment. The summaries appear in the chat and on their matching VS Code comments.

Local Review uses the built-in **Source Control** diff and **Comments** panel. It stores comments and replies per Git checkout and branch under `$CODEX_HOME/local-review` (default `~/.codex/local-review`). A detached HEAD gets its own review for that commit. Codex keeps the conversation history in your existing session.

## Install in VS Code

You need VS Code 1.96 or later, Git, Node.js 22 or later, and the Codex CLI. Sign in to Codex and install the official `openai.chatgpt` extension if you want to use the sidebar. Run setup as the user who runs VS Code on the workspace host. In a Remote SSH, WSL, dev-container, or code-server window, use that remote workspace host and its Codex configuration.

Use the [latest released VSIX](https://github.com/SchSeba/comment-vs-extention/releases/latest/download/local-review.vsix), or download the VSIX from a successful [PR validation run](https://github.com/SchSeba/comment-vs-extention/actions/workflows/ci.yml) for a test build. GitHub requires sign-in to download workflow artifacts. You can also build the package from this checkout.

1. Use a supplied `local-review.vsix`, or build it from this project:

   ```sh
   npm ci
   npm test
   npm run package
   ```

2. In the target VS Code window, run **Extensions: Install from VSIX…** and choose the file. From a terminal with the matching VS Code CLI, you can also run `code --install-extension /absolute/path/to/local-review.vsix`. Use `code-insiders` or `code-server` for those editions. For code-server with custom directories, pass the running instance's `--extensions-dir` and `--user-data-dir` to the CLI.
3. Locate the installed extension folder with `code --locate-extension local-review.local-review` or the matching editor CLI. If the CLI lacks that option, find `local-review.local-review-<version>` in the target host's installed extensions and confirm it contains `mcp.cjs`.
4. From the target workspace host, register the tools. Substitute the absolute paths to Node and the newly installed extension's `mcp.cjs`. The same registration serves the Codex CLI and sidebar.

   ```sh
   codex mcp add local-review -- "/absolute/path/to/node" "/absolute/path/to/mcp.cjs"
   codex mcp get local-review
   ```

   On Windows, quote paths containing spaces. If `local-review` is already registered, check that its command resolves to the newly installed extension, including any symlink such as `/opt/local-review-mcp.cjs`. Update the registration or symlink when it points to an older version. Both the VS Code workspace extension and Codex must use the same `CODEX_HOME`.
5. For the Codex shortcuts, copy the `handle-comments`, `mark-resolved-review`, and `clean-review` folders from the installed extension's `skills/` to `~/.agents/skills/` on the workspace host. When upgrading, update copies you installed from Local Review and preserve user-authored edits. The Podman test image seeds missing shortcuts at startup.
6. Run **Developer: Reload Window** in VS Code. Start Codex or use `codex resume` from the worktree and select your existing session. Use `/mcp` in Codex to check for `local-review`.

## Review and fix changes

1. Open a trusted Git worktree in VS Code and ask Codex to make a change.
2. Open **Source Control** on the left and select a changed file. Click the **+** beside a line on the working side of the diff, write your feedback, and choose **Add Review Comment**. Repeat for each fix you want.
3. In **Source Control**, look for the clipboard icon in the toolbar next to **Changes**. With several repositories open, use **⋯ → Local Review: Copy Codex Follow-up** on the target repository's row. The action is also in the Command Palette. Paste and submit the copied prompt in your current Codex chat, or submit `$handle-comments` from the target checkout.
4. Check the fixes in Source Control and the replies in **Comments**. To continue an **Addressed** thread, write below Codex's reply and click **Add Review Follow-up**. Submit the next review round the same way. The follow-up becomes pending and the new Codex reply appears in the same thread. Blocked feedback stays pending.

Switching branches changes which threads appear and which pending comments Codex can read. Switching back restores that branch's saved review. Submit draft comments before switching, since switching closes unsaved drafts. Named reviews follow the local branch name, including if you delete and later reuse that name. A copied prompt is tied to the checkout and branch where you copied it. If you are upgrading from 0.1.x, run **Local Review: Import Older Comments** and confirm which branch should receive the older records. Those records were saved without branch information.

### Review one repo inside a parent folder

You can open a folder such as `src` in VS Code and review any of the Git repositories listed in **Source Control**. A comment belongs to the Git checkout and branch of the file you clicked. Start Codex in that repository, then submit `$handle-comments`.

```sh
cd /path/to/src/project
codex
```

For bulk actions in VS Code, open a file from the target worktree first. When no active file identifies the worktree and several repositories are open, Local Review asks you to choose one.

### Resolve or clear comments

- Use the checkmark on an individual comment to mark it **Resolved**. It stays in Comments with its original feedback and any Codex reply. Use the trash button to remove it.
- Run **Local Review: Mark Resolved Review** from the Command Palette, or type `$mark-resolved-review` in Codex. This resolves fully answered threads on the current branch. Threads with pending follow-ups stay open.
- Run **Local Review: Clean Review** from the Command Palette and confirm the checkout and branch, or type `$clean-review` in Codex and approve the tool call when prompted. This clears that review's comments and replies.

### Ask a running Codex CLI session

In your running Codex CLI session in the worktree, type **`$handle-comments`** and press Enter. You can also select **handle-comments** from `/skills`. If the shortcut is missing, install it as described above or paste the copied follow-up. This plain-language request works when the MCP tools are available:

> Read my pending Local Review comments for this Git checkout and branch. Use `list_pending_comments` with the absolute worktree root. Use `get_comment_context` before each fix and pass the returned review scope to every subsequent tool call. Verify whether earlier edits already address later comments. Use `record_comment_reply` once per verified comment, print a short summary for each, and leave blocked comments pending.

If `/mcp` is missing `local-review`, run `codex mcp get local-review` in a separate terminal on the same host. Once the server is configured, let the current turn finish and reopen the same conversation with `codex resume`.

New comments save the selected excerpt and up to three numbered lines on either side, plus the language and whether the editor buffer had unsaved changes. That is what the reviewer saw. Before addressing each comment, Codex refreshes its location against the saved working file. It can find moved text and use matching nearby lines to identify an edited region. When the location is uncertain, it uses the original feedback and current code to verify the target or leaves the comment pending. A fix that also satisfies a later comment can receive a separate reply for that comment. Older comments retain their original excerpts.

The Comments panel keeps feedback available after a referenced line changes. See `docs/BRIDGE_VALIDATION.md` in the project for tested clients and the user-submitted follow-up flow.

## Local testing with Podman

The test image builds on Task Tracker's code-server image. It installs Local Review, registers its MCP server, installs the shortcuts in the persistent Codex volume, and pins the browser-tested official Codex extension. The password-free test IDE is bound to localhost.

```sh
podman build --pull=missing -f Dockerfile.codeserver -t localhost/local-review-codeserver:dev .
podman run -d --name local-review-codeserver \
  -p 127.0.0.1:18765:10000 \
  -v local-review-codex:/home/tasktracker/.codex \
  -v local-review-ide:/home/tasktracker/.local/share/code-server \
  -v local-review-workspace:/home/tasktracker/workspace \
  localhost/local-review-codeserver:dev
```

Open [the local test IDE](http://localhost:18765/). If you haven't signed in in this container, run `codex login --device-auth` in its integrated terminal and complete the browser sign-in. Reload the editor. To test a rebuilt image, recreate the container with the same named volumes to keep the login, comments, IDE settings, and worktrees. Copy the image's packaged VSIX with `podman cp local-review-codeserver:/opt/local-review.vsix ./local-review.vsix`.

### Validation

- Run `npm ci`, `npm test`, and `npm run package` locally. The automated tests exercise stdio MCP, worktree isolation, concurrent replies, resolution, and cleanup.
- For the signed-in browser test, open two separate disposable Git clones, one for the integrated terminal and one for the sidebar. The existing test container has a cloneable fixture at `$HOME/workspace/review-fixture`. Ask each client to set the greeting and punctuation in `greeting.js` to `Hi` and `?`. For a fresh container, you can use any disposable repo with a tracked file and two short lines.
- After the initial edit finishes, open the diff in **Source Control**. Add feedback to change `Hi` to `Welcome` and `?` to `!`. Copy the follow-up and submit it in the same conversation. Verify both fixes, two distinct chat summaries, and the matching replies in **Comments** after reloading.
- For same-file overlap, add one comment that inserts a line above two other comments and edits one of their targets. Verify that Codex refreshes both later comments, recognizes the fix already made, and applies the remaining fix at its new location.
- The recorded terminal roundtrip used `codex exec` and `codex exec resume` with workspace-write permission in a disposable clone. An interactive `codex` session can show its own folder-trust prompt. The browser automation stopped there. See `docs/BRIDGE_VALIDATION.md` for tested versions and results.

## Install with a Codex agent

Point a Codex CLI session at this checkout or give it the path to this README and send:

> Follow the agent installation steps in this README. Install Local Review into the VS Code window I already have running, configure its MCP server and Codex shortcuts on the same workspace host, and verify the setup. Tell me if I need to reload the editor or resume my Codex session.

### Agent installation steps

1. Identify the existing VS Code window's edition, profile, workspace host, and user. For a container or remote window, use its terminal or remote execution. For the Podman test IDE, use `podman cp` to copy the VSIX into the running container and `podman exec` to run setup as its default user. If multiple windows or profiles make the destination ambiguous, ask which to use.
2. Use a supplied VSIX from this project or build one with `npm ci`, `npm test`, and `npm run package` from the checkout. Install it with the CLI for the already-running editor and pass its profile or custom directories when needed. Keep the current workspace open. If the user wants the sidebar, check for the official `openai.chatgpt` extension and install it if missing. If installation requires an editor action, ask the user to run **Extensions: Install from VSIX…** in the target window.
3. Locate `local-review.local-review` in the target editor's extension host and verify the installed version, `mcp.cjs`, and Node executable on that host. Check `codex mcp get local-review` under the same user and `CODEX_HOME` as the target Codex. Resolve the MCP entry point, including the Podman image's `/opt/local-review-mcp.cjs` symlink, and update it if it points to an older version. If the name belongs to an unrelated server, ask before replacing it. Preserve the user's login, other MCP servers, and approval settings.
4. Install the three shortcut folders from the VSIX into `~/.agents/skills/` on the target host. For the Podman test image, use `$CODEX_HOME/skills/` so they persist with the Codex volume. Keep one copy of each and preserve user-authored shortcuts of the same name.
5. Verify the extension with the target editor's `--list-extensions --show-versions` and the server with `codex mcp get local-review`. Connect over stdio and check that the MCP server reports the same version as the VSIX and that its tools accept `scope`. Check the installed shortcut paths and sign-in with `codex login status`. Ask the user to sign in if needed.
6. Report the target and verified version. If the editor still needs to load the extension, ask the user to run **Developer: Reload Window**. After upgrading, ask them to resume the same Codex conversation if it lacks the new MCP tools or shortcuts.
