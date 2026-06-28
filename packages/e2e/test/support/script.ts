// A neutral, adapter-agnostic script: the sequence of assistant messages a fixture
// expects the model to emit, one step per turn of the harness loop. Fixtures are
// written against this vocabulary alone and never name a provider. Each adapter
// (see adapters.ts) translates a script into its own provider double — the pi
// adapter into pi-ai faux responses; a future adapter into whatever it uses. This
// is the seam that lets one static fixture set run against every adapter and,
// underneath, against the real model (where the script is simply ignored — the
// live model decides for itself).

/** One scripted assistant turn. */
export type ScriptStep =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "toolCall"; readonly name: string; readonly args: Record<string, unknown> }
  | { readonly kind: "delayText"; readonly ms: number; readonly text: string };

/** The model replies with prose and ends the turn (a text turn, or a non-compliant
 *  value turn that never calls foom_return). */
export const sayText = (text: string): ScriptStep => ({ kind: "text", text });

/** The model calls one tool with the given arguments (a FOOM control tool or an
 *  exposed method). The harness executes it and the loop continues. */
export const callTool = (name: string, args: Record<string, unknown>): ScriptStep => ({
  kind: "toolCall",
  name,
  args,
});

/** The model stalls `ms` before replying — used to provoke a turn-duration cap. */
export const stall = (ms: number, text: string): ScriptStep => ({ kind: "delayText", ms, text });
