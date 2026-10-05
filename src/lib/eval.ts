import type { Score } from './types';

/**
 * Score for "the side to move is checkmated". Stockfish has no line to report
 * there, and `mate 0` can't survive a perspective flip, so we use a huge cp
 * value instead (flipping it gives "the other side has delivered mate").
 */
export const MATED: Score = { cp: -100000 };
const MATE_CP = 50000;

/** Negate a score (switch perspective). */
export function flip(s: Score): Score {
  if (s.mate !== undefined) return { mate: -s.mate };
  return { cp: -(s.cp ?? 0) };
}

/** Convert a score to a single centipawn number (mates become ±10000-ish). */
export function toCp(s: Score): number {
  if (s.cp !== undefined && Math.abs(s.cp) >= MATE_CP) return s.cp > 0 ? 10000 : -10000;
  if (s.mate !== undefined) {
    if (s.mate === 0) return -10000; // side to move is mated
    return s.mate > 0 ? 10000 - s.mate * 10 : -10000 - s.mate * 10;
  }
  return s.cp ?? 0;
}

/**
 * Win probability (0..1) for the side the score belongs to.
 * Uses the logistic model Lichess fits to rated games.
 */
export function winProb(s: Score): number {
  if (s.cp !== undefined && Math.abs(s.cp) >= MATE_CP) return s.cp > 0 ? 1 : 0;
  if (s.mate !== undefined) {
    if (s.mate === 0) return 0;
    return s.mate > 0 ? 1 : 0;
  }
  const cp = Math.max(-1000, Math.min(1000, s.cp ?? 0));
  return 1 / (1 + Math.exp(-0.00368208 * cp));
}

/** Lichess-style per-move accuracy from win% before/after (both mover POV, 0..100). */
export function moveAccuracy(winBeforePct: number, winAfterPct: number): number {
  const diff = Math.max(0, winBeforePct - winAfterPct);
  const acc = 103.1668 * Math.exp(-0.04354 * diff) - 3.1669;
  return Math.max(0, Math.min(100, acc));
}

/**
 * Game accuracy: mix of harmonic mean and mean of move accuracies,
 * which punishes a few big blunders more than a plain average would.
 */
export function gameAccuracy(moveAccs: number[]): number {
  if (moveAccs.length === 0) return 100;
  const mean = moveAccs.reduce((a, b) => a + b, 0) / moveAccs.length;
  const harmonic = moveAccs.length / moveAccs.reduce((a, b) => a + 1 / Math.max(b, 1), 0);
  return Math.round(((mean + harmonic) / 2) * 10) / 10;
}

export function formatScore(s: Score): string {
  if (s.cp !== undefined && Math.abs(s.cp) >= MATE_CP) return s.cp > 0 ? '1-0' : '0-1';
  if (s.mate !== undefined) {
    if (s.mate === 0) return '#';
    return s.mate > 0 ? `M${s.mate}` : `-M${-s.mate}`;
  }
  const v = (s.cp ?? 0) / 100;
  return (v > 0 ? '+' : '') + v.toFixed(1);
}
