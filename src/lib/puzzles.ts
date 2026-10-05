import { Chess } from 'chess.js';
import { winProb } from './eval';
import { NAME } from './motifs';
import type { GameReview, Motif, Puzzle } from './types';

const DAY = 24 * 60 * 60 * 1000;
/** Leitner box intervals in days. */
export const BOX_INTERVALS = [0, 1, 3, 7, 16, 35];

/**
 * Turn a game review into training puzzles. A position becomes a puzzle when
 * the side to move had a clearly best move (a unique solution) that either
 * won decisively or was the only way to survive — and the user didn't find it.
 */
export function extractPuzzles(review: GameReview): Puzzle[] {
  const out: Puzzle[] = [];
  const user = review.userColor;
  for (const p of review.plies) {
    const [best, second] = p.lines;
    if (!best?.move || best.move === p.uci) continue;
    if (!['mistake', 'blunder', 'miss'].includes(p.classification)) continue;
    // Only puzzles for the user's own moves (or both sides if we don't know who the user is).
    if (user && p.color !== user) continue;

    const bestWin = winProb(best.score);
    const secondWin = second ? winProb(second.score) : 0;
    const unique =
      !second || bestWin - secondWin >= 0.15 || (best.score.mate !== undefined && best.score.mate > 0 && second.score.mate === undefined);

    // Winning puzzles need a clear-cut solution; defensive ones may have several
    // saving moves (the solver accepts any move the engine agrees holds).
    const winning = bestWin >= 0.7 && (unique || bestWin - p.winAfter >= 0.3);
    const saving = !winning && p.winAfter < 0.3 && bestWin >= 0.4;
    if (!winning && !saving) continue;

    const solution = trimSolution(p.fenBefore, best.pv, best.score.mate);
    if (solution.length === 0) continue;

    const themes = p.explanation.missed.length ? p.explanation.missed : (['material-win'] as Motif[]);
    const source: Puzzle['source'] = p.classification === 'miss' ? 'missed-punish' : 'own-mistake';
    out.push({
      id: `${review.meta.id}#${p.ply}`,
      fen: p.fenBefore,
      solution,
      color: p.color,
      themes: saving ? [...themes, 'defence'] : themes,
      source,
      gameId: review.meta.id,
      ply: p.ply,
      playedSan: p.san,
      hint: hintFor(p.fenBefore, best.move, themes),
      createdAt: Date.now(),
      box: 0,
      due: Date.now(),
      attempts: 0,
      solved: 0,
    });
  }
  return out;
}

/**
 * Keep the forcing part of the engine line: the full line for short mates,
 * otherwise the solver's first move plus follow-ups while they stay forcing
 * (captures, checks, promotions). Always ends on a solver move.
 */
export function trimSolution(fen: string, pv: string[], mate?: number): string[] {
  const chess = new Chess(fen);
  const play = (u: string) => {
    try {
      return chess.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] });
    } catch {
      return null;
    }
  };
  const isMate = mate !== undefined && mate > 0 && mate <= 4;
  if (isMate) {
    const out: string[] = [];
    for (const u of pv.slice(0, mate * 2 - 1)) {
      if (!play(u)) break;
      out.push(u);
    }
    return out.length % 2 === 1 ? out : out.slice(0, -1);
  }
  if (!pv[0] || !play(pv[0])) return [];
  const out = [pv[0]];
  // Extend with (reply, solver move) pairs while the solver's follow-up is forcing.
  for (let i = 1; i + 1 < pv.length && out.length < 5; i += 2) {
    if (chess.isGameOver()) break;
    const reply = play(pv[i]);
    if (!reply) break;
    const next = play(pv[i + 1]);
    if (!next || !(next.captured || next.promotion || chess.inCheck())) break;
    out.push(pv[i], pv[i + 1]);
  }
  return out;
}

function hintFor(fen: string, uci: string, themes: Motif[]): string {
  const chess = new Chess(fen);
  const piece = chess.get(uci.slice(0, 2) as never);
  const theme = themes.find((t) => t !== 'material-win');
  const parts: string[] = [];
  if (theme) parts.push(`Look for a ${theme.replace('-', ' ')}.`);
  if (piece) parts.push(`Your ${NAME[piece.type]} is the key piece.`);
  return parts.join(' ');
}

/** Update a puzzle's spaced-repetition box after an attempt. */
export function schedule(p: Puzzle, success: boolean, now = Date.now()): Puzzle {
  const box = success ? Math.min(p.box + 1, BOX_INTERVALS.length - 1) : 0;
  return {
    ...p,
    box,
    due: now + BOX_INTERVALS[box] * DAY,
    attempts: p.attempts + 1,
    solved: p.solved + (success ? 1 : 0),
  };
}

export function duePuzzles(ps: Puzzle[], now = Date.now()): Puzzle[] {
  return ps.filter((p) => p.due <= now).sort((a, b) => a.due - b.due);
}
