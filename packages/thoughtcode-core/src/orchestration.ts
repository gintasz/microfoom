// VIBECALL orchestration policy: given a program file + call, validate the callee declaration, bind
// and type-check the args, and derive what a subagent needs (return type, run config, resolved args).
// Pure policy + program loading — no harness/runtime coupling. Adapters call this, then spawn.

import { bindAndCheckArgs } from "./binding.js";
import { buildVibeRunConfig, type VibeRunConfig } from "./decorators.js";
import { buildVibeFunctionNotFoundMessage } from "./messages.js";
import { parseVibeCallArgs, serializeVibeCallArgs } from "./parser.js";
import { loadProgram } from "./program-loader.js";
import { collectVibeFunctionErrors } from "./validate.js";

export type VibeCallPrep =
  | { status: "ok"; returnType?: string; runConfig: VibeRunConfig; resolvedArgs: string }
  | { status: "error"; message: string }
  | { status: "unreadable" };

/**
 * Resolve a VIBECALL before spawning: load+parse the program, look up the callee, validate its
 * declaration, then bind + type-check the caller's args. `error` is the caller's fault (retryable);
 * `unreadable` means proceed with raw args and let the subagent's program load surface the read error.
 */
export async function prepareVibeCall(
  programFilePath: string,
  name: string,
  rawArgs: string,
  cwd: string | undefined,
): Promise<VibeCallPrep> {
  const loaded = await loadProgram(programFilePath, cwd);
  if (!loaded.ok) {
    return { status: "unreadable" };
  }
  const fn = loaded.program.functions.get(name);
  if (!fn) {
    return { status: "error", message: buildVibeFunctionNotFoundMessage(name, programFilePath) };
  }
  const declErrors = collectVibeFunctionErrors(fn);
  if (declErrors.length > 0) {
    return { status: "error", message: `VIBEFUNCTION \`${name}\`: ${declErrors.join("; ")}` };
  }
  const parsedArgs = parseVibeCallArgs(rawArgs);
  if (parsedArgs.errors.length > 0) {
    return { status: "error", message: `${name}: ${parsedArgs.errors.join("; ")}` };
  }
  const binding = bindAndCheckArgs(fn.params, parsedArgs.values);
  if (!binding.ok) {
    return { status: "error", message: `${name}: ${binding.error}` };
  }
  return {
    status: "ok",
    returnType: fn.returnType,
    runConfig: buildVibeRunConfig(fn.decorators).config,
    resolvedArgs: serializeVibeCallArgs(binding.bound),
  };
}
