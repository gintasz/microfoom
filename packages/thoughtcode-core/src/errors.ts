/**
 * A VIBEFUNCTION deliberately aborting via VIBETHROW (or a limit breach surfaced as a throw). Distinct
 * from a generic Error so the VIBECALL boundary can tell an intentional program throw apart from an
 * infrastructure failure. A language-level concept — harness-agnostic.
 */
export class VibeThrowError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VibeThrowError";
  }
}
