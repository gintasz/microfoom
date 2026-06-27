// A deliberately multi-stage program to exercise the full observability surface
// (F8) and the CLI run panel. It produces a deep span tree:
//
//   ▼ main
//     ▸ intro                 (sequential turn)
//     ▼ audit   routeCount=3  (scope: annotate + log + concurrent child turns)
//       ▸ /login              (concurrent labeled turns under the scope)
//       ▸ /signup
//       ▸ /reset
//       ▼ deep-check          (nested scope)
//         ▸ /login
//       • 3 routes audited    (scope log line)
//     ▸ value                 (a turn whose agent foom_calls score() → method span)
//     ▸ text                  (final streamed summary turn)
//
// Every value turn is string-typed so it also runs under `microfoom … --faux`
// (the faux session returns strings). Run it:
//   microfoom run examples/audit.ts "acme.com"
//   pnpm cli examples/audit.ts "acme.com" --faux        # offline, deterministic

import { foom, makeStandardSchema, Program } from "@microfoom/core";

const site = makeStandardSchema<string>((input) =>
  typeof input === "string" ? { value: input } : { issues: [{ message: "site must be a string" }] },
);

const line = makeStandardSchema<string>((input) =>
  typeof input === "string" ? { value: input } : { issues: [{ message: "expected a string" }] },
);

@foom.config({
  model: process.env.MICROFOOM_MODEL ?? "openrouter/deepseek/deepseek-v4-flash",
  thinking: "low",
})
export default class Audit extends Program<typeof site, string>(site) {
  async main(target: string): Promise<string> {
    // 1) A plain sequential turn.
    const intro = await this.agent.value(line)`
      One short sentence introducing a security audit of ${target}.
      Respond ONLY with the foom_return tool call carrying that sentence.
    `;

    // 2) A named scope: annotate it, fan out concurrent labeled child turns, then
    // log. Each route turn (and the nested scope) nests under "audit" in the panel.
    const routes = ["/login", "/signup", "/reset"];
    const audit = this.agent.scope("audit");
    audit.annotate({ routeCount: routes.length });

    const findings = await Promise.all(
      routes.map(
        (route) => audit.with({ label: route }).value(line)`
          Give a one-line finding about missing authentication on the ${route} route
          of ${target}. Respond ONLY with the foom_return tool call.
        `,
      ),
    );

    // A nested scope under "audit" — re-checks the riskiest route, one level deeper.
    const deep = audit.scope("deep-check");
    const recheck = await deep.with({ label: routes[0] }).value(line)`
      Re-examine ${routes[0]} for auth bypass specifically. One line.
      Respond ONLY with the foom_return tool call.
    `;
    audit.log(`${findings.length} routes audited`);

    // 3) A turn that asks the agent to call an exposed method (a foom_call → its
    // own method span in the tree), then return a string verdict.
    const verdict = await this.agent.value(line)`
      Call score with findingCount=${findings.length} to get a numeric risk score,
      then foom_return a one-line verdict that includes that score.
    `;

    // 4) A final streamed text turn that composes the report.
    return await this.agent.text`
      Write a two-sentence security audit summary for ${target}.
      Intro: ${intro}
      Findings: ${[...findings, recheck].join(" | ")}
      Verdict: ${verdict}
    `;
  }

  // Exposed so the agent may foom_call it (capability security, F3). Pure TS — a
  // deterministic risk score from the finding count.
  @foom.expose({ announcement: "Returns a 0–100 risk score for a given finding count." })
  async score(findingCount: number): Promise<number> {
    return Math.min(100, findingCount * 25);
  }
}
