import { setArgumentPath } from "./argument_object.js";
import type { JsonSchema } from "./backend.js";

interface ResolvedSchema {
  readonly schema: JsonSchema;
  readonly references: ReadonlySet<string>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asSchema(value: unknown): JsonSchema | undefined {
  return isRecord(value) ? value : undefined;
}

function schemaArray(schema: JsonSchema, key: string): readonly JsonSchema[] {
  const value = schema[key];
  if (!Array.isArray(value)) {
    return [];
  }
  const schemas: JsonSchema[] = [];
  for (const item of value) {
    const parsed = asSchema(item);
    if (parsed !== undefined) {
      schemas.push(parsed);
    }
  }
  return schemas;
}

function schemaProperties(schema: JsonSchema): Readonly<Record<string, JsonSchema>> {
  const properties = schema["properties"];
  if (!isRecord(properties)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(properties).flatMap(([name, value]) => {
      const property = asSchema(value);
      return property === undefined ? [] : [[name, property]];
    }),
  );
}

function requiredProperties(schema: JsonSchema): readonly string[] {
  const required = schema["required"];
  return Array.isArray(required)
    ? required.filter((name): name is string => typeof name === "string")
    : [];
}

function schemaType(schema: JsonSchema): string | undefined {
  const type = schema["type"];
  if (typeof type === "string") {
    return type;
  }
  if (!Array.isArray(type)) {
    return;
  }
  const concrete = type.filter((value): value is string => typeof value === "string");
  return concrete.length === 1 ? concrete[0] : undefined;
}

function schemaAnnotation(schema: JsonSchema): string | undefined {
  const description = schema["description"];
  if (typeof description === "string" && description.trim().length > 0) {
    return description.trim();
  }
  const title = schema["title"];
  if (typeof title === "string" && title.trim().length > 0) {
    return title.trim();
  }
  return;
}

function pathLabel(schema: JsonSchema, path: readonly string[]): string {
  const annotation = schemaAnnotation(schema);
  if (path.length === 0) {
    return annotation ?? "Input";
  }
  const argumentName = `--${path.join(".")}`;
  return annotation === undefined ? argumentName : `${argumentName} (${annotation})`;
}

function jsonPointer(root: JsonSchema, reference: string): JsonSchema | undefined {
  if (!reference.startsWith("#/")) {
    return;
  }
  let cursor: unknown = root;
  for (const encoded of reference.slice(2).split("/")) {
    if (!isRecord(cursor)) {
      return;
    }
    const segment = encoded.replaceAll("~1", "/").replaceAll("~0", "~");
    cursor = cursor[segment];
  }
  return asSchema(cursor);
}

function resolveSchema(
  schema: JsonSchema,
  root: JsonSchema,
  references: ReadonlySet<string>,
): ResolvedSchema | undefined {
  const reference = schema["$ref"];
  if (typeof reference !== "string") {
    return { schema, references };
  }
  if (references.has(reference)) {
    return;
  }
  const resolved = jsonPointer(root, reference);
  if (resolved === undefined) {
    return;
  }
  return { schema: resolved, references: new Set([...references, reference]) };
}

function discriminatorFor(variants: readonly JsonSchema[]): string | undefined {
  const [first, ...remaining] = variants;
  if (first === undefined) {
    return;
  }
  return Object.entries(schemaProperties(first)).find(([name, property]) => {
    if (!("const" in property)) {
      return false;
    }
    const values = [property["const"]];
    for (const variant of remaining) {
      const candidate = schemaProperties(variant)[name];
      if (candidate === undefined || !("const" in candidate)) {
        return false;
      }
      values.push(candidate["const"]);
    }
    return new Set(values.map((value) => JSON.stringify(value))).size === variants.length;
  })?.[0];
}

function titledVariants(variants: readonly JsonSchema[]): readonly string[] | undefined {
  const titles = variants.map((variant) => variant["title"]);
  return titles.every((title): title is string => typeof title === "string" && title.length > 0)
    ? titles
    : undefined;
}

function replaceCollectedField(root: unknown, path: readonly string[], value: unknown): unknown {
  if (path.length === 0) {
    return value;
  }
  if (!isRecord(root)) {
    return root;
  }
  setArgumentPath(root, path, value);
  return root;
}

export {
  asSchema,
  discriminatorFor,
  isRecord,
  pathLabel,
  replaceCollectedField,
  requiredProperties,
  resolveSchema,
  schemaArray,
  schemaProperties,
  schemaType,
  titledVariants,
};
