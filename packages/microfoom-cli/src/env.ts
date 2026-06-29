// The one place the CLI reads `process.env` (S1/CFG1). Both the headless runner
// (cli.ts) and the TUI (tui.tsx) take these resolved values as typed inputs
// instead of reaching for the environment directly. The `noProcessEnv` lint is
// disabled here (and only here) by a biome override.

/** Default model id when neither a `--model` flag nor a program default is given. */
export function modelFromEnv(): string | undefined {
  return process.env["MICROFOOM_MODEL"];
}

/** Preferred TUI theme name, or undefined to fall back to the default theme. */
export function tuiThemeFromEnv(): string | undefined {
  return process.env["MICROFOOM_TUI_THEME"];
}
