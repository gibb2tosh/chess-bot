import { gamePlayedAt } from './pgn';
import type { GameReview, Motif } from './types';

// Progress over time: the same per-game numbers the Insights page shows,
// grouped chronologically so you can see whether training is paying off.

export interface TrendPoint {
  label: string;
  /** First and last game time in the bucket (ms). */
  from: number;
  to: number;
  games: number;
  accuracy: number;
  blundersPerGame: number;
  /** Mistakes + misses per game (blunders counted separately). */
  mistakesPerGame: number;
  /** Errors per game involving each tracked theme (allowed or missed). */
  motifs: Partial<Record<Motif, number>>;
}

export interface PeriodStats {
  games: number;
  accuracy: number;
  blundersPerGame: number;
}

export interface Trends {
  bucket: 'month' | 'week' | 'games';
  points: TrendPoint[];
  /** The (up to three) themes that cost you most often overall. */
  tracked: Motif[];
  /** Your most recent games vs. the same number before them. */
  recent?: PeriodStats;
  earlier?: PeriodStats;
}

/** Games shorter than this (aborted, early resignations) say little about your play. */
export const MIN_PLIES = 10;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const GENERIC: Motif[] = ['material-win'];

interface GameStat {
  at: number;
  accuracy: number;
  blunders: number;
  mistakes: number;
  motifs: Map<Motif, number>;
}

function gameStat(r: GameReview): GameStat {
  const c = r.userColor!;
  const motifs = new Map<Motif, number>();
  let blunders = 0;
  let mistakes = 0;
  for (const p of r.plies) {
    if (p.color !== c) continue;
    if (p.classification === 'blunder') blunders++;
    else if (p.classification === 'mistake' || p.classification === 'miss') mistakes++;
    else continue;
    for (const m of new Set([...p.explanation.allowed, ...p.explanation.missed])) motifs.set(m, (motifs.get(m) ?? 0) + 1);
  }
  return { at: gamePlayedAt(r), accuracy: r.accuracy[c], blunders, mistakes, motifs };
}

function monthKey(t: number) {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function weekStart(t: number) {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); // Monday
  return d.getTime();
}

function round1(n: number) {
  return Math.round(n * 10) / 10;
}

function summarise(games: GameStat[], tracked: Motif[], label: string): TrendPoint {
  const n = games.length;
  const motifs: Partial<Record<Motif, number>> = {};
  for (const m of tracked) motifs[m] = round1(games.reduce((s, g) => s + (g.motifs.get(m) ?? 0), 0) / n);
  return {
    label,
    from: games[0].at,
    to: games[n - 1].at,
    games: n,
    accuracy: round1(games.reduce((s, g) => s + g.accuracy, 0) / n),
    blundersPerGame: round1(games.reduce((s, g) => s + g.blunders, 0) / n),
    mistakesPerGame: round1(games.reduce((s, g) => s + g.mistakes, 0) / n),
    motifs,
  };
}

function period(games: GameStat[]): PeriodStats {
  const n = games.length;
  return {
    games: n,
    accuracy: round1(games.reduce((s, g) => s + g.accuracy, 0) / n),
    blundersPerGame: round1(games.reduce((s, g) => s + g.blunders, 0) / n),
  };
}

export function buildTrends(reviews: GameReview[]): Trends {
  const games = reviews
    .filter((r) => r.userColor && r.plies.length >= MIN_PLIES)
    .map(gameStat)
    .sort((a, b) => a.at - b.at);

  const totals = new Map<Motif, number>();
  for (const g of games) for (const [m, n] of g.motifs) if (!GENERIC.includes(m)) totals.set(m, (totals.get(m) ?? 0) + n);
  const tracked = [...totals.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([m]) => m);

  // Pick the coarsest grouping that still gives at least three points.
  const groups = new Map<string, GameStat[]>();
  const byMonth = new Map<string, GameStat[]>();
  for (const g of games) byMonth.set(monthKey(g.at), [...(byMonth.get(monthKey(g.at)) ?? []), g]);
  const byWeek = new Map<number, GameStat[]>();
  for (const g of games) byWeek.set(weekStart(g.at), [...(byWeek.get(weekStart(g.at)) ?? []), g]);

  let bucket: Trends['bucket'];
  if (byMonth.size >= 3) {
    bucket = 'month';
    for (const [k, gs] of byMonth) {
      const [y, m] = k.split('-');
      groups.set(`${MONTHS[Number(m) - 1]} ${y.slice(2)}`, gs);
    }
  } else if (byWeek.size >= 3) {
    bucket = 'week';
    for (const [k, gs] of byWeek) {
      const d = new Date(k);
      groups.set(`${d.getDate()} ${MONTHS[d.getMonth()]}`, gs);
    }
  } else {
    bucket = 'games';
    const size = Math.max(3, Math.ceil(games.length / 6));
    for (let i = 0; i < games.length; i += size) {
      const chunk = games.slice(i, i + size);
      groups.set(`Games ${i + 1}–${i + chunk.length}`, chunk);
    }
  }

  const points = [...groups.entries()].map(([label, gs]) => summarise(gs, tracked, label));

  let recent: PeriodStats | undefined;
  let earlier: PeriodStats | undefined;
  if (games.length >= 10) {
    const w = Math.min(10, Math.floor(games.length / 2));
    recent = period(games.slice(-w));
    earlier = period(games.slice(-2 * w, -w));
  }

  return { bucket, points, tracked, recent, earlier };
}
