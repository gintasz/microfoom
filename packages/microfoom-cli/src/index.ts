// Public surface of @microfoom/cli (programmatic reuse). The bin is `cli.ts`; the
// renderer, panel, loader and fake session are exported so other frontends/tests
// can reuse them. Re-exports are explicit (no `export *`).

export { fakeOpenSession } from "./fake.js";
export {
  fmtCost,
  fmtDuration,
  fmtSummary,
  fmtTokens,
} from "./format.js";
export { loadProgram, type ProgramClass } from "./loader.js";
export { attachPanel, type Panel } from "./panel.js";
export { type RenderOptions, renderRunTree } from "./render.js";
