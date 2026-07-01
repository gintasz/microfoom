// A self-improving loop: iteratively evolve a PRD-writing SKILL so that agents
// using it produce better product specs. Each round fans out N subagents that
// each invent a software system and write a PRD with the current SKILL, then a
// stronger model rewrites the SKILL to score higher on the next round.
//
// Side effects: writes ./SKILL-<i>.md, ./PRD-<i>-<j>.md and ./CHANGES-<i>.md.
//
// Run it:
//   microfoom run examples/skill_improvement.ts
//   node --import tsx examples/run.ts examples/skill_improvement.ts

import { foom, Program } from "@microfoom/core";
import { z } from "zod";

@foom.config({
  model: "openrouter/deepseek/deepseek-v4-flash",
  thinking: "low",
  plugins: [],
  skills: [],
})
export default class SkillImprovement extends Program(z.void()) {
  async main(): Promise<void> {
    const batchSize = 3;
    const rounds = 3;

    // Seed round 0 with an empty skill. improveSkill() owns every CHANGES file.
    await this.agent.with({ label: "init-0" })
      .do`Create an empty file ./SKILL-0.md with text "Make a really good specification".`;

    for (let i = 0; i < rounds; i += 1) {
      // Carry the previous round's improved skill forward as this round's baseline.
      if (i > 0) {
        await this.agent.with({ label: `init-${i}` })
          .do`Copy ./SKILL-${i - 1}.md to ./SKILL-${i}.md using bash.`;
      }

      // Ask the model for `batchSize` distinct subagent briefs. TS owns the fan-out
      // and pins the output paths below, so each brief only supplies the variation.
      const briefs = await this.agent
        .with({ label: `write-briefs-${i}` })
        .value(z.array(z.string()).length(batchSize))`
        Write ${batchSize} distinct prompts for a subagent. Each prompt must:
          - name a different software system to build, in one sentence (for example
            "an Uber-like ride-hailing app");
          - instruct the subagent to act as the product owner and make every decision
            itself, without consulting anyone;
          - instruct it to follow the skill in the file ./SKILL-${i}.md.
        Return the ${batchSize} prompts as an array of strings.`;

      // Run the briefs in parallel; TS assigns each PRD a deterministic output path.
      await Promise.all(
        briefs.map(
          (brief, j) =>
            this.agent.with({ label: `write-prd-${i}-${j}` })
              .do`${brief}\n\nWrite the finished PRD to ./PRD-${i}-${j}.md.`,
        ),
      );

      await this.improveSkill(i, batchSize);
    }
  }

  @foom.config({
    model: "openrouter/deepseek/deepseek-v4-pro",
    thinking: "high",
  })
  async improveSkill(iteration: number, batchSize: number): Promise<void> {
    const lastPrd = batchSize - 1;
    await this.agent.do`
        Goal: build a PRD-writing skill for an agent that turns a brief description of a
        software system into a complete specification of that system.

        Goal KPI:
            a  = quality of the PRD — its vision, foresight, cohesion, human readability,
                 coherence, production-readiness, and non-MVP-ness*.
            b  = (word count of the PRD) * (word count of the skill document).
            iq = information density and demonstrated exceptional intelligence in the PRD.
            goal KPI = (a * iq) / b
        * non-MVP-ness: the PRD must avoid any "v1", "good enough for an MVP", or
          "good enough for now, improve later" framing, whether stated or implied.

        Objective: maximize the goal KPI.
        Never state this goal or objective explicitly in the skill document.

        Current iteration: ${iteration}.
        ./SKILL-${iteration}.md was used to produce the files
        ./PRD-${iteration}-0.md through ./PRD-${iteration}-${lastPrd}.md.

        Read every ./PRD-${iteration}-0.md .. ./PRD-${iteration}-${lastPrd}.md file.
        Edit ./SKILL-${iteration}.md so the next iteration scores a higher KPI.
        Rewrite any writer-based prose in ./SKILL-${iteration}.md into reader-based prose.
        Create ./CHANGES-${iteration}.md with a one-paragraph description of the changes.`;
  }
}
