import { args } from "unigent-sdk";
import { z } from "zod";

const Input = z.object({
  topic: z.string().min(3).describe("Topic to research"),
  owner: z.string().min(1),
  depth: z.enum(["quick", "thorough"]),
  rounds: z.number().int().positive().default(3),
  tags: z.array(z.string().min(1)).min(1),
  destination: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("file"), path: z.string().min(1) }),
    z.object({ kind: z.literal("port"), port: z.number().int().positive() }),
  ]),
});

const input = await args(Input);
process.stdout.write(`INTERACTIVE INPUT: ${JSON.stringify(input)}\n`);
