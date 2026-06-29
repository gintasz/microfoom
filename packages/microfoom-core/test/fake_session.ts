// A scripted in-process HarnessSession for deterministic tests (Q4) — it replays
// "model rounds" through the real FOOM tool handlers, exactly as a real harness
// loop would, with no network. A round is either a tool call (executed via the
// turn's tools) or final assistant text. One flat script spans all turns of a run.

import type {
  HarnessSession,
  OpenSession,
  SessionTurnRequest,
  SessionTurnResult,
  UsageDelta,
} from "../src/index.ts";

type FakeRound = { readonly call: { name: string; args: unknown } } | { readonly text: string };

const USAGE: UsageDelta = { inputTokens: 1, outputTokens: 1, totalTokens: 2, costUsd: 0 };

/** Build an OpenSession that replays `script` across the run's turns. */
function fakeOpenSession(script: readonly FakeRound[], usage: UsageDelta = USAGE): OpenSession {
  let cursor = 0;
  const session: HarnessSession = {
    async runTurn(request: SessionTurnRequest): Promise<SessionTurnResult> {
      while (cursor < script.length) {
        const round = script[cursor];
        cursor += 1;
        if (round === undefined) {
          break;
        }
        if ("text" in round) {
          return { assistantText: round.text, usage };
        }
        const tool = request.tools.find((candidate) => candidate.name === round.call.name);
        if (tool === undefined) {
          return { assistantText: "", usage };
        }
        const result = await tool.execute(round.call.args);
        if (result.terminate === true) {
          return { assistantText: "", usage };
        }
      }
      return { assistantText: "", usage };
    },
  };
  return () => session;
}

/** A single-entry harness registry around {@link fakeOpenSession} (auto-default). */
function fakeHarness(
  script: readonly FakeRound[],
  usage: UsageDelta = USAGE,
): Record<string, OpenSession> {
  return { default: fakeOpenSession(script, usage) };
}

export type { FakeRound };
export { fakeHarness, fakeOpenSession };
