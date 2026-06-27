// An offline, deterministic session for `--harness fake`: no model, no network, no
// key. It drives any program through the real FOOM tool handlers — on a value turn
// it calls foom_return with an echo of the prompt; on a text turn it returns that
// echo. Lets you smoke-test wiring/observability (and the CLI's own tests) without
// a provider. Returns a string, so string-typed programs (e.g. hello) settle.

import {
  CONTROL_TOOLS,
  type HarnessSession,
  type OpenSession,
  type SessionTurnRequest,
  type SessionTurnResult,
  type UsageDelta,
} from "@microfoom/core";

const FAKE_USAGE: UsageDelta = {
  inputTokens: 4,
  outputTokens: 6,
  totalTokens: 10,
  costUsd: 0,
};

export function fakeOpenSession(): OpenSession {
  const session: HarnessSession = {
    async runTurn(request: SessionTurnRequest): Promise<SessionTurnResult> {
      const reply = `fake reply for: ${request.prompt.slice(0, 60).replace(/\s+/g, " ").trim()}`;
      const returnTool = request.tools.find((tool) => tool.name === CONTROL_TOOLS.return);
      if (returnTool !== undefined) {
        await returnTool.execute({ value: reply });
        return { assistantText: "", usage: FAKE_USAGE };
      }
      return { assistantText: reply, usage: FAKE_USAGE };
    },
  };
  return () => session;
}
