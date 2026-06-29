// Copy to the system clipboard from inside the alt-screen TUI. The terminal owns
// the mouse (for clicks/scroll), so native drag-select + Cmd/Ctrl-C can't reach
// the app; OpenTUI does its own drag selection, and we ship the result to the
// clipboard with an OSC 52 escape — honored by iTerm2, kitty, VS Code's terminal,
// Terminal.app, and tmux (with set-clipboard on). Best-effort: unsupported
// terminals simply ignore it.

/** Write `text` to the system clipboard via OSC 52. Returns false if empty. */
import process from "node:process";
export function copyToClipboard(text: string): boolean {
  if (text.length === 0) {
    return false;
  }
  const payload = Buffer.from(text, "utf8").toString("base64");
  // ESC ] 52 ; c ; <base64> BEL
  process.stdout.write(`]52;c;${payload}`);
  return true;
}
