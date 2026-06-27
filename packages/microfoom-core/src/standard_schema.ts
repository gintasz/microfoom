// Standard Schema (F4) is the one validation contract — the library commits to no
// concrete validator. Returns are validated against the caller's schema; method
// arguments against the schema the derivation emits (ADR-0003). The tool handlers
// call a schema's `validate` directly (sync or async) and use `formatIssues` to
// render failures back to the model.

import type { StandardSchemaV1 } from "@standard-schema/spec";

/** The issues a failed validation reports. */
export type ValidationIssues = readonly StandardSchemaV1.Issue[];

/** Render issues as a single human-readable line for an error message. */
export function formatIssues(issues: ValidationIssues): string {
  return issues
    .map((issue) => {
      const path = issue.path
        ?.map((segment) => (typeof segment === "object" ? segment.key : segment))
        .join(".");
      return path ? `${path}: ${issue.message}` : issue.message;
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
