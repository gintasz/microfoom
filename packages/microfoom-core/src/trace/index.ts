// Opt-in instrumentation entry point (F8). Importing this augments the run context
// with the trace surface (scope / onEvent / export); the common path imports none
// of it, and core never depends on this module. The runtime methods always exist
// on the context — this entry surfaces their types and adds a renderer/exporter.

import type { AgentEvent, AgentTraceExporter } from "../events.js";
import type { AgentScope } from "../program.js";

export type { AgentEvent, AgentTraceExporter } from "../events.js";
export type { AgentScope } from "../program.js";

declare module "../program.js" {
  interface AgentProgramContext<TProgram extends object> {
    /** Name a manual span; returns a handle whose work attributes to it. */
    scope(name: string): AgentScope;
    /** Subscribe to the intrinsic event stream. */
    onEvent(handler: (event: AgentEvent) => void): void;
    /** Pipe the event stream to an exporter (OTel / Langfuse / …). */
    export(exporter: AgentTraceExporter): void;
  }
}

/** Render one trace event as a single human-readable line (OB1). */
export function formatEvent(event: AgentEvent): string {
  switch (event.type) {
    case "span_start":
      return `▸ ${event.name} (${event.span})`;
    case "span_end":
      return `■ ${event.span} ${event.durationMs}ms`;
    case "turn_start":
      return `→ turn ${event.span}${event.label !== undefined ? ` "${event.label}"` : ""}`;
    case "foom_call":
      return `· ${event.span} foom_call ${event.method}`;
    case "repair":
      return `· ${event.span} repair #${event.attempt}`;
    case "log":
      return `[${event.level}] ${event.span} ${event.message}`;
    case "annotate":
      return `# ${event.span} ${JSON.stringify(event.attributes)}`;
  }
}

/** An exporter that prints each event via `formatEvent` to the console. */
export const consoleExporter: AgentTraceExporter = {
  export: (event) => {
    console.log(formatEvent(event));
  },
};
