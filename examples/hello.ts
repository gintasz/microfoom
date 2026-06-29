// A hello-world microfoom program. TypeScript orchestrates; the model does only
// the fuzzy bit (writing the greeting) and returns it through the structured
// channel (foom_return), schema-validated.
//
// Schemas are any Standard Schema (F4) — here plain zod. The library depends on
// no validator; you bring your own (zod is just a dev/example dependency).
//
// Run it:
//   pnpm run example -- Ada            # greets "Ada"
//   microfoom run examples/hello.ts Ada
// (needs a model + API key in ~/.pi; see examples/README.md)

import process from "node:process";
import { foom, Program } from "@microfoom/core";
import { z } from "zod";

const name = z.string();

@foom.config({
  model: process.env.MICROFOOM_MODEL ?? "openrouter/deepseek/deepseek-v4-flash",
  thinking: "low",
})
export default class Hello extends Program(name) {
  async main(who: string): Promise<string> {
    return await this.agent.value(z.string())`a warm, one-sentence greeting for ${who}`;
  }
}
