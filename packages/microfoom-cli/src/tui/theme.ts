// Two flat palettes for the TUI — a dark one and a light one. The light palette
// is used when the host terminal reports a light background, so the panel reads as
// a clean white surface rather than washed-out dark colors (the parent CLI passes
// the detected mode in the meta line; see store.ts / cli.ts).

type ThemeMode = "dark" | "light";

interface Palette {
  readonly bg: string;
  readonly panelBg: string;
  readonly selBg: string;
  /** Subtle fill behind a user-message block, for visual separation. */
  readonly userBg: string;
  readonly fg: string;
  readonly dim: string;
  readonly border: string;
  readonly accent: string;
  /** Per-role colors used across the trace tree and the transcript. */
  readonly program: string;
  readonly method: string;
  readonly turn: string;
  readonly scope: string;
  readonly user: string;
  readonly thinking: string;
  readonly tool: string;
  readonly ok: string;
  readonly error: string;
}

const DARK: Palette = {
  bg: "#0b0e14",
  panelBg: "#0d1017",
  selBg: "#1f2a44",
  userBg: "#171c26",
  fg: "#c9d1d9",
  dim: "#6b7280",
  border: "#2b313b",
  accent: "#7aa2f7",
  program: "#e6edf3",
  method: "#7dcfff",
  turn: "#9ece6a",
  scope: "#e0af68",
  user: "#9ece6a",
  thinking: "#a78bfa",
  tool: "#e0af68",
  ok: "#73daca",
  error: "#f7768e",
};

const LIGHT: Palette = {
  bg: "#ffffff",
  panelBg: "#ffffff",
  selBg: "#dbe9ff",
  userBg: "#eef0f3",
  fg: "#1f2328",
  dim: "#6e7781",
  border: "#d0d7de",
  accent: "#0969da",
  program: "#1f2328",
  method: "#0550ae",
  turn: "#1a7f37",
  scope: "#9a6700",
  user: "#1a7f37",
  thinking: "#8250df",
  tool: "#9a6700",
  ok: "#1a7f37",
  error: "#cf222e",
};

function paletteFor(mode: ThemeMode): Palette {
  return mode === "light" ? LIGHT : DARK;
}

export type { Palette, ThemeMode };
export { paletteFor };
