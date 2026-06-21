import type { Theme } from "@earendil-works/pi-coding-agent";
import { wrapTextWithAnsi } from "@earendil-works/pi-tui";
import type { VibeCallTranscriptItem } from "../types.js";

const transcriptLabels: Record<VibeCallTranscriptItem["role"], string> = {
  assistant: "Assistant",
  tool: "Tool",
  return: "Return",
  error: "Error",
  thinking: "Reasoning",
  status: "Status",
};

export function appendTranscriptLines(
  lines: string[],
  transcript: VibeCallTranscriptItem[],
  theme: Theme,
  width: number | undefined,
): void {
  if (transcript.length === 0) {
    lines.push(theme.fg("dim", "  Waiting for subagent activity..."));
    return;
  }

  for (const item of transcript) {
    lines.push(theme.fg("accent", transcriptLabels[item.role]));
    for (const line of item.text.split("\n")) {
      lines.push(...(width === undefined ? [`  ${line}`] : wrapTextWithAnsi(`  ${line}`, width)));
    }
    lines.push("");
  }
  if (lines.at(-1) === "") {
    lines.pop();
  }
}
