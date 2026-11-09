# Local Review: native VS Code conversations with a Codex handoff

**Implementation specification and execution plan**  
**Prepared:** 10 October 2026  
**Working product name:** Local Review  
**Audience:** Codex implementing a new VS Code extension end to end  
**Deliverable:** Source, tests, documentation, and an installable VSIX; not another agent application.

> **Critical integration dependency:** This specification defines the desired product completely, but it does not assert that the installed official Codex extension exposes a usable message-submission API. Milestone M0 must prove that our Send button submits a new user message to the selected, already-finished conversation in the official extension. Do not replace that requirement with a hook, clipboard operation, separate Codex process, or simulated success. If the bridge is unavailable, implement the independent review features, produce the evidence and integration request, and report the full workflow as blocked—not complete.

## Contents

1. [Product contract](#1-product-contract)
2. [Verified foundations and unresolved interfaces](#2-verified-foundations-and-unresolved-interfaces)
3. [Exact user experience](#3-exact-user-experience)
4. [Architecture and technology choices](#4-architecture-and-technology-choices)
5. [First milestone: prove the real Codex bridge](#5-first-milestone-prove-the-real-codex-bridge)
6. [Internal bridge contract](#6-internal-bridge-contract)
7. [Workspace identity and private persistence](#7-workspace-identity-and-private-persistence)
8. [Git discovery, baselines, and snapshots](#8-git-discovery-baselines-and-snapshots)
9. [Persistent domain model](#9-persistent-domain-model)
10. [Native diff and discussion UI](#10-native-diff-and-discussion-ui)
11. [Code anchors and outdated conversations](#11-code-anchors-and-outdated-conversations)
12. [Publish and send transaction](#12-publish-and-send-transaction)
13. [MCP tools and agent replies](#13-mcp-tools-and-agent-replies)
14. [Manual edits, agent edits, and concurrency](#14-manual-edits-agent-edits-and-concurrency)
15. [Build and live-cluster evidence](#15-build-and-live-cluster-evidence)
16. [Security, privacy, and trust](#16-security-privacy-and-trust)
17. [Remote development and platform support](#17-remote-development-and-platform-support)
18. [Repository layout and development commands](#18-repository-layout-and-development-commands)
19. [Implementation milestones and work items](#19-implementation-milestones-and-work-items)
20. [Testing strategy and acceptance scenario](#20-testing-strategy-and-acceptance-scenario)
21. [Packaging, installation, and upgrades](#21-packaging-installation-and-upgrades)
22. [Performance and operational limits](#22-performance-and-operational-limits)
23. [Completion criteria and reporting](#23-completion-criteria-and-reporting)
24. [References](#24-references)

---

## 1. Product contract

### 1.1 The user's actual workflow

The user develops features and bug fixes in the **official Codex VS Code extension**. Their normal sequence must remain intact:

1. Start a Codex conversation and discuss a plan.
2. Approve the plan. Codex implements, builds, and tests, potentially against an authorized live development Kubernetes/OpenShift cluster.
3. Codex finishes its turn normally. No pending tool call, hook, or waiting agent remains.
4. Open Local Review, inspect changes using native VS Code diffs and language tooling, and create line-level discussions.
5. Make manual edits whenever needed. Comments and code references update independently.
6. Click **Send to Codex**. The extension sends one new user message to the currently selected conversation in the official Codex UI.
7. Codex fixes the feedback, replies inside the local discussions, records testing outcomes, and finishes normally again.
8. Repeat at the user's pace, including after editor restarts and long breaks.
9. When satisfied, the user deliberately commits and pushes the real code for external GitHub review.

The review extension may be opened for the first time **after** the implementation is complete. It must not require task-start registration or a prearranged agent review loop.

### 1.2 Non-negotiable requirements

| ID | Requirement |
|---|---|
| R01 | Keep the official Codex extension and its existing conversation. |
| R02 | Send means submit a real new user message and begin a new turn, not merely attach context or fill a composer. |
| R03 | Determine the selected conversation authoritatively; do not infer it from the newest transcript, last-modified file, or most recently loaded thread. |
| R04 | Use native VS Code text/diff editors, preserving the real working document on the current-code side. |
| R05 | Support persistent, ordered human/agent replies in GitHub-style discussions. |
| R06 | Automatically track code movement and mark changed references outdated without automatically resolving the concern. |
| R07 | Support manual code edits before, between, and after agent turns. |
| R08 | Store review data and immutable snapshots outside the reviewed repository. |
| R09 | Never create intermediate Git commits, stage changes, stash, change branches, or push as part of review operation. |
| R10 | Preserve drafts, published batches, discussions, delivery state, and original code across restart/crash. |
| R11 | Batch multiple comments/replies into one Codex request; reply back to their original discussions. |
| R12 | Keep source-version, artifact, and live-cluster test evidence associated; never label old test results current after new edits. |
| R13 | Handle local and remote-host layouts explicitly; prioritize the user's Windows/WSL development workflow during validation. |
| R14 | Preserve the session's model, execution environment, and approvals; do not switch to cloud mode or broaden permissions. |
| R15 | Never claim the workflow works based only on mocks or a standalone App Server test. |
| R16 | Work without GitHub credentials or creating a GitHub pull request. |

### 1.3 Deliberate exclusions

Do not build a new chat application, browser diff renderer, language server, autonomous review daemon, or deployment system. Do not add Stop hooks, polling prompts, agent wait loops, hidden checkpoint commits, or runtime keyboard/DOM automation.

Do not silently fork/resume a transcript in another agent process and describe that as controlling the active official IDE conversation. Shared history on disk is not sufficient proof of shared ownership, UI updates, or approval routing.

A manual export is permitted as a clearly labelled recovery feature. It is **not** acceptance of R02.

### 1.4 Terminology

- **Codex thread:** The official agent conversation. Treat its ID as opaque and use the identity semantics observed in the installed provider.
- **Codex turn:** One user submission and the agent work that follows.
- **Review:** Local collection of discussions and code-version references for one repository/worktree.
- **Discussion:** A line-level or file-level conversation, containing multiple human and agent messages.
- **Snapshot:** Immutable local content manifest, not a Git commit.
- **Batch:** Immutable selected message revisions and code context submitted together.
- **Round:** A batch plus its agent work, replies, and associated verification evidence.

Use `discussionId` and `codexThreadId` as separate field names. Do not ambiguously call both `threadId` throughout the implementation.

## 2. Verified foundations and unresolved interfaces

The facts below were checked against primary documentation on the preparation date. The remainder of the document specifies **our proposed implementation**, not additional APIs claimed to exist in Codex.

| Foundation | Verified scope | What it does not prove |
|---|---|---|
| Codex IDE commands | The command reference includes selected-text/file context attachment and UI commands. [S1] | The published list does not document arbitrary prompt submission or selected-conversation discovery. |
| Codex App Server | `turn/start` accepts a target thread and input; the protocol distinguishes threads and turns. [S2] | It does not prove another extension can access the IDE-owned transport or its selected conversation. |
| Cross-extension VS Code APIs | Extensions can use registered commands and exported APIs after activation. [S3] | Codex must actually expose the needed API; VS Code cannot invent one on its behalf. |
| Native editor UI | `vscode.diff` opens a comparison, and native comments represent conversations attached to documents. [S3] [S4] [S5] | Native UI alone does not provide historical language-server context or persistence. |
| MCP | Codex IDE can connect to configured MCP servers. [S6] | MCP tool availability does not independently submit a new message to an idle Codex chat. |
| Private storage | VS Code provides private extension storage locations and workspace-aware extension hosts. [S3] [S7] | Those files are not automatically encrypted, synchronized, or accessible from every host. |

**Documented attachment commands are not a Send API.** Specifically, do not implement `chatgpt.addToThread` followed by a successful notification and call that message delivery. [S1]

**Protocol compatibility must be versioned.** The current App Server documentation includes experimental transports. Generating schemas from an unrelated globally installed CLI does not prove compatibility with the IDE's bundled runtime. [S2]

**MCP dependency note:** At preparation time, the official TypeScript SDK identifies v2 and its split server/client packages as the stable line. Select and pin compatible versions, using its actual documentation and the Codex handshake; do not paste old v1 import paths into v2 code. [S8]

The official Marketplace entry currently uses `openai.chatgpt`. Verify the installed extension rather than assuming a similarly named extension is official. [S9]

## 3. Exact user experience

### 3.1 Entry point

Add an activity-bar view container named **Local Review**, with three native Tree Views:

- **Changes:** Files, change kinds, review status, staged/unstaged indicators, and a baseline selector.
- **Discussions:** Open, outdated, detached, resolved, and draft discussions; filters and unread agent replies.
- **Rounds:** Published batches, delivery status, addressed/unanswered items, and verification evidence.

A small status/header area shows `Send to: <selected Codex conversation>` and bridge capability. A version with no supported bridge must visibly say so.

Default primary actions: **Start/Open Review**, **Add Comment**, **Send to Codex**, **Refresh Changes**, and **Show Integration Diagnostics**. Avoid mandatory wizard steps on every round.

### 3.2 Inline discussion behavior

Use a real comment controller with replies enabled. Example desired presentation:

```text
pkg/reconcile/retry.go:84–91     Open · Outdated reference

You: Do not retry permanent authentication failures.

Codex: I separated permanent errors and added a failure-path test.
        Verification: unit tests passed; cluster test failed.

You: Preserve the cancellation handling I added manually.

[Reply]  [Resolve]  [No longer relevant]  [Original code]  [Current code]
```

Render badges and actions supported by the native Comments API rather than promising pixel-identical GitHub HTML. Put advanced history/evidence in the Tree Views or a read-only text document. A webview may later summarize review metadata, but must not replace the code editor or inline discussions.

A new human reply to a resolved discussion reopens it with an explicit history event. Agent replies do not resolve discussions. Agent completion means **Ready for your review**, not **Resolved**.

### 3.3 Selecting feedback

Each draft/reply has a selection checkbox or context-menu action. Default Send includes all new selected human messages since their last successfully delivered revision, with sufficient published discussion history to understand them.

Allow sending a new global review instruction even when no line comments are selected. Block an actually empty submission.

**Publish locally** persists a batch without invoking Codex. **Send to Codex** publishes and sends as one action. Do not introduce an unnecessary mandatory two-click publish-then-send workflow.

### 3.4 Target semantics

The destination is the conversation selected at Send time, not the conversation associated with an earlier batch. Show the destination prominently.

If the current destination differs from this review's previous destination, ask for a specific confirmation once: `Send this review to conversation B instead of A?` Preserve per-batch routing history. Never silently move previous messages to B.

Resolve the target before preflight; capture an identity/selection token. Revalidate immediately before dispatch. A change during preflight must either abort with `Target changed` or send to the explicitly captured target using a provider-supported addressed API. Never silently substitute another target.

When multiple Codex panels make the destination ambiguous, require explicit selection through an authoritative provider mechanism. Do not guess from which unrelated editor last had focus.

### 3.5 No active turn required

The previous Codex turn may have ended minutes or days ago. If a new turn is currently running when Send is clicked, default to **not sending**: preserve the batch and explain that the destination is busy. Do not automatically steer, interrupt, queue, or submit later without another deliberate user action.

## 4. Architecture and technology choices

### 4.1 Components

```text
VS Code workbench
  Native diff/text editors + native comments + review Tree Views
                    |
  Local Review extension (workspace-host execution where possible)
    ReviewController
    SnapshotService + AnchorEngine
    ReviewStore (single writer)
    PublishCoordinator + Outbox
    CodexBridge adapter  ----------------> Official Codex extension
    Local authenticated IPC endpoint             |
                    ^                       existing conversation
                    |                             |
           MCP stdio proxy <----------------------+
           (Codex invokes tools)
```

The extension owns the authoritative review state. The MCP proxy is a transport adapter; it does not independently edit the database, run Git mutations, invoke Codex, or execute build commands.

The code editor does not depend on Codex connectivity. Codex integration does not depend on rendering a webview.

### 4.2 Implementation defaults

Use TypeScript with strict checking, npm workspaces, a locked dependency graph, and bundled extension/proxy entry points. Use native VS Code Tree Views and Comments UI. Start with the Node test runner for pure-domain tests and the official VS Code extension test harness for extension-host tests. [S10]

Use the official MCP TypeScript SDK and a runtime schema validator compatible with the chosen SDK. Record dependency versions and runtime requirements in `docs/COMPATIBILITY.md`. Use a maintained text-diff implementation for line/offset mapping; select and lock it during M1 rather than guessing an API in this plan.

**Persistence default:** Small append-only, checksummed JSON event journal plus content-addressed immutable blobs. One authoritative writer per repository/worktree; in-memory projections rebuilt from durable events. This avoids making native SQLite/Electron ABI packaging a prerequisite. Encapsulate behind `ReviewStore` so SQLite can replace it later if measured volume justifies that.

Do not implement a distributed database, message broker, embedded browser, or global always-running daemon.

### 4.3 Runtime dependency

The extension runs in the VS Code extension host. The MCP stdio proxy needs a supported Node runtime **on the host where Codex launches that MCP process**.

Do not assume `process.execPath` is a general-purpose Node executable: it can identify the editor runtime. Installation must validate a user-selected or discovered Node binary against the bundled proxy, then persist its absolute path. Offer a documented prerequisite, not a silent runtime download.

Bundle dependencies with the proxy. No `npx -y <latest-package>` downloads during a user's review. A stable per-user launcher should select an atomically installed, versioned proxy bundle, rather than storing a path inside a soon-to-be-deleted extension-version directory.

## 5. First milestone: prove the real Codex bridge

### 5.1 Why this comes first

R02/R03 are the highest-risk requirements. Native comments, local snapshots, and MCP replies cannot compensate for missing Send integration. Build a minimal diagnostic extension and tiny MCP echo tool **before** polishing the review interface.

No test performed only against a separately launched App Server can pass this milestone.

### 5.2 Environment inventory

Produce `docs/BRIDGE_VALIDATION.md` and a sanitized machine-readable diagnostic record containing:

- VS Code and Git versions, operating system, extension host location, remote name, and UI kind.
- Official Codex extension ID and installed version.
- Whether it is active; available public export descriptors after activation.
- Candidate registered commands and declared command metadata.
- Documented argument/return types and documentation/source provenance for any integration candidate.
- Available provider transport only if exposed by a supported configuration or authorized discovery mechanism.
- Whether the selected chat is local, cloud, busy, idle, or unknown, if the provider actually supplies that information.
- Evidence separating supported, observed-but-undocumented, unavailable, and untested capabilities.

Collect names/type shapes only. Do not dump exported objects, process environments, credentials, authentication files, entire transcripts, or extension state databases.

VS Code supports command enumeration and activation/exports, but discovering a name does not establish its argument schema or guarantee safety. Do not trial-call arbitrary commands that might modify files or start agent work. [S3]

### 5.3 Integration candidates, in order

**Candidate A — Documented exported API.** Prefer an official exported interface that returns the selected conversation and submits an addressed user message. Use actual provider types and activation lifecycle. Only claim this path after observing it.

**Candidate B — Documented command(s).** Use a registered public command only if its input schema and semantics meet the requirements. Verify both message submission and target handling. A command that only prepares context is insufficient.

**Candidate C — Verified IDE-owned transport.** Investigate only if the IDE officially exposes or intentionally shares an authorized App Server control endpoint. Prove that it is the process/endpoint owning the selected official UI conversation, that target discovery is authoritative, and that normal UI/approvals remain synchronized. Experimental transport support must be labelled and version-scoped. Merely finding a socket or an existing thread ID is not enough. [S2]

**Candidate D — Observed undocumented extension interface.** A callable interface observed in the installed version may be implemented as an opt-in experimental adapter only with a reproducible contract, strict version matching, an explicit local consent setting, and the full smoke tests. Do not patch official extension files, inject code, attach debuggers, hijack stdio, or redistribute its implementation. Unknown versions disable that adapter until retested.

Do not auto-enable D as a fallback when A/B/C fail. Do not make an experimental success look like official API support.

### 5.4 Proof sequence

Use a disposable workspace and a real official extension conversation with harmless prompts; run authenticated tests only with authorization for those submissions.

1. Create conversation A normally in the official UI. Establish a harmless unique marker in its context, and let the turn finish.
2. Click our single `Send Probe` command. Submit a new user message containing a unique probe/batch ID and asking the agent to repeat A's marker. No code changes needed.
3. Verify the new user message is visible in A, a new turn begins in A, and its response retains A's prior context.
4. Obtain the strongest available provider acknowledgement. A resolved `executeCommand()` promise with no documented meaning is not proof of accepted delivery.
5. Switch to conversation B and repeat. Verify A does not receive B's message.
6. Repeat with an unsent composer draft present; the bridge must not overwrite, accidentally submit, or combine it with our review.
7. Change conversation during a delayed preflight; verify the defined target-race behavior.
8. Restart the window, select A again, and send another probe without any waiting hook.
9. Invoke the tiny MCP tool from the sent turn and verify its result reaches the correct review probe.
10. Test approval handling with a harmless operation in a restrictive test profile. Do not auto-approve it.
11. Test a busy target, failed connection, and lost acknowledgement. Check that the adapter does not duplicate turns.
12. Repeat in the actual local/WSL topology, not only a local development-host simulation.

Capture IDs, provider version, timestamps, and sanitized screenshots/logs. Screenshots supplement machine evidence; they are not an excuse to automate the live composer through DOM or key presses.

### 5.5 Gate result and continuation policy

Write exactly one bridge capability outcome:

- `SUPPORTED_VERIFIED`: A documented interface passed real-IDE tests on the recorded versions/topology.
- `EXPERIMENTAL_VERIFIED`: An explicit opt-in adapter passed, but uses a version-sensitive/experimental interface.
- `BLOCKED`: No suitable interface was found or it failed required behavior.
- `NOT_RUN`: The installed IDE/session, credentials, GUI, or target topology was unavailable.

If blocked or not run, still implement independent storage, native reviews, anchors, and mocked-adapter contract tests. Ship a development VSIX with Send disabled and diagnostics, not a falsely complete product. Produce `docs/REQUIRED_CODEX_API.md` describing the missing provider capability and the exact acceptance tests. Do not spend subsequent milestones pretending the missing interface will materialize.

An upstream API request would minimally ask for: selected-conversation identity and changes; new-turn submission to an expected conversation; typed acceptance/rejection; busy state; and preservation of existing UI, drafts, settings, and approvals. These are requested capabilities, not claims about an existing API.

## 6. Internal bridge contract

The following names belong to **our extension**. They are an adapter boundary, not methods known to be exported by Codex.

```typescript
export type BridgeLevel =
  | "supported-verified"
  | "experimental-verified"
  | "unsupported"
  | "not-tested";

export interface CodexTarget {
  providerId: "openai.chatgpt";
  providerVersion: string;
  codexThreadId: string;
  conversationLabel: string;
  hostIdentity: string;
  workspaceUri: string;
  mode: "local" | "cloud" | "unknown";
  activity: "idle" | "busy" | "unknown";
  selectionToken: string; // Our/provider token for the captured selection.
}

export interface SendRequest {
  batchId: string;
  clientRequestId: string;
  prompt: string;
  promptSha256: string;
  expectedTarget: CodexTarget;
}

export type SendOutcome =
  | {
      kind: "accepted";
      codexThreadId: string;
      codexTurnId?: string;
      providerReceipt?: string;
      proof: "provider-receipt" | "observed-matching-user-message";
    }
  | { kind: "rejected"; code: string; message: string }
  | { kind: "unknown"; reason: string };

export interface CodexBridge {
  inspect(): Promise<{
    level: BridgeLevel;
    reasons: string[];
    supportsDeliveryLookup: boolean;
    supportsAtomicExpectedTarget: boolean;
  }>;
  getSelectedTarget(): Promise<CodexTarget | undefined>;
  sendNewTurn(request: SendRequest): Promise<SendOutcome>;
  lookupDelivery?(request: SendRequest): Promise<SendOutcome>;
  dispose(): void;
}
```

Runtime-validate provider responses; never cast arbitrary export values into this interface and assume compatibility. Normalize version-specific protocols inside individual adapters.

For a legitimately reachable App Server, a new-turn request conceptually resembles the following documented operation. Do not run it by spawning another server to evade M0. [S2]

```json
{
  "id": 42,
  "method": "turn/start",
  "params": {
    "threadId": "<verified-existing-target>",
    "input": [{ "type": "text", "text": "<published-review-message>" }]
  }
}
```

Do not add model, sandbox, approval, working-directory, or collaboration-mode overrides unless an explicitly supported integration requires preserving their existing values and this is proven. Reject a target whose execution mode/workspace does not meet the local review contract.

There is no requirement to stream or parse the entire Codex chat. MCP replies are the authoritative agent messages in our review UI. Provider turn notifications may enrich progress only when genuinely available.

## 7. Workspace identity and private persistence

### 7.1 Canonical identity

Identify a review by the canonical repository root, actual worktree Git directory, remote authority/host identity, and an installation-local namespace. Do not identify a worktree solely by repository remote URL or Git common directory: distinct worktrees can share both.

Use VS Code URIs internally. Canonicalize filesystem paths on the host that owns them; retain the original display URI. Do not lowercase every path, assume case-insensitive filesystems, or convert Windows/WSL paths with string replacement.

For multiple roots, the first version supports multiple review entries but **one repository/worktree per review and batch**. Cross-repository batches are out of scope until explicit target/workspace semantics are implemented.

### 7.2 Storage layout

Use `globalStorageUri` for a canonical per-host repository store, and workspace UI state for the selected review/filter. These are extension-owned locations, not guessed editor paths. [S7]

```text
<extension global storage>/
  installations/<installation-id>/
    repositories/<repository-worktree-key>/
      CURRENT                          # Durable pointer to current generation.
      generations/<generation-id>/
        state.json                     # Optional compacted projection.
        journal.jsonl                  # Checked append-only event records.
      blobs/sha256/<prefix>/<hash>      # Immutable raw/text content.
      writer.lock/
      diagnostics/                     # Redacted, bounded, opt-in export.
  runtime/
    registry.json                      # IPC discovery metadata, not all reviews.
    credentials/                       # Restricted local authentication files.
  proxy/<version>/                     # Bundled, versioned MCP proxy.
```

Store opaque IDs rather than sensitive repository names in filenames. Keep personal source, discussions, cluster logs, and runtime credentials out of Settings Sync. Private storage is not an encryption promise.

The extension's **own source repository** may contain implementation documentation and generated test reports. That is separate from runtime review data for projects the user reviews.

### 7.3 Durable writes and recovery

Design the store as a single-writer event log:

1. Validate a command against current entity revisions and authorization.
2. Write any new immutable blobs to a temporary file in the destination directory, sync and rename, and verify their hashes.
3. Append a bounded journal record containing sequence, transaction ID, schema version, event payload, and checksum; sync the file.
4. Update in-memory projections and notify UI subscribers only after durability succeeds.
5. Return success to the caller.

At startup, validate records and monotonic sequence numbers. Ignore an incomplete trailing write after preserving it for diagnostics; corruption in the middle must produce a recovery/read-only state, not silent data skipping.

Compaction must be generation-based: write and sync a complete new generation, atomically replace `CURRENT`, then retain the previous generation until a successful reopen. Do not truncate the only valid journal in place.

Use tested platform-specific atomic-write primitives. Document what filesystem durability is guaranteed on tested local filesystems. Do not claim power-loss durability on arbitrary network filesystems without testing.

### 7.4 One writer, multiple windows

Acquire a per-worktree ownership lock. A second editor window connects to the active owner or opens the same store read-only; it must not create a conflicting writer because its VS Code workspace ID is different.

Use owner identity, process-start nonce, and a heartbeat for coordination. Never break a lock on age alone. Confirm the owner is gone/unreachable with a conservative recovery action. A disk lock is not a security boundary against another same-user process.

All MCP writes pass through the owner. The proxy must not bypass the lock by writing journal records directly.

### 7.5 Retention and deletion

Pin blobs referenced by open discussions, published batches, and retained evidence. Never delete a referenced original code snippet just because its current file was deleted.

Provide storage usage, manual archive/export, and explicit purge. Garbage collection removes only unreferenced blobs after a grace period and integrity scan. A storage limit prompts cleanup; it must not silently drop unresolved history.

## 8. Git discovery, baselines, and snapshots

### 8.1 Read-only Git adapter

Prefer a narrow subprocess wrapper with an allowlist, explicit `cwd`, argv arrays, timeouts, cancellation, and bounded output. Do not build shell command strings from paths or comment content.

Use NUL-delimited output for status, filenames, and rename pairs. Git documents stable porcelain formats and separate working-tree/index comparisons. [S11] [S12]

Read-only discovery may include:

```text
git rev-parse --show-toplevel
git rev-parse --absolute-git-dir
git rev-parse --git-common-dir
git rev-parse --verify HEAD
git status --porcelain=v2 -z --untracked-files=all
git ls-files -z
git ls-tree -r -z <verified-full-base-object-id>
git cat-file blob <verified-blob-object-id>
git diff --no-ext-diff --no-textconv --name-status -z <base> --
```

Set `GIT_OPTIONAL_LOCKS=0` so background status inspection does not refresh the index as an optional side effect. Disable automatic lazy fetch where supported, and report missing baseline objects instead of fetching them. If a promisor-repository runtime cannot guarantee no lazy fetch, refuse that baseline read rather than risk an implicit network operation. [S13]

Disable external diff/textconv execution. Avoid executing repository-configured filesystem-monitor helpers in discovery. Run Git only for trusted workspaces. Respect literal paths and reject revision strings not resolved through the explicit baseline picker.

**Forbidden in runtime review code:** `add`, `commit`, `stash`, `checkout`, `switch`, `reset`, `clean`, `update-ref`, `write-tree`, `hash-object -w`, `push`, and automatic `fetch`. No private refs, orphan commits, or Git object writes as snapshot storage.

### 8.2 Late-start baseline: the default workflow

When review starts after Codex finished, resolve and pin the current existing `HEAD` object as the default baseline. Show **All current changes against HEAD at review creation**, including pre-existing unrelated changes.

An earlier task-start workspace cannot be reconstructed when no snapshot was captured. Never pretend that HEAD equals the exact pre-task working directory. Make the limitation visible, and allow the user to select a different existing baseline or narrow the files being reviewed.

Optional task-start snapshots can improve future tasks, but must never become a prerequisite for the normal workflow.

A review's baseline remains fixed even if the user subsequently commits, rebases, or changes branches. Detect these actions and offer explicit rebaseline/archive choices; do not silently change its meaning.

### 8.3 Comparison views

Implement three clear views:

| View | Left | Right |
|---|---|---|
| All review changes | Pinned baseline snapshot | Actual workspace document |
| Since previous round | Previous sent/reviewed snapshot | Actual workspace document |
| Original discussion | Snapshot on which its anchor was created | Current document, or a later selected snapshot |

When the user starts review late, the first **Since previous round** view is unavailable until a round snapshot exists. Explain that instead of showing a misleading empty task history.

The default diff shows final working files against the pinned baseline. Staging status is separate metadata. A staged change canceled by an unstaged edit may have no final diff, but must remain visible as an index difference when the user chooses staged inspection.

### 8.4 Snapshot content

A snapshot manifest should include stable file IDs/relative paths, existence, file kind/mode, encoding/EOL, raw SHA-256, text-content reference when supported, source document version if any, capture time, and scope/exclusions.

Capture the eligible tracked repository files plus explicitly included untracked files, storing unchanged content once. Missing files get tombstones. Retain a baseline manifest so deleted/renamed content remains accessible without new Git objects.

Exclude secrets and clearly unsupported content from automatic capture; show omissions rather than pretending the manifest covers the entire repository. Build verification fingerprints must explicitly state their scope.

Use both raw-content hashes and decoded text/position maps. Preserve line endings and encoding; a normalized matching view is not the original source. Initial native text support may be limited to tested encodings, with unsupported encodings reported as metadata/file-level review only.

### 8.5 Stable capture, not pretend atomicity

Use change-generation counters, open-document versions, and read-before/read-after checks to detect edits during capture. Retry a small bounded number of times, then refuse Send with `Workspace is changing` while preserving drafts.

A normal filesystem does not provide a whole-workspace atomic snapshot through this algorithm. Label captures as **validated stable during capture**, with the observed generation and scope; do not call them transactionally atomic filesystem snapshots.

At Send, save relevant dirty files through explicit user action, rescan, capture, and immediately revalidate before dispatch. If code changes during preflight, regenerate/reconfirm. Changes after dispatch are concurrent drift, handled separately.

### 8.6 Edge cases

- **New file:** Show an empty immutable original and the actual working file. Do not create a fake tracked baseline file.
- **Deleted file:** Show original content against an empty virtual document. Do not recreate it on disk just to render a diff.
- **Rename:** Preserve the original file identity when a reliable rename relationship is known; otherwise record a candidate and ask for reattachment when needed.
- **Binary/large file:** Metadata/file-level discussions; no fake line positions.
- **Unmerged Git entries:** Show a conflict state; no automatic conflict resolution or inaccurate normal diff.
- **Symlink:** Record link target; do not follow it outside allowed roots to collect arbitrary contents.
- **Submodule:** Show gitlink/change status. Require explicit entry into that repository for content review.
- **No Git/unborn HEAD:** Offer an explicitly chosen local baseline/empty baseline and label it. Do not silently treat every existing file as a feature implementation.
- **Excluded/generated file:** Show the reason and a deliberate include action where safe.

## 9. Persistent domain model

Implement versioned runtime schemas and migrations. The following TypeScript is a proposed domain contract, not a complete persistence implementation.

```typescript
export type Id = string;
export type Sha256 = string;
export type IsoDate = string;

// Persist positions as zero-based UTF-16, end-exclusive: the VS Code model.
// Convert to one-based human-readable line numbers only at display/export boundaries.
export interface Position { line: number; character: number }
export interface CodeRange { start: Position; end: Position }

export type Resolution = "open" | "resolved" | "not-relevant";
export type AnchorState = "current" | "outdated" | "detached" | "ambiguous";
export type AgentWorkState =
  | "not-requested" | "pending" | "working"
  | "ready-for-review" | "needs-user" | "failed";

export interface CodeAnchor {
  id: Id;
  repositoryKey: string;
  fileId: Id;
  originalPath: string;
  originalSide: "old" | "new" | "file";
  originalSnapshotId: Id;
  reviewedCandidateSnapshotId: Id;
  originalRange?: CodeRange;
  originalBlobSha256?: Sha256;
  selectedText?: string;
  prefixContext?: string;
  suffixContext?: string;
  containingSymbol?: { name: string; kind: number; containerName?: string };
  reviewedChangeFingerprint?: Sha256; // Especially useful for old-side comments.
}

export interface AnchorProjection {
  anchorId: Id;
  evaluatedSnapshotId?: Id;
  evaluatedDocumentVersion?: number;
  state: AnchorState;
  currentPath?: string;
  currentRange?: CodeRange;
  locationKind: "workspace" | "historical-side" | "none";
  reason: string;
  method: "exact" | "edit-map" | "unique-context" | "manual" | "none";
}

export interface MessageRevision {
  messageId: Id;
  revision: number;
  discussionId: Id;
  authorKind: "human" | "agent";
  authorLabel: string;
  bodyMarkdown: string;
  createdAt: IsoDate;
  inReplyToMessageId?: Id;
  basedOnMessageRevision?: number;
  anchorId?: Id;
  batchId?: Id;
  agentOperationId?: Id;
  sourceCodexTurnId?: string; // Only when independently available, not invented.
}

export interface Discussion {
  id: Id;
  reviewId: Id;
  anchorId?: Id;
  resolution: Resolution;
  agentWork: AgentWorkState;
  latestHumanRevisionSequence: number;
  lastAddressedHumanRevisionSequence?: number;
  createdAt: IsoDate;
  updatedAt: IsoDate;
}

export interface PublishedBatch {
  id: Id;
  reviewId: Id;
  ordinal: number;
  createdAt: IsoDate;
  repositoryKey: string;
  snapshotId: Id;
  priorRoundSnapshotId?: Id;
  messages: Array<{ messageId: Id; revision: number }>;
  contextMessageRefs: Array<{ messageId: Id; revision: number }>;
  anchorProjectionRefs: Id[];
  globalInstructions: string;
  target: CodexTarget;
  serializedPayloadSha256: Sha256;
  promptSha256: Sha256;
  clientRequestId: Id;
}

export type DeliveryState =
  | "published" | "dispatching" | "accepted"
  | "rejected" | "unknown" | "cancelled-before-dispatch";

export interface DeliveryAttempt {
  id: Id;
  batchId: Id;
  clientRequestId: Id;
  state: DeliveryState;
  startedAt?: IsoDate;
  completedAt?: IsoDate;
  providerReceipt?: string;
  codexTurnId?: string;
  failureCode?: string;
}
```

Additional schemas must cover `Review`, `SnapshotManifest`, immutable `FileVersion`, `Round`, `VerificationRecord`, `HumanStateEvent`, `MigrationRecord`, and scoped batch-access grants.

**Immutability rules:** A published batch always refers to exact message revisions. Editing a comment after Send creates another revision/draft; it cannot alter the earlier batch. Agent replies append records instead of replacing the human request. Human resolve/reopen and anchor reattachment are history events.

**Independent state dimensions:** An accepted message is not a completed fix; a completed fix is not verified success; a changed anchor is not resolved; an agent reply to an older message does not address a newer human follow-up.

Do not use a single overloaded `status` field to represent all these dimensions.

## 10. Native diff and discussion UI

### 10.1 Immutable virtual originals, real current files

Register a read-only content provider for a scheme such as `local-review-snapshot:`. Encode only opaque repository/snapshot/file IDs in the URI and resolve them through the store. Do not expose arbitrary filesystem paths as fetch parameters.

Open comparisons with `vscode.diff(originalUri, workspaceUri, title, options)`. Immutable historical-to-historical comparisons use two snapshot URIs. Native diff and virtual-document primitives are documented by VS Code. [S4] [S14]

Use the file's real language mode for readable historical text. The current side must retain its actual workspace URI so existing language extensions can operate normally. Test Go to Definition, references, hover, and rename availability with real language tooling; do not replace their providers.

For historical/deleted code, provide **Open corresponding workspace file/symbol** when mapping is reliable. Do not claim that assigning a language ID gives historical snapshots a complete language-server project.

### 10.2 Selection and side detection

Use actual editor URI, selection, and the opened comparison's recorded URI pair. Do not infer the old/new side from tab title, line color, or screen position.

For the extension's own comparisons, maintain an explicit registry of diff inputs. For a native Source Control diff opened elsewhere, resolve its document identity through a verified supported Git adapter. If the historical URI format cannot be interpreted reliably, offer **Open in Local Review diff** rather than guessing a revision.

Selections are end-exclusive. A selection ending at character zero of the next line must not accidentally include that line in a line-level comment. Preserve both precise positions and human-readable line spans.

### 10.3 Comments API integration

Implement a `CommentController`, commenting ranges, reply/save commands, per-comment edit/delete menu actions, and a map between UI threads and durable `discussionId`s. Base the mechanics on Microsoft's comment sample and installed stable types. [S5]

Always enable replies for our discussions. Save locally before showing a comment as persisted. Canceling an empty new comment removes its temporary UI thread. Reopening a file reconstructs comments from the store, not from editor process memory. When a relocation changes the document URI, recreate the native UI thread as necessary while preserving the same durable discussion ID; do not assume the URI is mutable.

Resolved and not-relevant discussions may use the native resolved state while retaining our distinct reason in the label/history. Outdated is an additional label/context value; it must not be represented by setting native state to resolved.

MVP editing rules: users edit their own draft messages; editing published human feedback creates a new revision and pending send. Agent messages are immutable apart from appending a correction, and the UI must identify agent authorship.

### 10.4 Keyboard and accessibility

Provide command-palette actions for every core operation, accessible labels, standard theme icons, high-contrast support, keyboard traversal, and focus restoration after sending. Do not rely on a colored badge alone to distinguish outdated or failed states.

Do not steal focus from a comment editor or overwrite an unrelated selection merely to attach context to Codex.

## 11. Code anchors and outdated conversations

### 11.1 Preserve origin and compute a separate projection

The original anchor is immutable. Recompute a separate current projection on relevant editor/disk changes and at Send. Keep relocation/reattachment history.

Use a conservative hierarchy:

1. Same relevant content/change fingerprint: current.
2. Known edit mapping moves the span without changing its selected contents: relocate and keep current.
3. Unique exact selected text plus strong surrounding context in the same file: relocate; confirm uniqueness.
4. Reliable rename or symbol-assisted candidate: use it to narrow search, not as proof of semantic equivalence.
5. Referenced contents or reviewed change were modified: outdated; retain original and show current counterpart where reliable.
6. Original current-side code was deleted and cannot be located: detached/outdated; retain historical access.
7. Multiple equally plausible matches: ambiguous; require manual reattachment.

Do not auto-attach to the nearest matching line number or first repeated text match. A symbol name alone is not a stable identity across overloads, nested declarations, or duplicate files.

### 11.2 Edit mapping

For an open text document, use known version transitions and change offsets. Apply multiple nonoverlapping changes against the correct pre-change text, in an order that preserves those offsets; test multi-cursor edits, formatting, and undo.

Outside-range edits can translate positions. Any overlapping insertion/replacement/deletion must trigger content re-evaluation rather than blindly shifting the range. Disk changes, missed events, and reloads require a text diff against the stored version.

Run expensive mapping outside the UI hot path, cancel obsolete computations, and install a result only when its source/target versions still match.

### 11.3 Old-side comments need different semantics

A comment on deleted code in an original-side diff is not automatically invalid just because that code is absent from the working tree: its subject is the deletion/change itself.

For old-side anchors, retain the baseline location **and** the reviewed candidate snapshot/change fingerprint. Keep the reference current while that reviewed change is unchanged. Mark it outdated when that change materially evolves or cannot be mapped. Use `locationKind: historical-side` instead of pretending the deleted code has a current working-file range.

For a file-level discussion, show file-change context but do not invent a line anchor. Code changes can mark its context changed without deciding its underlying concern is no longer relevant.

### 11.4 Status examples

| Event | Reference behavior | Discussion behavior |
|---|---|---|
| Insert unrelated function above selection | Reposition; current | Remains open/resolved as it was |
| Change a selected condition | Outdated; preserve original | Remains open until human resolves |
| Delete selected new-side block | Detached/outdated | Still listed as outstanding |
| Discuss deletion on old side; deletion unchanged | Current historical-side anchor | Remains open |
| Move duplicate text with uncertain destination | Ambiguous | Require reattachment, do not lose history |
| Revert exactly to original contents | May become current again; retain history of drift | No automatic resolution change |
| Another function changes behavior | May stay textually current | Semantic relevance remains a human/agent judgment |
| User explicitly marks no longer relevant | Preserve anchor history | `not-relevant`, distinct from fixed |

### 11.5 Manual reattachment

Allow selection of replacement code and **Attach discussion here**. Append an anchor-link event with actor and timestamp. Keep the original anchor available. Never rewrite the original code reference to make the conversation look as if it began on the new lines.

## 12. Publish and send transaction

### 12.1 Ordered preflight and dispatch

Implement a per-review send mutex and an outbox. Sequence:

1. Confirm workspace trust, bridge capability, and a real selected target.
2. Capture the target/selection identity and check local workspace/mode compatibility.
3. Freeze the selection of message revisions and global instructions; snapshot their exact bodies.
4. Check dirty files in the relevant review/build scope. Offer **Save affected files and send** or **Cancel**. Saving failure cancels dispatch.
5. Refresh status, anchors, exclusions, and current content. Warn about outdated/ambiguous items; allow sending them with original and current context, not a false precise location.
6. Capture a stable code snapshot and manual-change delta against the prior round where available.
7. Verify MCP connectivity and that the current Codex session has the required tools available. If this is not observable, run the explicit setup self-test before claiming full thread-reply integration.
8. Build the immutable batch and prompt, including exact IDs and revisions. Generate a scoped access grant.
9. Persist batch plus `published` outbox state before any external submission.
10. Revalidate target, code generation, selected messages, and provider busy state. If changed before dispatch, stop/rebuild explicitly rather than sending stale assumptions.
11. Persist `dispatching`, invoke the verified adapter once, then durably record accepted/rejected/unknown.
12. Update pending-send cursors only for the exact accepted message revisions. Newer drafts remain pending.

The normal successful path is one Send action after setup. Confirmations occur for real ambiguity, dirty files, changed target, sensitive content, or material drift—not as gratuitous steps every round.

### 12.2 Delivery state machine

```text
published → dispatching → accepted
                       → rejected
                       → unknown
published → cancelled-before-dispatch
```

Keep agent progress separately: `not-fetched → fetched → working → ready/needs-user/failed`. Delivery acceptance is not execution success.

If the provider accepted the message but the reply was lost, the correct state is **Unknown delivery** until reconciled. Do not auto-retry an unknown attempt. A local request ID or JSON-RPC ID does not create server-side idempotency.

If supported, reconcile with provider receipts or a matching user-message/batch marker. Otherwise show an explicit `Inspect conversation before retrying` recovery action. Record a user-confirmed resend as another attempt with the original batch identity.

Locally suppress double-click duplicates using mutexes and durable outbox records. Do not claim end-to-end exactly-once delivery without a provider guarantee.

### 12.3 Suggested generated message

Render this from structured fields with escaped/length-limited user content. Tool names below are ours.

```text
Address Local Review batch <batch-id> in this conversation.
Review: <review-id>; repository: <display-path>; captured source: <snapshot-id>.

Use local_review_get_batch with the supplied batch ID and scoped access grant.
Retrieve all pages of the selected discussions before editing. The batch contains
exact published message revisions, original code excerpts, and current mappings.

I may have made manual changes since your last turn. Read the current files first.
Preserve existing changes unless a requested fix requires changing them; explain
any conflict rather than restoring an earlier version of the whole file.

Address the selected feedback. Reply in each discussion through
local_review_reply, identifying the message revision addressed and what changed.
Record verification through local_review_record_verification and finish the round
through local_review_finish_round. Agent completion does not resolve discussions.

Run the agreed checks for the current source/artifact. Live-cluster work is limited
to the explicitly approved context, namespace, and actions below. Report failure,
missing access, or unrun tests honestly. Do not request broader access implicitly.

Do not stage, commit, stash, change branches, or push. Do not wait for another
review, install a hook, or start a background review loop. Finish normally.

<selected global instruction and scoped verification profile>
<batch-access grant, omitted from logs and diagnostics>
```

Do not send a giant repository dump. Include compact metadata and the minimal batch entry point, with full selected review context available through MCP. The prompt itself is immutable/auditable with sensitive grant material redacted from displayed logs.

### 12.4 Recovery export

Provide **Export review prompt** as a deliberate fallback when sending is unsupported or the user needs recovery. Mark it `Exported—not sent`. Include the selected feedback directly or a clearly usable MCP reference; do not generate a dead temporary path the agent cannot read.

Never relabel this fallback as one-click official-session integration.

## 13. MCP tools and agent replies

### 13.1 Separate data exchange from message submission

The verified Codex bridge starts the new turn. MCP provides review data and lets the agent append discussion/evidence records during that turn. Do not implement MCP sampling, long-running tool waits, or background prompt injection to impersonate Send.

The proxy exposes a narrow MCP server over stdio and forwards authorized review operations to the extension's IPC owner. Only protocol messages go to stdout; diagnostics go to stderr with redaction. Use the current negotiated MCP version supported by both the pinned SDK and Codex. The protocol and SDK provide the transport/tool foundations. [S8] [S15] [S16]

### 13.2 Proposed tool surface

All tools below are implemented by this project. Do not assume they already exist in Codex.

| Tool | Essential input | Result/behavior |
|---|---|---|
| `local_review_health` | Protocol/client version | Compatible endpoint status; no private review enumeration. |
| `local_review_get_batch` | Batch ID, scoped grant, optional cursor | Frozen batch metadata and selected discussion/message revisions; paginated when necessary. |
| `local_review_get_discussion` | Batch ID, grant, discussion ID, cursor | Only the discussion history authorized by that published batch. |
| `local_review_get_anchor_status` | Batch ID, grant, discussion IDs | Current reference projections and source-drift warning; no arbitrary-file access. |
| `local_review_acknowledge_batch` | Batch ID, grant, agent operation ID | Idempotently mark fetched/working; does not itself prove UI delivery. |
| `local_review_reply` | Batch ID, grant, discussion ID, replied-to message/revision, body, operation ID | Append an agent-authored response to the specified discussion. |
| `local_review_prepare_verification` | Batch ID, grant, profile/step IDs, operation ID | Capture current scoped input fingerprint and issue a verification run ID; does not run a command. |
| `local_review_record_verification` | Run ID, batch ID, grant, structured result, operation ID | Append evidence, mark origin/trust level, and assess source drift. |
| `local_review_finish_round` | Batch ID, grant, item dispositions, summary, operation ID | Capture latest code state, report addressed/unanswered items, mark ready/needs-user/failed. |

No tool may resolve a discussion, delete human feedback, publish a new batch, send another Codex prompt, read arbitrary local paths, run shell commands, or change Git state.

Do not offer an agent `set_any_status` or `execute_command` escape hatch.

### 13.3 Access control and identity limitations

Generate an unpredictable batch-scoped capability when publishing. It authorizes only that batch's published contents, allowed discussions, and append-only results. Do not expose unpublished drafts or newly added unrelated feedback to an earlier batch.

Keep the broker authentication secret separate from the batch grant. The broker secret lives in a restricted local credential file used by the proxy, not in user prompts. A batch grant may be included in the message deliberately sent to Codex; treat it as sensitive and redact it from logs/exports by default.

Bind the grant to review/batch/repository, permitted methods, and lifecycle. Revoke on explicit closure/purge and support rotation. Expiration must give a recoverable error without losing feedback.

**Important trust boundary:** Standard tool arguments do not prove the official Codex conversation identity. Do not trust an agent-supplied `codexThreadId` as authentication. Store the target established by our verified dispatch path, and treat a grant as a scoped bearer capability. Another process with the same operating-system account may be able to read local data; this is not isolation from malicious same-user code.

If an adapter exposes authenticated thread/turn metadata independently, attach it as additional provenance. Otherwise label the reply as agent-reported from the authorized batch, not cryptographically proven UI-session authorship.

### 13.4 Tool validation

Validate every request with runtime schemas, length limits, finite enums, and ownership checks. Unknown keys should not become filesystem paths or commands.

For mutations, require a unique operation ID and persist its payload hash. Repeating the same operation returns the original result; reusing the ID with different content returns `OPERATION_ID_REUSE`.

An agent reply must identify the published human message revision it addresses. Accept a valid response to an older revision as history, but flag it stale when newer feedback exists. Do not reject useful history merely because someone added a new message concurrently.

`finish_round` requires a disposition for every selected human item: `addressed`, `needs-clarification`, `not-addressed`, or `blocked`. Missing dispositions remain visibly unanswered. The agent cannot mark later messages addressed by finishing an earlier batch.

Use bounded pages with stable cursors over immutable batch data. Do not silently truncate feedback. Include total counts and a next cursor so the agent can fetch the complete selected review.

### 13.5 IPC and proxy lifecycle

On one host, prefer authenticated Unix-domain sockets or user-scoped Windows named pipes. Use bounded, length-framed messages, protocol-version negotiation, request IDs, deadlines, and cancellation. The registry maps opaque repository keys to endpoints and owner instances.

Restrict permissions on directories/credential files, protect against stale endpoints, and validate owner/installation identity. On Windows, test actual pipe/credential access controls; do not assume a pipe name alone enforces user isolation.

If a loopback HTTP transport is needed for a proven topology, bind only to loopback, authenticate every request, validate Host/Origin, disable wildcard CORS, and limit request size. The MCP specification explicitly warns about local HTTP origin validation and DNS rebinding. [S15]

The proxy should return `REVIEW_UI_OFFLINE` when the extension is closed. It must not spawn another Codex instance, open the database as a second writer, or wait indefinitely for a human. Each operation is short-lived; cluster testing runs in Codex's normal execution tools, not inside an MCP review call.

### 13.6 Setup without repository pollution

Provide **Configure Codex integration** as a one-time explicit action:

1. Diagnose the actual Codex/MCP execution host.
2. Validate the Node runtime and bundled proxy.
3. Install the stable launcher under private extension-managed storage.
4. Show the proposed user-level MCP registration/configuration change.
5. Preserve existing config and create a backup; apply only the named entry after approval.
6. Restart/reload the Codex extension only when needed and approved; verify the existing conversation can be reopened unchanged.
7. Run the health and batch-roundtrip self-test.

Codex's documentation describes IDE MCP configuration and user-level `config.toml`; use those supported setup paths and the actual installed version's behavior. [S6]

Do not write `.codex/config.toml`, `AGENTS.md`, or review metadata into the reviewed repository automatically. Do not install lifecycle hooks. Setup may require a one-time extension restart; the normal review loop does not.

## 14. Manual edits, agent edits, and concurrency

### 14.1 Watch the actual workspace

Listen for document content/save/close events and filesystem create/change/delete events. Deduplicate self-observed changes, debounce expensive work, and reconcile after editor focus returns or a watcher reconnects. Editor events can reflect dirty-state changes as well as text changes, so compare content/version before invalidating anchors. [S3]

Do not depend exclusively on filesystem watchers: they do not capture unsaved buffers and may lose events. Do not depend exclusively on editor events: the agent may write files outside the editor.

### 14.2 Unsaved buffers

Comments may be created on dirty documents; snapshot the exact visible buffer content and version. Mark their source as unsaved.

Before Send, require saving affected review/build inputs, with a clear prompt and a cancellation path. Do not call a global Save All without explaining that unrelated buffers would be saved. Untitled documents require Save As before they can become agent-edit targets; they may remain local-only comments otherwise.

If a file becomes dirty while Codex is working on disk, show a concurrent-edit warning, retain the buffer, and rely on native editor conflict handling. Never discard it or write old snapshots back automatically.

### 14.3 Preserve manual changes

Provide the captured current snapshot plus the prior round snapshot when it exists. Tell Codex to read current files and preserve existing edits.

Do not confidently label every intervening edit as human-authored. Unless reliable origin information exists, label the delta **Changes since previous round**, with optional observed editor-origin hints. Formatters, scripts, and the agent may all modify files.

The extension cannot guarantee that a coding agent preserves every manual change. Make that a behavioral instruction plus a reviewable delta, not a claimed file-lock or semantic protection mechanism.

### 14.4 Concurrent submissions

Allow multiple draft discussions but only one dispatch operation at a time per review. A new batch must not silently mutate or extend an already-sent batch.

A running batch can receive agent replies while the user creates new feedback. Store both, identify which revisions were addressed, and keep the new feedback pending. Do not merge it into the running task unless the user deliberately sends it after the current turn finishes.

### 14.5 Branch/worktree changes

Detect repository identity and baseline changes on focus, Send, and relevant Git metadata updates. If a worktree is moved or removed, preserve the review and prompt for explicit relocation. Never route it to another worktree with the same remote URL.

A manual user commit is allowed; the product must simply avoid making one itself. After such a commit, maintain the pinned review baseline and offer an explicit archive/rebaseline action.

## 15. Build and live-cluster evidence

### 15.1 Scope: coordinate and record, do not deploy

Codex already has the user's build/test workflow. The extension stores an optional verification profile and includes it in a published request. It does not independently run `kubectl`, `oc`, SSH, builds, or deployments.

During implementation of Local Review, default automated tests use fixtures/mocks. Live-cluster acceptance is a separately authorized test, not permission to discover and modify whatever cluster happens to be reachable.

### 15.2 Verification profile

A local profile describes agreed steps and constraints:

```json
{
  "id": "development-cluster",
  "label": "Agreed development-cluster checks",
  "repositoryKey": "<scoped-worktree-key>",
  "steps": [
    { "id": "unit", "kind": "unit", "instruction": "Run the repository's agreed unit tests" },
    { "id": "build", "kind": "build", "instruction": "Build the changed component and record its artifact digest" },
    { "id": "cluster", "kind": "cluster", "instruction": "Use the approved test procedure and record its outcome" }
  ],
  "cluster": {
    "enabled": false,
    "context": null,
    "namespace": null,
    "allowedActions": [],
    "requireExplicitContext": true,
    "cleanupInstruction": null
  }
}
```

This is a template, not permission to execute its placeholder instructions. Populate from the user's existing workflow or explicit configuration. Missing context/namespace/action scope leaves live-cluster execution blocked, while local review remains usable.

Do not scrape or upload kubeconfig contents, registry credentials, tokens, or private keys. Store nonsecret context/namespace labels and artifact identifiers only.

### 15.3 Verification record

Record:

- Batch/round and verification run IDs.
- Input snapshot/fingerprint, scope completeness, and start/end source-generation checks.
- Step type, actual command or sanitized description, cwd, start/end timestamps, and exit result if known.
- Outcome: `passed`, `failed`, `blocked`, `not-run`, or `unknown`.
- Build artifact identifier and immutable digest where available; mutable tags alone are insufficient proof of the artifact tested.
- Cluster context/namespace, observed deployed digest, test summary, and sanitized evidence references.
- Origin: `agent-reported` or `observed-provider-event`; do not turn reported text into asserted proof.
- Source drift and whether it can be considered current for the latest workspace.

Example display:

```text
Round 3 · source S3
Unit tests: Passed (agent-reported)
Build: sha256:<recorded digest>
Cluster: development-context / approved-namespace
Deployed artifact: sha256:<observed digest>
Cluster test: Failed — reconciliation timed out
Current workspace: changed since S3; verification is stale
```

### 15.4 Freshness rules

Any relevant source/input change invalidates “current verification.” Keep the historical outcome visible. By default be conservative: a whole-review input fingerprint change makes the round stale. Scope-aware exceptions require explicit dependency coverage, not a filename guess.

A successful build is not a successful deployment; a deployment using an older image is not verification of the new source. Missing source-to-artifact linkage or unknown deployed digest yields incomplete evidence.

Capturing the current source hash after tests finish does not prove those tests ran against it. Use the prepared run fingerprint, execution interval, artifact identity, and drift checks. Where the evidence remains uncertain, label it.

Cluster state can change independently of source. A source-matched test is still historical evidence from its recorded time, not a promise that the cluster remains healthy indefinitely.

### 15.5 Permissions and risky actions

Use the same Codex approval/security configuration already in force. Publishing a review is not authorization to bypass sandbox restrictions, access production clusters, or run destructive cleanup.

The generated prompt must require explicit cluster context in commands when live testing is approved, report blocked permissions honestly, and avoid blanket destructive operations. Do not infer an approved cluster from whichever kubeconfig context is currently selected.

## 16. Security, privacy, and trust

### 16.1 Threat model

Protect against cross-workspace routing, accidental feedback disclosure, unexpected local HTTP callers, malformed tool inputs, path traversal, stale/duplicate operations, unsafe markdown, and accidental repository changes.

Do not claim protection against a malicious process running as the same OS user with access to all source and extension data. Do not claim that a local review remains wholly local after feedback is deliberately sent to a cloud-backed agent.

### 16.2 Workspace trust

Declare limited support in untrusted workspaces. Permit read-only UI where safe, but disable subprocess Git inspection, MCP launch/configuration, Send, and actions that execute code until trust is granted. Use VS Code's documented trust APIs and test trusted and restricted states separately. [S17]

Never accept executable paths or helper commands from an untrusted workspace setting without explicit trust/validation. User-level settings for proxy/runtime paths are preferable.

### 16.3 Content safety

Treat code excerpts, repository files, comments, and tool responses as data, not privileged instructions to the extension. No `eval`, shell interpolation, automatic command links, or arbitrary file writes from review text.

Render user/agent markdown untrusted, without HTML execution or arbitrary command URI trust. Extension-owned actions are registered separately with validated IDs. Validate all URI/path lookups against the selected review and allowed roots; reject traversal, symlink escapes, invalid encodings, and foreign authority.

### 16.4 Secrets and sensitive files

Default exclusions cover private keys, kubeconfigs, credential stores, `.env`-style files, known token files, and binary secrets. Show excluded-file counts/reasons. Permit intentional safe examples only through explicit inclusion.

Scan outgoing comments/excerpts/logs for likely secrets as a warning layer; do not claim perfect detection. Show a preview/redaction decision instead of silently changing the user's feedback. Do not place authentication tokens in diagnostics, process arguments where avoidable, or repository files.

### 16.5 Logging and telemetry

No external telemetry by default. Local logs contain operation IDs, durations, capability levels, and redacted error summaries—not full code, prompts, or credentials.

Provide a user-reviewed diagnostic export with clear contents. Bound retention. Keep ordinary operation independent from an internet service controlled by this project.

### 16.6 Read-only Git enforcement

Put all runtime Git access behind one audited wrapper and test its allowlist. Record a Git-state fingerprint before and after review-only operations. Include refs, index bytes where stable, stash/reflog state, and tracked/untracked workspace status.

The **test harness only** may create baseline commits in disposable fixture repositories that it creates under a dedicated temporary directory. Never seed fixtures inside the user's repository. Add a safety check requiring the fixture marker and root before any test-only Git mutation.

## 17. Remote development and platform support

### 17.1 Host topology must be explicit

There may be four different locations: the VS Code UI, workspace extension host, Codex backend execution host, and MCP proxy host. Document the actual layout rather than assuming `localhost` means the same machine everywhere.

VS Code's remote-extension guidance explains extension host placement and remote-safe storage. Use `extensionKind`, runtime diagnostics, and URIs accordingly; do not hardcode editor installation directories. [S7]

Prefer the review controller/store near the actual workspace files. A separate UI-side bridge companion is justified only if the validated Codex interface lives there and cannot be accessed through supported cross-host commands. Do not assume extension exports are transparently callable across processes/hosts.

### 17.2 Required validation matrix

| Layout | Review UI/storage | Send/return-path requirement |
|---|---|---|
| Local Linux | Supported desktop extension host | Real installed official Codex test |
| Local Windows | Windows paths/locks/IPC | Real official extension test; no Unix-only assumptions |
| Windows UI + WSL workspace | Workspace operations in WSL | Prove where Codex and MCP run, and both directions of communication |
| Remote SSH | Remote workspace host | Test only declared supported topology; no silent localhost tunneling assumptions |
| Dev Container | Container workspace host | Record storage lifetime and proxy/runtime availability |
| Web-only VS Code | Explicitly unsupported for full MVP | No pretend Node subprocess/official-extension integration |

Local Linux/Windows and the actual user WSL arrangement are release priorities. Other topologies may be labelled preview/not-tested until validated; do not claim universal remote support from a local test.

### 17.3 Host mismatch handling

If the official bridge runs locally while the review store is remote, require an authenticated, scoped transport proven for that layout. Do not expose a broker on `0.0.0.0`, open firewall ports, or install tunnels automatically.

If the MCP proxy cannot reach the right owner host, health diagnostics must explain the mismatch. Keep drafts safe and disable full Send until the reply path is usable.

Reinstallation/rebuilding a container may remove private storage on that host. Provide explicit export/backup guidance and display the effective data location. Do not promise persistence beyond the actual volume/storage lifecycle.

## 18. Repository layout and development commands

Use one repository, with boundaries that make pure-domain logic testable without VS Code or Codex.

```text
local-review/
  package.json
  package-lock.json
  tsconfig.base.json
  README.md
  LICENSE
  SECURITY.md
  .vscode/
    launch.json
    tasks.json
  packages/
    protocol/
      src/                       # Runtime schemas, IDs, errors, IPC contracts.
    core/
      src/domain/
      src/store/
      src/snapshots/
      src/anchors/
      src/publishing/
      src/verification/
    vscode-extension/
      package.json
      src/extension.ts
      src/reviewController.ts
      src/git/
      src/editors/
      src/comments/
      src/views/
      src/bridge/
        codexBridge.ts
        unsupportedBridge.ts
        adapters/                # Only adapters substantiated by M0.
      src/ipc/
      src/setup/
      resources/
    mcp-proxy/
      src/main.ts
      src/tools/
      src/ipcClient.ts
      src/launcher.ts
  test/
    unit/
    extension-host/
    bridge-contract/
    fixtures/
      typescript-retry/
      go-controller/
      unusual-paths/
    e2e/
      real-codex/
      live-cluster/
    fault-injection/
  scripts/
    doctor.mjs
    verify.mjs
    package.mjs
    fixtures.mjs
    test-real-codex.mjs
    test-cluster.mjs
  docs/
    ARCHITECTURE.md
    BRIDGE_VALIDATION.md
    REQUIRED_CODEX_API.md
    COMPATIBILITY.md
    DATA_FORMAT.md
    SECURITY.md
    TEST_REPORT.md
    USER_GUIDE.md
    TROUBLESHOOTING.md
    PROGRESS.md
    decisions/
  dist/
```

These paths are the implementation project, not runtime files to create inside other repositories being reviewed.

Implement the following commands with real behavior, clear prerequisites, and nonzero exit codes on failure:

```text
npm ci
npm run doctor
npm run typecheck
npm run lint
npm run test:unit
npm run test:integration
npm run test:security
npm run test:recovery
npm run test:bridge:mock
npm run test:bridge:real       # Explicitly gated; requires real IDE/session access.
npm run test:cluster          # Explicitly gated; never chooses a cluster itself.
npm run build
npm run package
npm run verify
```

`npm run verify` must run all noninteractive safe checks and report real-IDE/cluster checks separately. A skipped authenticated test is `NOT_RUN`, not green proof that the real bridge works.

Choose and record Node/VS Code minimum versions based on tested APIs and the MCP runtime. Pin CI versions, dependency versions, and the tested Codex extension version. Do not select a model for the user or hardcode a current model name in the bridge.

Provide an F5 extension-host configuration. The real-Codex test profile must actually enable/install the official extension; a runner launched with all extensions disabled cannot validate that integration. [S10]

## 19. Implementation milestones and work items

Execute in the order below. Record each task in `docs/PROGRESS.md` as `NOT_STARTED`, `IN_PROGRESS`, `DONE`, `BLOCKED`, or `NOT_RUN`, with files changed, test evidence, and the next concrete action. Do not use a checked box for an unverified integration.

The full test inventory is supplied separately in `TEST_MATRIX.md`. Map implementation tests to those IDs.

### M0 — Real bridge feasibility and environment diagnosis

**Dependencies:** None. Build only the minimal extension/proxy needed for the experiment.

| Task | Deliverable | Acceptance |
|---|---|---|
| M0.1 | Sanitized environment and capability inventory | Exact versions/host locations recorded; no secret dumps. |
| M0.2 | Candidate adapter investigation | Actual schemas/provenance recorded; no guessed send command. |
| M0.3 | Send Probe button | Existing finished conversation receives a real new message, or a concrete unsupported result is produced. |
| M0.4 | A/B target-switch, restart, draft, and busy tests | Outcomes match Section 5; failures not hidden behind mocks. |
| M0.5 | Tiny MCP return-path probe | Sent conversation invokes tool and correct local probe is updated. |
| M0.6 | Bridge validation report and capability decision | Supported/experimental/blocked/not-run status with evidence. |

**Exit:** The integration path is proved or explicitly blocked. Continue independent modules even when blocked, but retain the release blocker.

### M1 — Project foundation and contracts

**Dependencies:** M0 inventory; does not require successful real Send.

| Task | Deliverable | Acceptance |
|---|---|---|
| M1.1 | Workspace packages, strict TS, lint/build/test scripts | Clean install, typecheck, and basic tests pass. |
| M1.2 | Runtime schemas and ID/revision rules | Invalid payloads rejected; no `any` at trust boundaries. |
| M1.3 | Domain/service interfaces and unsupported bridge | Review domain runs without VS Code; unsupported state is visible. |
| M1.4 | Test fixture safety wrapper | Mutating fixture setup cannot target a real workspace. |
| M1.5 | Version/runtime compatibility record | Node, VS Code, MCP packages, and provider versions identified. |

**Exit:** Repository builds reproducibly and has meaningful foundational tests, not empty passing suites.

### M2 — Repository discovery, durable store, and snapshots

**Dependencies:** M1.

| Task | Deliverable | Acceptance |
|---|---|---|
| M2.1 | Host/worktree identity + read-only Git wrapper | Distinct worktrees isolated; unsafe commands rejected. |
| M2.2 | Journal, projections, lock, and recovery | Truncated-tail and competing-window tests pass. |
| M2.3 | Content-addressed blobs and pinned baseline | Snapshot survives file deletion and does not create Git objects. |
| M2.4 | Stable capture + exclusions + dirty-buffer capture | Concurrent changes detected; unsupported files labelled. |
| M2.5 | Baseline selection and status model | Late-start limitation, new/deleted/renamed files handled correctly. |
| M2.6 | Retention/integrity inspection | Referenced blobs protected from garbage collection. |

**Exit:** Restart restores the same review/snapshot contents and review-only actions leave Git state unchanged.

### M3 — Native diff shell and code-navigation proof

**Dependencies:** M2.

| Task | Deliverable | Acceptance |
|---|---|---|
| M3.1 | Changes Tree View + baseline controls | File list matches expected fixture changes. |
| M3.2 | Snapshot content provider and native comparisons | Current side is the actual workspace URI. |
| M3.3 | Go to Definition/reference/hover smoke tests | TypeScript and Go fixtures work with installed tooling on current side. |
| M3.4 | Old/new side selection model | Selections map to correct content and revision. |
| M3.5 | Missing/binary/conflict states | No fake files, misleading ranges, or accidental source changes. |

**Exit:** A user can inspect real diffs and navigate current code before commenting exists.

### M4 — Persistent human/agent discussions

**Dependencies:** M3 and domain schemas.

| Task | Deliverable | Acceptance |
|---|---|---|
| M4.1 | Native comment controller + replies | Multi-message conversation works; replies remain enabled. |
| M4.2 | Draft/edit/revision persistence | Published message history is immutable; unsent edits remain drafts. |
| M4.3 | Resolve/reopen/not-relevant actions | Agent messages cannot resolve threads; new human reply reopens. |
| M4.4 | Discussions Tree View and unread indicators | Open/outdated discussions never vanish from outstanding counts. |
| M4.5 | Restart reconstruction and deletion handling | Original discussion survives file deletion/editor restart. |

**Exit:** GitHub-style conversation semantics work using mocked agent messages, clearly separate from real integration validation.

### M5 — Anchor tracking and code evolution

**Dependencies:** M2–M4.

| Task | Deliverable | Acceptance |
|---|---|---|
| M5.1 | Position/text-version mapping | Insertions above a selection move it without invalidation. |
| M5.2 | Overlap/deletion/undo behavior | Changed code becomes outdated; exact undo preserves history. |
| M5.3 | Conservative context/rename matching | Repeated snippets become ambiguous rather than misattached. |
| M5.4 | Original-side reviewed-change tracking | Commenting on a deletion does not become immediately detached. |
| M5.5 | Manual reattachment + historical views | Original reference remains accessible. |
| M5.6 | Watcher reconciliation/fuzz tests | Missed events/reload converge to correct projections. |

**Exit:** Anchor acceptance tests and property-based/randomized edit sequences pass, including UTF-16 and CRLF cases.

### M6 — Publish coordinator and real Send adapter

**Dependencies:** M4–M5; real dispatch additionally requires a verified M0 adapter.

| Task | Deliverable | Acceptance |
|---|---|---|
| M6.1 | Batch selection, revision freeze, prompt renderer | Only chosen revisions included; omitted drafts stay private. |
| M6.2 | Dirty-file/stability/target preflight | No unsaved-code mismatch or silent target switch. |
| M6.3 | Durable outbox + delivery reconciliation | Unknown outcomes are not automatically retried. |
| M6.4 | Provider adapter with version guards | Same official UI conversation owns the new turn. |
| M6.5 | Busy/draft/multi-panel behavior | No steering, composer clobbering, or accidental duplicate turn. |
| M6.6 | Explicit recovery export | Clearly marked exported, not sent. |

**Exit:** Full real adapter tests pass, or this milestone's real-send part remains BLOCKED while independent tests pass. Never substitute the standalone Codex SDK for M6.4.

### M7 — MCP roundtrip, scoped grants, and discussion results

**Dependencies:** M1–M2 and M4–M6 contracts; can test with a fake client before the real bridge is available.

| Task | Deliverable | Acceptance |
|---|---|---|
| M7.1 | Versioned authenticated IPC | Invalid credentials/host/workspace IDs rejected. |
| M7.2 | Bundled MCP proxy and launcher | Startup works without runtime package downloads. |
| M7.3 | Read/paging tools | Frozen selected context fully retrievable; drafts inaccessible. |
| M7.4 | Reply/acknowledgement/idempotency tools | Duplicate operation IDs cannot duplicate replies. |
| M7.5 | Finish-round semantics | Every selected item has disposition; newer feedback remains outstanding. |
| M7.6 | User-level setup and health diagnostics | No reviewed-repository files added; wrong-host issues explained. |
| M7.7 | Real same-conversation tool roundtrip | Codex responds inside the correct native discussions. |

**Exit:** Both fake-client security tests and the real-IDE return-path test have distinct recorded outcomes.

### M8 — Manual-edit protections and verification evidence

**Dependencies:** M5–M7.

| Task | Deliverable | Acceptance |
|---|---|---|
| M8.1 | Change-drift awareness and next-round diff | Manual code edits retained and reflected before dispatch. |
| M8.2 | Verification profile and run preparation | Missing live-cluster scope blocks cluster checks, not reviews. |
| M8.3 | Artifact/source/evidence records | Old image/tests are never shown as verified new source. |
| M8.4 | Stale reply and test badges | Reply to old revision cannot clear newer comment. |
| M8.5 | Agent-reported versus observed provenance | No unsupported claim that text proves test execution. |

**Exit:** A complete mocked two-round flow plus authorized real-session flow preserve edits and show honest verification freshness.

### M9 — Security, remote topology, recovery, and packaging

**Dependencies:** M2–M8; independent work may proceed while M0 remains blocked.

| Task | Deliverable | Acceptance |
|---|---|---|
| M9.1 | Trust, path, markdown, credential tests | Restricted mode and malicious payload checks pass. |
| M9.2 | Crash/compaction/unknown-delivery fault tests | No data loss or automatic duplicate sends. |
| M9.3 | Local Windows/Linux and actual WSL tests | Host matrix has recorded outcomes, not assumptions. |
| M9.4 | Storage limits, large-diff responsiveness | Resource use measured; no unbounded UI blocking. |
| M9.5 | VSIX and bundled proxy packaging | Clean installation and uninstallation tested. |
| M9.6 | User guide, troubleshooting, compatibility | Setup and failure states reproducible from documentation. |

**Exit:** A clean machine/profile can install the VSIX and diagnose support without modifying reviewed repositories.

### M10 — User-flow acceptance and final handoff

**Dependencies:** All applicable prior milestones; real bridge must pass to claim full completion.

Run the exact scenario in Section 20. Complete the test matrix, provide the VSIX path, record limitations, and show evidence that no review-generated Git commits/staging occurred.

Do not auto-publish to the Marketplace, create public repositories/issues, upload private reports, or run a Git push as part of the handoff.

### Parallel work guidance

After M0 inventory and M1 contracts, independent agents may work on storage, UI, anchors, and MCP tools. Give each exclusive ownership of implementation files and a shared schema contract. Only one owner changes protocol schemas or review-store migration formats at a time.

Do not let a UI agent invent bridge methods while another investigates the real provider. Keep one owner for M0/M6 and require evidence-backed adapter contracts.

## 20. Testing strategy and acceptance scenario

### 20.1 Test layers

**Pure unit tests:** Schemas, range conversions, event replay, snapshot hashes, stable capture decisions, text mapping, batch selection, outbox transitions, token scope, and evidence freshness. No Codex login required.

**Property/fuzz tests:** Generate insert/delete/replace sequences over Unicode/multiline text, compare incremental anchors with fresh recomputation, and assert bounds and ambiguity rules. Exercise journal truncation at arbitrary byte offsets and replay consistency.

**Extension-host integration:** Real native documents/diffs/comment commands, persistence across reload, source-control fixtures, active selection, and trust-aware commands. Use the official test harness. [S10]

**MCP/IPC contract tests:** Actual stdio subprocess and framed IPC, wrong grants, cross-workspace requests, pagination, cancellation, corrupt input, proxy restart, and duplicate mutation handling.

**Provider fake:** Deterministic adapter behaviors for busy, failure, unknown acceptance, target races, and version mismatch. Clearly tag these as mocks.

**Real official-extension test:** Required for Send claims. Validate selected-conversation routing, user-message UI, retained context, official execution/approval behavior, and MCP return path.

**Authorized live-cluster test:** Optional during ordinary CI, mandatory before claiming the user's cluster loop has been demonstrated. A skipped test remains NOT_RUN; it cannot be replaced by a fake “passed” result.

### 20.2 End-to-end acceptance script

Use a disposable TypeScript or Go project first, then the real development workflow only with appropriate authorization.

1. Open the official Codex extension and start conversation A before opening Local Review.
2. Plan a harmless test feature. Approve implementation and let Codex finish normally.
3. Open Local Review for the first time. Start a review against the existing HEAD; verify no task-start snapshot is claimed.
4. Open a changed-file native diff. Navigate to a called function from the current side.
5. Add two comments in separate files and one comment on an original-side deleted block. Reply to the first comment so it contains conversation history.
6. Manually edit another function, leave one file dirty, then click Send. Verify the save/cancel preflight. Save and send.
7. Observe exactly one new user message in conversation A. Verify no new conversation, waiting hook, or background agent process was created by Local Review.
8. Codex retrieves the batch, fixes the selected concerns, posts responses to the right discussions, and records actual test outcomes. It finishes normally.
9. Verify changed references are outdated without being resolved; an unchanged deleted-code discussion remains properly anchored to its reviewed change.
10. Add a follow-up human message and make another manual edit. Inspect **Since previous round** and send again to A.
11. Verify the second batch contains the new human revision and relevant history, not an accidental replay of every old request. Preserve manual changes and distinguish fresh/stale verification.
12. Resolve one discussion manually. Leave another open. Restart VS Code; restore all history and the open count.
13. Select conversation B and attempt Send. Confirm the destination change, or cancel; verify no silent routing to A.
14. Return to A and send another harmless follow-up after its earlier turn is finished.
15. Simulate lost delivery acknowledgement. Verify an Unknown state rather than an automatic duplicate.
16. Check refs, index, stash/reflog, and repository status against expected user/agent source changes. No Local Review checkpoint commits, staged changes, private metadata, or hidden refs exist.
17. In the authorized development-cluster variant, require source/artifact/context linkage and intentionally simulate a stale image or failed test. Verify the UI does not show a false pass.
18. End review manually. The product does not commit or push; the user remains free to do that independently.

### 20.3 Evidence format

Every scenario records test ID, runtime/provider versions, host topology, fixture/source fingerprint, result, and sanitized evidence path.

Use result values `PASS`, `FAIL`, `BLOCKED`, and `NOT_RUN`. A human-observed real-IDE test may be marked `PASS_MANUAL` with evidence and limitations; do not describe it as automated.

## 21. Packaging, installation, and upgrades

### 21.1 Extension manifest

Contribute commands, Tree Views, native comment menus, restricted-workspace behavior, and configuration entries. Use stable APIs supported by the recorded `engines.vscode` range.

Core command IDs should include:

```text
localReview.open
localReview.start
localReview.addComment
localReview.reply
localReview.send
localReview.publishLocally
localReview.resolve
localReview.reopen
localReview.markNotRelevant
localReview.reattach
localReview.showOriginal
localReview.showSincePreviousRound
localReview.configureCodex
localReview.diagnostics
localReview.exportPrompt
```

Suggested settings: default baseline; snapshot/file-size limits; secret exclusions; proxy Node path; user-level integration setup; bridge experimental opt-in; diagnostics verbosity. Do not expose a configurable arbitrary “send command” plus unvalidated JSON as the default integration.

Allow the local review UI to function when Codex is absent. Avoid forcing activation of unrelated extensions on every editor startup; use lazy activation and explicit setup. If an official API requires an extension dependency, document that decision and its installation behavior.

### 21.2 Build output

Package an installable `.vsix` and a checksum, bundled extension/proxy scripts, source maps as appropriate for debugging, dependency-license notices, and a release manifest with capability/compatibility information. VS Code documents VSIX packaging and publication tooling. [S18]

Build reproducibly from the lockfile. Inspect the package to ensure it contains no credentials, personal source snapshots, logs, fixture `.git` directories, private conversations, or development-only probes enabled by default.

Do not run automatic Marketplace publication or source pushes. A packaged experimental adapter must be labelled experimental and off by default.

### 21.3 Upgrade safety

On activation, negotiate data/proxy/protocol versions before accepting writes. Back up and validate migrations. Unknown future schemas open read-only, not with destructive defaults.

Upgrade the stable proxy launcher pointer atomically. Running proxy processes may finish with their loaded version; refuse incompatible operations clearly. Do not interrupt an active Codex turn just to update a helper.

A Codex extension upgrade invalidates a version-pinned experimental adapter until its smoke tests pass again. Retain local review functionality and data while Send is disabled.

### 21.4 Documentation and release automation

Provide local setup, F5 development, standalone proxy prerequisites, MCP registration, host topology diagrams in text, supported versions, recovery procedures, and explicit unsupported paths.

A CI workflow should run safe static/unit/integration/security/recovery suites and build a VSIX artifact. Use isolated test profiles and no personal account credentials. Real-Codex/live-cluster suites are separate opt-in jobs/manual runs with scoped secrets and no implicit execution on untrusted pull requests.

## 22. Performance and operational limits

The following are **initial engineering budgets**, not measured claims. Benchmark and adjust them with evidence.

| Item | Initial target or cap |
|---|---|
| Typical comment save | Durable local save and UI feedback within 250 ms on a local test machine |
| Common anchor refresh | Within 500 ms after edit debounce for ordinary source files |
| Large text-file automatic matching | Start with a 2 MiB per-file cap; metadata/manual handling above it |
| Repository scan | Cancellable, bounded concurrency; ignore excluded build/vendor trees by policy |
| Snapshot capture | Stream/hash incrementally; reuse blobs; report unstable or oversized inputs |
| MCP response page | About 100 KiB maximum serialized content per page, with explicit paging |
| IPC frame | Hard maximum around 1 MiB; reject malformed/oversized frames |
| Comment body | Bounded, initially 32 KiB per revision, with clear validation |
| Diagnostic logs | Bounded local rotation; no prompt/source payloads by default |
| Storage quota | User-visible soft threshold; never evict referenced open-discussion blobs silently |

Do not freeze the extension host with unbounded diff computations. Use background computation or asynchronous chunking, cancellation, and version guards. Avoid snapshotting the entire repository on every keystroke; map affected anchors incrementally and perform stable batch snapshots at explicit boundaries.

Record benchmarks with repository/file sizes, machine/runtime, cold/warm state, and p50/p95 latencies. CI timing variability must not mask correctness failures.

## 23. Completion criteria and reporting

### 23.1 Definition of done

The end-to-end product is complete only when:

- The real official-extension bridge submits a new turn to the selected finished conversation and passes target/restart tests.
- Native diff/code navigation and persistent multi-reply discussions work.
- Old/new-side anchors survive code edits, deletions, ambiguity, and reload correctly.
- Manual edits and new message revisions are preserved across rounds.
- Scoped MCP read/reply/evidence tools work from the same agent workflow.
- Delivery failures/uncertainty do not lose drafts or silently duplicate submissions.
- Private snapshots do not create Git commits, staged changes, hidden refs, or repository metadata.
- Security/recovery/host tests pass for each claimed supported topology.
- Source/artifact/test freshness is reported honestly; missing live-cluster validation remains explicit.
- A clean-profile installation of the built VSIX succeeds with documented prerequisites.

### 23.2 Required handoff files

Provide source, VSIX/checksum, `README.md`, user/setup/troubleshooting guides, compatibility matrix, bridge evidence, data-format/migration documentation, security notes, test report, and progress/known-issues record.

The final implementation report must answer:

1. What exactly was built and where is the VSIX?
2. Which Send adapter is used, and is it documented or experimental?
3. Which actual official Codex/VS Code versions and host layouts were tested?
4. Did the real existing-conversation Send test pass, and what proves it?
5. Which tests passed, failed, were blocked, or were not run?
6. What live-cluster testing actually happened, if any?
7. What prerequisites or external provider changes remain?
8. How does the user install, configure, and recover the extension?

### 23.3 Non-completion is better than fabricated completion

If no suitable provider interface exists, the useful deliverable is a functioning native review extension with its Send feature explicitly blocked, a reproducible diagnostic, and a minimal provider API request. Do not conceal this behind an “integration abstraction,” screenshots from a different client, or a clipboard workaround.

If GUI/account/cluster access is absent, finish the code and safe tests available, leave reproducible test commands, and label external acceptance as NOT_RUN. Do not invent access or test results.

Do not stop merely because an optional enhancement is difficult. Continue the independent implementation and report the precise boundary of what is complete.

## 24. References

These primary sources support the platform facts in this plan. They do not certify that our proposed bridge or extension has been implemented or tested. Recheck them against the installed versions during M0/M1.

| Ref | Source | Relevant scope |
|---|---|---|
| [S1] | OpenAI: Codex IDE/developer commands | Published commands versus actual submission capability |
| [S2] | OpenAI: Codex App Server | Thread/turn protocol, schemas, transport caveats |
| [S3] | Microsoft: VS Code API reference | Extension exports/commands, comments, documents, storage |
| [S4] | Microsoft: Built-in commands | Native diff and language-provider commands |
| [S5] | Microsoft: Native comment sample | Comment controller/reply mechanics |
| [S6] | OpenAI: MCP configuration | IDE MCP setup and configuration |
| [S7] | Microsoft: Remote extension guidance | Host placement and private storage |
| [S8] | Official MCP TypeScript SDK | Versioned SDK/server/client APIs |
| [S9] | Official Codex Marketplace listing | Extension identity |
| [S10] | Microsoft: Testing extensions | Real extension-host test tooling |
| [S11] | Git: git-status | Porcelain and NUL-delimited status output |
| [S12] | Git: git-diff | Working tree/index/revision comparisons |
| [S13] | Git: general command reference | Optional locks and read-only discovery controls |
| [S14] | Microsoft: Virtual documents | Immutable document provider foundation |
| [S15] | MCP transport specification, versioned reference | stdio/HTTP transport and HTTP security |
| [S16] | MCP tools specification, versioned reference | Tool schema and result semantics |
| [S17] | Microsoft: Workspace trust | Restricted workspace behavior |
| [S18] | Microsoft: Publishing extensions | VSIX packaging and publication controls |

The versioned MCP specification links are references, not an instruction to force that protocol version. Negotiate and record the actual version supported by the installed Codex client and selected SDK.

[S1]: https://developers.openai.com/codex/ide/commands "OpenAI — Codex IDE commands"
[S2]: https://developers.openai.com/codex/app-server "OpenAI — Codex App Server"
[S3]: https://code.visualstudio.com/api/references/vscode-api "Microsoft — VS Code API reference"
[S4]: https://code.visualstudio.com/api/references/commands "Microsoft — Built-in commands"
[S5]: https://github.com/microsoft/vscode-extension-samples/blob/main/comment-sample/src/extension.ts "Microsoft — Native comment sample"
[S6]: https://developers.openai.com/codex/mcp "OpenAI — Model Context Protocol"
[S7]: https://code.visualstudio.com/api/advanced-topics/remote-extensions "Microsoft — Remote extensions"
[S8]: https://github.com/modelcontextprotocol/typescript-sdk "Official MCP TypeScript SDK"
[S9]: https://marketplace.visualstudio.com/items?itemName=openai.chatgpt "Official Codex extension"
[S10]: https://code.visualstudio.com/api/working-with-extensions/testing-extension "Microsoft — Testing extensions"
[S11]: https://git-scm.com/docs/git-status "Git — git-status"
[S12]: https://git-scm.com/docs/git-diff "Git — git-diff"
[S13]: https://git-scm.com/docs/git "Git — command reference"
[S14]: https://code.visualstudio.com/api/extension-guides/virtual-documents "Microsoft — Virtual documents"
[S15]: https://modelcontextprotocol.io/specification/2025-06-18/basic/transports "MCP — Versioned transport reference"
[S16]: https://modelcontextprotocol.io/specification/2025-06-18/server/tools "MCP — Versioned tools reference"
[S17]: https://code.visualstudio.com/api/extension-guides/workspace-trust "Microsoft — Workspace Trust"
[S18]: https://code.visualstudio.com/api/working-with-extensions/publishing-extension "Microsoft — Publishing extensions"
