import type { StandardSchemaV1 } from "@standard-schema/spec";
import {
  assembleArgumentPairs,
  getArgumentPath,
  pairsFromArguments,
  setArgumentPath,
} from "./argument_object.js";
import { AgentInputError } from "./errors.js";
import {
  collectInteractiveInput,
  type PromptedField,
  repromptField,
} from "./interactive_schema.js";
import { pathLabel, replaceCollectedField } from "./interactive_schema_shape.js";
import type { InteractivePrompt } from "./interactive_terminal.js";
import { type OutputSchema, optionalJsonSchema } from "./schema.js";

interface PreparedCandidate<Output> {
  readonly candidate: Record<string, unknown>;
  readonly validation: StandardSchemaV1.Result<Output>;
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

function issueMessage(issue: StandardSchemaV1.Issue): string {
  const path = issuePath(issue.path).join(".");
  return path.length === 0 ? issue.message : `${path}: ${issue.message}`;
}

function validationMessage(issues: readonly StandardSchemaV1.Issue[]): string {
  return issues.map(issueMessage).join("; ");
}

async function prepareNamedCandidate<Output>(
  arguments_: readonly string[],
  schema: OutputSchema<Output>,
): Promise<PreparedCandidate<Output>> {
  const pairs = pairsFromArguments(arguments_);
  const candidate = assembleArgumentPairs(pairs, true);
  const raw = assembleArgumentPairs(pairs, false);
  let validation = await schema["~standard"].validate(candidate);
  for (let attempt = 0; attempt < pairs.length; attempt += 1) {
    if (validation.issues === undefined) {
      break;
    }
    let changed = false;
    for (const issue of validation.issues) {
      const path = issuePath(issue.path);
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
    validation = await schema["~standard"].validate(candidate);
  }
  return { candidate, validation };
}

function hasExplicitInvalidIssue(
  issues: readonly StandardSchemaV1.Issue[],
  candidate: Record<string, unknown>,
): boolean {
  return issues.some((issue) => {
    const path = issuePath(issue.path);
    return path.length > 0 && getArgumentPath(candidate, path) !== undefined;
  });
}

function commonPrefixLength(first: readonly string[], second: readonly string[]): number {
  let length = 0;
  while (length < first.length && length < second.length && first[length] === second[length]) {
    length += 1;
  }
  return length;
}

function promptedFieldForIssue(
  issue: StandardSchemaV1.Issue,
  fields: readonly PromptedField[],
): PromptedField | undefined {
  const path = issuePath(issue.path);
  if (path.length === 0) {
    return fields.find((field) => field.path.length === 0);
  }
  return [...fields]
    .map((field) => ({ field, score: commonPrefixLength(path, field.path) }))
    .filter(({ field, score }) => score === path.length || score === field.path.length)
    .sort((left, right) => right.score - left.score)[0]?.field;
}

async function validateCollectedInput<Output>(
  initialValue: unknown,
  schema: OutputSchema<Output>,
  rootSchema: ReturnType<typeof optionalJsonSchema>,
  fields: readonly PromptedField[],
  io: InteractivePrompt,
): Promise<Output> {
  let value = initialValue;
  for (;;) {
    const result = await schema["~standard"].validate(value);
    if (result.issues === undefined) {
      return result.value;
    }
    const [issue] = result.issues;
    if (issue === undefined) {
      throw new AgentInputError("script arguments are invalid");
    }
    const field = promptedFieldForIssue(issue, fields);
    if (field === undefined) {
      if (fields.length === 0) {
        throw new AgentInputError(validationMessage(result.issues));
      }
      const rootField: PromptedField = { path: [], schema: {} };
      io.write(`Invalid Input: ${issue.message}\n`);
      value = await repromptField(rootField, rootSchema, io);
      continue;
    }
    io.write(`Invalid ${pathLabel(field.schema, field.path)}: ${issue.message}\n`);
    value = replaceCollectedField(value, field.path, await repromptField(field, rootSchema, io));
  }
}

async function parseInteractiveArgs<Output>(
  arguments_: readonly string[],
  schema: OutputSchema<Output>,
  io: InteractivePrompt,
  parseProvided: () => Promise<Output>,
): Promise<Output> {
  const normalized = arguments_[0] === "--" ? arguments_.slice(1) : arguments_;
  const [first] = normalized;
  if (first !== undefined && !first.startsWith("--")) {
    return await parseProvided();
  }
  const projected = optionalJsonSchema(schema);
  if (projected === undefined && normalized.length > 0) {
    return await parseProvided();
  }
  const prepared = await prepareNamedCandidate(normalized, schema);
  if (prepared.validation.issues === undefined) {
    return prepared.validation.value;
  }
  if (hasExplicitInvalidIssue(prepared.validation.issues, prepared.candidate)) {
    throw new AgentInputError(validationMessage(prepared.validation.issues));
  }
  const candidate =
    projected?.["type"] === "object" || normalized.length > 0 ? prepared.candidate : undefined;
  const collection = await collectInteractiveInput(projected, candidate, io);
  return await validateCollectedInput(
    collection.value,
    schema,
    projected,
    collection.promptedFields,
    io,
  );
}

export { parseInteractiveArgs };
