// Intrinsic run events (F8 substrate). The core emits these; the opt-in trace
// entry (`@microfoom/core/trace`) is just a typed subscriber. Core never imports
// the trace surface — it only produces this neutral event stream.

import type { AgentUsage } from "./usage.js";

/** A trace event. The built-in run panel and any exporter subscribe to these. */
export type AgentEvent =
  | {
      readonly type: "span_start";
      readonly span: string;
      readonly parent?: string;
      readonly name: string;
      /** What produced the span — drives the render glyph. Absent for manual scopes. */
      readonly kind?: "program" | "method" | "turn" | "scope";
    }
  | {
      readonly type: "span_end";
      readonly span: string;
      readonly durationMs: number;
      readonly usage: AgentUsage;
    }
  | { readonly type: "turn_start"; readonly span: string; readonly label?: string }
  | { readonly type: "foom_call"; readonly span: string; readonly method: string }
  | { readonly type: "repair"; readonly span: string; readonly attempt: number }
  | {
      readonly type: "log";
      readonly span: string;
      readonly message: string;
      readonly level: "info" | "warn" | "error";
    }
  | {
      readonly type: "annotate";
      readonly span: string;
      readonly attributes: Record<string, unknown>;
    }
  // Transcript events (the live conversation): the prompt sent to the model, the
  // assistant's streamed prose/reasoning, and the tool calls it made within a span.
  // A frontend folds these into a readable transcript (see trace.buildTranscript);
  // exporters that only want the span tree ignore them.
  | { readonly type: "turn_meta"; readonly span: string; readonly systemPrompt: string }
  | { readonly type: "user_prompt"; readonly span: string; readonly text: string }
  | { readonly type: "msg_start"; readonly span: string }
  | { readonly type: "msg_text"; readonly span: string; readonly delta: string }
  | { readonly type: "msg_thinking"; readonly span: string; readonly delta: string }
  | { readonly type: "msg_end"; readonly span: string }
  | {
      readonly type: "tool_start";
      readonly span: string;
      readonly callId: string;
      readonly name: string;
      readonly args: unknown;
    }
  | {
      readonly type: "tool_end";
      readonly span: string;
      readonly callId: string;
      readonly content: string;
      readonly isError: boolean;
    };

/** An OTel-style sink: the runtime feeds it the event stream. */
export interface AgentTraceExporter {
  export(event: AgentEvent): void;
}
