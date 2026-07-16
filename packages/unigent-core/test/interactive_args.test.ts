import type { StandardSchemaV1 } from "@standard-schema/spec";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { parseArgs } from "../src/args.ts";
import { parseInteractiveArgs } from "../src/interactive_args.ts";
import type { InteractivePrompt } from "../src/interactive_terminal.ts";

class ScriptedPrompt implements InteractivePrompt {
  readonly #responses: string[];
  public transcript = "";

  public constructor(responses: readonly string[]) {
    this.#responses = [...responses];
  }

  public async ask(prompt: string): Promise<string> {
    this.transcript += prompt;
    const response = this.#responses.shift();
    if (response === undefined) {
      throw new Error(`missing scripted response for: ${prompt}`);
    }
    this.transcript += `${response}\n`;
    return response;
  }

  public write(message: string): void {
    this.transcript += message;
  }

  public close(): void {
    // Scripted prompts hold no operating-system resources.
  }

  public expectComplete(): void {
    expect(this.#responses).toEqual([]);
  }
}

async function collect<Output>(
  schema: StandardSchemaV1<unknown, Output>,
  arguments_: readonly string[],
  responses: readonly string[],
): Promise<{ readonly output: Output; readonly transcript: string }> {
  const prompt = new ScriptedPrompt(responses);
  const output = await parseInteractiveArgs(
    arguments_,
    schema,
    prompt,
    async (): Promise<Output> => await parseArgs(arguments_, schema),
  );
  prompt.expectComplete();
  return { output, transcript: prompt.transcript };
}

describe("interactive script arguments", () => {
  it("uses optional descriptions, falls back to paths, and skips defaults", async () => {
    const result = await collect(
      z.object({
        topic: z.string().min(1).describe("Topic to research"),
        owner: z.string(),
        depth: z.enum(["quick", "thorough"]),
        rounds: z.number().int().positive().default(3),
      }),
      ["--depth", "quick"],
      ["TypeScript agents", "Ada"],
    );

    expect(result.output).toEqual({
      topic: "TypeScript agents",
      owner: "Ada",
      depth: "quick",
      rounds: 3,
    });
    expect(result.transcript).toContain("--topic (Topic to research): ");
    expect(result.transcript).toContain("--owner: ");
    expect(result.transcript).not.toContain("rounds");
    expect(result.transcript).not.toContain("depth:");
  });

  it("collects nested objects, arrays of objects, booleans, and integers", async () => {
    const result = await collect(
      z.object({
        profile: z.object({ name: z.string() }),
        items: z.array(z.object({ label: z.string() })).min(1),
        approved: z.boolean(),
        count: z.number().int(),
      }),
      [],
      ["Ada", "", "first", "", "yes", "4"],
    );

    expect(result.output).toEqual({
      profile: { name: "Ada" },
      items: [{ label: "first" }],
      approved: true,
      count: 4,
    });
    expect(result.transcript).toContain("--profile.name: ");
    expect(result.transcript).toContain("Add an item to --items? [Y/n]: ");
    expect(result.transcript).toContain("--items.0.label: ");
    expect(result.transcript).toContain("--approved [y/n]: ");
  });

  it("selects a discriminated union and prompts only for that branch", async () => {
    const result = await collect(
      z.object({
        destination: z.discriminatedUnion("kind", [
          z.object({ kind: z.literal("file"), path: z.string() }),
          z.object({ kind: z.literal("port"), port: z.number().int() }),
        ]),
      }),
      [],
      ["2", "8080"],
    );

    expect(result.output).toEqual({ destination: { kind: "port", port: 8080 } });
    expect(result.transcript).toContain("1. file");
    expect(result.transcript).toContain("2. port");
    expect(result.transcript).toContain("--destination.port: ");
    expect(result.transcript).not.toContain("destination.path");
  });

  it("preserves explicit fields while selecting a missing union discriminator", async () => {
    const result = await collect(
      z.discriminatedUnion("kind", [
        z.object({ kind: z.literal("file"), path: z.string() }),
        z.object({ kind: z.literal("port"), port: z.number().int() }),
      ]),
      ["--path", "/tmp/result.json"],
      ["1"],
    );

    expect(result.output).toEqual({ kind: "file", path: "/tmp/result.json" });
    expect(result.transcript).toContain("1. file");
    expect(result.transcript).not.toContain("path: ");
  });

  it("honors array bounds while collecting items", async () => {
    const result = await collect(z.array(z.string()).min(1).max(1), [], ["", "only"]);

    expect(result.output).toEqual(["only"]);
    expect(result.transcript.match(/Add an item/gu)).toHaveLength(1);
  });

  it("uses validated JSON for an ambiguous union", async () => {
    const result = await collect(z.union([z.string(), z.number()]), [], ['"hello"']);

    expect(result.output).toBe("hello");
    expect(result.transcript).toContain("Input (JSON): ");
  });

  it("retries prompted values using the original schema validation", async () => {
    const result = await collect(z.string().min(3), [], ["x", "valid"]);

    expect(result.output).toBe("valid");
    expect(result.transcript).toContain("Invalid Input:");
    expect(result.transcript.match(/(?:^|\n)Input: /gu)).toHaveLength(2);
  });

  it("falls back to whole-input JSON for cross-field validation", async () => {
    const result = await collect(
      z
        .object({ first: z.string(), second: z.string() })
        .refine((value) => value.first !== value.second, "values must differ"),
      [],
      ["same", "same", '{"first":"one","second":"two"}'],
    );

    expect(result.output).toEqual({ first: "one", second: "two" });
    expect(result.transcript).toContain("Invalid Input: values must differ");
    expect(result.transcript).toContain("Input (JSON): ");
  });

  it("rejects invalid explicit values before asking for missing fields", async () => {
    const prompt = new ScriptedPrompt([]);
    const schema = z.object({ count: z.number(), name: z.string() });

    await expect(
      parseInteractiveArgs(
        ["--count", "nope"],
        schema,
        prompt,
        async () => await parseArgs(["--count", "nope"], schema),
      ),
    ).rejects.toThrow("count");
    expect(prompt.transcript).toBe("");
  });

  it("falls back to complete JSON when a Standard Schema cannot project its shape", async () => {
    const zodSchema = z.object({ name: z.string() });
    const { validate, vendor, version } = zodSchema["~standard"];
    const standardOnly: StandardSchemaV1<unknown, { name: string }> = {
      "~standard": { validate, vendor, version },
    };
    const result = await collect(standardOnly, [], ['{"name":"Ada"}']);

    expect(result.output).toEqual({ name: "Ada" });
    expect(result.transcript).toContain("Input (JSON): ");
  });
});
