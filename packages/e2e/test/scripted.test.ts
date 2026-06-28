// Deterministic, offline behavior suite: every fixture's scripted tier driven
// through the real harness adapter over a faux provider. Runs in `check` (no
// network, no credentials, no cost). The same fixtures run against the live model
// in e2e.test.ts.

import { describe, it } from "vitest";
import { adapters } from "./support/adapters.ts";
import { fixtures } from "./support/fixtures.ts";

for (const adapter of adapters) {
  describe(`microfoom runtime behavior — ${adapter.name} (scripted)`, () => {
    for (const fixture of fixtures) {
      if (!fixture.tiers.includes("scripted")) continue;
      it(fixture.name, async () => {
        await fixture.exec(adapter.scripted(fixture.script), "scripted");
      });
    }
  });
}
