// The one place this adapter reads `process.env` (S1/CFG1). Every other module
// takes the resolved values as typed inputs, so env access is centralized and
// can be replaced with fakes in tests rather than reached for directly. The
// `noProcessEnv` lint is disabled here (and only here) by a biome override.

/** Path to append a JSONL dump of each model request body, or undefined. */
import process from "node:process";
export function dumpPayloadFile(): string | undefined {
  return process.env["MICROFOOM_DUMP_PAYLOAD"];
}

/** Default per-turn JSONL log path when the caller does not supply one. */
export function logFileFromEnv(): string | undefined {
  return process.env["MICROFOOM_LOG"];
}
