// The harness-specific execution layer: spawning a VIBEFUNCTION as a pi subagent.
// (Program loading, arg binding, and call orchestration are harness-agnostic — they live in core.)
export { runThoughtcodeSubagent } from "./subagent.js";
