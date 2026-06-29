// Standard Schema (F4) is the one validation contract — the library commits to no
// concrete validator. Returns are validated against the caller's schema; method
// arguments against the schema the derivation emits (ADR-0003). The tool handlers
// call a schema's `validate` directly (sync or async) and use `formatIssues` to
// render failures back to the model.

import type { StandardSchemaV1 } from "@standard-schema/spec";
import type { JsonSchema } from "./session.js";

/** The issues a failed validation reports. */
export type ValidationIssues = readonly StandardSchemaV1.Issue[];

/**
 * Best-effort JSON Schema for a Standard Schema's *input* — the shape the model
 * must emit (validation then transforms it to the output your code receives). Used
 * to advertise foom_return's `value` parameter so the model returns the right
 * shape first try. Read through the optional **Standard JSON Schema** interface
 * (`~standard.jsonSchema`), implemented by zod 4.2+, valibot 1.2+, arktype 2.1.28+
 * — never a concrete validator (F4). Returns undefined when the validator doesn't
 * implement it (the caller falls back to an open schema). `$schema` is stripped:
 * providers want a bare subschema, not a document.
 */
export function standardInputJsonSchema(schema: StandardSchemaV1): JsonSchema | undefined {
  const converter = (
    schema as {
      readonly "~standard"?: {
        readonly jsonSchema?: {
          readonly input?: (options: { target: string }) => Record<string, unknown>;
        };
      };
    }
  )["~standard"]?.jsonSchema;
  if (converter?.input === undefined) return undefined;
  try {
    const json: Record<string, unknown> = { ...converter.input({ target: "draft-2020-12" }) };
    delete json["$schema"];
    return json;
  } catch {
    return undefined;
  }
}

/** Render issues as a single human-readable line for an error message. */
export function formatIssues(issues: ValidationIssues): string {
  return issues
    .map((issue) => {
      const path = issue.path
        ?.map((segment) => (typeof segment === "object" ? segment.key : segment))
        .join(".");
      return path !== undefined && path !== "" ? `${path}: ${issue.message}` : issue.message;
    })
    .join("; ");
}

/**
 * Build a Standard Schema from a plain validate function. Used by the parameter
 * derivation (ADR-0003) to package a derived validator and by tests; keeps the
 * `~standard` shape in one place.
 */
export function makeStandardSchema<Output>(
  validate: (
    input: unknown,
  ) => StandardSchemaV1.Result<Output> | Promise<StandardSchemaV1.Result<Output>>,
  vendor = "microfoom",
): StandardSchemaV1<unknown, Output> {
  return {
    "~standard": {
      version: 1,
      vendor,
      validate,
    },
  };
}
