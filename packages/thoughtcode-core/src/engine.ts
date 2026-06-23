// The harness-agnostic run engine: the control flow for executing one VIBEFUNCTION — limits, the
// prompt/reminder loop, and the success/throw/error outcome decision. It drives a `VibeSession`
// provided by a `Harness` adapter, which owns the harness-specific spawning, event handling, and
// observability. Adapters implement `Harness`; the loop here is shared by all of them.

import { VibeRunConfig } from "./decorators.js";
import { VibeThrowError } from "./errors.js";
import {
  THOUGHTCODE_MAX_VIBE_RETURN_REMINDERS,
  THOUGHTCODE_MISSING_VIBE_RETURN_MESSAGE,
  THOUGHTCODE_MISSING_VIBE_RETURN_PROGRESS_STEP,
  THOUGHTCODE_SUBAGENT_ABORTED_BEFORE_PROMPT_MESSAGE,
} from "./messages.js";
import { appendThoughtcodeSystemPrompt } from "./prompt.js";

export interface RunLimiter {
  signal: AbortSignal;
  /** Throw if aborted: a VibeThrowError for a deliberate limit breach, else a plain cancel error. */
  throwIfAborted(): void;
  /** Abort (as a throw) when the run's cumulative cost crosses its budget. */
  checkBudget(costSoFar: number, budgetUsd: number | undefined): void;
  dispose(): void;
}

/**
 * Owns @timeout / @budget / parent-cancel aborting for one run. A deliberate limit breach sets a
 * reason so it surfaces as a VibeThrowError rather than a plain cancel. Consumers react to `.signal`.
 */
export function createRunLimiter(opts: {
  parentSignal: AbortSignal | undefined;
  timeoutMs: number | undefined;
  functionName: string;
}): RunLimiter {
  const controller = new AbortController();
  let abortReason: string | undefined;
  const onParentAbort = () => controller.abort();
  if (opts.parentSignal) {
    if (opts.parentSignal.aborted) controller.abort();
    else opts.parentSignal.addEventListener("abort", onParentAbort, { once: true });
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  if (opts.timeoutMs !== undefined) {
    timer = setTimeout(() => {
      abortReason ??= `exceeded its ${opts.timeoutMs! / 1000}s timeout`;
      controller.abort();
    }, opts.timeoutMs);
    timer.unref?.();
  }

  return {
    signal: controller.signal,
    throwIfAborted() {
      if (!controller.signal.aborted) return;
      if (abortReason) throw new VibeThrowError(`VIBEFUNCTION \`${opts.functionName}\` ${abortReason}.`);
      throw new Error(THOUGHTCODE_SUBAGENT_ABORTED_BEFORE_PROMPT_MESSAGE);
    },
    checkBudget(costSoFar, budgetUsd) {
      if (budgetUsd === undefined || controller.signal.aborted || costSoFar <= budgetUsd) return;
      abortReason ??= `exceeded its $${budgetUsd} cost budget`;
      controller.abort();
    },
    dispose() {
      if (timer) clearTimeout(timer);
      opts.parentSignal?.removeEventListener("abort", onParentAbort);
    },
  };
}

/** How a VIBEFUNCTION run finished. The adapter renders this into its observability + result. */
export type RunOutcome =
  | { kind: "done"; value: string }
  | { kind: "throw"; message: string }
  | { kind: "error"; message: string; step?: string };

/**
 * A live execution of one VIBEFUNCTION, owned by the harness adapter. It runs prompts, exposes what
 * it has captured (a VIBERETURN value, a VIBETHROW message, or an infrastructure error), and finalizes
 * its observability when the engine decides the outcome.
 */
export interface VibeSession {
  /** Run the initial prompt. */
  prompt(text: string): Promise<void>;
  /** Re-prompt the agent to finish (it ended a turn without VIBERETURN/VIBETHROW). */
  remind(): Promise<void>;
  /** Record the final outcome (progress/status/observability). */
  conclude(outcome: RunOutcome): void;
  dispose(): void;
  readonly returnedValue: string | undefined;
  readonly thrownMessage: string | undefined;
  readonly error: string | undefined;
}

export interface VibeRunRequest {
  call: { name: string };
  prompt: string;
  signal?: AbortSignal;
  runConfig?: VibeRunConfig;
}

export interface Harness {
  /** Open a session for this run, wired to the limiter (which the session aborts/budget-checks against). */
  openSession(limiter: RunLimiter): Promise<VibeSession>;
}

/**
 * Execute one VIBEFUNCTION: open a session, prompt it, nudge it until it ends via VIBERETURN/VIBETHROW
 * (bounded), enforce limits, and resolve to the returned value or throw. All harness specifics live
 * behind the `Harness`/`VibeSession` port.
 */
export async function runVibeFunction(harness: Harness, request: VibeRunRequest): Promise<string> {
  const limiter = createRunLimiter({
    parentSignal: request.signal,
    timeoutMs: request.runConfig?.timeoutMs,
    functionName: request.call.name,
  });
  let session: VibeSession | undefined;
  try {
    limiter.throwIfAborted();
    session = await harness.openSession(limiter);
    limiter.throwIfAborted();

    await session.prompt(appendThoughtcodeSystemPrompt(request.prompt));
    limiter.throwIfAborted();

    for (
      let reminders = 0;
      session.returnedValue === undefined &&
      session.thrownMessage === undefined &&
      !session.error &&
      reminders < THOUGHTCODE_MAX_VIBE_RETURN_REMINDERS;
      reminders += 1
    ) {
      limiter.throwIfAborted();
      await session.remind();
      limiter.throwIfAborted();
    }

    if (session.thrownMessage !== undefined) {
      session.conclude({ kind: "throw", message: session.thrownMessage });
      throw new VibeThrowError(session.thrownMessage);
    }
    if (session.returnedValue === undefined) {
      if (session.error) {
        session.conclude({ kind: "error", message: session.error });
        throw new Error(session.error);
      }
      session.conclude({
        kind: "error",
        message: THOUGHTCODE_MISSING_VIBE_RETURN_MESSAGE,
        step: THOUGHTCODE_MISSING_VIBE_RETURN_PROGRESS_STEP,
      });
      throw new Error(THOUGHTCODE_MISSING_VIBE_RETURN_MESSAGE);
    }

    session.conclude({ kind: "done", value: session.returnedValue });
    return session.returnedValue;
  } finally {
    limiter.dispose();
    session?.dispose();
  }
}
