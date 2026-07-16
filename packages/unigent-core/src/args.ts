import { basename } from "node:path";
import process from "node:process";
import type { StandardSchemaV1 } from "@standard-schema/spec";
import {
  assembleArgumentPairs,
  coerceScalar,
  getArgumentPath,
  type InputPair,
  pairsFromArguments,
  setArgumentPath,
} from "./argument_object.js";
import { AgentInputError } from "./errors.js";
import { parseInteractiveArgs } from "./interactive_args.js";
import { createTerminalPrompt, InteractiveInputCancelledError } from "./interactive_terminal.js";
import { type OutputSchema, parseSchema } from "./schema.js";

interface ArgsOptions {
  /** One-line explanation shown before usage. */
  readonly description?: string;
  /** Arguments appended to the detected script name in usage output. */
  readonly usage?: string;
}
const INTERRUPTED_EXIT_CODE = 130;

async function parsePositional<Output>(
  arguments_: readonly string[],
  schema: OutputSchema<Output>,
): Promise<Output> {
  const named = arguments_.find((token) => token.startsWith("--"));
  if (named !== undefined) {
    throw new AgentInputError(`cannot mix positional input with named argument: ${named}`);
  }
  const raw = arguments_.join(" ");
  const coerced = coerceScalar(raw);
  const coercedResult = await schema["~standard"].validate(coerced);
  if (coercedResult.issues === undefined) {
    return coercedResult.value;
  }
  if (!Object.is(coerced, raw)) {
    const rawResult = await schema["~standard"].validate(raw);
    if (rawResult.issues === undefined) {
      return rawResult.value;
    }
  }
  const parsed = await parseSchema(schema, raw);
  throw new AgentInputError(parsed.error ?? "positional script input is invalid");
}

function issuePath(path: StandardSchemaV1.Issue["path"]): readonly string[] {
  if (!Array.isArray(path)) {
    return [];
  }
  return path.map((segment: unknown) =>
    typeof segment === "object" && segment !== null && "key" in segment
      ? String(segment.key)
      : String(segment),
  );
}

async function uncoerceRejectedFields<Output>(
  schema: OutputSchema<Output>,
  candidate: Record<string, unknown>,
  raw: Readonly<Record<string, unknown>>,
  pairCount: number,
): Promise<Output> {
  for (let attempt = 0; attempt <= pairCount; attempt += 1) {
    const result = await schema["~standard"].validate(candidate);
    if (result.issues === undefined) {
      return result.value;
    }
    let changed = false;
    for (const issue of result.issues) {
      const path = issuePath(issue.path);
      if (path.length === 0) {
        continue;
      }
      const current = getArgumentPath(candidate, path);
      const original = getArgumentPath(raw, path);
      if (typeof original === "string" && current !== original) {
        setArgumentPath(candidate, path, original);
        changed = true;
      }
    }
    if (!changed) {
      break;
    }
  }
  const parsed = await parseSchema(schema, candidate);
  throw new AgentInputError(parsed.error ?? "script arguments are invalid");
}

/** Parse an explicit argv array as typed named arguments or scalar positional input. */
async function parseArgs(arguments_: readonly string[]): Promise<Record<string, unknown>>;
async function parseArgs<Output>(
  arguments_: readonly string[],
  schema: OutputSchema<Output>,
): Promise<Output>;
async function parseArgs<Output>(
  arguments_: readonly string[],
  schema?: OutputSchema<Output>,
): Promise<Output | Record<string, unknown>> {
  const normalized = arguments_[0] === "--" ? arguments_.slice(1) : arguments_;
  if (normalized.length === 0 && schema !== undefined) {
    const emptyNamedResult = await schema["~standard"].validate({});
    if (emptyNamedResult.issues === undefined) {
      return emptyNamedResult.value;
    }
    if (emptyNamedResult.issues.every((issue) => issuePath(issue.path).length === 0)) {
      return await parsePositional(normalized, schema);
    }
  }
  const [first] = normalized;
  if (first !== undefined && !first.startsWith("--")) {
    if (schema === undefined) {
      throw new AgentInputError(`unexpected positional argument: ${first}`);
    }
    return await parsePositional(normalized, schema);
  }
  const pairs = pairsFromArguments(normalized);
  const candidate = assembleArgumentPairs(pairs, true);
  if (schema === undefined) {
    return candidate;
  }
  return await uncoerceRejectedFields(
    schema,
    candidate,
    assembleArgumentPairs(pairs, false),
    pairs.length,
  );
}

function argsHelp(options: ArgsOptions, interactive: boolean): string {
  const [, scriptPath] = process.argv;
  const scriptName = basename(scriptPath ?? "script");
  const usage = options.usage ?? "[arguments]";
  const description = options.description === undefined ? "" : `${options.description}\n\n`;
  const interactiveHelp = interactive
    ? "\nOptions:\n  -i  Prompt for missing required arguments.\n"
    : "";
  return `${description}Usage: ${scriptName} ${usage}\n${interactiveHelp}`;
}

function exitWithArgsMessage(message: string, code: number, stream: NodeJS.WriteStream): never {
  stream.write(message);
  process.exit(code);
}

function isOutputSchema<Output>(
  value: OutputSchema<Output> | ArgsOptions | undefined,
): value is OutputSchema<Output> {
  return value !== undefined && "~standard" in value;
}

async function parseRequestedArgs<Output>(
  arguments_: readonly string[],
  schema: OutputSchema<Output> | undefined,
  interactive: boolean,
): Promise<Output | Record<string, unknown>> {
  if (!interactive) {
    return schema === undefined ? await parseArgs(arguments_) : await parseArgs(arguments_, schema);
  }
  if (schema === undefined) {
    throw new AgentInputError("-i requires an input schema");
  }
  const prompt = createTerminalPrompt();
  try {
    return await parseInteractiveArgs(
      arguments_,
      schema,
      prompt,
      async (): Promise<Output> => await parseArgs(arguments_, schema),
    );
  } finally {
    prompt.close();
  }
}

/** Parse `process.argv`, print standardized help/errors, and exit when no value can be returned. */
async function args(options?: ArgsOptions): Promise<Record<string, unknown>>;
async function args<Output>(schema: OutputSchema<Output>, options?: ArgsOptions): Promise<Output>;
async function args<Output>(
  schemaOrOptions?: OutputSchema<Output> | ArgsOptions,
  suppliedOptions: ArgsOptions = {},
): Promise<Output | Record<string, unknown>> {
  const schema = isOutputSchema(schemaOrOptions) ? schemaOrOptions : undefined;
  const options = isOutputSchema(schemaOrOptions) ? suppliedOptions : (schemaOrOptions ?? {});
  const arguments_ = process.argv.slice(2);
  if (arguments_.includes("--help") || arguments_.includes("-h")) {
    return exitWithArgsMessage(argsHelp(options, schema !== undefined), 0, process.stdout);
  }
  const interactive = arguments_.includes("-i");
  const inputArguments = interactive
    ? arguments_.filter((argument) => argument !== "-i")
    : arguments_;
  try {
    return await parseRequestedArgs(inputArguments, schema, interactive);
  } catch (error) {
    if (error instanceof InteractiveInputCancelledError) {
      return process.exit(INTERRUPTED_EXIT_CODE);
    }
    if (error instanceof AgentInputError) {
      return exitWithArgsMessage(
        `unigent: ${error.message}\n\n${argsHelp(options, schema !== undefined)}`,
        1,
        process.stderr,
      );
    }
    throw error;
  }
}

export type { ArgsOptions, InputPair };
export { args, parseArgs };
