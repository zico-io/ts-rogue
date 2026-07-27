import { experimental_workflow } from "eve/tools";

// Enables the experimental Workflow tool. No subagents are declared beyond
// the built-in `agent` delegation tool, so `experimental_workflow()` defaults
// its callable set to `["agent"]` - Workflow orchestrates `agent` calls from
// one model-authored JavaScript program run as a single durable step (fan-out
// with Promise.all, chaining one call's result into another's input,
// loop/conditional logic) instead of costing one model turn per batch. See
// HAR-67 (restored after #152 removed it alongside the coder/scout/reviewer
// subagents it also orchestrated).
export default experimental_workflow();
