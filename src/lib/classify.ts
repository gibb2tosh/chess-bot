import { Chess, type Square } from 'chess.js';
import { winProb } from './eval';
import { VALUE, isHanging, nonPawnMaterial, pieces } from './motifs';
import type { Classification, Color, EngineLine, Phase, Score } from './types';

export interface ClassifyInput {
  fenBefore: string;
  playedUci: string;
  /** Engine lines for fenBefore, scores from mover's POV, best first. */
  lines: EngineLine[];
  /** Eval after the played move, from the mover's POV. */
  afterScore: Score;
  /** The previous move (opponent's), for spotting simple recaptures. */
  prevUci?: string;
  /** How many expected points the opponent's previous move threw away. */
  prevEpLoss?: number;
}

export interface ClassifyResult {
  classification: Classification;
  epLoss: number;
  winBefore: number;
  winAfter: number;
}

// Thresholds on expected-points loss (win probability, 0..1).
export const THRESHOLDS = { excellent: 0.02, good: 0.05, inaccuracy: 0.1, mistake: 0.2 };

export function classifyMove(input: ClassifyInput): ClassifyResult {
  const { fenBefore, playedUci, lines, afterScore } = input;
  const chess = new Chess(fenBefore);
  const legal = chess.moves().length;
  const best = lines[0];
  const winBefore = best ? winProb(best.score) : winProb(afterScore);
  const winAfter = winProb(afterScore);
  // A move can't be "better than best" — clamp noise from search depth differences.
  const epLoss = Math.max(0, winBefore - winAfter);
  const isBest = !!best && best.move === playedUci;

  const result = (classification: Classification): ClassifyResult => ({ classification, epLoss, winBefore, winAfter });

  if (legal === 1) return result('forced');

  if (isBest || epLoss < THRESHOLDS.excellent) {
    if (isBrilliant(chess, playedUci, winBefore, winAfter)) return result('brilliant');
    if (isBest && isGreat(input, winBefore)) return result('great');
    return result(isBest || epLoss < 0.005 ? 'best' : 'excellent');
  }
  if (epLoss < THRESHOLDS.good) return result('good');

  // "Miss": opponent just erred, we were clearly better, and we let most of it slip
  // without actually throwing the game away.
  const opponentErred = (input.prevEpLoss ?? 0) >= THRESHOLDS.inaccuracy;
  if (opponentErred && winBefore >= 0.7 && epLoss >= THRESHOLDS.inaccuracy && winAfter >= 0.35) {
    return result('miss');
  }
  if (epLoss < THRESHOLDS.inaccuracy) return result('inaccuracy');
  if (epLoss < THRESHOLDS.mistake) return result('mistake');
  return result('blunder');
}

/** Only-move: the best move holds the position while the alternatives clearly don't. */
function isGreat(input: ClassifyInput, winBefore: number): boolean {
  const [best, second] = input.lines;
  if (!best || !second) return false;
  if (winBefore > 0.97) return false; // anything wins
  const gap = winProb(best.score) - winProb(second.score);
  if (gap < 0.15) return false;
  // Plain recaptures are "only moves" but nobody should get a medal for them.
  if (input.prevUci && input.prevUci.slice(2, 4) === input.playedUci.slice(2, 4)) return false;
  return true;
}

/** A good move that leaves a piece en prise (a sound sacrifice). */
function isBrilliant(chess: Chess, uci: string, winBefore: number, winAfter: number): boolean {
  if (winAfter < 0.5 || winBefore > 0.97) return false;
  const from = uci.slice(0, 2) as Square;
  const to = uci.slice(2, 4) as Square;
  const mover = chess.get(from);
  if (!mover || mover.type === 'p' || mover.type === 'k') return false;
  const captured = chess.get(to);
  let m;
  try {
    m = chess.move({ from, to, promotion: uci[4] });
  } catch {
    return false;
  }
  const sacrificed = isHanging(chess, to) && VALUE[mover.type] - (captured ? VALUE[captured.type] : 0) >= 2;
  // Also count leaving *another* piece hanging that wasn't before (e.g. ignoring a pin).
  chess.undo();
  const before = new Set(
    pieces(chess, mover.color as Color)
      .filter((p) => p.type !== 'p' && isHanging(chess, p.square))
      .map((p) => p.square),
  );
  chess.move(m);
  const leftHanging = pieces(chess, mover.color as Color).some(
    (p) => p.type !== 'p' && p.type !== 'k' && p.square !== to && !before.has(p.square) && isHanging(chess, p.square) && VALUE[p.type] >= 3,
  );
  const givesMate = chess.isCheckmate();
  chess.undo();
  return !givesMate && (sacrificed || leftHanging);
}

export function phaseOf(fen: string, moveNumber: number): Phase {
  const chess = new Chess(fen);
  const npm = nonPawnMaterial(chess);
  const queens = pieces(chess).filter((p) => p.type === 'q').length;
  if (npm <= 20 || (queens === 0 && npm <= 26)) return 'endgame';
  if (moveNumber <= 12 && npm >= 50) return 'opening';
  return 'middlegame';
}
