// The observability model: a run record and its progress/transcript/usage/event shapes. Pure data,
// harness-agnostic. Adapters mutate these from their native events and render them however they like.

import type { VibeCallArgs } from "./tool-defs.js";

export interface VibeCallUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cost: number;
}

export type VibeCallEventType = "thinking" | "tool" | "responding" | "return" | "error" | "status";

export interface VibeCallEvent {
  t: number;
  type: VibeCallEventType;
  text: string;
}

export interface VibeCallTranscriptItem {
  t: number;
  role: "thinking" | "assistant" | "tool" | "return" | "error" | "status";
  text: string;
  toolCallId?: string;
}

export interface VibeCallProgress {
  status: "run" | "done" | "fail";
  depth: number;
  startedAt: number;
  endedAt?: number;
  step: string;
  usage?: VibeCallUsage;
  usageCumulative?: boolean;
}

export interface VibeCallDetails {
  kind: "vibecall";
  runId: string;
  program_file_path: string;
  name: string;
  args: string;
  prompt: string;
  status: "running" | "done" | "error" | "aborted";
  depth: number;
  progress?: VibeCallProgress;
  events?: VibeCallEvent[];
  transcript?: VibeCallTranscriptItem[];
  result?: string;
  error?: string;
  /** True when the failure was a deliberate VIBETHROW by the callee, not an infrastructure error. */
  thrown?: boolean;
}

export interface VibeCallRunRecord {
  id: string;
  toolCallId: string;
  traceId: string;
  parentRunId?: string;
  call: VibeCallArgs;
  prompt: string;
  status: VibeCallDetails["status"];
  depth: number;
  progress: VibeCallProgress;
  events: VibeCallEvent[];
  transcript: VibeCallTranscriptItem[];
  nestedUsageByRunId: Map<string, VibeCallUsage>;
  result?: string;
  error?: string;
  cwd?: string;
  startedAt: number;
  endedAt?: number;
}
