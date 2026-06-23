// Emitting streaming progress as a pi AgentToolResult (via onUpdate). The record/details builders are
// in core; this is the pi-specific bridge from a progress snapshot to a tool result.

import { createVibeCallDetails, getVibeCallRun, type VibeCallDetails, type VibeCallProgress } from "thoughtcode-core";
import { textResult } from "../shared/tool-result.js";
import type { VibeSubagentRunRequest } from "../types.js";

export function emitVibeCallProgress(
  request: VibeSubagentRunRequest,
  progress: VibeCallProgress,
  status: VibeCallDetails["status"] = "running",
): void {
  const record = getVibeCallRun(request.runId);
  request.onUpdate?.(
    textResult(
      progress.step,
      createVibeCallDetails(
        request.runId,
        request.call,
        request.prompt,
        status,
        request.depth,
        progress,
        record?.events,
        record?.transcript,
      ),
    ),
  );
}
