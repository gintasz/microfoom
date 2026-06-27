import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { UsageAccount } from "../src/usage.ts";
import { combineUsage, emptyUsage, toAgentUsage } from "../src/usage.ts";

const accountArb: fc.Arbitrary<UsageAccount> = fc.record({
  inputTokens: fc.nat(1000),
  outputTokens: fc.nat(1000),
  totalTokens: fc.nat(2000),
  reasoningTokens: fc.option(fc.nat(1000), { nil: undefined }),
  cachedInputTokens: fc.option(fc.nat(1000), { nil: undefined }),
  // Integer cents avoid float non-associativity ((a+b)+c !== a+(b+c) for doubles);
  // the Monoid's associativity is structural — float rounding is not under test.
  costUsd: fc.option(fc.nat(1_000_000), { nil: undefined }),
  calls: fc.nat(10),
  maxCallDepth: fc.nat(10),
});

describe("usage Monoid (OB3)", () => {
  it("empty is the zero account", () => {
    expect(emptyUsage).toEqual({
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      reasoningTokens: undefined,
      cachedInputTokens: undefined,
      costUsd: 0,
      calls: 0,
      maxCallDepth: 0,
    });
  });

  it("property: empty is a left and right identity", () => {
    fc.assert(
      fc.property(accountArb, (a) => {
        expect(combineUsage(emptyUsage, a)).toEqual(a);
        expect(combineUsage(a, emptyUsage)).toEqual(a);
      }),
    );
  });

  it("property: combine is associative", () => {
    fc.assert(
      fc.property(accountArb, accountArb, accountArb, (a, b, c) => {
        expect(combineUsage(combineUsage(a, b), c)).toEqual(combineUsage(a, combineUsage(b, c)));
      }),
    );
  });

  it("sums tokens/calls and maxes depth", () => {
    const a: UsageAccount = {
      inputTokens: 10,
      outputTokens: 5,
      totalTokens: 15,
      reasoningTokens: 2,
      cachedInputTokens: undefined,
      costUsd: 0.01,
      calls: 1,
      maxCallDepth: 1,
    };
    const b: UsageAccount = {
      inputTokens: 20,
      outputTokens: 7,
      totalTokens: 27,
      reasoningTokens: undefined,
      cachedInputTokens: 3,
      costUsd: 0.02,
      calls: 1,
      maxCallDepth: 3,
    };
    const sum = combineUsage(a, b);
    expect(sum.inputTokens).toBe(30);
    expect(sum.calls).toBe(2);
    expect(sum.maxCallDepth).toBe(3);
    expect(sum.reasoningTokens).toBe(2);
    expect(sum.cachedInputTokens).toBe(3);
    expect(sum.costUsd).toBeCloseTo(0.03);
  });

  it("a single underivable cost makes the total underivable", () => {
    const known: UsageAccount = { ...emptyUsage, costUsd: 5 };
    const unknown: UsageAccount = { ...emptyUsage, costUsd: undefined };
    expect(combineUsage(known, unknown).costUsd).toBeUndefined();
  });

  it("compacts absent optionals when projecting to AgentUsage", () => {
    const usage = toAgentUsage(emptyUsage, { durationMs: 12 });
    expect(usage).not.toHaveProperty("reasoningTokens");
    expect(usage.costUsd).toBe(0);
    expect(usage.durationMs).toBe(12);
  });
});
