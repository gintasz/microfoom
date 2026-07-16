import type { JsonSchema } from "./backend.js";
import {
  asSchema,
  discriminatorFor,
  isRecord,
  pathLabel,
  requiredProperties,
  resolveSchema,
  schemaArray,
  schemaProperties,
  schemaType,
  titledVariants,
} from "./interactive_schema_shape.js";
import type { InteractivePrompt } from "./interactive_terminal.js";
import { compileJsonSchemaValidator, type JsonSchemaValidator } from "./json_schema_validator.js";

interface PromptedField {
  readonly path: readonly string[];
  readonly schema: JsonSchema;
}

interface InteractiveCollection {
  readonly value: unknown;
  readonly promptedFields: readonly PromptedField[];
}

interface PromptState {
  readonly io: InteractivePrompt;
  readonly rootSchema: JsonSchema;
  readonly promptedFields: PromptedField[];
  readonly validators: Map<JsonSchema, JsonSchemaValidator | undefined>;
}

async function selectOption(
  label: string,
  options: readonly unknown[],
  io: InteractivePrompt,
): Promise<unknown> {
  io.write(`${label}:\n`);
  options.forEach((option, index) => {
    io.write(`  ${index + 1}. ${typeof option === "string" ? option : JSON.stringify(option)}\n`);
  });
  for (;;) {
    const answer = (await io.ask("> ")).trim();
    const selected = Number(answer);
    if (Number.isInteger(selected) && selected >= 1 && selected <= options.length) {
      return options[selected - 1];
    }
    io.write(`Enter a number from 1 to ${options.length}.\n`);
  }
}

async function promptBoolean(label: string, io: InteractivePrompt): Promise<boolean> {
  for (;;) {
    const answer = (await io.ask(`${label} [y/n]: `)).trim().toLowerCase();
    if (answer === "y" || answer === "yes" || answer === "true") {
      return true;
    }
    if (answer === "n" || answer === "no" || answer === "false") {
      return false;
    }
    io.write("Enter yes or no.\n");
  }
}

async function promptNumber(
  label: string,
  integer: boolean,
  io: InteractivePrompt,
): Promise<number> {
  for (;;) {
    const answer = (await io.ask(`${label}: `)).trim();
    const value = Number(answer);
    if (answer.length > 0 && Number.isFinite(value) && (!integer || Number.isInteger(value))) {
      return value;
    }
    io.write(integer ? "Enter an integer.\n" : "Enter a number.\n");
  }
}

async function promptJson(label: string, io: InteractivePrompt): Promise<unknown> {
  for (;;) {
    const answer = await io.ask(`${label} (JSON): `);
    try {
      return JSON.parse(answer) as unknown;
    } catch {
      io.write("Enter valid JSON.\n");
    }
  }
}

function confirmationValue(answer: string, required: boolean): boolean | undefined {
  if (answer.length === 0) {
    return required;
  }
  if (answer === "y" || answer === "yes") {
    return true;
  }
  if (!required && (answer === "n" || answer === "no")) {
    return false;
  }
  return;
}

function arrayConfirmationError(minimumItems: number): string {
  if (minimumItems === 0) {
    return "Enter yes or no.\n";
  }
  const noun = minimumItems === 1 ? "item is" : "items are";
  return `At least ${minimumItems} ${noun} required; answer yes.\n`;
}

async function confirmArrayItem(
  label: string,
  itemCount: number,
  minimumItems: number,
  io: InteractivePrompt,
): Promise<boolean> {
  const required = itemCount < minimumItems;
  for (;;) {
    const prompt = required
      ? `Add an item to ${label}? [Y/n]: `
      : `Add an item to ${label}? [y/N]: `;
    const answer = (await io.ask(prompt)).trim().toLowerCase();
    const confirmed = confirmationValue(answer, required);
    if (confirmed !== undefined) {
      return confirmed;
    }
    io.write(arrayConfirmationError(required ? minimumItems : 0));
  }
}

function promptValidator(schema: JsonSchema, state: PromptState): JsonSchemaValidator | undefined {
  if (state.validators.has(schema)) {
    return state.validators.get(schema);
  }
  let validator: JsonSchemaValidator | undefined;
  try {
    const definitions = state.rootSchema["$defs"];
    const compilable = definitions === undefined ? schema : { ...schema, ["$defs"]: definitions };
    validator = compileJsonSchemaValidator(compilable);
  } catch {
    // Standard Schema remains authoritative when its projection cannot compile in isolation.
  }
  state.validators.set(schema, validator);
  return validator;
}

function validatesIndependently(schema: JsonSchema): boolean {
  const type = schemaType(schema);
  if (type === "object" || type === "array") {
    return false;
  }
  const variants = [...schemaArray(schema, "oneOf"), ...schemaArray(schema, "anyOf")];
  return variants.length === 0 || discriminatorFor(variants) === undefined;
}

async function promptValidatedValue(
  schema: JsonSchema,
  path: readonly string[],
  state: PromptState,
  references: ReadonlySet<string>,
): Promise<unknown> {
  for (;;) {
    const value = await promptValue(schema, path, state, references);
    const validator = validatesIndependently(schema) ? promptValidator(schema, state) : undefined;
    const issues = validator?.validate(value) ?? [];
    if (issues.length === 0) {
      return value;
    }
    state.io.write(`Invalid ${pathLabel(schema, path)}: ${issues.join("; ")}\n`);
  }
}

async function promptUnion(
  schema: JsonSchema,
  path: readonly string[],
  state: PromptState,
  references: ReadonlySet<string>,
): Promise<unknown> {
  const variants = [...schemaArray(schema, "oneOf"), ...schemaArray(schema, "anyOf")];
  const discriminator = discriminatorFor(variants);
  if (discriminator !== undefined) {
    const values = variants.map(
      (optionSchema) => schemaProperties(optionSchema)[discriminator]?.["const"],
    );
    const selected = await selectOption(pathLabel(schema, path), values, state.io);
    const index = values.findIndex((value) => Object.is(value, selected));
    const selectedVariant = variants[index];
    if (selectedVariant !== undefined) {
      const candidate: Record<string, unknown> = { [discriminator]: selected };
      await collectObject(selectedVariant, candidate, path, state, references);
      return candidate;
    }
  }
  const titles = titledVariants(variants);
  if (titles !== undefined) {
    const selected = await selectOption(pathLabel(schema, path), titles, state.io);
    const index = titles.indexOf(String(selected));
    const variant = variants[index];
    if (variant !== undefined) {
      return await promptValue(variant, path, state, references);
    }
  }
  return await promptJson(pathLabel(schema, path), state.io);
}

async function promptArray(
  schema: JsonSchema,
  path: readonly string[],
  state: PromptState,
  references: ReadonlySet<string>,
): Promise<unknown> {
  const items = asSchema(schema["items"]);
  if (items === undefined || schema["prefixItems"] !== undefined) {
    return await promptJson(pathLabel(schema, path), state.io);
  }
  const minimum = schema["minItems"];
  const minimumItems = typeof minimum === "number" && Number.isInteger(minimum) ? minimum : 0;
  const maximum = schema["maxItems"];
  const maximumItems =
    typeof maximum === "number" && Number.isInteger(maximum) ? maximum : Infinity;
  const values: unknown[] = [];
  while (
    values.length < maximumItems &&
    (await confirmArrayItem(pathLabel(schema, path), values.length, minimumItems, state.io))
  ) {
    const itemPath = [...path, String(values.length)];
    values.push(await promptValidatedValue(items, itemPath, state, references));
  }
  return values;
}

async function promptValue(
  originalSchema: JsonSchema,
  path: readonly string[],
  state: PromptState,
  references: ReadonlySet<string>,
): Promise<unknown> {
  const resolved = resolveSchema(originalSchema, state.rootSchema, references);
  if (resolved === undefined) {
    return await promptJson(pathLabel(originalSchema, path), state.io);
  }
  const { schema } = resolved;
  if ("const" in schema) {
    return schema["const"];
  }
  const enumValues = schema["enum"];
  if (Array.isArray(enumValues) && enumValues.length > 0) {
    return await selectOption(pathLabel(schema, path), enumValues, state.io);
  }
  if (schemaArray(schema, "oneOf").length > 0 || schemaArray(schema, "anyOf").length > 0) {
    return await promptUnion(schema, path, state, resolved.references);
  }
  const type = schemaType(schema);
  if (type === "object") {
    const candidate: Record<string, unknown> = {};
    await collectObject(schema, candidate, path, state, resolved.references);
    return candidate;
  }
  if (type === "array") {
    return await promptArray(schema, path, state, resolved.references);
  }
  if (type === "boolean") {
    return await promptBoolean(pathLabel(schema, path), state.io);
  }
  if (type === "number" || type === "integer") {
    return await promptNumber(pathLabel(schema, path), type === "integer", state.io);
  }
  if (type === "string") {
    return await state.io.ask(`${pathLabel(schema, path)}: `);
  }
  if (type === "null") {
    return null;
  }
  return await promptJson(pathLabel(schema, path), state.io);
}

async function collectExistingNode(
  schema: JsonSchema,
  value: unknown,
  path: readonly string[],
  state: PromptState,
  references: ReadonlySet<string>,
): Promise<void> {
  const resolved = resolveSchema(schema, state.rootSchema, references);
  if (resolved === undefined || !isRecord(value)) {
    return;
  }
  const variants = [
    ...schemaArray(resolved.schema, "oneOf"),
    ...schemaArray(resolved.schema, "anyOf"),
  ];
  const discriminator = discriminatorFor(variants);
  if (discriminator !== undefined) {
    const values = variants.map(
      (optionSchema) => schemaProperties(optionSchema)[discriminator]?.["const"],
    );
    const existingSelection = value[discriminator];
    const selected = values.some((option) => Object.is(option, existingSelection))
      ? existingSelection
      : await selectOption(pathLabel(resolved.schema, path), values, state.io);
    value[discriminator] = selected;
    const variant = variants.find((candidate) =>
      Object.is(schemaProperties(candidate)[discriminator]?.["const"], selected),
    );
    if (variant !== undefined) {
      if (existingSelection === undefined) {
        state.promptedFields.push({ path, schema: resolved.schema });
      }
      await collectObject(variant, value, path, state, resolved.references);
      return;
    }
  }
  if (schemaType(resolved.schema) === "object") {
    await collectObject(resolved.schema, value, path, state, resolved.references);
  }
}

async function collectObject(
  schema: JsonSchema,
  candidate: Record<string, unknown>,
  path: readonly string[],
  state: PromptState,
  references: ReadonlySet<string>,
): Promise<void> {
  const properties = schemaProperties(schema);
  for (const name of requiredProperties(schema)) {
    const property = properties[name];
    if (property === undefined) {
      continue;
    }
    const propertyPath = [...path, name];
    const existing = candidate[name];
    if (existing !== undefined) {
      await collectExistingNode(property, existing, propertyPath, state, references);
      continue;
    }
    if (Object.hasOwn(property, "default")) {
      continue;
    }
    state.promptedFields.push({ path: propertyPath, schema: property });
    candidate[name] = await promptValidatedValue(property, propertyPath, state, references);
  }
}

async function collectInteractiveInput(
  schema: JsonSchema | undefined,
  candidate: unknown,
  io: InteractivePrompt,
): Promise<InteractiveCollection> {
  if (schema === undefined) {
    return { value: await promptJson("Input", io), promptedFields: [{ path: [], schema: {} }] };
  }
  const state: PromptState = {
    io,
    rootSchema: schema,
    promptedFields: [],
    validators: new Map(),
  };
  if (isRecord(candidate) && schemaType(schema) === "object") {
    await collectObject(schema, candidate, [], state, new Set());
    return { value: candidate, promptedFields: state.promptedFields };
  }
  if (candidate !== undefined) {
    await collectExistingNode(schema, candidate, [], state, new Set());
    return { value: candidate, promptedFields: state.promptedFields };
  }
  state.promptedFields.push({ path: [], schema });
  return {
    value: await promptValidatedValue(schema, [], state, new Set()),
    promptedFields: state.promptedFields,
  };
}

async function repromptField(
  field: PromptedField,
  rootSchema: JsonSchema | undefined,
  io: InteractivePrompt,
): Promise<unknown> {
  const state: PromptState = {
    io,
    rootSchema: rootSchema ?? field.schema,
    promptedFields: [],
    validators: new Map(),
  };
  return await promptValidatedValue(field.schema, field.path, state, new Set());
}

export type { PromptedField };
export { collectInteractiveInput, repromptField };
