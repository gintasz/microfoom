// The prompt renderer (dedent) is a behavioral fence: a prose turn's prompt is the
// rendered template verbatim (no notice is appended, unlike value/do), so capturing
// `request.prompt` proves exactly what ships to the model. Each case pins one property
// of dedent we rely on; a future swap that regresses any of these breaks here.

import type { StandardSchemaV1 } from "@standard-schema/spec";
import { describe, expect, it } from "vitest";
import {
  type AgentRun,
  type AgentTextStream,
  type OpenSession,
  Program,
  runProgram,
  type SessionTurnRequest,
  type SessionTurnResult,
} from "../src/index.ts";
import { makeStandardSchema } from "../src/standard_schema.ts";

const stringInput: StandardSchemaV1<unknown, string> = makeStandardSchema((input) =>
  typeof input === "string" ? { value: input } : { issues: [{ message: "expected a string" }] },
);

// Run one prose turn whose template `build` produces, and return the exact prompt the
// harness received. `build` gets `this.agent` (an AgentRun) and returns its prose turn.
async function renderedPrompt(build: (agent: AgentRun) => AgentTextStream): Promise<string> {
  let captured = "";
  const capturing: OpenSession = () => ({
    async runTurn(request: SessionTurnRequest): Promise<SessionTurnResult> {
      captured = request.prompt;
      return { assistantText: "", usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 } };
    },
  });
  class P extends Program(stringInput) {
    async main(): Promise<string> {
      return await build(this.agent);
    }
  }
  await runProgram(P, "x", { harnesses: { default: capturing }, model: "fake" });
  return captured;
}

describe("prompt render (dedent)", () => {
  it("strips common source indentation and preserves relative nesting", async () => {
    const prompt = await renderedPrompt(
      (agent) => agent.prose`
      line one
        nested two
      line three
    `,
    );
    expect(prompt).toBe("line one\n  nested two\nline three");
  });

  it("does not let a multi-line interpolated value poison the dedent", async () => {
    const value = "X\nY\nZ";
    const prompt = await renderedPrompt(
      (agent) => agent.prose`
      Header:
      ${value}
      Footer.
    `,
    );
    expect(prompt).toBe("Header:\nX\nY\nZ\nFooter.");
  });

  it("preserves backslashes of invalid JS escapes (regexes, Windows paths)", async () => {
    const prompt = await renderedPrompt((agent) => agent.prose`Match \d{3}-\d{4} in C:\Users\data`);
    expect(prompt).toBe("Match \\d{3}-\\d{4} in C:\\Users\\data");
  });

  it("resolves valid escapes: \\n becomes a newline, \\t a tab", async () => {
    const prompt = await renderedPrompt((agent) => agent.prose`a\nb\tc`);
    expect(prompt).toBe("a\nb\tc");
  });

  it("leaves a single-line prompt untouched", async () => {
    const prompt = await renderedPrompt((agent) => agent.prose`Say hi.`);
    expect(prompt).toBe("Say hi.");
  });
});
