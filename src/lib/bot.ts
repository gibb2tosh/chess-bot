import { Chess } from 'chess.js';
import { winProb } from './eval';
import type { EngineLike } from './types';

/**
 * A sparring bot meant to play like a human of a given rating.
 *
 * Instead of Stockfish's own strength limiter (which is calibrated to engine
 * ratings and plays oddly at club level) it asks the engine for its top few
 * moves and picks among them with a softmax over how much each move loses.
 * Lower ratings get a higher "temperature" (more willing to pick inferior
 * moves), a shallower search, and occasional outright blunders.
 */
export interface BotStyle {
  depth: number;
  multipv: number;
  temperature: number;
  blunderRate: number;
}

function lerp(points: [number, number][], x: number): number {
  if (x <= points[0][0]) return points[0][1];
  for (let i = 1; i < points.length; i++) {
    const [x1, y1] = points[i];
    const [x0, y0] = points[i - 1];
    if (x <= x1) return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
  }
  return points[points.length - 1][1];
}

export function styleForRating(elo: number): BotStyle {
  return {
    depth: Math.round(lerp([[400, 4], [800, 6], [1200, 8], [1600, 10], [2000, 12], [2400, 16]], elo)),
    multipv: elo >= 2200 ? 3 : 5,
    temperature: lerp([[400, 0.2], [800, 0.12], [1200, 0.07], [1600, 0.035], [2000, 0.015], [2400, 0.004]], elo),
    blunderRate: lerp([[400, 0.15], [800, 0.08], [1200, 0.04], [1600, 0.02], [2000, 0.006], [2400, 0]], elo),
  };
}

export interface BotChoice {
  move: string; // uci
  /** Expected points lost vs. the engine's best move. */
  loss: number;
  candidates: { move: string; loss: number; p: number }[];
}

export function pickMove(
  candidates: { move: string; win: number }[],
  temperature: number,
  rand: () => number = Math.random,
): BotChoice {
  const bestWin = Math.max(...candidates.map((c) => c.win));
  const withLoss = candidates.map((c) => ({ move: c.move, loss: Math.max(0, bestWin - c.win) }));
  const weights = withLoss.map((c) => Math.exp(-c.loss / Math.max(temperature, 1e-4)));
  const total = weights.reduce((a, b) => a + b, 0);
  const probs = weights.map((w) => w / total);
  let r = rand();
  let idx = 0;
  for (; idx < probs.length - 1; idx++) {
    if (r < probs[idx]) break;
    r -= probs[idx];
  }
  return {
    move: withLoss[idx].move,
    loss: withLoss[idx].loss,
    candidates: withLoss.map((c, i) => ({ ...c, p: probs[i] })),
  };
}

/** Moves a human is likely to consider: captures, checks, and piece moves. */
function plausibleRandomMove(fen: string, rand: () => number): string | null {
  const chess = new Chess(fen);
  const moves = chess.moves({ verbose: true });
  if (!moves.length) return null;
  const weighted = moves.map((m) => ({ m, w: (m.captured ? 3 : 1) + (m.san.includes('+') ? 2 : 0) + (m.piece !== 'p' ? 1 : 0) }));
  const total = weighted.reduce((s, x) => s + x.w, 0);
  let r = rand() * total;
  for (const x of weighted) {
    if (r < x.w) return x.m.from + x.m.to + (x.m.promotion ?? '');
    r -= x.w;
  }
  const last = weighted[weighted.length - 1].m;
  return last.from + last.to + (last.promotion ?? '');
}

export async function botMove(engine: EngineLike, fen: string, elo: number, rand: () => number = Math.random): Promise<string> {
  const style = styleForRating(elo);
  if (rand() < style.blunderRate) {
    const m = plausibleRandomMove(fen, rand);
    if (m) return m;
  }
  const lines = await engine.analyse(fen, { depth: style.depth, multipv: style.multipv });
  if (!lines.length) {
    const m = plausibleRandomMove(fen, rand);
    if (!m) throw new Error('No legal moves');
    return m;
  }
  return pickMove(
    lines.map((l) => ({ move: l.move, win: winProb(l.score) })),
    style.temperature,
    rand,
  ).move;
}
