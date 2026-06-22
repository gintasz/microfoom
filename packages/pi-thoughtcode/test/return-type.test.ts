import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { extractReturnType } from "thoughtcode-core";
import { describe, expect, it } from "vitest";
import { checkReturnValue, createVibeReturnTool, isParsableReturnType, normalizeReturnType, resolveReturnType } from "../dist/index.js";

const SCRATCH_DIR = "/tmp/agentic_coding";

async function writeProgram(contents: string): Promise<{ dir: string; file: string }> {
  const dir = await mkdtemp(join(SCRATCH_DIR, "thoughtcode-rt-"));
  const file = join(dir, "program.txt");
  await writeFile(file, contents);
  return { dir, file };
}

const TYPED_PROGRAM = [
  "# program",
  "VIBEFUNCTION main()",
  "    res = VIBECALL fac(n = 2)",
  "    VIBERETURN(res)",
  "",
  "VIBEFUNCTION fac(n: number) -> int",
  "    VIBERETURN(hello)",
  "",
  "VIBEFUNCTION bogus() -> intfaketype",
  "    VIBERETURN(x)",
].join("\n");

describe("resolveReturnType (file → extract → validate wiring)", () => {
  it("resolves a valid annotation from the program file", async () => {
    const { file } = await writeProgram(TYPED_PROGRAM);
    expect(await resolveReturnType(file, "fac", undefined)).toEqual({ status: "ok", type: "int" });
  });

  it("reports an unrecognized annotation as invalid (the intfaketype bug)", async () => {
    const { file } = await writeProgram(TYPED_PROGRAM);
    expect(await resolveReturnType(file, "bogus", undefined)).toEqual({ status: "invalid", annotation: "intfaketype" });
  });

  it("reports none when the function has no annotation", async () => {
    const { file } = await writeProgram(TYPED_PROGRAM);
    expect(await resolveReturnType(file, "main", undefined)).toEqual({ status: "none" });
  });

  it("resolves a relative path against cwd", async () => {
    const { dir } = await writeProgram(TYPED_PROGRAM);
    expect(await resolveReturnType("program.txt", "fac", dir)).toEqual({ status: "ok", type: "int" });
  });

  it("reports unreadable when the file is missing", async () => {
    expect(await resolveReturnType("/no/such/program.txt", "fac", undefined)).toEqual({ status: "unreadable" });
  });
});

describe("return-type synonyms", () => {
  it("maps friendly aliases to ArkType keywords", () => {
    expect(normalizeReturnType("int")).toBe("number.integer");
    expect(normalizeReturnType("str")).toBe("string");
    expect(normalizeReturnType("bool")).toBe("boolean");
    expect(normalizeReturnType("int[]")).toBe("number.integer[]");
    expect(normalizeReturnType('{ "r": "int" }')).toBe('{ "r": "number.integer" }');
  });

  it("does not clobber already-valid dotted keywords", () => {
    expect(normalizeReturnType("number.integer")).toBe("number.integer");
  });

  it("enforces the synonym at check time (the `int` bug)", () => {
    expect(checkReturnValue("hello", "int").ok).toBe(false);
    expect(checkReturnValue("2", "int")).toEqual({ ok: true });
    expect(checkReturnValue("2.5", "int").ok).toBe(false);
  });

  it("reports parsability for warning surfacing", () => {
    expect(isParsableReturnType("int")).toBe(true);
    expect(isParsableReturnType("number.integer")).toBe(true);
    expect(isParsableReturnType("@@@ not a type")).toBe(false);
  });
});

describe("extractReturnType", () => {
  const program = [
    "# program",
    "VIBEFUNCTION main()",
    "VIBEFUNCTION fac(n: number) -> number.integer",
    'VIBEFUNCTION shape(x) -> { "result": "number", "data": "string" }',
  ].join("\n");

  it("extracts a scalar annotation", () => {
    expect(extractReturnType(program, "fac")).toBe("number.integer");
  });

  it("extracts a structural (JSON) annotation", () => {
    expect(extractReturnType(program, "shape")).toBe('{ "result": "number", "data": "string" }');
  });

  it("returns undefined when the function has no annotation", () => {
    expect(extractReturnType(program, "main")).toBeUndefined();
  });

  it("returns undefined when the function is absent", () => {
    expect(extractReturnType(program, "missing")).toBeUndefined();
  });
});

describe("checkReturnValue", () => {
  it("accepts a matching integer", () => {
    expect(checkReturnValue("2", "number.integer")).toEqual({ ok: true });
  });

  it("rejects a non-integer", () => {
    const result = checkReturnValue("2.5", "number.integer");
    expect(result.ok).toBe(false);
  });

  it("rejects prose for a numeric type", () => {
    const result = checkReturnValue("The answer is 2", "number.integer");
    expect(result.ok).toBe(false);
  });

  it("accepts a matching union literal", () => {
    expect(checkReturnValue("ok", '"ok" | "fail"')).toEqual({ ok: true });
  });

  it("validates structural JSON returns", () => {
    expect(checkReturnValue('{"result":2,"data":"x"}', '{ "result": "number", "data": "string" }')).toEqual({ ok: true });
    expect(checkReturnValue('{"result":"two","data":"x"}', '{ "result": "number", "data": "string" }').ok).toBe(false);
  });

  it("treats a malformed annotation as no constraint", () => {
    expect(checkReturnValue("anything", "@@@ not a type @@@")).toEqual({ ok: true });
  });
});

describe("createVibeReturnTool type enforcement", () => {
  it("accepts a correctly typed value immediately", async () => {
    let returned: string | undefined;
    const tool = createVibeReturnTool({ returnType: "number.integer", onVibeReturn: (v) => (returned = v) });
    const result = await tool.execute("c1", { value: "2" });
    expect(returned).toBe("2");
    expect(result.details).toEqual({ kind: "vibereturn", value: "2" });
  });

  it("throws on a type mismatch so the agent retries", async () => {
    const tool = createVibeReturnTool({ returnType: "number.integer", onVibeReturn: () => {} });
    await expect(tool.execute("c1", { value: "not a number" })).rejects.toThrow(/declared return type/);
  });

  it("stops rejecting after the failure cap to avoid an infinite loop", async () => {
    let returned: string | undefined;
    const tool = createVibeReturnTool({ returnType: "number.integer", onVibeReturn: (v) => (returned = v) });
    // 3 rejected attempts (the cap), then the 4th is accepted despite being wrong.
    for (let i = 0; i < 3; i += 1) {
      await expect(tool.execute("c1", { value: "bad" })).rejects.toThrow();
    }
    const result = await tool.execute("c1", { value: "bad" });
    expect(returned).toBe("bad");
    expect(result.details).toEqual({ kind: "vibereturn", value: "bad" });
  });

  it("skips checking entirely when no return type is declared", async () => {
    let returned: string | undefined;
    const tool = createVibeReturnTool({ onVibeReturn: (v) => (returned = v) });
    await tool.execute("c1", { value: "anything goes" });
    expect(returned).toBe("anything goes");
  });
});
