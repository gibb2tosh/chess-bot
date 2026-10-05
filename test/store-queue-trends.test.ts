import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ReviewQueue, type QueueJob } from '../src/lib/reviewQueue';
import * as reviewStore from '../src/lib/reviewStore';
import { buildTrends } from '../src/lib/trends';
import { buildProfile } from '../src/lib/profile';
import { UciEngine } from '../src/lib/engine';
import { countPlies, pgnEndTime } from '../src/lib/pgn';
import type { Classification, GameMeta, GameReview, Motif, PlyAnalysis } from '../src/lib/types';

// Node has no localStorage; a Map-backed stand-in is enough here.
if (!('localStorage' in globalThis)) {
  const m = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, String(v)),
    removeItem: (k: string) => void m.delete(k),
    clear: () => m.clear(),
  };
}

// --- helpers -------------------------------------------------------------

function meta(id: string, endTime?: number): GameMeta {
  return { id, white: 'me', black: 'them', result: '1-0', pgn: '', source: 'pgn', endTime };
}

/** A synthetic review: `n` user moves, with the given classifications/motifs on some of them. */
function fakeReview(
  id: string,
  opts: { endTime?: number; accuracy?: number; errors?: { cls: Classification; motifs: Motif[] }[]; plies?: number } = {},
): GameReview {
  const plies: PlyAnalysis[] = [];
  const n = opts.plies ?? 30;
  const errors = opts.errors ?? [];
  for (let i = 0; i < n; i++) {
    const color = i % 2 === 0 ? 'w' : 'b';
    const err = color === 'w' ? errors[i / 2] : undefined;
    plies.push({
      ply: i + 1,
      moveNumber: Math.floor(i / 2) + 1,
      color,
      san: 'x',
      uci: 'a2a3',
      fenBefore: '',
      fenAfter: '',
      evalBefore: { cp: 0 },
      evalAfter: { cp: 0 },
      bestUci: 'a2a3',
      bestSan: 'a3',
      lines: [],
      epLoss: 0,
      winBefore: 0.5,
      winAfter: 0.5,
      classification: err?.cls ?? 'best',
      phase: 'middlegame',
      explanation: { headline: '', details: [], ideas: [], missed: [], allowed: err?.motifs ?? [], played: [] },
    });
  }
  return {
    meta: meta(id, opts.endTime),
    userColor: 'w',
    plies,
    accuracy: { w: opts.accuracy ?? 80, b: 80 },
    counts: { w: {} as never, b: {} as never },
    analysedAt: 1,
    depth: 10,
    keyMoments: [],
  };
}

const DAY = 86400;
const t0 = Date.UTC(2026, 0, 15) / 1000;

// --- review store ----------------------------------------------------------

describe('reviewStore (IndexedDB)', () => {
  beforeEach(async () => {
    await reviewStore._resetForTests();
    await new Promise((resolve, reject) => {
      const req = indexedDB.deleteDatabase('chess-coach');
      req.onsuccess = resolve;
      req.onerror = reject;
    });
    localStorage.clear();
  });

  it('saves, sorts newest game first, replaces and deletes', async () => {
    await reviewStore.saveReview(fakeReview('a', { endTime: t0 }));
    await reviewStore.saveReview(fakeReview('b', { endTime: t0 + DAY }));
    await reviewStore.saveReview(fakeReview('a', { endTime: t0, accuracy: 99 }));
    let all = await reviewStore.loadReviews();
    expect(all.map((r) => r.meta.id)).toEqual(['b', 'a']);
    expect(all[1].accuracy.w).toBe(99);
    await reviewStore.deleteReview('b');
    all = await reviewStore.loadReviews();
    expect(all.map((r) => r.meta.id)).toEqual(['a']);
  });

  it('holds far more than localStorage could', async () => {
    const big = fakeReview('x', { plies: 90 });
    for (let i = 0; i < 120; i++) await reviewStore.saveReview({ ...big, meta: meta(`g${i}`, t0 + i) });
    expect((await reviewStore.loadReviews()).length).toBe(120);
  });

  it('recognises the same chess.com game whether it came from the API or a pasted PGN', () => {
    const fromApi = { ...fakeReview('uuid-1'), meta: { ...meta('uuid-1'), url: 'https://www.chess.com/game/live/42' } };
    expect(reviewStore.findReviewOf([fromApi], { id: 'https://www.chess.com/game/live/42', url: 'https://www.chess.com/game/live/42' })).toBe(fromApi);
    expect(reviewStore.findReviewOf([fromApi], { id: 'uuid-1' })).toBe(fromApi);
    expect(reviewStore.findReviewOf([fromApi], { id: 'other', url: 'https://www.chess.com/game/live/43' })).toBeUndefined();
  });

  it('migrates reviews saved by the first version from localStorage', async () => {
    localStorage.setItem('cc.reviews', JSON.stringify([fakeReview('old1'), fakeReview('old2')]));
    const all = await reviewStore.loadReviews();
    expect(all.map((r) => r.meta.id).sort()).toEqual(['old1', 'old2']);
    expect(localStorage.getItem('cc.reviews')).toBeNull();
  });
});

// --- queue -------------------------------------------------------------------

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('ReviewQueue', () => {
  it('runs jobs one at a time, in order, with clicked games jumping ahead', async () => {
    const order: string[] = [];
    const gates = new Map<string, ReturnType<typeof deferred<GameReview>>>();
    const q = new ReviewQueue(
      (job) => {
        order.push(job.meta.id);
        const d = deferred<GameReview>();
        gates.set(job.meta.id, d);
        return d.promise;
      },
      { onResult: () => undefined },
    );
    const job = (id: string): QueueJob => ({ meta: meta(id), depth: 10 });
    expect(q.add([job('a'), job('b'), job('c')])).toBe(3);
    expect(q.add([job('b')])).toBe(0); // duplicates ignored
    expect(q.getState().current?.job.meta.id).toBe('a');
    q.add([job('urgent')], { front: true });
    gates.get('a')!.resolve(fakeReview('a'));
    await vi.waitFor(() => expect(order).toEqual(['a', 'urgent']));
    gates.get('urgent')!.resolve(fakeReview('urgent'));
    await vi.waitFor(() => expect(order).toEqual(['a', 'urgent', 'b']));
    expect(q.getState().batch).toMatchObject({ total: 4, completed: 2 });
    gates.get('b')!.reject(new Error('engine died'));
    await vi.waitFor(() => expect(order).toEqual(['a', 'urgent', 'b', 'c']));
    expect(q.getState().batch).toMatchObject({ failed: 1 });
    gates.get('c')!.resolve(fakeReview('c'));
    await vi.waitFor(() => expect(q.getState()).toEqual({ current: null, pending: [], batch: null }));
  });

  it('cancels: drops pending work and aborts the running review without reporting an error', async () => {
    const onError = vi.fn();
    const onResult = vi.fn();
    let started = 0;
    const q = new ReviewQueue(
      (_job, signal) => {
        started++;
        return new Promise((_, reject) => signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))));
      },
      { onResult, onError },
    );
    q.add([{ meta: meta('a'), depth: 10 }, { meta: meta('b'), depth: 10 }]);
    q.cancelAll();
    await vi.waitFor(() => expect(q.getState().current).toBeNull());
    expect(started).toBe(1);
    expect(onError).not.toHaveBeenCalled();
    expect(onResult).not.toHaveBeenCalled();
  });

  it('notifies subscribers with a new state object each time', async () => {
    const q = new ReviewQueue(async (job) => fakeReview(job.meta.id), { onResult: () => undefined });
    const states = new Set<unknown>();
    q.subscribe(() => states.add(q.getState()));
    q.add([{ meta: meta('a'), depth: 10 }]);
    await vi.waitFor(() => expect(q.getState().current).toBeNull());
    expect(states.size).toBeGreaterThan(2);
  });
});

// --- trends ------------------------------------------------------------------

describe('trends', () => {
  it('groups by month when games span 3+ months and tracks recurring themes', () => {
    const reviews = [
      fakeReview('1', { endTime: t0, accuracy: 60, errors: [{ cls: 'blunder', motifs: ['fork'] }, { cls: 'blunder', motifs: ['fork'] }] }),
      fakeReview('2', { endTime: t0 + 31 * DAY, accuracy: 70, errors: [{ cls: 'mistake', motifs: ['pin'] }] }),
      fakeReview('3', { endTime: t0 + 62 * DAY, accuracy: 80 }),
      fakeReview('4', { endTime: t0 + 63 * DAY, accuracy: 90 }),
    ];
    const t = buildTrends(reviews);
    expect(t.bucket).toBe('month');
    expect(t.points.map((p) => p.label)).toEqual(['Jan 26', 'Feb 26', 'Mar 26']);
    expect(t.points.map((p) => p.accuracy)).toEqual([60, 70, 85]);
    expect(t.points[0].blundersPerGame).toBe(2);
    expect(t.tracked).toEqual(['fork', 'pin']);
    expect(t.points[0].motifs.fork).toBe(2);
  });

  it('falls back to weeks, then fixed-size groups, and ignores very short games', () => {
    const weekly = [0, 7, 14].map((d, i) => fakeReview(`w${i}`, { endTime: t0 + d * DAY }));
    expect(buildTrends(weekly).bucket).toBe('week');
    const sameDay = Array.from({ length: 9 }, (_, i) => fakeReview(`s${i}`, { endTime: t0 + i * 60 }));
    const g = buildTrends(sameDay);
    expect(g.bucket).toBe('games');
    expect(g.points.map((p) => p.label)).toEqual(['Games 1–3', 'Games 4–6', 'Games 7–9']);
    const withShort = [...sameDay, fakeReview('short', { endTime: t0, plies: 4 })];
    expect(buildTrends(withShort).points.reduce((s, p) => s + p.games, 0)).toBe(9);
  });

  it('compares your latest games with the ones before and turns that into insights', () => {
    const reviews = Array.from({ length: 20 }, (_, i) =>
      fakeReview(`g${i}`, {
        endTime: t0 + i * DAY,
        accuracy: i < 10 ? 70 : 80,
        errors: i < 10 ? [{ cls: 'blunder', motifs: [] }] : [],
      }),
    );
    const t = buildTrends(reviews);
    expect(t.recent).toEqual({ games: 10, accuracy: 80, blundersPerGame: 0 });
    expect(t.earlier).toEqual({ games: 10, accuracy: 70, blundersPerGame: 1 });
    const titles = buildProfile(reviews).insights.map((i) => i.title);
    expect(titles).toContain('Improving');
    expect(titles).toContain('Fewer blunders');
  });
});

describe('insight wording', () => {
  it('describes tactical and positional mistake themes in plain words', () => {
    const reviews = Array.from({ length: 4 }, (_, i) =>
      fakeReview(`g${i}`, {
        endTime: t0 + i * DAY,
        errors: [
          { cls: 'blunder', motifs: ['fork'] },
          { cls: 'mistake', motifs: ['piece-activity'] },
        ],
      }),
    );
    const details = buildProfile(reviews).insights.map((i) => i.detail);
    expect(details).toContain('In 4 of your mistakes you walked into a fork. Before each move, ask: "what are their checks, captures and threats after this?"');
    expect(details.some((d) => d.startsWith('In 4 of your mistakes you chose a passive move when an active one was available.'))).toBe(true);
  });
});

// --- misc --------------------------------------------------------------------

describe('pgn dates', () => {
  it('reads chess.com end dates', () => {
    expect(pgnEndTime({ Date: '2026.03.02', EndDate: '2026.03.03', EndTime: '01:02:03' })).toBe(Date.UTC(2026, 2, 3, 1, 2, 3) / 1000);
    expect(pgnEndTime({ UTCDate: '2026.03.02', UTCTime: '10:00:00' })).toBe(Date.UTC(2026, 2, 2, 10) / 1000);
    expect(pgnEndTime({ Date: '????.??.??' })).toBeUndefined();
    expect(countPlies('1. e4 e5 2. Nf3 *')).toBe(3);
    expect(countPlies('not a game')).toBe(0);
  });
});

describe('engine crash handling', () => {
  it('rejects the pending request and later ones once the engine fails', async () => {
    const sent: string[] = [];
    const engine = new UciEngine((c) => sent.push(c));
    engine.onLine('uciok');
    await Promise.resolve();
    engine.onLine('readyok');
    const p = engine.analyse('8/8/8/8/8/8/8/K6k w - - 0 1', { depth: 5 });
    await vi.waitFor(() => expect(sent.some((c) => c.startsWith('go'))).toBe(true));
    engine.fail(new Error('boom'));
    await expect(p).rejects.toThrow('boom');
    expect(engine.isDead).toBe(true);
    await expect(engine.analyse('8/8/8/8/8/8/8/K6k w - - 0 1', { depth: 5 })).rejects.toThrow('boom');
  });
});
