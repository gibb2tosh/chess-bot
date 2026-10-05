import { Chess } from 'chess.js';
import { classifyMove, phaseOf } from './classify';
import { flip, winProb } from './eval';
import { describeLine, describeMove, explainMove, joinPhrases, type Perspective } from './explain';
import { withTurn } from './motifs';
import { uciLineToSan } from './pgn';
import { evaluatePosition } from './review';
import type { Classification, Color, EngineLike, EngineLine, Explanation, Score } from './types';

// "What if I'd played this instead?" — instant feedback on moves you try on
// the review board, plus what each side is threatening.

export interface Threat {
  /** The side making the threat (the side that is NOT to move). */
  side: Color;
  uci: string[];
  san: string[];
  /** e.g. "Qxf7#, which leads to checkmate" or "Nxe5, which wins a pawn". */
  summary: string;
  mate: boolean;
}

export interface MoveFeedback {
  fenBefore: string;
  fenAfter: string;
  uci: string;
  san: string;
  color: Color;
  classification: Classification;
  epLoss: number;
  /** Mover's winning chances before/after (0..1). */
  winBefore: number;
  winAfter: number;
  explanation: Explanation;
  /** Evaluation after the move, White's point of view. */
  evalAfter: Score;
  /** The other side's best answer, and the line it starts. */
  reply?: EngineLine;
  replySan: string[];
  /** What this move threatens next, if anything serious. */
  threat: Threat | null;
}

/**
 * What would `side` do with a free move right now? That's its threat. We only
 * report it if it would gain something real (mate, or a clear jump in
 * winning chances backed by material), so quiet positions show nothing.
 */
export async function findThreat(engine: EngineLike, fen: string, side: Color, depth: number, base?: EngineLine): Promise<Threat | null> {
  const chess = new Chess(fen);
  if (chess.isGameOver() || chess.turn() === side) return null;
  const nullFen = withTurn(fen, side);
  if (!nullFen) return null; // the side to move is in check: no "free move" to imagine
  const baseLine = base ?? (await evaluatePosition(engine, fen, depth, 1))[0];
  const [line] = await evaluatePosition(engine, nullFen, depth, 1);
  if (!line?.move) return null;
  const mate = line.score.mate !== undefined && line.score.mate > 0;
  const gain = winProb(line.score) - (1 - winProb(baseLine.score));
  const result = describeLine(nullFen, line.pv, side, line.score);
  if (!mate && (gain < 0.08 || !result.text)) return null;
  const san = uciLineToSan(nullFen, line.pv.slice(0, 6));
  const first = describeMove(nullFen, line.move).phrases.slice(0, 1);
  const summary = mate
    ? `${san[0]}, ${line.score.mate === 1 ? 'which is checkmate' : `with checkmate in ${line.score.mate}`}`
    : `${san[0]}, which ${joinPhrases([...first.filter((p) => !p.startsWith('wins')), result.text])}`;
  return { side, uci: line.pv.slice(0, san.length), san, summary, mate };
}

/** Full feedback for one move, as if it had been played in the game. */
export async function analyseMove(
  engine: EngineLike,
  fenBefore: string,
  uci: string,
  opts: { depth: number; perspective: Perspective; prevUci?: string; linesBefore?: EngineLine[] },
): Promise<MoveFeedback> {
  const linesBefore = opts.linesBefore?.length ? opts.linesBefore : await evaluatePosition(engine, fenBefore, opts.depth, 3);
  const chess = new Chess(fenBefore);
  const color = chess.turn() as Color;
  const moveNumber = Number(fenBefore.split(' ')[5]);
  const m = chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
  const fenAfter = chess.fen();
  const [replyLine] = await evaluatePosition(engine, fenAfter, opts.depth, 1);
  const afterScore = flip(replyLine.score);
  const cls = classifyMove({ fenBefore, playedUci: uci, lines: linesBefore, afterScore, prevUci: opts.prevUci });
  const reply = replyLine.move ? replyLine : undefined;
  const explanation = explainMove({
    fenBefore,
    playedUci: uci,
    playedSan: m.san,
    color,
    moveNumber,
    phase: phaseOf(fenBefore, moveNumber),
    classification: cls.classification,
    epLoss: cls.epLoss,
    winBefore: cls.winBefore,
    winAfter: cls.winAfter,
    lines: linesBefore,
    reply,
    afterScore,
    prevUci: opts.prevUci,
    perspective: opts.perspective,
  });
  const threat = await findThreat(engine, fenAfter, color, Math.max(8, opts.depth - 2), replyLine);
  return {
    fenBefore,
    fenAfter,
    uci,
    san: m.san,
    color,
    classification: cls.classification,
    epLoss: cls.epLoss,
    winBefore: cls.winBefore,
    winAfter: cls.winAfter,
    explanation,
    evalAfter: color === 'w' ? afterScore : flip(afterScore),
    reply,
    replySan: reply ? uciLineToSan(fenAfter, reply.pv.slice(0, 8)) : [],
    threat,
  };
}

/** "You threaten…" / "Your opponent threatens…" / "White threatens…". */
export function threatSentence(t: Threat, user?: Color): string {
  const who = !user ? (t.side === 'w' ? 'White threatens' : 'Black threatens') : t.side === user ? 'You threaten' : 'Your opponent threatens';
  return `${who} ${t.summary}.`;
}
