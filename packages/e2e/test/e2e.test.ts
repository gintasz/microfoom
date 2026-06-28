// Live behavior suite: every fixture's live tier driven through the real harness
// adapter against a real model (resolved from the host's pi config; override with
// MICROFOOM_E2E_MODEL). Excluded from the default `check` run (filename matches the
// vitest e2e exclude); run it with `pnpm test:e2e`.
//
// Skip vs. fail is deliberate: only a harness/provider failure (no credentials,
// connection down) skips — a behavior mismatch is NOT a FoomtimeHarnessError, so a
// real regression in protocol compliance still fails loudly.

import { FoomtimeHarnessError } from "@microfoom/core";
import { describe, it } from "vitest";
import { adapters } from "./support/adapters.ts";
import { fixtures } from "./support/fixtures.ts";

for (const adapter of adapters) {
  describe(`microfoom runtime behavior — ${adapter.name} (live)`, () => {
    for (const fixture of fixtures) {
      if (!fixture.tiers.includes("live")) continue;
      it(fixture.name, async () => {
        try {
          await fixture.exec(adapter.live, "live");
        } catch (error) {
          if (error instanceof FoomtimeHarnessError) {
            console.warn(`[live skipped — provider] ${fixture.name}: ${error.message}`);
            return;
          }
          throw error;
        }
      }, 60_000);
    }
  });
}
