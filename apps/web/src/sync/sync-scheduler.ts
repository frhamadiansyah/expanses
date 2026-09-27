/*
 * When to sync (spec §9.4): when the app comes to the foreground (`trigger`), and every 30 s while it is open. A
 * failed run leaves the outbox as it was and retries with exponential backoff — 60 s, 120 s, 240 s, then every
 * 5 minutes — until one succeeds, which puts the schedule back to 30 s. One run at a time: a trigger during a run
 * queues a single follow-up rather than a second concurrent run. No screen waits on this; errors go to `onError`.
 *
 * What a run does — drain `sync_outbox` in hlc order, pull from `applied_seq` — is `syncOnce`, built by tasks 3–4
 * and wired into the app in task 7.
 */

export interface SyncSchedulerOptions {
  syncOnce: () => Promise<void>;
  /** Called with whatever a failed run threw. */
  onError?: (error: unknown) => void;
  /** Between successful runs; 30 s. */
  intervalMs?: number;
  /** The longest wait after failures; 5 minutes. */
  maxBackoffMs?: number;
}

export class SyncScheduler {
  private readonly syncOnce: () => Promise<void>;
  private readonly onError: (error: unknown) => void;
  private readonly intervalMs: number;
  private readonly maxBackoffMs: number;

  private started = false;
  private failures = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running: Promise<void> | null = null;
  private followUp: Promise<void> | null = null;

  constructor(options: SyncSchedulerOptions) {
    this.syncOnce = options.syncOnce;
    this.onError = options.onError ?? (() => {});
    this.intervalMs = options.intervalMs ?? 30_000;
    this.maxBackoffMs = options.maxBackoffMs ?? 5 * 60_000;
  }

  /** Runs now and keeps running on the schedule until `stop`. A second `start` is a no-op. */
  start(): void {
    if (this.started) return;
    this.started = true;
    void this.trigger();
  }

  stop(): void {
    this.started = false;
    this.clearTimer();
  }

  /**
   * Runs now — the foreground hook, or "I just wrote something". While a run is in flight, queues exactly one more
   * after it. Resolves when the run it started (or joined) is over; never rejects.
   */
  trigger(): Promise<void> {
    if (!this.running) return this.runNow();
    if (!this.followUp) {
      this.followUp = this.running.then(() => {
        this.followUp = null;
        return this.runNow();
      });
    }
    return this.followUp;
  }

  private runNow(): Promise<void> {
    this.clearTimer();
    const run = (async () => {
      try {
        await this.syncOnce();
        this.failures = 0;
      } catch (error) {
        this.failures += 1;
        this.onError(error);
      }
    })().finally(() => {
      this.running = null;
      if (this.started && !this.followUp) this.schedule();
    });
    this.running = run;
    return run;
  }

  private schedule(): void {
    this.clearTimer();
    const delay = this.failures === 0 ? this.intervalMs : Math.min(this.intervalMs * 2 ** this.failures, this.maxBackoffMs);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.trigger();
    }, delay);
  }

  private clearTimer(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }
}
