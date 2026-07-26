// Declared subagents inherit nothing from the root's authored hook slots, so
// without this re-export scout's tool calls and reasoning would never relay
// working chips to Linear -- the parent session would see nothing while the
// subagent works, which reads as idle. The root's shared hook already branches
// correctly on ctx.session.parent (truthy inside any child session, declared
// or built-in-tool copy alike) and handles the session-id handoff.
export { default } from "../../../hooks/child-relay";
