import type { StandardSchemaV1 } from "@standard-schema/spec";
import { describe, expect, it } from "vitest";
import { CONTROL_TOOLS, Program, runProgram } from "../src/index.ts";
import { makeStandardSchema } from "../src/standard_schema.ts";
import { fakeHarness } from "./fake_session.ts";
// Importing the trace entry augments AgentProgramContext with scope/onEvent/export.
import "../src/trace/index.ts";
import { type AgentEvent, formatEvent } from "../src/trace/index.ts";

const numberSchema: StandardSchemaV1<unknown, number> = makeStandardSchema((input) =>
  typeof input === "number" ? { value: input } : { issues: [{ message: "number" }] },
);
const inputSchema: StandardSchemaV1<unknown, string> = makeStandardSchema((input) =>
  typeof input === "string" ? { value: input } : { issues: [{ message: "string" }] },
);

describe("trace entry (F8, opt-in)", () => {
  it("delivers intrinsic events to onEvent and span ops", async () => {
    const events: AgentEvent[] = [];
    class Traced extends Program<typeof inputSchema, number>(inputSchema) {
      async main(): Promise<number> {
        this.agent.onEvent((event) => events.push(event));
        const span = this.agent.scope("audit");
        span.annotate({ routes: 3 });
        span.log("auditing");
        return await this.agent.value(numberSchema)`pick`;
      }
    }
    const out = await runProgram(Traced, "x", {
      harnesses: fakeHarness([{ call: { name: CONTROL_TOOLS.return, args: { value: 5 } } }]),
      model: "fake",
    });
    expect(out).toBe(5);
    expect(events.map((event) => event.type)).toEqual(
      expect.arrayContaining(["span_start", "annotate", "log", "turn_start"]),
    );
  });

  it("renders events to human-readable lines (OB1)", () => {
    expect(formatEvent({ type: "foom_call", span: "s1", method: "double" })).toBe(
      "· s1 foom_call double",
    );
    expect(formatEvent({ type: "log", span: "s1", message: "hi", level: "warn" })).toBe(
      "[warn] s1 hi",
    );
  });
});
