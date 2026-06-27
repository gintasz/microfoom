import type { StandardSchemaV1 } from "@standard-schema/spec";
import { foom, Program } from "../../src/index.ts";
import { makeStandardSchema } from "../../src/standard_schema.ts";

const numberSchema: StandardSchemaV1<unknown, number> = makeStandardSchema((input) =>
  typeof input === "number" ? { value: input } : { issues: [{ message: "expected a number" }] },
);

const inputSchema: StandardSchemaV1<unknown, number> = makeStandardSchema((input) =>
  typeof input === "number" ? { value: input } : { issues: [{ message: "expected a number" }] },
);

export class Calc extends Program<typeof inputSchema, number>(inputSchema) {
  async main(seed: number): Promise<number> {
    return await this.agent.value(
      numberSchema,
    )`Double ${seed} with the double tool, then foom_return it.`;
  }

  @foom.expose({ tool: { description: "Doubles an integer." } })
  async double(n: number): Promise<number> {
    return n * 2;
  }
}
