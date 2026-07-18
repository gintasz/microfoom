import type {
  AgentEvent,
  Backend,
  BackendSession,
  BackendSessionOptions,
  BackendTurnRequest,
  BackendTurnResult,
} from "@unigent/core";
import {
  AgentBackendUnavailableError,
  AgentBudgetExceededError,
  AgentCancelledError,
  AgentRaisedError,
  agent,
  tool,
} from "@unigent/core";
import { fail } from "@unigent/core/tools";
import { buildTraceTree, buildTranscript, subscribeTrace } from "@unigent/core/trace";
import { describe, expect, it } from "vitest";
import { z } from "zod";

type TurnHandler = (
  request: BackendTurnRequest,
  model: string,
) => BackendTurnResult | Promise<BackendTurnResult>;

const EMPTY_USAGE = { inputTokens: 1, outputTokens: 1, totalTokens: 2, costUsd: 0.1 };

function fakeBackend(handler: TurnHandler, onOpen?: (model: string) => void): Backend {
  const open = ({ model }: BackendSessionOptions): BackendSession => {
    onOpen?.(model);
    return {
      runTurn: (request) => Promise.resolve(handler(request, model)),
      fork: () => open({ model }),
    };
  };
  return {
    name: "fake",
    capabilities: {
      reportsCost: true,
      supportsSessionFork: true,
    },
    openSession: open,
  };
}

function backendResult(text: string): BackendTurnResult {
  return { text, usage: EMPTY_USAGE };
}

/**
 * Multiply two numbers.
 *
 * @promptSnippet Use this for exact arithmetic.
 * @promptGuideline Pass both operands to multiply.
 */
function multiply(left: number, right: number): number {
  return left * right;
}

describe("Unigent core integration", () => {
  it("derives a raw source tool, executes it, and validates structured output", async () => {
    const observed: AgentEvent[] = [];
    const stopObserving = subscribeTrace((event) => observed.push(event));
    const backend = fakeBackend(async (request) => {
      const multiplyTool = request.tools.find((candidate) => candidate.name === "multiply");
      const returnTool = request.tools.find((candidate) => candidate.name === "unigent_return");
      expect(multiplyTool).toMatchObject({
        description: "Multiply two numbers.",
        promptSnippet: "Use this for exact arithmetic.",
        promptGuidelines: ["Pass both operands to multiply."],
      });
      expect(request.systemPrompt).toContain("- multiply: Use this for exact arithmetic.");
      expect(request.systemPrompt).toContain(
        "Unigent tool guidelines:\n- Pass both operands to multiply.",
      );
      const product = await multiplyTool?.execute({ left: 6, right: 7 });
      await returnTool?.execute({ value: Number(product?.content) });
      return backendResult("");
    });
    const calculator = agent({
      name: "calculator",
      source: import.meta.url,
      backend,
      model: "fake",
      tools: [multiply],
    });

    const result = await calculator.run("multiply", z.number());
    stopObserving();

    expect(result.output).toBe(42);
    expect(result.usage.totalTokens).toBe(2);
    expect(result.trace.events.some((event) => event.type === "span_start")).toBe(true);
    expect(observed).toEqual(result.trace.events);
    const tree = buildTraceTree(result.trace.events);
    expect(tree.roots[0]).toMatchObject({ name: "calculator", outcome: "succeeded" });
    expect(tree.usage.totalTokens).toBe(2);
    expect(buildTranscript(result.trace.events)).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: "user", text: "multiply" })]),
    );
  });

  it("supports portable tools when source is unavailable", async () => {
    const uppercase = tool({
      name: "uppercase",
      description: "Uppercase text.",
      input: z.object({ text: z.string() }),
      execute: ({ text }) => text.toUpperCase(),
    });
    const backend = fakeBackend(async (request) => {
      const selected = request.tools.find((candidate) => candidate.name === "uppercase");
      const outcome = await selected?.execute({ text: "unigent" });
      return backendResult(outcome?.content ?? "");
    });
    const assistant = agent({ name: "portable", backend, model: "fake", tools: [uppercase] });

    const result = await assistant.run("uppercase");

    expect(result.output).toBe("UNIGENT");
  });

  it("rejects user tools in the reserved Unigent control namespace", () => {
    const reserved = tool({
      name: "unigent_custom",
      description: "Reserved name.",
      input: z.object({}),
      execute: () => undefined,
    });

    expect(() =>
      agent({
        name: "reserved",
        backend: fakeBackend(() => backendResult("")),
        model: "fake",
        tools: [reserved],
      }),
    ).toThrow("tool name uses reserved unigent_ namespace: unigent_custom");
  });

  it("runs nested agents through ordinary tool functions and folds usage and traces", async () => {
    const backend = fakeBackend(async (request, model) => {
      if (model === "research") {
        request.onEvent({ type: "text", text: "evidence" });
        return backendResult("evidence");
      }
      const researchTool = request.tools.find((candidate) => candidate.name === "researchTopic");
      const evidence = await researchTool?.execute({ topic: "tracing" });
      return backendResult(`used ${evidence?.content}`);
    });
    const researcher = agent({ name: "researcher", backend, model: "research" });

    /** Research one focused topic. */
    async function researchTopic(topic: string): Promise<string> {
      const result = await researcher.run(topic);
      return result.output;
    }

    const assistant = agent({
      name: "assistant",
      source: import.meta.url,
      backend,
      model: "assistant",
      tools: [researchTopic],
    });
    const scope = assistant.scope("work");

    const result = await scope.run("use research");

    expect(result.output).toBe("used evidence");
    expect(result.usage.totalTokens).toBe(4);
    expect(scope.usage.totalTokens).toBe(4);
    expect(scope.traces).toHaveLength(1);
    expect(
      result.trace.events.filter((event) => event.type === "span_start" && event.kind !== "turn"),
    ).toHaveLength(3);
  });

  it("repairs a missing structured return on the same backend session", async () => {
    let turns = 0;
    const backend = fakeBackend(async (request) => {
      turns += 1;
      request.onEvent({ type: "text", text: turns === 1 ? "draft" : "fixed" });
      if (turns === 2) {
        const returnTool = request.tools.find((candidate) => candidate.name === "unigent_return");
        await returnTool?.execute({ value: "fixed" });
      }
      return backendResult("");
    });
    const assistant = agent({ name: "repair", backend, model: "fake", repairAttempts: 2 });

    const result = await assistant.run("return text", z.string());

    expect(result.output).toBe("fixed");
    expect(turns).toBe(2);
    expect(buildTranscript(result.trace.events).filter((entry) => entry.kind !== "system")).toEqual(
      [
        expect.objectContaining({ kind: "user", text: "return text" }),
        expect.objectContaining({ kind: "assistant", text: "draft" }),
        expect.objectContaining({
          kind: "user",
          text: "You did not call unigent_return. Call it now with the required result.",
        }),
        expect.objectContaining({ kind: "assistant", text: "fixed" }),
      ],
    );
    expect(
      result.trace.events.filter((event) => event.type === "span_start").map((event) => event.kind),
    ).toEqual(["run", "turn", "turn"]);
  });

  it("retries a transient repair failure from the pre-repair session", async () => {
    let turns = 0;
    const prompts: string[] = [];
    const backend = fakeBackend(async (request) => {
      turns += 1;
      prompts.push(request.prompt);
      if (turns === 1) {
        request.onEvent({ type: "text", text: "unstructured" });
        return backendResult("unstructured");
      }
      if (turns === 2) {
        throw new AgentBackendUnavailableError("temporary repair stream failure");
      }
      const returnTool = request.tools.find((candidate) => candidate.name === "unigent_return");
      await returnTool?.execute({ value: "recovered" });
      return backendResult("");
    });
    const assistant = agent({
      name: "repair-retry",
      backend,
      model: "fake",
      retries: 1,
      repairAttempts: 1,
    });

    const result = await assistant.run("return text", z.string());

    const repairPrompt = "You did not call unigent_return. Call it now with the required result.";
    expect(result.output).toBe("recovered");
    expect(prompts).toEqual(["return text", repairPrompt, repairPrompt]);
    expect(buildTranscript(result.trace.events).filter((entry) => entry.kind === "user")).toEqual([
      expect.objectContaining({ text: "return text" }),
      expect.objectContaining({ text: repairPrompt }),
    ]);
    expect(
      result.trace.events.filter(
        (event) =>
          event.type === "span_end" &&
          event.error === "temporary repair stream failure" &&
          event.outcome === "failed",
      ),
    ).toHaveLength(1);
    expect(result.usage).toMatchObject({ calls: 2, totalTokens: 4 });
  });

  it("adopts the successful repair fork for the next stateful session turn", async () => {
    const sessionTurnIndices: number[] = [];
    let repairCalls = 0;
    const makeSession = (seed = 0): BackendSession => {
      let nextTurnIndex = seed;
      return {
        runTurn: async (request): Promise<BackendTurnResult> => {
          sessionTurnIndices.push(nextTurnIndex);
          nextTurnIndex += 1;
          if (request.prompt.startsWith("You did not call")) {
            repairCalls += 1;
            if (repairCalls === 1) {
              throw new AgentBackendUnavailableError("temporary repair stream failure");
            }
            const returnTool = request.tools.find(
              (candidate) => candidate.name === "unigent_return",
            );
            await returnTool?.execute({ value: "recovered" });
          }
          return backendResult(request.prompt === "after" ? "continued" : "unstructured");
        },
        fork: (): BackendSession => makeSession(nextTurnIndex),
      };
    };
    const backend: Backend = {
      name: "stateful-repair",
      capabilities: { reportsCost: true, supportsSessionFork: true },
      openSession: () => makeSession(),
    };
    const session = agent({ name: "repair", backend, model: "fake", retries: 1 }).session();

    await expect(session.run("structured", z.string())).resolves.toMatchObject({
      output: "recovered",
    });
    await expect(session.run("after")).resolves.toMatchObject({ output: "continued" });

    expect(sessionTurnIndices).toEqual([0, 1, 1, 2]);
  });

  it("keeps one protocol prompt while structured output toggles between session turns", async () => {
    const prompts: string[] = [];
    const returnToolAvailability: boolean[] = [];
    const backend = fakeBackend(async (request) => {
      prompts.push(request.systemPrompt);
      const returnTool = request.tools.find((candidate) => candidate.name === "unigent_return");
      returnToolAvailability.push(returnTool !== undefined);
      if (returnTool !== undefined) {
        await returnTool.execute({ value: { answer: 42 } });
        return backendResult("");
      }
      return backendResult(`prose ${prompts.length}`);
    });
    const assistant = agent({ name: "alternating", backend, model: "fake" });
    const session = assistant.session();

    const first = await session.run("first");
    const structured = await session.run("second", z.object({ answer: z.number() }));
    const third = await session.run("third");

    expect(first.output).toBe("prose 1");
    expect(structured.output).toEqual({ answer: 42 });
    expect(third.output).toBe("prose 3");
    expect(new Set(prompts)).toHaveLength(1);
    const protocolPrompt = prompts[0] ?? "";
    expect(protocolPrompt).toContain("<!-- unigent:begin -->");
    expect(protocolPrompt).toContain("you MUST call it");
    expect(protocolPrompt).toContain("omitting it fails the task");
    expect(protocolPrompt).toContain("<!-- unigent:end -->");
    const injectedInstruction = protocolPrompt
      .split("<!-- unigent:begin -->")[1]
      ?.split("<!-- unigent:end -->")[0];
    expect(injectedInstruction?.match(/[.!?](?=\s|$)/g)).toHaveLength(1);
    expect(returnToolAvailability).toEqual([false, true, false]);
  });

  it("retries transient failures only before user tools execute", async () => {
    let opens = 0;
    const backend = fakeBackend(
      () => {
        if (opens === 1) {
          throw new AgentBackendUnavailableError("temporary");
        }
        return backendResult("recovered");
      },
      () => {
        opens += 1;
      },
    );
    const assistant = agent({ name: "retry", backend, model: "fake", retries: 1 });

    const result = await assistant.run("retry");

    expect(result.output).toBe("recovered");
    expect(opens).toBe(2);
  });

  it("surfaces deliberate agent failure as AgentRaisedError", async () => {
    const backend = fakeBackend(async (request) => {
      expect(request.systemPrompt).toContain(
        "If unigent_fail is available, call it only when you cannot complete the user's instructions.",
      );
      expect(request.systemPrompt).toContain(
        "Do not use it for recoverable tool errors or uncertainty.",
      );
      const failure = request.tools.find((candidate) => candidate.name === "unigent_fail");
      await failure?.execute({ message: "cannot proceed", code: "NO_INPUT" });
      return backendResult("");
    });
    const assistant = agent({ name: "failure", backend, model: "fake", tools: [fail] });

    await expect(assistant.run("fail")).rejects.toMatchObject({
      constructor: AgentRaisedError,
      code: "NO_INPUT",
    });
  });

  it("enforces cumulative scope budget", async () => {
    const backend = fakeBackend(() => backendResult("expensive"));
    const scope = agent({ name: "budget", backend, model: "fake" }).scope("budget", {
      limits: { budgetUsd: 0.05 },
    });

    await expect(scope.run("spend")).rejects.toBeInstanceOf(AgentBudgetExceededError);
    expect(scope.usage.costUsd).toBe(0.1);
  });

  it("replays events independently to multiple consumers", async () => {
    const backend = fakeBackend((request) => {
      request.onEvent({ type: "text", text: "one" });
      request.onEvent({ type: "text", text: "two" });
      return backendResult("onetwo");
    });
    const run = agent({ name: "events", backend, model: "fake" }).run("stream");
    await run;
    const collect = async (): Promise<string[]> => {
      const texts: string[] = [];
      for await (const event of run.events) {
        if (event.type === "text") {
          texts.push(event.text);
        }
      }
      return texts;
    };

    expect(await Promise.all([collect(), collect()])).toEqual([
      ["one", "two"],
      ["one", "two"],
    ]);
  });

  it("cancels an active run with a typed error", async () => {
    const backend = fakeBackend(
      (request) =>
        new Promise<BackendTurnResult>((_resolve, reject) => {
          request.signal.addEventListener("abort", () => reject(new Error("aborted")), {
            once: true,
          });
        }),
    );
    const run = agent({ name: "cancel", backend, model: "fake" }).run("wait");
    run.abort();

    await expect(run).rejects.toBeInstanceOf(AgentCancelledError);
  });

  it("preserves stateful sessions and forks", async () => {
    let count = 0;
    const backend: Backend = {
      name: "stateful",
      capabilities: {
        reportsCost: true,
        supportsSessionFork: true,
      },
      openSession: (): BackendSession => {
        const make = (seed: number): BackendSession => {
          let current = seed;
          return {
            runTurn: async (): Promise<BackendTurnResult> => {
              current += 1;
              count += 1;
              return backendResult(String(current));
            },
            fork: () => make(current),
          };
        };
        return make(0);
      },
    };
    const session = agent({ name: "session", backend, model: "fake" }).session();
    expect((await session.run("first")).output).toBe("1");
    const branch = session.fork();

    expect((await session.run("second")).output).toBe("2");
    expect((await branch.run("branch")).output).toBe("2");
    expect(count).toBe(3);
  });
});
