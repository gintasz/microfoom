// macOS-style scroll acceleration for the transcript pane. OpenTUI's ScrollBox
// defaults to linear (1 line per wheel notch), which feels nothing like a trackpad;
// it accepts any object with this `tick()/reset()` shape, so we supply our own
// (OpenTUI's MacOSScrollAccel isn't on its public export surface).
//
// `tick()` returns how many lines to advance for the current wheel event: a relaxed
// gesture stays at the base step (precise), a fast burst ramps the multiplier up.

interface ScrollAccel {
  tick: (now?: number) => number;
  reset: () => void;
}

const DEFAULT_MAX_LINES = 14;
const DEFAULT_STREAK_WINDOW_MS = 160;
const DEFAULT_RAMP_LENGTH = 12;
const EASE_IN_EXPONENT = 1.5;

export interface MacScrollOptions {
  /** Lines advanced for a relaxed (non-accelerating) notch. */
  readonly base?: number;
  /** Max lines advanced at full burst. */
  readonly max?: number;
  /** Notches faster than this (ms apart) accelerate; slower ones reset the streak. */
  readonly streakWindowMs?: number;
  /** Streak length at which the multiplier reaches `max`. */
  readonly rampLength?: number;
}

export class MacScrollAccel implements ScrollAccel {
  private last = 0;
  private streak = 0;
  private readonly base: number;
  private readonly max: number;
  private readonly window: number;
  private readonly ramp: number;

  public constructor(options: MacScrollOptions = {}) {
    this.base = options.base ?? 2;
    this.max = options.max ?? DEFAULT_MAX_LINES;
    this.window = options.streakWindowMs ?? DEFAULT_STREAK_WINDOW_MS;
    this.ramp = options.rampLength ?? DEFAULT_RAMP_LENGTH;
  }

  public tick(now: number = Date.now()): number {
    const dt = now - this.last;
    this.last = now;
    this.streak = dt > this.window ? 0 : Math.min(this.streak + 1, this.ramp);
    // Ease-in curve: slow start, then bend up toward `max` on sustained bursts.
    const t = this.streak / this.ramp;
    return Math.round(this.base + (this.max - this.base) * t ** EASE_IN_EXPONENT);
  }

  public reset(): void {
    this.last = 0;
    this.streak = 0;
  }
}
