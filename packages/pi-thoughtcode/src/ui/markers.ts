import type { Theme } from "@earendil-works/pi-coding-agent";
import type { VibeCallDetails, VibeCallProgress } from "thoughtcode-core";

/** The status glyph for a run card, colored by the pi-tui theme. */
export function markerForProgress(
  progress: VibeCallProgress | undefined,
  status: VibeCallDetails["status"],
  theme: Theme,
): string {
  if (progress?.status === "done" || status === "done") {
    return theme.fg("success", "✓");
  }
  if (progress?.status === "fail" || status === "error" || status === "aborted") {
    return theme.fg("error", "✗");
  }
  return theme.fg("accent", "◐");
}
