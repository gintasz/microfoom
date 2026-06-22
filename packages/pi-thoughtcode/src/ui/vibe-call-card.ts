import type { AgentToolResult, Theme } from "@earendil-works/pi-coding-agent";
import { type Component, Text, truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { VIBE_CALL_TOOL_NAME } from "thoughtcode-core";
import {
  COLLAPSED_ARGS_MAX_LENGTH,
  COLLAPSED_VALUE_MAX_LENGTH,
  EXPANDED_ARGS_MAX_LENGTH,
  EXPANDED_VALUE_MAX_LENGTH,
  formatArgsForDisplay,
  formatDuration,
  formatPathForDisplay,
  formatProgressStepForDisplay,
  formatUsage,
  labelForStatus,
  markerForProgress,
} from "../shared/display.js";
import { truncateEnd } from "../shared/truncate.js";
import type { VibeCallParams } from "../tools/schema.js";
import type { VibeCallDetails } from "../types.js";
import { appendTranscriptLines } from "./transcript-lines.js";

export function renderVibeCallCall(_args: VibeCallParams, _theme: Theme, _executionStarted: boolean): Text {
  // The result card (renderVibeCallResult) renders every state — pending progress and done —
  // so a separate call-header line is always redundant. Suppress it to avoid a duplicate VIBECALL row.
  return new Text("", 0, 0);
}

export function renderVibeCallResult(
  result: AgentToolResult<VibeCallDetails>,
  expanded: boolean,
  theme: Theme,
  cwd: string | undefined,
): Component {
  return {
    render(width: number) {
      return renderVibeCallResultLines(result, expanded, theme, cwd, width);
    },
    invalidate() {
      // No cached render state.
    },
  };
}

function renderVibeCallResultLines(
  result: AgentToolResult<VibeCallDetails>,
  expanded: boolean,
  theme: Theme,
  cwd: string | undefined,
  width: number,
): string[] {
  const details = result.details;
  const progress = details.progress;
  const status = labelForStatus(progress, details.status);
  const duration = progress ? formatDuration(progress.startedAt, progress.endedAt) : "";
  const usage = formatUsage(progress?.usage, progress?.usageCumulative);
  const headerParts = [
    markerForProgress(progress, details.status, theme),
    theme.fg("toolTitle", theme.bold(VIBE_CALL_TOOL_NAME)),
    theme.fg(status === "done" ? "success" : status === "failed" ? "error" : "accent", status),
    duration,
    `id=${details.runId}`,
    usage,
  ].filter(Boolean);

  const argsMax = expanded ? EXPANDED_ARGS_MAX_LENGTH : COLLAPSED_ARGS_MAX_LENGTH;
  const valueMax = expanded ? EXPANDED_VALUE_MAX_LENGTH : COLLAPSED_VALUE_MAX_LENGTH;
  const entryLine = `${theme.fg("muted", "entry")} ${details.name}`;
  const fileLine = `${theme.fg("muted", "file")} ${formatPathForDisplay(details.program_file_path, cwd)}`;
  const entryFileLine = `${entryLine}  ${fileLine}`;
  const lines = [headerParts.join(" ")];

  if (visibleWidth(entryFileLine) <= width) {
    lines.push(entryFileLine);
  } else {
    lines.push(entryLine, fileLine);
  }
  lines.push(`${theme.fg("muted", "args")} ${formatArgsForDisplay(details.args, argsMax)}`);

  if (details.status === "done" && details.result !== undefined) {
    lines.push(`${theme.fg("muted", "done")} ${truncateEnd(details.result, valueMax)}`);
  } else if (details.error) {
    lines.push(`${theme.fg("muted", "fail")} ${truncateEnd(details.error, valueMax)}`);
  } else if (progress?.step) {
    lines.push(formatProgressStepForDisplay(progress.step, expanded, cwd));
  }

  if (expanded) {
    lines.push("", theme.fg("muted", "debug"));
    lines.push(`  ${theme.fg("muted", "depth")} ${progress?.depth ?? details.depth}`);

    lines.push("", theme.fg("muted", "Subagent"));
    lines.push(theme.fg("accent", "User"));
    for (const line of details.prompt.split("\n")) {
      for (const segment of wrapTextWithAnsi(line, Math.max(1, width - 2))) {
        lines.push(`  ${segment}`);
      }
    }
    lines.push("");
    appendTranscriptLines(lines, details.transcript ?? [], theme, width);
  }

  // Safety net: the TUI crashes if any rendered line exceeds the terminal width. Flatten embedded
  // newlines and clamp every line — single-value previews (done/fail/args) are not width-bounded above.
  return lines.flatMap((line) =>
    line.split("\n").map((segment) => (visibleWidth(segment) > width ? truncateToWidth(segment, width) : segment)),
  );
}
