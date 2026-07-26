// Declared subagents inherit nothing from the root's authored tool slots, so
// without this re-export coder cannot call session_update at all and its
// blocked-only instruction is dead text. The shared tool's role guard
// classifies coder as a child (ctx.session.parent is set) and refuses
// review/completed; relayIssueId() is null here (coder runs no child-relay
// hook), so a blocked update posts unprefixed - already handled.
export { default } from "../../../tools/session_update";
