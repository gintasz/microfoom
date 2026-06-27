import { fileURLToPath } from "node:url";
import {
  CONTROL_TOOLS,
  type HarnessSession,
  type OpenSession,
  type SessionTurnRequest,
  type SessionTurnResult,
  type UsageDelta,
} from "@microfoom/core";
import { describe, expect, it } from "vitest";
import { runProgramFile } from "../src/extension.ts";

type Round = { readonly call: { name: string; args: unknown } } | { readonly text: string };

function fauxOpenSession(rounds: readonly Round[]): OpenSession {
  let cursor = 0;
  const usage: UsageDelta = { inputTokens: 1, outputTokens: 1, totalTokens: 2, costUsd: 0 };
  const session: HarnessSession = {
    async runTurn(request: SessionTurnRequest): Promise<SessionTurnResult> {
      while (cursor < rounds.length) {
        const round = rounds[cursor];
        cursor += 1;
        if (round === undefined) break;
        if ("text" in round) return { assistantText: round.text, usage };
        const tool = request.tools.find((candidate) => candidate.name === round.call.name);
        if (tool === undefined) return { assistantText: "", usage };
        const result = await tool.execute(round.call.args);
        if (result.terminate === true) return { assistantText: "", usage };
      }
      return { assistantText: "", usage };
    },
  };
  return () => session;
}

describe("extension runProgramFile", () => {
  it("loads a default-exported program and runs it against a session", async () => {
    const sourceFile = fileURLToPath(new URL("./fixtures/run_program.ts", import.meta.url));
    const out = await runProgramFile(
      sourceFile,
      21,
      fauxOpenSession([{ call: { name: CONTROL_TOOLS.return, args: { value: 42 } } }]),
      "fake",
    );
    expect(out).toBe(42);
  });

  it("rejects a file without a default-exported program", async () => {
    const sourceFile = fileURLToPath(new URL("./fixtures/run_program.ts", import.meta.url).href);
    await expect(
      runProgramFile(`${sourceFile}.missing`, "", fauxOpenSession([]), "fake"),
    ).rejects.toBeInstanceOf(Error);
  });
});
