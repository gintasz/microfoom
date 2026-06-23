import type { AgentToolResult, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { VibeCallArgs, VibeCallDetails, VibeCallProgress, VibeRunConfig } from "thoughtcode-core";

// This module holds only pi-specific types. The observability model lives in thoughtcode-core — import
// VibeCallRunRecord / VibeCallProgress / VibeCallDetails / … straight from core.

// pi tool-result detail payloads.
export interface VibeReturnDetails {
  kind: "vibereturn";
  value: string;
}

export interface VibeThrowDetails {
  kind: "vibethrow";
  message: string;
}

export interface VibeLoadProgramDetails {
  kind: "vibeloadprogram";
  program_file_path: string;
}

export interface VibeSubagentRunRequest {
  runId: string;
  toolCallId: string;
  call: VibeCallArgs;
  prompt: string;
  ctx: ExtensionContext;
  signal: AbortSignal | undefined;
  depth: number;
  progress: VibeCallProgress;
  onUpdate: ((result: AgentToolResult<VibeCallDetails>) => void) | undefined;
  /** Root run id shared by an entire nested VIBECALL tree; used to correlate debug logs. */
  traceId: string;
  /** Run id of the VIBECALL that spawned this subagent, if any. */
  parentRunId?: string;
  /** Declared return type of the callee (parsed by the caller), enforced on its VIBERETURN. */
  returnType?: string;
  /** Run configuration from the callee's decorators (parsed by the caller). */
  runConfig?: VibeRunConfig;
}

export type VibeSubagentRunner = (request: VibeSubagentRunRequest) => Promise<string>;

export interface ThoughtcodeToolOptions {
  runSubagent?: VibeSubagentRunner;
  onVibeReturn?: (value: string) => void;
  onVibeThrow?: (message: string) => void;
  depth?: number;
  /** Declared return-type annotation of the VIBEFUNCTION this subagent executes, if any. */
  returnType?: string;
  /** Root run id shared by an entire nested VIBECALL tree; used to correlate debug logs. */
  traceId?: string;
  /** Run id of the VIBECALL that owns the session these tools run in, if any. */
  parentRunId?: string;
}
