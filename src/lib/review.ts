import { Chess } from 'chess.js';
import { classifyMove, phaseOf } from './classify';
import { MATED, flip, gameAccuracy, moveAccuracy } from './eval';
import { explainMove, type Perspective } from './explain';
import { parsePgn } from './pgn';
import type { Classification, Color, EngineLike, EngineLine, Explanation, GameMeta, GameReview, PlyAnalysis, Score } from './types';

export const ALL_CLASSES: Classification[] = [
  'brilliant',
  'great',
  'best',
  'excellent',
  'good',
  'book',
  'inaccuracy',
  'mistake',
  'miss',
  'blunder',
  'forced',
];

function emptyCounts(): Record<Classification, number> {
  return Object.fromEntries(ALL_CLASSES.map((c) => [c, 0])) as Record<Classification, number>;
}

export interface ReviewOptions {
  depth?: number;
  multipv?: number;
  /** Username to detect which side the user played (case-insensitive). */
  username?: string;
  onProgress?: (done: number, total: number) => void;
  signal?: AbortSignal;
}

/** Evaluate a position (top `multipv` lines, side-to-move POV), handling finished games without asking the engine. */
export async function evaluatePosition(engine: EngineLike, fen: string, depth: number, multipv: number): Promise<EngineLine[]> {
  const c = new Chess(fen);
  if (c.isCheckmate()) return [{ move: '', pv: [], score: MATED, depth }];
  if (c.isDraw() || c.isStalemate()) return [{ move: '', pv: [], score: { cp: 0 }, depth }];
  const lines = await engine.analyse(fen, { depth, multipv: Math.min(multipv, c.moves().length) });
  return lines.length ? lines : [{ move: '', pv: [], score: { cp: 0 }, depth }];
}

function toWhite(score: Score, sideToMove: Color): Score {
  return sideToMove === 'w' ? score : flip(score);
}

function parseIncrement(tc?: string): number {
  if (!tc) return 0;
  const m = tc.match(/\+(\d+)/);
  return m ? Number(m[1]) : 0;
}

export function detectUserColor(meta: GameMeta, username?: string): Color | undefined {
  if (!username) return undefined;
  const u = username.toLowerCase();
  if (meta.white.toLowerCase() === u) return 'w';
  if (meta.black.toLowerCase() === u) return 'b';
  return undefined;
}

/** Whose point of view a move's explanation is written from. */
export function perspectiveFor(mover: Color, user?: Color): Perspective {
  if (!user) return 'neutral';
  return mover === user ? 'self' : 'opponent';
}

/**
 * Re-create the explanation for `plies[i]` written for `user` (cheap, no engine).
 * Lets the review re-word moves when you tell it which side you played, and
 * upgrades reviews saved before explanations knew your side.
 */
export function explainPly(plies: PlyAnalysis[], i: number, user?: Color): Explanation {
  const p = plies[i];
  const next = plies[i + 1]?.lines[0];
  const reply = p.reply ?? (next?.move ? next : undefined);
  const perspective = perspectiveFor(p.color, user);
  // Without the opponent's best reply the explanation would lose detail; the stored one is already right for 'self'.
  if (!reply && perspective === 'self') return p.explanation;
  return explainMove({
    fenBefore: p.fenBefore,
    playedUci: p.uci,
    playedSan: p.san,
    color: p.color,
    moveNumber: p.moveNumber,
    phase: p.phase,
    classification: p.classification,
    epLoss: p.epLoss,
    winBefore: p.winBefore,
    winAfter: p.winAfter,
    lines: p.lines,
    reply,
    afterScore: p.color === 'w' ? p.evalAfter : flip(p.evalAfter),
    prevUci: plies[i - 1]?.uci,
    perspective,
  });
}

export async function reviewGame(meta: GameMeta, engine: EngineLike, opts: ReviewOptions = {}): Promise<GameReview> {
  const depth = opts.depth ?? 14;
  const multipv = opts.multipv ?? 3;
  const game = parsePgn(meta.pgn);
  const fens = [game.startFen, ...game.moves.map((m) => m.fenAfter)];
  const evals: EngineLine[][] = [];
  for (let i = 0; i < fens.length; i++) {
    if (opts.signal?.aborted) throw new DOMException('Review cancelled', 'AbortError');
    evals.push(await evaluatePosition(engine, fens[i], depth, multipv));
    opts.onProgress?.(i + 1, fens.length);
  }

  const userColor = detectUserColor(meta, opts.username);
  const inc = parseIncrement(meta.timeControl);
  const lastClock: Partial<Record<Color, number>> = {};
  const plies: PlyAnalysis[] = [];
  const accs: Record<Color, number[]> = { w: [], b: [] };
  const counts = { w: emptyCounts(), b: emptyCounts() };

  for (let i = 0; i < game.moves.length; i++) {
    const mv = game.moves[i];
    const lines = evals[i];
    const replyLines = evals[i + 1];
    const afterScore = flip(replyLines[0].score); // opponent POV -> mover POV
    const prev = plies[i - 1];
    const cls = classifyMove({
      fenBefore: mv.fenBefore,
      playedUci: mv.uci,
      lines,
      afterScore,
      prevUci: prev?.uci,
      prevEpLoss: prev?.epLoss,
    });
    const phase = phaseOf(mv.fenBefore, mv.moveNumber);
    const reply = replyLines[0].move ? replyLines[0] : undefined;
    const explanation = explainMove({
      fenBefore: mv.fenBefore,
      playedUci: mv.uci,
      playedSan: mv.san,
      color: mv.color,
      moveNumber: mv.moveNumber,
      phase,
      classification: cls.classification,
      epLoss: cls.epLoss,
      winBefore: cls.winBefore,
      winAfter: cls.winAfter,
      lines,
      reply,
      afterScore,
      prevUci: prev?.uci,
      perspective: perspectiveFor(mv.color, userColor),
    });

    let timeSpent: number | undefined;
    if (mv.clock !== undefined) {
      const last = lastClock[mv.color];
      if (last !== undefined) timeSpent = Math.max(0, last - mv.clock + inc);
      lastClock[mv.color] = mv.clock;
    }

    const bestUci = lines[0]?.move || mv.uci;
    const c = new Chess(mv.fenBefore);
    let bestSan = bestUci;
    try {
      bestSan = c.move({ from: bestUci.slice(0, 2), to: bestUci.slice(2, 4), promotion: bestUci[4] }).san;
    } catch {
      /* keep uci */
    }

    plies.push({
      ply: mv.ply,
      moveNumber: mv.moveNumber,
      color: mv.color,
      san: mv.san,
      uci: mv.uci,
      fenBefore: mv.fenBefore,
      fenAfter: mv.fenAfter,
      evalBefore: toWhite(lines[0].score, mv.color),
      evalAfter: toWhite(afterScore, mv.color),
      bestUci,
      bestSan,
      lines,
      epLoss: cls.epLoss,
      winBefore: cls.winBefore,
      winAfter: cls.winAfter,
      classification: cls.classification,
      phase,
      explanation,
      clock: mv.clock,
      timeSpent,
      reply,
    });
    accs[mv.color].push(moveAccuracy(cls.winBefore * 100, cls.winAfter * 100));
    counts[mv.color][cls.classification]++;
  }

  const keyMoments = plies
    .filter((p) => ['blunder', 'mistake', 'miss', 'brilliant', 'great'].includes(p.classification))
    .map((p) => p.ply);

  return {
    meta,
    userColor,
    plies,
    accuracy: { w: gameAccuracy(accs.w), b: gameAccuracy(accs.b) },
    counts,
    analysedAt: Date.now(),
    depth,
    keyMoments,
  };
}
