// A hello-world microfoom program. TypeScript orchestrates; the model does only
// the fuzzy bit (writing the greeting) and returns it through the structured
// channel (FOOMRETURN), schema-validated.
//
// Run it:
//   pnpm run example            # greets "world"
//   pnpm run example -- Ada     # greets "Ada"
// (needs a model + API key in ~/.pi; see examples/README.md)

import { foom, makeStandardSchema, Program } from "@microfoom/core";

const name = makeStandardSchema<string>((input) =>
  typeof input === "string" ? { value: input } : { issues: [{ message: "name must be a string" }] },
);

const greeting = makeStandardSchema<string>((input) =>
  typeof input === "string"
    ? { value: input }
    : { issues: [{ message: "greeting must be a string" }] },
);

@foom.config({
  model: process.env.MICROFOOM_MODEL ?? "openrouter/deepseek/deepseek-v4-flash",
  thinking: "low",
})
export default class Hello extends Program<typeof name, string>(name) {
  async main(who: string): Promise<string> {
    return await this.agent.value(greeting)`
      Call the foom_return tool with a warm, one-sentence greeting for ${who}.
      Respond ONLY with the foom_return tool call — no prose.
    `;
  }
}
