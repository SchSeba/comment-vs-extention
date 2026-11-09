# Codex implementation prompt

Open the intended extension-development repository in VS Code and give Codex this file together with `IMPLEMENTATION_PLAN.md` and `TEST_MATRIX.md`. In a new project, the folder containing these documents can be the project root. In an existing project, preserve its structure and instructions rather than replacing them blindly.

The block below is the startup instruction. The files describe the implementation to build; they are not a prebuilt extension.

---

Implement the Local Review VS Code extension specified in `IMPLEMENTATION_PLAN.md`, using `TEST_MATRIX.md` as the acceptance inventory. Read both files in full before making architectural decisions, and follow applicable repository instructions.

The user's required workflow is fixed: they use the official Codex VS Code extension to plan, implement, and test a task; Codex finishes normally; they then open our native-diff review UI, create GitHub-style multi-reply discussions, and optionally edit code manually. Our Send button submits one new message to the selected, existing official Codex conversation. Codex addresses the feedback, replies inside our discussions through MCP, tests again, and finishes. Repeat without intermediate Git commits.

Start with M0: build the smallest diagnostic extension and return-path probe that can validate actual selected-conversation discovery and new-turn submission in the installed official extension. Verify the provider's real capabilities and argument schemas. Do not invent a send command or treat context attachment as submission. A separately launched Codex/App Server, a copied prompt, or an outstanding hook/tool call does not satisfy this requirement.

Record exact VS Code/Codex/MCP/runtime versions, host topology, the candidate bridge interface, and actual test evidence in `docs/BRIDGE_VALIDATION.md`. Distinguish `SUPPORTED_VERIFIED`, `EXPERIMENTAL_VERIFIED`, `BLOCKED`, and `NOT_RUN`. An experimental interface must be opt-in and version-guarded. Do not patch the official extension, inject into its webview, hijack its process transport, or automate keyboard input as the production bridge.

Then execute M1–M10 in dependency order. Create the real source, runtime schemas, native comments/diffs, private durable snapshots, conservative anchor tracking, revisioned discussion history, publish/outbox coordination, scoped MCP tools, installation workflow, tests, documentation, and an installable VSIX. Use a real current workspace URI on the new side of the diff. Changing code must mark references outdated without automatically resolving discussions. Preserve manual edits and distinguish old test evidence from verification of the current source/artifact.

If the bridge is blocked or cannot be tested here, continue all independent implementation work and safe tests. Keep Send visibly unsupported/not-verified, write `docs/REQUIRED_CODEX_API.md` with the precise missing provider interface, and report the full workflow as incomplete. Do not replace the user's workflow with another architecture merely to claim completion. Similarly, no live-cluster access means that test is `NOT_RUN`, not passed.

Do not create runtime review metadata inside reviewed repositories. Do not stage, commit, stash, switch branches, or push in the project or any user repository. Test-only baseline commits are allowed exclusively inside safety-checked disposable fixture repositories created by the test harness. Do not install hooks, run agent wait loops, create public issues, publish packages, or modify cluster resources without explicit authorization. Keep existing Codex approvals and execution settings intact.

Implement and run all available safe checks: typecheck, lint, unit, extension-host, security, recovery, MCP/IPC, and bridge-contract suites. Keep authenticated real-IDE and authorized live-cluster checks separately identifiable. Never enable destructive/live-cluster operations simply because credentials happen to exist. Validate the exact Windows/WSL topology when available and record missing platform coverage honestly.

Maintain `docs/PROGRESS.md` with milestone/task status, concrete changes, tests/results, blockers, and next steps. Use existing repository conventions when they do not contradict the product contract; otherwise record an architectural decision. Keep working through feasible milestones instead of stopping after scaffolding or a single component.

Finish by providing the VSIX path/checksum, installation and one-time MCP setup instructions, actual bridge capability and tested versions, test results including every blocked/not-run external check, known limitations, and a concise mapping to the definition of done. Do not claim end-to-end completion without the real official-conversation Send and MCP reply roundtrip passing.
