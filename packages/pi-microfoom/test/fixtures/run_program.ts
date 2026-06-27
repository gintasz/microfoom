import { makeStandardSchema, Program } from "@microfoom/core";

const schema = makeStandardSchema<number>((input) =>
  typeof input === "number" ? { value: input } : { issues: [{ message: "expected a number" }] },
);

// Default-exported program loaded by /microfoom-run.
export default class Doubler extends Program<typeof schema, number>(schema) {
  async main(seed: number): Promise<number> {
    return await this.agent.value(schema)`Double ${seed} and foom_return it.`;
  }
}
