# Automatic submission to an existing Codex chat

An official IDE integration would need to expose the selected local conversation, its busy state, and a way to submit a user message to that exact conversation with a typed acceptance or rejection. The submission must preserve the existing draft, execution environment and approval routing. It needs either an expected-selection token or an explicit conversation target to avoid submitting to the wrong chat during a selection change.

Acceptance requires a real new user message and turn in the selected finished chat. Verify selection changes across two chats, preservation of an unsent draft, busy and failed destinations, lost acknowledgement handling, reopening after an IDE restart, and the MCP reply returning to the matching comment. The command that copies a follow-up hands control back to the user to submit it.
