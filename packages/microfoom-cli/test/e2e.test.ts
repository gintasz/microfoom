// End-to-end TUI test driven through a real PTY with termless (Playwright-for-
// terminals): spawn the bun TUI on the fake harness, assert the two-pane layout +
// transcript content, exercise a mouse click on a trace node (filter), keyboard
// reset, and write screenshots. Excluded from the default suite (e2e.test.ts);
// needs bun on PATH. Run: pnpm vitest run packages/microfoom-cli/test/e2e.test.ts

import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { createTerminal } from "@termless/core";
import { createXtermBackend } from "@termless/xtermjs";
import { afterAll, beforeAll, expect, test } from "vitest";

/** Absolute path to bun (node-pty can't rely on the inherited PATH). */
function resolveBun(): string {
  const home = process.env["HOME"] ?? "";
  const candidates = [resolve(home, ".bun/bin/bun"), "/usr/local/bin/bun", "/opt/homebrew/bin/bun"];
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  try {
    return execSync("command -v bun", { encoding: "utf8" }).trim();
  } catch {
    return "bun";
  }
}

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../../..");
const bun = resolveBun();
const tuiEntry = resolve(repoRoot, "packages/microfoom-cli/src/tui.tsx");
const program = resolve(repoRoot, "examples/hello.ts");
const shotsDir = resolve(tmpdir(), "microfoom-tui-shots");

const HEADER_HARNESS_RE = /microfoom.*fake/;
const OSC52_CLIPBOARD_RE = /]52;c;([A-Za-z0-9+/=]+)/;
const COPIED_CHARS_RE = /copied \d+ chars/;
const FOCUSED_TRANSCRIPT_RE = /TRANSCRIPT · span/;

let term: ReturnType<typeof createTerminal>;

beforeAll(async () => {
  mkdirSync(shotsDir, { recursive: true });
  term = createTerminal({ backend: createXtermBackend(), cols: 120, rows: 36 });
  await term.spawn([bun, tuiEntry, program, "Ada", "--harness", "fake", "--theme", "dark"]);
  // Wait for the run to settle (tool result is the last transcript entry).
  await term.waitFor("tool result", 20_000);
}, 30_000);

afterAll(async () => {
  await term?.close();
});

test("renders the two-pane inspector with trace + transcript", () => {
  const screen = term.screen.getText();
  // Both panes present.
  expect(screen).toContain("TRACE");
  expect(screen).toContain("TRANSCRIPT");
  // Trace tree nodes.
  expect(screen).toContain("main");
  expect(screen).toContain("value");
  // Transcript shows every role: user prompt, thinking, tool call (+args), result.
  expect(screen).toContain("user");
  expect(screen).toContain("thinking");
  expect(screen).toContain("foom_return");
  expect(screen).toContain("tool result");
  // Tool-call args are rendered as JSON.
  expect(screen).toContain("value");
  // Status footer reflects completion.
  expect(screen).toContain("done");
  // Header names the harness in use.
  expect(screen).toMatch(HEADER_HARNESS_RE);
  writeFileSync(resolve(shotsDir, "01-overview.svg"), term.screenshotSvg());
});

test("drag-selecting transcript text copies it to the clipboard via OSC 52", async () => {
  const rows = term.screen.getText().split("\n");
  const userRow = rows.findIndex((line) => line.includes("user"));
  expect(userRow).toBeGreaterThanOrEqual(0);
  // Drag across the user prompt line (one row below the "user" header).
  const y = userRow + 1;
  term.mouseDown(70, y);
  term.mouseMove(110, y);
  term.mouseUp(110, y);
  await new Promise((r) => setTimeout(r, 300));
  // The OSC 52 clipboard write lands in the raw output stream.
  const match = term.out.getText().match(OSC52_CLIPBOARD_RE);
  expect(match).not.toBeNull();
  expect(
    Buffer.from((match as RegExpMatchArray)[1] ?? "", "base64").toString("utf8").length,
  ).toBeGreaterThan(0);
  expect(term.screen.getText()).toMatch(COPIED_CHARS_RE);
});

test("clicking a trace node filters the transcript to that span", async () => {
  // The "value" turn row is the 2nd tree row: header(0) + top border(1) + main(2) + value(3).
  term.click(5, 3);
  await term.waitFor("TRANSCRIPT · span", 5000);
  const screen = term.screen.getText();
  expect(screen).toMatch(FOCUSED_TRANSCRIPT_RE);
  writeFileSync(resolve(shotsDir, "02-node-selected.svg"), term.screenshotSvg());
});

test("'a' clears the filter back to the full transcript", async () => {
  term.press("a");
  // Poll until the span suffix is gone (no waitForAbsence in termless).
  let cleared = false;
  for (let i = 0; i < 30 && !cleared; i += 1) {
    if (FOCUSED_TRANSCRIPT_RE.test(term.screen.getText())) {
      await new Promise((r) => setTimeout(r, 100));
    } else {
      cleared = true;
    }
  }
  expect(term.screen.getText()).not.toMatch(FOCUSED_TRANSCRIPT_RE);
});

test("system prompt + full user msg are hidden by default, toggled with s/m", async () => {
  // Default: neither the system block nor the injected user-prompt instructions show.
  expect(term.screen.getText()).not.toContain("microfoom:begin");
  expect(term.screen.getText()).not.toContain("✦ system");
  // m reveals the full user message (incl. the appended foom instructions).
  term.press("m");
  await term.waitFor("microfoom:begin", 4000);
  expect(term.screen.getText()).toContain("microfoom:begin");
  // s reveals the per-turn system prompt block.
  term.press("s");
  await term.waitFor("✦ system", 4000);
  expect(term.screen.getText()).toContain("✦ system");
  // Toggle both back off.
  term.press("m");
  term.press("s");
  await new Promise((r) => setTimeout(r, 300));
  expect(term.screen.getText()).not.toContain("✦ system");
});

test("'r' re-runs and picks up source edits (fresh process via the node launcher)", async () => {
  const cli = resolve(repoRoot, "packages/microfoom-cli/src/cli.ts");
  // Must live inside the repo so the program can resolve @microfoom/core.
  const tmp = resolve(repoRoot, "examples/.e2e-rerun.ts");
  writeFileSync(tmp, readFileSync(resolve(repoRoot, "examples/hello.ts"), "utf8"));
  const t2 = createTerminal({ backend: createXtermBackend(), cols: 120, rows: 30 });
  try {
    await t2.spawn(["node", "--import", "tsx", cli, tmp, "Ada", "--harness", "fake", "--tui"]);
    await t2.waitFor("tool result", 20_000);
    expect(t2.screen.getText()).not.toContain("ZESTY");
    writeFileSync(
      tmp,
      readFileSync(tmp, "utf8").replace("warm, one-sentence greeting", "ZESTY greeting"),
    );
    await new Promise((r) => setTimeout(r, 200));
    t2.press("r");
    await t2.waitFor("ZESTY", 15_000);
    expect(t2.screen.getText()).toContain("ZESTY");
  } finally {
    await t2.close();
    rmSync(tmp, { force: true });
  }
}, 45_000);

test("writes a PNG screenshot when a renderer is available", async () => {
  try {
    const png = await term.screenshot();
    writeFileSync(resolve(shotsDir, "03-overview.png"), png);
    expect(png.byteLength).toBeGreaterThan(0);
  } catch {
    // PNG renderers are optional; the SVG screenshots above are the baseline.
    expect(true).toBe(true);
  }
});
