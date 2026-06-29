// Opt-in instrumentation entry point (F8). Importing this augments the run context
// with the trace surface (scope / onEvent / export); the common path imports none
// of it, and core never depends on this module. The runtime methods always exist
// on the context — this entry surfaces their types and adds a renderer/exporter.

import type { AgentEvent, AgentTraceExporter } from "../events.js";
import type { AgentScope } from "../program.js";
import {
  type AgentUsage,
  combineUsage,
  emptyUsage,
  toAgentUsage,
  type UsageAccount,
} from "../usage.js";

declare module "../program.js" {
  interface AgentProgramContext<TProgram extends object> {
    /** Name a manual span; returns a handle whose work attributes to it. */
    scope: (name: string) => AgentScope;
    /** Subscribe to the intrinsic event stream. */
    onEvent: (handler: (event: AgentEvent) => void) => void;
    /** Pipe the event stream to an exporter (OTel / Langfuse / …). */
    export: (exporter: AgentTraceExporter) => void;
  }
}

/** Render one trace event as a single human-readable line (OB1). */
function formatEvent(event: AgentEvent): string {
  switch (event.type) {
    case "span_start":
      return `▸ ${event.name} (${event.span})`;
    case "span_end":
      return `■ ${event.span} ${event.durationMs}ms`;
    case "turn_start":
      return `→ turn ${event.span}${event.label === undefined ? "" : ` "${event.label}"`}`;
    case "foom_call":
      return `· ${event.span} foom_call ${event.method}`;
    case "repair":
      return `· ${event.span} repair #${event.attempt}`;
    case "log":
      return `[${event.level}] ${event.span} ${event.message}`;
    case "annotate":
      return `# ${event.span} ${JSON.stringify(event.attributes)}`;
    case "turn_meta":
      return `⚙ ${event.span} system(${event.systemPrompt.length} chars)`;
    case "user_prompt":
      return `» ${event.span} ${event.text}`;
    case "msg_start":
      return `« ${event.span} (assistant)`;
    case "msg_text":
      return `« ${event.span} ${event.delta}`;
    case "msg_thinking":
      return `~ ${event.span} ${event.delta}`;
    case "msg_end":
      return `« ${event.span} (end)`;
    case "tool_start":
      return `↳ ${event.span} ${event.name}(${JSON.stringify(event.args)})`;
    case "tool_end":
      return `↲ ${event.span} ${event.isError ? "error" : "ok"} ${event.content}`;
  }
}

/** An exporter that prints each event via `formatEvent` to the console. */
const consoleExporter: AgentTraceExporter = {
  export: (event: AgentEvent): void => {
    // biome-ignore lint/suspicious/noConsole: this exporter's sole purpose is to print trace events to the console (F8/OB1 renderer).
    console.log(formatEvent(event));
  },
};

/** One log line attached to a span. */
interface RunLog {
  readonly message: string;
  readonly level: "info" | "warn" | "error";
}

/**
 * One node of the run's span tree — pure data, no presentation. A frontend (CLI,
 * harness panel) renders this however it likes. `usage` is rolled up: a node's
 * own measured usage (real only on turn leaves) plus all descendants'.
 */
interface RunNode {
  readonly span: string;
  readonly name: string;
  readonly kind: "program" | "method" | "turn" | "scope";
  /** Wall-clock duration; absent while the span is still open. */
  readonly durationMs: number | undefined;
  /** Rolled-up usage for this subtree. */
  readonly usage: AgentUsage;
  readonly annotations: Record<string, unknown>;
  readonly logs: readonly RunLog[];
  /** Methods the agent foom_called within this span. */
  readonly foomCalls: readonly string[];
  /** Count of repair attempts recorded within this span. */
  readonly repairs: number;
  readonly children: readonly RunNode[];
  /** `false` while the span is still open (no span_end seen). */
  readonly settled: boolean;
}

function toAccount(usage: AgentUsage): UsageAccount {
  return {
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    totalTokens: usage.totalTokens,
    reasoningTokens: usage.reasoningTokens,
    cachedInputTokens: usage.cachedInputTokens,
    costUsd: usage.costUsd,
    calls: usage.calls,
    maxCallDepth: usage.maxCallDepth,
  };
}

interface MutableNode {
  span: string;
  name: string;
  kind: RunNode["kind"];
  parent: string | undefined;
  durationMs: number | undefined;
  ownUsage: UsageAccount;
  annotations: Record<string, unknown>;
  logs: RunLog[];
  foomCalls: string[];
  repairs: number;
  settled: boolean;
  children: MutableNode[];
}

function ensure(map: Map<string, MutableNode>, span: string): MutableNode {
  let node = map.get(span);
  if (node === undefined) {
    node = {
      span,
      name: span,
      kind: "scope",
      parent: undefined,
      durationMs: undefined,
      ownUsage: emptyUsage,
      annotations: {},
      logs: [],
      foomCalls: [],
      repairs: 0,
      settled: false,
      children: [],
    };
    map.set(span, node);
  }
  return node;
}

function freeze(node: MutableNode): RunNode {
  const children = node.children.map(freeze);
  // Roll usage up: own (real only on turn leaves) + all descendants.
  let account = node.ownUsage;
  for (const child of children) {
    account = combineUsage(account, toAccount(child.usage));
  }
  return {
    span: node.span,
    name: node.name,
    kind: node.kind,
    durationMs: node.durationMs,
    usage: toAgentUsage(account),
    annotations: node.annotations,
    logs: node.logs,
    foomCalls: node.foomCalls,
    repairs: node.repairs,
    children,
    // A scope is a grouping handle with no end event of its own; it is "settled"
    // by virtue of the run completing, so it never shows as in-flight.
    settled: node.settled || node.kind === "scope",
  };
}

/**
 * Fold an event stream into the run's span tree (pure). Events arrive in emission
 * order; a span's `span_start` always precedes its end/markers. Returns the single
 * root (the program span) — or a synthetic `run` root if the stream has several
 * top-level spans (e.g. parent-less manual scopes).
 */
function buildRunTree(events: readonly AgentEvent[]): RunNode {
  const map = new Map<string, MutableNode>();
  for (const event of events) {
    switch (event.type) {
      case "span_start": {
        const node = ensure(map, event.span);
        node.name = event.name;
        if (event.kind !== undefined) {
          node.kind = event.kind;
        }
        node.parent = event.parent;
        break;
      }
      case "span_end": {
        const node = ensure(map, event.span);
        node.durationMs = event.durationMs;
        node.ownUsage = toAccount(event.usage);
        node.settled = true;
        break;
      }
      case "turn_start":
        ensure(map, event.span).kind = "turn";
        break;
      case "foom_call":
        ensure(map, event.span).foomCalls.push(event.method);
        break;
      case "repair":
        ensure(map, event.span).repairs = event.attempt;
        break;
      case "log":
        ensure(map, event.span).logs.push({ message: event.message, level: event.level });
        break;
      case "annotate":
        Object.assign(ensure(map, event.span).annotations, event.attributes);
        break;
      default:
        // Transcript-only events (msg_*/tool_*/turn_meta/user_prompt) don't shape
        // the span tree.
        break;
    }
  }

  const roots: MutableNode[] = [];
  for (const node of map.values()) {
    if (node.parent !== undefined && map.has(node.parent)) {
      (map.get(node.parent) as MutableNode).children.push(node);
    } else {
      roots.push(node);
    }
  }

  if (roots.length === 1 && roots[0] !== undefined) {
    return freeze(roots[0]);
  }
  return freeze({
    span: "run",
    name: "run",
    kind: "program",
    parent: undefined,
    durationMs: undefined,
    ownUsage: emptyUsage,
    annotations: {},
    logs: [],
    foomCalls: [],
    repairs: 0,
    settled: roots.every((root) => root.settled),
    children: roots,
  });
}

// --- transcript: event stream → readable conversation ----------------------

/**
 * One turn of the live conversation, span-tagged so a frontend can filter the
 * transcript to a clicked span. Streamed prose/reasoning is coalesced: contiguous
 * deltas of the same kind within one assistant message become a single entry.
 */
type TranscriptEntry =
  | { readonly kind: "system"; readonly span: string; readonly text: string }
  | { readonly kind: "user"; readonly span: string; readonly text: string }
  | { readonly kind: "assistant"; readonly span: string; readonly text: string }
  | { readonly kind: "thinking"; readonly span: string; readonly text: string }
  | {
      readonly kind: "tool_call";
      readonly span: string;
      readonly callId: string;
      readonly name: string;
      readonly args: unknown;
    }
  | {
      readonly kind: "tool_result";
      readonly span: string;
      readonly callId: string;
      readonly content: string;
      readonly isError: boolean;
    };

interface OpenText {
  kind: "assistant" | "thinking";
  index: number;
  text: string;
}

/**
 * Fold an event stream into an ordered transcript (pure). The user prompt, the
 * assistant's reasoning and prose, and each tool call/result land in emission
 * order. Non-transcript events (spans, usage) are ignored.
 *
 * Coalescing is tracked PER SPAN, not globally, for two reasons:
 *  - Concurrent turns (e.g. `Promise.all` over routes) interleave their deltas in
 *    one stream; a single open slot would flip between spans and shred each turn's
 *    reasoning into one-word fragments.
 *  - A harness may chunk one reasoning stream across many provider messages (pi
 *    does — dozens of `msg_start`/`msg_end` per turn); those boundaries are ignored
 *    so the thinking stays whole.
 * A change of kind, a tool call/result, or a new prompt closes that span's entry.
 */
function buildTranscript(events: readonly AgentEvent[]): readonly TranscriptEntry[] {
  const out: TranscriptEntry[] = [];
  // Per-span open streamed entry, so interleaved deltas append to the right block.
  const open = new Map<string, OpenText>();

  const append = (kind: "assistant" | "thinking", span: string, delta: string): void => {
    const current = open.get(span);
    if (current !== undefined && current.kind === kind) {
      current.text += delta;
      out[current.index] = { kind, span, text: current.text };
      return;
    }
    const index = out.length;
    open.set(span, { kind, index, text: delta });
    out.push({ kind, span, text: delta });
  };

  for (const event of events) {
    switch (event.type) {
      case "turn_meta":
        out.push({ kind: "system", span: event.span, text: event.systemPrompt });
        break;
      case "user_prompt":
        open.delete(event.span);
        out.push({ kind: "user", span: event.span, text: event.text });
        break;
      case "msg_start":
      case "msg_end":
        // Message boundaries do NOT break coalescing (see note above).
        break;
      case "msg_text":
        append("assistant", event.span, event.delta);
        break;
      case "msg_thinking":
        append("thinking", event.span, event.delta);
        break;
      case "tool_start":
        open.delete(event.span);
        out.push({
          kind: "tool_call",
          span: event.span,
          callId: event.callId,
          name: event.name,
          args: event.args,
        });
        break;
      case "tool_end":
        open.delete(event.span);
        out.push({
          kind: "tool_result",
          span: event.span,
          callId: event.callId,
          content: event.content,
          isError: event.isError,
        });
        break;
      default:
        break;
    }
  }
  return out;
}

export type { AgentEvent, AgentTraceExporter } from "../events.js";
export type { AgentScope } from "../program.js";
export type { AgentUsage } from "../usage.js";
export type { RunLog, RunNode, TranscriptEntry };
export { buildRunTree, buildTranscript, consoleExporter, formatEvent };
