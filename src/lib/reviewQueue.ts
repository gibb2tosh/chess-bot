import type { GameMeta, GameReview } from './types';

// One engine, many games: every review (a single click, a bulk import of your
// history, or the auto-watcher) goes through this queue and runs one at a time.

export interface QueueJob {
  meta: GameMeta;
  depth: number;
  /** Open the review when it's done (a game you clicked on). */
  open?: boolean;
  /** Show a notification when it's done (found by the auto-watcher). */
  notify?: boolean;
}

export interface QueueState {
  current: { job: QueueJob; done: number; total: number } | null;
  pending: QueueJob[];
  /** Stats for the current run of work; reset when the queue empties. */
  batch: { total: number; completed: number; failed: number; msPerGame?: number } | null;
}

export type Runner = (job: QueueJob, signal: AbortSignal, onProgress: (done: number, total: number) => void) => Promise<GameReview>;

export interface QueueHandlers {
  onResult: (review: GameReview, job: QueueJob) => void | Promise<void>;
  onError?: (error: unknown, job: QueueJob) => void;
}

const IDLE: QueueState = { current: null, pending: [], batch: null };

export class ReviewQueue {
  private state: QueueState = IDLE;
  private listeners = new Set<() => void>();
  private controller: AbortController | null = null;
  private running = false;
  private durations: number[] = [];
  private runner: Runner;
  private handlers: QueueHandlers;

  constructor(runner: Runner, handlers: QueueHandlers) {
    this.runner = runner;
    this.handlers = handlers;
  }

  getState = (): QueueState => this.state;

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  private set(patch: Partial<QueueState>) {
    this.state = { ...this.state, ...patch };
    for (const fn of this.listeners) fn();
  }

  /** Is this game queued or being reviewed right now? */
  has(id: string): boolean {
    return this.state.current?.job.meta.id === id || this.state.pending.some((j) => j.meta.id === id);
  }

  /** Queue games (duplicates are ignored). `front` puts them ahead of anything waiting. Returns how many were added. */
  add(jobs: QueueJob[], { front = false } = {}): number {
    const seen = new Set<string>();
    const fresh = jobs.filter((j) => {
      if (this.has(j.meta.id) || seen.has(j.meta.id)) return false;
      seen.add(j.meta.id);
      return true;
    });
    if (!fresh.length) return 0;
    const batch = this.state.batch ?? { total: 0, completed: 0, failed: 0 };
    this.set({
      pending: front ? [...fresh, ...this.state.pending] : [...this.state.pending, ...fresh],
      batch: { ...batch, total: batch.total + fresh.length },
    });
    void this.pump();
    return fresh.length;
  }

  /** Drop everything waiting and stop the game being reviewed. */
  cancelAll() {
    this.set({ pending: [] });
    this.controller?.abort();
  }

  private async pump() {
    if (this.running) return;
    this.running = true;
    try {
      while (this.state.pending.length) {
        const [job, ...rest] = this.state.pending;
        this.controller = new AbortController();
        const signal = this.controller.signal;
        this.set({ pending: rest, current: { job, done: 0, total: 1 } });
        const started = Date.now();
        try {
          const review = await this.runner(job, signal, (done, total) => {
            if (this.state.current?.job === job) this.set({ current: { job, done, total } });
          });
          await this.handlers.onResult(review, job);
          this.durations = [...this.durations.slice(-9), Date.now() - started];
          const b = this.state.batch!;
          this.set({
            batch: {
              ...b,
              completed: b.completed + 1,
              msPerGame: this.durations.reduce((a, c) => a + c, 0) / this.durations.length,
            },
          });
        } catch (e) {
          if (!signal.aborted) {
            const b = this.state.batch!;
            this.set({ batch: { ...b, failed: b.failed + 1 } });
            this.handlers.onError?.(e, job);
          }
        }
      }
    } finally {
      this.controller = null;
      this.running = false;
      this.set(IDLE);
    }
  }
}
