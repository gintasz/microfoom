// buildTranscript folds the event stream into a readable conversation. The hard
// cases — which a real run hits and which the first cut got wrong — are coalescing
// across the message boundaries a harness emits mid-stream, and keeping concurrent
// turns' interleaved deltas in separate per-span entries.

import { describe, expect, it } from "vitest";
import type { AgentEvent } from "../src/trace/index.ts";
import { buildTranscript } from "../src/trace/index.ts";

const thinking = (span: string, delta: string): AgentEvent => ({
  type: "msg_thinking",
  span,
  delta,
});
const text = (span: string, delta: string): AgentEvent => ({ type: "msg_text", span, delta });
const start = (span: string): AgentEvent => ({ type: "msg_start", span });
const end = (span: string): AgentEvent => ({ type: "msg_end", span });

describe("buildTranscript", () => {
  it("coalesces contiguous deltas of one kind into a single entry", () => {
    const out = buildTranscript([
      thinking("s", "Hel"),
      thinking("s", "lo "),
      thinking("s", "world"),
    ]);
    expect(out).toEqual([{ kind: "thinking", span: "s", text: "Hello world" }]);
  });

  it("coalesces ACROSS msg_start/msg_end boundaries (harnesses chunk one stream)", () => {
    // pi emits many message boundaries within one reasoning stream; they must not
    // shred the thinking into per-message fragments.
    const out = buildTranscript([
      start("s"),
      thinking("s", "one "),
      end("s"),
      start("s"),
      thinking("s", "thought"),
      end("s"),
    ]);
    expect(out).toEqual([{ kind: "thinking", span: "s", text: "one thought" }]);
  });

  it("keeps concurrent turns' interleaved deltas in separate per-span entries", () => {
    // Promise.all over routes interleaves spans in one stream; a global open slot
    // would flip between them and fragment each turn's reasoning.
    const out = buildTranscript([
      thinking("a", "A1 "),
      thinking("b", "B1 "),
      thinking("a", "A2"),
      thinking("b", "B2"),
    ]);
    expect(out).toEqual([
      { kind: "thinking", span: "a", text: "A1 A2" },
      { kind: "thinking", span: "b", text: "B1 B2" },
    ]);
  });

  it("starts a new entry when the kind changes within a span", () => {
    const out = buildTranscript([thinking("s", "reasoning"), text("s", "answer")]);
    expect(out).toEqual([
      { kind: "thinking", span: "s", text: "reasoning" },
      { kind: "assistant", span: "s", text: "answer" },
    ]);
  });

  it("breaks coalescing on a tool call and resumes after the result", () => {
    const out = buildTranscript([
      thinking("s", "before"),
      { type: "tool_start", span: "s", callId: "1", name: "score", args: { findingCount: 3 } },
      { type: "tool_end", span: "s", callId: "1", content: "75", isError: false },
      thinking("s", "after"),
    ]);
    expect(out).toEqual([
      { kind: "thinking", span: "s", text: "before" },
      { kind: "tool_call", span: "s", callId: "1", name: "score", args: { findingCount: 3 } },
      { kind: "tool_result", span: "s", callId: "1", content: "75", isError: false },
      { kind: "thinking", span: "s", text: "after" },
    ]);
  });

  it("emits a system entry from turn_meta, before the user prompt", () => {
    const out = buildTranscript([
      { type: "turn_meta", span: "s", systemPrompt: "you are a runtime" },
      { type: "user_prompt", span: "s", text: "do it" },
    ]);
    expect(out).toEqual([
      { kind: "system", span: "s", text: "you are a runtime" },
      { kind: "user", span: "s", text: "do it" },
    ]);
  });

  it("renders a full turn: user prompt, thinking, tool round-trip, answer", () => {
    const out = buildTranscript([
      { type: "user_prompt", span: "s", text: "do it" },
      start("s"),
      thinking("s", "let me "),
      thinking("s", "think"),
      { type: "tool_start", span: "s", callId: "c", name: "foom_return", args: { value: "ok" } },
      { type: "tool_end", span: "s", callId: "c", content: "Returned.", isError: false },
      end("s"),
    ]);
    expect(out.map((e) => e.kind)).toEqual(["user", "thinking", "tool_call", "tool_result"]);
    expect(out[1]).toEqual({ kind: "thinking", span: "s", text: "let me think" });
  });
});
