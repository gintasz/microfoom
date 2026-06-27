// The fixed control protocol (F2). The agent affects the program ONLY through
// these four native tools; their effect is dispatched by the core (tools.ts) and
// executed by the harness loop, never parsed from free text. A `{ tool }`-tier
// method is additionally advertised as its own native tool with its derived
// parameter schema (ADR-0003).

/** Reserved native tool names for the control operations. */
export const CONTROL_TOOLS = {
  call: "foom_call",
  return: "foom_return",
  throw: "foom_throw",
  inspect: "foom_inspect",
} as const;

export type ControlToolName = (typeof CONTROL_TOOLS)[keyof typeof CONTROL_TOOLS];

const CONTROL_TOOL_NAMES: ReadonlySet<string> = new Set(Object.values(CONTROL_TOOLS));

/** True when a tool name is one of the reserved control operations. */
export function isControlTool(name: string): name is ControlToolName {
  return CONTROL_TOOL_NAMES.has(name);
}
