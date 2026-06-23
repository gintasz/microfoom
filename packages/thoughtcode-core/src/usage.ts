// Token/cost usage aggregation, including folding a nested VIBECALL's cumulative usage into its parent.

import type { VibeCallDetails, VibeCallRunRecord, VibeCallUsage } from "./run-record.js";

function emptyUsage(): VibeCallUsage {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 };
}

function addUsage(target: VibeCallUsage, delta: VibeCallUsage): void {
  target.input += delta.input;
  target.output += delta.output;
  target.cacheRead += delta.cacheRead;
  target.cacheWrite += delta.cacheWrite;
  target.cost += delta.cost;
}

function subtractUsage(current: VibeCallUsage, previous: VibeCallUsage | undefined): VibeCallUsage {
  return {
    input: current.input - (previous?.input ?? 0),
    output: current.output - (previous?.output ?? 0),
    cacheRead: current.cacheRead - (previous?.cacheRead ?? 0),
    cacheWrite: current.cacheWrite - (previous?.cacheWrite ?? 0),
    cost: current.cost - (previous?.cost ?? 0),
  };
}

/** Fold a nested VIBECALL's cumulative usage into the parent record (delta-based, no double-count). */
export function addNestedVibeCallUsage(record: VibeCallRunRecord, childDetails: VibeCallDetails): boolean {
  const childUsage = childDetails.progress?.usage;
  if (!childUsage) {
    return false;
  }

  const previousUsage = record.nestedUsageByRunId.get(childDetails.runId);
  const delta = subtractUsage(childUsage, previousUsage);
  if (delta.input === 0 && delta.output === 0 && delta.cacheRead === 0 && delta.cacheWrite === 0 && delta.cost === 0) {
    return false;
  }

  record.progress.usage ??= emptyUsage();
  addUsage(record.progress.usage, delta);
  record.progress.usageCumulative = true;
  record.nestedUsageByRunId.set(childDetails.runId, { ...childUsage });
  return true;
}
