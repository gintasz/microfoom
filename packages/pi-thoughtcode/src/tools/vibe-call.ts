import { defineTool, type AgentToolResult } from "@earendil-works/pi-coding-agent";
import {
  STEP_MAX_LENGTH,
  VIBE_CALL_TOOL_DESCRIPTION,
  appendProgressUpdate,
  buildVibeCallFailureMessage,
  buildVibeCallSubagentPrompt,
  buildVibeCallThrewMessage,
  createVibeCallDetails,
  createVibeCallProgress,
  createVibeCallRunId,
  createVibeCallRunRecord,
  prepareVibeCall,
  setVibeCallRun,
  truncateEnd,
  type VibeCallArgs,
  type VibeCallDetails,
  type VibeRunConfig,
} from "thoughtcode-core";
import { logRunEnd, logRunStart } from "../runs/index.js";
import { getErrorMessage, textResult } from "../shared/tool-result.js";
import type { ThoughtcodeToolOptions } from "../types.js";
import { renderVibeCallCall, renderVibeCallResult } from "../ui/index.js";
import { runThoughtcodeSubagent } from "../runtime/subagent.js";
import { vibeCallParameters, type VibeCallParams } from "./schema.js";
import { VibeThrowError } from "./vibe-throw.js";

export function createVibeCallTool(options: ThoughtcodeToolOptions = {}) {
  const runSubagent = options.runSubagent ?? runThoughtcodeSubagent;
  const depth = options.depth ?? 1;
  const parentTraceId = options.traceId;
  const parentRunId = options.parentRunId;

  return defineTool({
    ...VIBE_CALL_TOOL_DESCRIPTION,
    parameters: vibeCallParameters,
    executionMode: "parallel",
    async execute(
      toolCallId,
      params: VibeCallParams,
      signal,
      onUpdate,
      ctx,
    ): Promise<AgentToolResult<VibeCallDetails>> {
      const rawCall: VibeCallArgs = {
        program_file_path: params.program_file_path,
        name: params.name,
        args: params.args,
      };
      const runId = createVibeCallRunId();
      const traceId = parentTraceId ?? runId;

      const argError = (message: string): AgentToolResult<VibeCallDetails> =>
        textResult(
          buildVibeCallFailureMessage("error", message),
          createVibeCallDetails(runId, rawCall, "", "error", depth, undefined, undefined, undefined, { error: message }),
        );

      // Core resolves the call (validate callee decl, bind + type-check args, derive return type and
      // run config) — a bad arg is the caller's fault → return an error result it can retry. When the
      // file can't be read we proceed with raw args; the subagent's VIBELOADPROGRAM surfaces that.
      let resolvedArgs = rawCall.args;
      let returnType: string | undefined;
      let runConfig: VibeRunConfig = {};
      const prep = await prepareVibeCall(rawCall.program_file_path, rawCall.name, rawCall.args, ctx?.cwd);
      if (prep.status === "error") {
        return argError(prep.message);
      }
      if (prep.status === "ok") {
        resolvedArgs = prep.resolvedArgs;
        returnType = prep.returnType;
        runConfig = prep.runConfig;
      }

      const call: VibeCallArgs = { ...rawCall, args: resolvedArgs };
      const prompt = buildVibeCallSubagentPrompt(call);
      const progress = createVibeCallProgress(depth);
      const run = createVibeCallRunRecord(runId, toolCallId, call, prompt, depth, progress, ctx?.cwd, traceId, parentRunId);
      setVibeCallRun(run);
      logRunStart(run);
      appendProgressUpdate(run, progress, ctx?.cwd);

      try {
        const value = await runSubagent({
          runId,
          toolCallId,
          call,
          prompt,
          ctx,
          signal,
          depth,
          progress,
          onUpdate,
          traceId,
          parentRunId,
          returnType,
          runConfig,
        });

        progress.status = "done";
        progress.endedAt ??= Date.now();
        progress.step = `done ${truncateEnd(value, STEP_MAX_LENGTH - 5)}`;
        run.status = "done";
        run.endedAt = progress.endedAt;
        run.result = value;
        appendProgressUpdate(run, progress, ctx?.cwd);
        logRunEnd(run, "done", value);

        return textResult(value, createVibeCallDetails(runId, call, prompt, "done", depth, progress, run.events, run.transcript, { result: value }));
      } catch (error) {
        const thrown = error instanceof VibeThrowError;
        const status = signal?.aborted ? "aborted" : "error";
        const message = getErrorMessage(error);
        progress.status = "fail";
        progress.endedAt ??= Date.now();
        progress.step = `${thrown ? "throw" : "fail"} ${truncateEnd(message, STEP_MAX_LENGTH - 6)}`;
        run.status = status;
        run.endedAt = progress.endedAt;
        run.error = message;
        appendProgressUpdate(run, progress, ctx?.cwd);
        logRunEnd(run, status, message);
        return textResult(
          thrown ? buildVibeCallThrewMessage(message) : buildVibeCallFailureMessage(status, message),
          createVibeCallDetails(runId, call, prompt, status, depth, progress, run.events, run.transcript, {
            error: message,
            ...(thrown ? { thrown: true } : {}),
          }),
        );
      }
    },
    renderCall(args, theme, context) {
      return renderVibeCallCall(args, theme, context.executionStarted);
    },
    renderResult(result, { expanded }, theme, context) {
      return renderVibeCallResult(result, expanded, theme, context.cwd);
    },
  });
}

export const vibeCallTool = createVibeCallTool();
