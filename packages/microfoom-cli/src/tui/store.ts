// The TUI's data source. The bun TUI process runs the program in-process (so the
// terminal stdin stays free for OpenTUI's keyboard/mouse input) and pushes the
// run's event stream here. React reads an immutable snapshot via
// useSyncExternalStore. The program finishing does NOT close the TUI — `status`
// flips to done/error and the view stays up until the user quits.

import type { AgentEvent } from "@microfoom/core/trace";

export interface RunMeta {
  readonly file: string;
  readonly model: string;
  readonly harness: string;
  readonly input: string;
}

export interface TuiSnapshot {
  readonly meta: RunMeta | undefined;
  readonly events: readonly AgentEvent[];
  readonly status: "running" | "done" | "error";
  readonly result: string | undefined;
  readonly error: string | undefined;
}

export interface TuiStore {
  subscribe(listener: () => void): () => void;
  getSnapshot(): TuiSnapshot;
  /** Feed one run event (coalesced into the next render tick). */
  push(event: AgentEvent): void;
  /** Set run metadata (header). */
  setMeta(meta: RunMeta): void;
  /** Mark the run settled; the view stays up. */
  done(result: string | undefined, error: string | undefined): void;
}

const COALESCE_MS = 30;

export function createStore(): TuiStore {
  let meta: RunMeta | undefined;
  const events: AgentEvent[] = [];
  let status: TuiSnapshot["status"] = "running";
  let result: string | undefined;
  let error: string | undefined;

  let snapshot: TuiSnapshot = { meta, events, status, result, error };
  const listeners = new Set<() => void>();
  let timer: ReturnType<typeof setTimeout> | undefined;

  const rebuild = (): void => {
    snapshot = { meta, events: events.slice(), status, result, error };
    for (const listener of listeners) listener();
  };
  // Coalesce bursts of stream deltas into one render tick.
  const schedule = (): void => {
    if (timer === undefined) timer = setTimeout(flush, COALESCE_MS);
  };
  const flush = (): void => {
    timer = undefined;
    rebuild();
  };

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot() {
      return snapshot;
    },
    push(event) {
      events.push(event);
      schedule();
    },
    setMeta(next) {
      meta = next;
      rebuild();
    },
    done(nextResult, nextError) {
      status = nextError !== undefined ? "error" : "done";
      result = nextResult;
      error = nextError;
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
      rebuild();
    },
  };
}
