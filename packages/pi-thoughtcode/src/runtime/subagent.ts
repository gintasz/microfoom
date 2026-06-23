import {
  DefaultResourceLoader,
  SessionManager,
  SettingsManager,
  createAgentSession,
  getAgentDir,
} from "@earendil-works/pi-coding-agent";
import {
  STEP_MAX_LENGTH,
  THOUGHTCODE_SUBAGENT_FAILED_MESSAGE,
  THOUGHTCODE_VIBE_RETURN_REMINDER_MESSAGE,
  VIBE_CALL_TOOL_NAME,
  VIBE_LOAD_PROGRAM_TOOL_NAME,
  VIBE_RETURN_TOOL_NAME,
  VIBE_THROW_TOOL_NAME,
  addNestedVibeCallUsage,
  appendNestedVibeCallToolTranscript,
  appendProgressUpdate,
  appendTranscriptItem,
  appendVibeCallEvent,
  buildCannotSpawnThoughtcodeSubagentMessage,
  getVibeCallRun,
  runVibeFunction,
  truncateEnd,
  vibeCallDetailsFromToolResult,
  type Harness,
  type RunLimiter,
  type RunOutcome,
  type VibeCallRunRecord,
  type VibeSession,
} from "thoughtcode-core";
import {
  appendTranscriptFromAssistantMessage,
  appendTranscriptFromAssistantUpdate,
  updateProgressFromChildEvent,
} from "../runs/child-session-events.js";
import { emitVibeCallProgress, logReminder, logSessionEvent } from "../runs/index.js";
import { getTextContent } from "../shared/tool-result.js";
import type { VibeReturnDetails, VibeSubagentRunRequest } from "../types.js";
import { createThoughtcodeTools } from "../tools/index.js";

/** pi adapter: run one VIBEFUNCTION by delegating the loop to core, providing a pi-backed session. */
export function runThoughtcodeSubagent(request: VibeSubagentRunRequest): Promise<string> {
  const harness: Harness = { openSession: (limiter) => openPiSession(request, limiter) };
  return runVibeFunction(harness, {
    call: { name: request.call.name },
    prompt: request.prompt,
    signal: request.signal,
    runConfig: request.runConfig,
  });
}

/** Records a run's final progress/status and emits it (one place for all four outcomes). */
function concludeRun(
  request: VibeSubagentRunRequest,
  run: VibeCallRunRecord | undefined,
  cwd: string | undefined,
  outcome: RunOutcome,
): void {
  const progress = request.progress;
  progress.endedAt = Date.now();
  if (outcome.kind === "done") {
    progress.status = "done";
    progress.step = `done ${truncateEnd(outcome.value, STEP_MAX_LENGTH - 5)}`;
  } else {
    progress.status = "fail";
    progress.step =
      outcome.kind === "throw"
        ? `throw ${truncateEnd(outcome.message, STEP_MAX_LENGTH - 6)}`
        : (outcome.step ?? `fail ${truncateEnd(outcome.message, STEP_MAX_LENGTH - 5)}`);
  }
  if (run) {
    run.status = outcome.kind === "done" ? "done" : "error";
    run.endedAt = progress.endedAt;
    if (outcome.kind === "done") {
      run.result = outcome.value;
    } else {
      run.error = outcome.message;
      // Record the full message as its own transcript item — progress.step is truncated for the
      // compact one-line status, but the expanded/inspect view must show the whole thing.
      if (outcome.kind === "throw") {
        appendTranscriptItem(run, "error", outcome.message);
      }
    }
    appendProgressUpdate(run, progress, cwd);
  }
  if (outcome.kind === "done") {
    emitVibeCallProgress(request, progress);
  } else {
    emitVibeCallProgress(request, progress, "error");
  }
}

/**
 * Spawn a pi AgentSession for one VIBEFUNCTION and adapt it to the core `VibeSession` port: capture the
 * VIBERETURN value / VIBETHROW message / infra error, drive the run-record observability from pi
 * session events, and enforce the limiter (budget mid-stream, abort on cancel/timeout).
 */
async function openPiSession(request: VibeSubagentRunRequest, limiter: RunLimiter): Promise<VibeSession> {
  const { ctx } = request;
  const run = getVibeCallRun(request.runId);
  const runConfig = request.runConfig ?? {};

  let model = ctx.model;
  if (!model) {
    throw new Error(buildCannotSpawnThoughtcodeSubagentMessage("no PI model is selected."));
  }
  if (runConfig.modelId) {
    const requested = ctx.modelRegistry
      ?.getAll()
      .find((candidate) => candidate.id === runConfig.modelId || `${candidate.provider}/${candidate.id}` === runConfig.modelId);
    if (!requested) {
      throw new Error(
        `VIBEFUNCTION \`${request.call.name}\` requests model \`${runConfig.modelId}\` via @model, which is not available.`,
      );
    }
    model = requested;
  }

  let returnedValue: string | undefined;
  let thrownMessage: string | undefined;
  let subagentError: string | undefined;

  const childTools = createThoughtcodeTools({
    depth: request.depth + 1,
    traceId: request.traceId,
    parentRunId: request.runId,
    returnType: request.returnType,
    onVibeReturn: (value) => {
      returnedValue = value;
    },
    onVibeThrow: (message) => {
      thrownMessage = message;
    },
  });
  const agentDir = getAgentDir();
  const cwd = ctx.cwd;
  const settingsManager = SettingsManager.create(cwd, agentDir);
  const resourceLoader = new DefaultResourceLoader({
    cwd,
    agentDir,
    settingsManager,
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
  });
  await resourceLoader.reload();

  const { session } = await createAgentSession({
    cwd,
    agentDir,
    model,
    modelRegistry: ctx.modelRegistry,
    settingsManager,
    sessionManager: SessionManager.inMemory(cwd),
    resourceLoader,
    customTools: [...childTools],
    tools: ["read", VIBE_CALL_TOOL_NAME, VIBE_RETURN_TOOL_NAME, VIBE_LOAD_PROGRAM_TOOL_NAME, VIBE_THROW_TOOL_NAME],
    ...(runConfig.thinkingLevel ? { thinkingLevel: runConfig.thinkingLevel } : {}),
  });

  const unsubscribe = session.subscribe((event) => {
    logSessionEvent(request, event);

    if (run && event.type === "message_update") {
      appendTranscriptFromAssistantUpdate(run, event);
    }

    if (
      run &&
      (event.type === "tool_execution_update" || event.type === "tool_execution_end") &&
      event.toolName === VIBE_CALL_TOOL_NAME
    ) {
      const details = vibeCallDetailsFromToolResult(event.type === "tool_execution_update" ? event.partialResult : event.result);
      if (details) {
        addNestedVibeCallUsage(run, details);
      }
    }

    if (updateProgressFromChildEvent(request.progress, event, cwd)) {
      if (run) {
        const toolCallId =
          event.type === "tool_execution_start" || event.type === "tool_execution_update" || event.type === "tool_execution_end"
            ? event.toolCallId
            : undefined;
        appendProgressUpdate(run, request.progress, cwd, toolCallId);
      }
      emitVibeCallProgress(request, request.progress);
    }

    limiter.checkBudget(request.progress.usage?.cost ?? 0, runConfig.budgetUsd);

    if (run && event.type === "tool_execution_update" && event.toolName === VIBE_CALL_TOOL_NAME) {
      appendNestedVibeCallToolTranscript(run, event.partialResult, event.toolCallId);
    }
    if (run && event.type === "tool_execution_end" && event.toolName === VIBE_CALL_TOOL_NAME) {
      appendNestedVibeCallToolTranscript(run, event.result, event.toolCallId);
    }

    if (event.type !== "message_end") {
      return;
    }
    if (event.message.role === "assistant" && event.message.stopReason === "error") {
      subagentError = event.message.errorMessage ?? THOUGHTCODE_SUBAGENT_FAILED_MESSAGE;
      if (run) {
        appendVibeCallEvent(run, "error", subagentError);
        appendTranscriptItem(run, "error", subagentError);
      }
      return;
    }
    if (event.message.role === "assistant") {
      if (run) {
        appendTranscriptFromAssistantMessage(run, event.message.content);
      }
      return;
    }
    if (event.message.role !== "toolResult") {
      return;
    }
    if (event.message.toolName === VIBE_CALL_TOOL_NAME) {
      if (run) {
        appendNestedVibeCallToolTranscript(run, event.message, event.message.toolCallId);
      }
      return;
    }
    if (event.message.toolName !== VIBE_RETURN_TOOL_NAME) {
      return;
    }
    const details = event.message.details as Partial<VibeReturnDetails> | undefined;
    returnedValue = typeof details?.value === "string" ? details.value : getTextContent(event.message.content);
  });

  // The limiter aborts the session on cancel / timeout / budget breach.
  const onLimiterAbort = () => void session.abort();
  if (limiter.signal.aborted) {
    void session.abort();
  } else {
    limiter.signal.addEventListener("abort", onLimiterAbort, { once: true });
  }

  await session.bindExtensions({});
  emitVibeCallProgress(request, request.progress);

  return {
    async prompt(text) {
      await session.prompt(text, { expandPromptTemplates: false, source: "extension" });
    },
    async remind() {
      if (run) {
        appendTranscriptItem(run, "status", THOUGHTCODE_VIBE_RETURN_REMINDER_MESSAGE);
        logReminder(run, THOUGHTCODE_VIBE_RETURN_REMINDER_MESSAGE);
      }
      await session.prompt(THOUGHTCODE_VIBE_RETURN_REMINDER_MESSAGE, { expandPromptTemplates: false, source: "extension" });
    },
    conclude(outcome) {
      concludeRun(request, run, cwd, outcome);
    },
    dispose() {
      limiter.signal.removeEventListener("abort", onLimiterAbort);
      unsubscribe();
      session.dispose();
    },
    get returnedValue() {
      return returnedValue;
    },
    get thrownMessage() {
      return thrownMessage;
    },
    get error() {
      return subagentError;
    },
  };
}
