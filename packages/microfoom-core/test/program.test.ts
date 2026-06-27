import { fileURLToPath } from "node:url";
import type { StandardSchemaV1 } from "@standard-schema/spec";
import { describe, expect, it } from "vitest";
import { CONTROL_TOOLS, foom, Program, runProgram } from "../src/index.ts";
import { makeStandardSchema } from "../src/standard_schema.ts";
import { type FakeRound, fakeOpenSession } from "./fake_session.ts";
import { Calc } from "./fixtures/calc_program.ts";

const numberSchema: StandardSchemaV1<unknown, number> = makeStandardSchema((input) =>
  typeof input === "number" ? { value: input } : { issues: [{ message: "expected a number" }] },
);
const stringInput: StandardSchemaV1<unknown, string> = makeStandardSchema((input) =>
  typeof input === "string" ? { value: input } : { issues: [{ message: "expected a string" }] },
);

const callRound = (name: string, args: unknown): FakeRound => ({ call: { name, args } });

describe("program facade (end to end, faux session)", () => {
  it("runs a text turn and returns the prose", async () => {
    class Greeter extends Program<typeof stringInput, string>(stringInput) {
      async main(who: string): Promise<string> {
        return await this.agent.text`Say hi to ${who}.`;
      }
    }
    const out = await runProgram(Greeter, "sam", {
      openSession: fakeOpenSession([{ text: "hi sam" }]),
      model: "fake",
    });
    expect(out).toBe("hi sam");
  });

  it("runs a value turn validated against the schema", async () => {
    class Picker extends Program<typeof stringInput, number>(stringInput) {
      async main(): Promise<number> {
        return await this.agent.value(numberSchema)`Pick a number.`;
      }
    }
    const out = await runProgram(Picker, "x", {
      openSession: fakeOpenSession([callRound(CONTROL_TOOLS.return, { value: 9 })]),
      model: "fake",
    });
    expect(out).toBe(9);
  });

  it("takes the model from class @foom.config when run options omit it", async () => {
    @foom.config({ model: "from-class" })
    class Configured extends Program<typeof stringInput, string>(stringInput) {
      async main(): Promise<string> {
        return await this.agent.text`hello`;
      }
    }
    const out = await runProgram(Configured, "x", {
      openSession: fakeOpenSession([{ text: "ok" }]),
      model: "fallback",
    });
    expect(out).toBe("ok");
  });

  it("dispatches a FOOMCALL into an exposed method (with derived schema)", async () => {
    const sourceFile = fileURLToPath(new URL("./fixtures/calc_program.ts", import.meta.url));
    const out = await runProgram(Calc, 21, {
      openSession: fakeOpenSession([
        callRound(CONTROL_TOOLS.call, { method: "double", arguments: { n: 21 } }),
        callRound(CONTROL_TOOLS.return, { value: 42 }),
      ]),
      model: "fake",
      sourceFile,
      className: "Calc",
    });
    expect(out).toBe(42);
  });

  it("repairs an invalid return then succeeds", async () => {
    class Picker extends Program<typeof stringInput, number>(stringInput) {
      async main(): Promise<number> {
        return await this.agent.value(numberSchema)`Pick.`;
      }
    }
    const out = await runProgram(Picker, "x", {
      openSession: fakeOpenSession([
        callRound(CONTROL_TOOLS.return, { value: "not a number" }),
        callRound(CONTROL_TOOLS.return, { value: 5 }),
      ]),
      model: "fake",
    });
    expect(out).toBe(5);
  });

  it("surfaces FOOMTHROW as a thrown FoomtimeThrowError carrying the code", async () => {
    class Thrower extends Program<typeof stringInput, number>(stringInput) {
      async main(): Promise<number> {
        return await this.agent.value(numberSchema)`fail please`;
      }
    }
    await expect(
      runProgram(Thrower, "x", {
        openSession: fakeOpenSession([
          callRound(CONTROL_TOOLS.throw, { message: "nope", code: "E_NOPE" }),
        ]),
        model: "fake",
      }),
    ).rejects.toMatchObject({ name: "FoomtimeThrowError", code: "E_NOPE" });
  });

  it("runs a stateful session across turns", async () => {
    class Chat extends Program<typeof stringInput, number>(stringInput) {
      async main(): Promise<number> {
        const session = this.agent.session();
        await session.text`Explain random numbers.`;
        return await session.value(numberSchema)`Now give one.`;
      }
    }
    const out = await runProgram(Chat, "x", {
      openSession: fakeOpenSession([
        { text: "a random number is..." },
        callRound(CONTROL_TOOLS.return, { value: 4 }),
      ]),
      model: "fake",
    });
    expect(out).toBe(4);
  });
});
