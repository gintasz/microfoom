import { fileURLToPath } from "node:url";
import type { StandardSchemaV1 } from "@standard-schema/spec";
import { describe, expect, it } from "vitest";
import { deriveMethodParameters } from "../src/schema_derive.ts";

const fixture = fileURLToPath(new URL("./fixtures/sample_program.ts", import.meta.url));

const validate = (schema: StandardSchemaV1<unknown, unknown>, input: unknown) =>
  schema["~standard"].validate(input) as StandardSchemaV1.Result<unknown>;

describe("parameter-schema derivation (ADR-0003)", () => {
  it("derives a JSON Schema of primitive params from the TS signature", () => {
    const { jsonSchema, paramNames } = deriveMethodParameters(fixture, "Sample", "gen");
    expect(paramNames).toEqual(["min", "max"]);
    expect(jsonSchema).toEqual({
      type: "object",
      properties: { min: { type: "number" }, max: { type: "number" } },
      required: ["min", "max"],
      additionalProperties: false,
    });
  });

  it("marks optional params as not required", () => {
    const { jsonSchema } = deriveMethodParameters(fixture, "Sample", "greet");
    expect(jsonSchema["required"]).toEqual(["name"]);
    expect((jsonSchema["properties"] as Record<string, unknown>)["loud"]).toEqual({
      type: "boolean",
    });
  });

  it("derives a literal union as an enum", () => {
    const { jsonSchema } = deriveMethodParameters(fixture, "Sample", "pick");
    expect((jsonSchema["properties"] as Record<string, unknown>)["choice"]).toEqual({
      enum: ["a", "b", "c"],
    });
  });

  it("derives arrays and object params", () => {
    const sum = deriveMethodParameters(fixture, "Sample", "sum");
    expect((sum.jsonSchema["properties"] as Record<string, unknown>)["values"]).toEqual({
      type: "array",
      items: { type: "number" },
    });
    const configure = deriveMethodParameters(fixture, "Sample", "configure");
    expect((configure.jsonSchema["properties"] as Record<string, unknown>)["options"]).toEqual({
      type: "object",
      properties: { id: { type: "string" }, count: { type: "number" } },
      required: ["id", "count"],
      additionalProperties: false,
    });
  });

  it("validates call arguments against the derived Standard Schema", () => {
    const { schema } = deriveMethodParameters(fixture, "Sample", "gen");
    expect(validate(schema, { min: 1, max: 2 }).issues).toBeUndefined();
    expect(validate(schema, { min: "x", max: 2 }).issues).toBeDefined();
    expect(validate(schema, { min: 1 }).issues).toBeDefined();
  });
});
