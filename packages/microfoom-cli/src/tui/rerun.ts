// Shared between the node launcher (cli.ts) and the bun TUI (tui.tsx). Pressing `r`
// can't reload the program in-process — bun caches modules by path and ignores
// cache-busting query strings, so an in-process re-run would execute the OLD code.
// Instead the TUI exits with this sentinel and the launcher respawns a fresh bun
// process, which imports the edited source clean.
export const RERUN_EXIT_CODE = 75;
