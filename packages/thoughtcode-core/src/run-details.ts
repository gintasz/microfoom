// Pure builders for run records, progress, and the tool-result details payload.

import type { VibeCallDetails, VibeCallProgress, VibeCallRunRecord } from "./run-record.js";
import type { VibeCallArgs } from "./tool-defs.js";

export function createVibeCallProgress(depth: number): VibeCallProgress {
  return { status: "run", depth, startedAt: Date.now(), step: "think" };
}

export function createVibeCallDetails(
  runId: string,
  call: VibeCallArgs,
  prompt: string,
  status: VibeCallDetails["status"],
  depth: number,
  progress: VibeCallProgress | undefined,
  events: VibeCallDetails["events"] | undefined,
  transcript: VibeCallDetails["transcript"] | undefined,
  extra: Pick<VibeCallDetails, "result" | "error" | "thrown"> = {},
): VibeCallDetails {
  return {
    kind: "vibecall",
    runId,
    program_file_path: call.program_file_path,
    name: call.name,
    args: call.args,
    prompt,
    status,
    depth,
    ...(progress ? { progress } : {}),
    ...(events ? { events: [...events] } : {}),
    ...(transcript ? { transcript: [...transcript] } : {}),
    ...extra,
  };
}

export function createVibeCallRunRecord(
  runId: string,
  toolCallId: string,
  call: VibeCallArgs,
  prompt: string,
  depth: number,
  progress: VibeCallProgress,
  cwd: string | undefined,
  traceId: string = runId,
  parentRunId?: string,
): VibeCallRunRecord {
  return {
    id: runId,
    toolCallId,
    traceId,
    parentRunId,
    call,
    prompt,
    status: "running",
    depth,
    progress,
    events: [],
    transcript: [],
    nestedUsageByRunId: new Map(),
    cwd,
    startedAt: progress.startedAt,
  };
}
