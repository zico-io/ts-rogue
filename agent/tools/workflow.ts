import { experimental_workflow } from "eve/tools";

// Enables the experimental Workflow tool so eve can orchestrate its declared
// subagents (and the built-in `agent`) from a single model-authored
// JavaScript program run as one durable step. See HAR-22.
export default experimental_workflow();
