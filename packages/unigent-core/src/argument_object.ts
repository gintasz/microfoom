import { AgentInputError } from "./errors.js";

type InputPair = readonly [string, string | boolean];
type InputContainer = Record<string, unknown> | unknown[];

const NEGATION_PREFIX = "no-";
const UNSAFE_PATH_SEGMENTS: ReadonlySet<string> = new Set([
  "__proto__",
  "constructor",
  "prototype",
]);

function coerceScalar(raw: string): unknown {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed === "number" || typeof parsed === "boolean") {
      return parsed;
    }
  } catch {
    // Non-JSON scalars remain strings.
  }
  return raw;
}

function pathSegments(path: string): readonly string[] {
  const segments = path.split(".");
  if (segments.some((segment) => segment.length === 0 || UNSAFE_PATH_SEGMENTS.has(segment))) {
    throw new AgentInputError(`unsafe or empty argument path: ${path}`);
  }
  return segments;
}

function readContainer(container: InputContainer, key: string): unknown {
  return Array.isArray(container) ? container[Number(key)] : container[key];
}

function writeContainer(container: InputContainer, key: string, value: unknown): void {
  if (Array.isArray(container)) {
    container[Number(key)] = value;
  } else {
    container[key] = value;
  }
}

function isInputContainer(value: unknown): value is InputContainer {
  return typeof value === "object" && value !== null;
}

function setArgumentPath(
  root: Record<string, unknown>,
  path: readonly string[],
  value: unknown,
): void {
  let cursor: InputContainer = root;
  for (const segment of path.slice(0, -1)) {
    const existing = readContainer(cursor, segment);
    if (existing !== undefined && !isInputContainer(existing)) {
      throw new AgentInputError(`argument path conflicts at ${path.join(".")}`);
    }
    const next: InputContainer = existing ?? {};
    writeContainer(cursor, segment, next);
    cursor = next;
  }
  writeContainer(cursor, path.at(-1) ?? "", value);
}

function getArgumentPath(root: unknown, path: readonly string[]): unknown {
  let cursor = root;
  for (const segment of path) {
    if (!isInputContainer(cursor)) {
      return;
    }
    cursor = readContainer(cursor, segment);
  }
  return cursor;
}

function assembleArgumentPairs(
  pairs: readonly InputPair[],
  coerce: boolean,
): Record<string, unknown> {
  const grouped = new Map<string, Array<string | boolean>>();
  for (const [name, value] of pairs) {
    const values = grouped.get(name);
    if (values === undefined) {
      grouped.set(name, [value]);
    } else {
      values.push(value);
    }
  }
  const root: Record<string, unknown> = {};
  const convert = (value: string | boolean): unknown =>
    coerce && typeof value === "string" ? coerceScalar(value) : value;
  for (const [name, values] of grouped) {
    const value = values.length === 1 ? convert(values[0] ?? "") : values.map(convert);
    setArgumentPath(root, pathSegments(name), value);
  }
  return root;
}

function flagPair(
  name: string,
  inline: string | undefined,
  next: string | undefined,
): { readonly pair: InputPair; readonly consumedNext: boolean } {
  if (name.length === 0) {
    throw new AgentInputError("argument names must not be empty");
  }
  if (name.startsWith(NEGATION_PREFIX) && inline === undefined) {
    return { pair: [name.slice(NEGATION_PREFIX.length), false], consumedNext: false };
  }
  if (inline !== undefined) {
    return { pair: [name, inline], consumedNext: false };
  }
  if (next === undefined || next.startsWith("--")) {
    return { pair: [name, true], consumedNext: false };
  }
  return { pair: [name, next], consumedNext: true };
}

function pairsFromArguments(arguments_: readonly string[]): readonly InputPair[] {
  const pairs: InputPair[] = [];
  let index = 0;
  while (index < arguments_.length) {
    const token = arguments_[index] ?? "";
    if (token === "--") {
      index += 1;
      continue;
    }
    if (!token.startsWith("--")) {
      throw new AgentInputError(`unexpected positional argument: ${token}`);
    }
    const equals = token.indexOf("=");
    const name = equals < 0 ? token.slice(2) : token.slice(2, equals);
    const inline = equals < 0 ? undefined : token.slice(equals + 1);
    const parsed = flagPair(name, inline, arguments_[index + 1]);
    pairs.push(parsed.pair);
    index += parsed.consumedNext ? 2 : 1;
  }
  return pairs;
}

export type { InputPair };
export {
  assembleArgumentPairs,
  coerceScalar,
  getArgumentPath,
  pairsFromArguments,
  setArgumentPath,
};
