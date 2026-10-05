import { useEffect, useMemo, useState } from 'react';
import { Chess } from 'chess.js';
import { getAnalysisEngine } from '../lib/engine';
import { analyseMove, findThreat, type MoveFeedback, type Threat } from '../lib/explore';
import { uciLineToSan } from '../lib/pgn';
import { evaluatePosition, perspectiveFor } from '../lib/review';
import { flip, winProb } from '../lib/eval';
import type { Color, EngineLine, Score } from '../lib/types';

// The "try your own moves" analysis board, shared by the review and puzzle pages.

export const EXPLORE_DEPTH = 13;
export const THREAT_DEPTH = 11;

/** A line of moves you're trying out on the board, starting from some position. */
export interface Exploration {
  startFen: string;
  label: string;
  moves: string[];
  /** How many of `moves` are on the board (0 = the start position). */
  index: number;
  /** The move that led to startFen (helps spot recaptures). */
  prevUci?: string;
  /** Engine lines for startFen, when we already have them. */
  linesAtStart?: EngineLine[];
}

export type FeedbackEntry = MoveFeedback | { error: string };

export const turnOf = (fen: string) => fen.split(' ')[1] as Color;
export const moveNo = (fen: string) => {
  const [, turn, , , , n] = fen.split(' ');
  return turn === 'w' ? `${n}.` : `${n}...`;
};
export const toWhite = (s: Score, sideToMove: Color): Score => (sideToMove === 'w' ? s : flip(s));
/** Your winning chances (%) from a White-POV score, or null if we don't know your side. */
export const yourChances = (whiteScore: Score, user?: Color) =>
  user ? Math.round((user === 'w' ? winProb(whiteScore) : 1 - winProb(whiteScore)) * 100) : null;

// Analysis of a given position or move never changes, so cache it for the session.
const feedbackCache = new Map<string, FeedbackEntry>();
const positionCache = new Map<string, EngineLine[]>();
const threatCache = new Map<string, Threat | null>();
const inflight = new Set<string>();

function useCacheVersion() {
  const [, setVersion] = useState(0);
  return () => setVersion((v) => v + 1);
}

export function useExploration(user?: Color) {
  const [explore, setExplore] = useState<Exploration | null>(null);
  const refresh = useCacheVersion();

  const fens = useMemo(() => {
    if (!explore) return [];
    const c = new Chess(explore.startFen);
    const out = [c.fen()];
    for (const u of explore.moves) {
      c.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] });
      out.push(c.fen());
    }
    return out;
  }, [explore]);
  const sans = useMemo(() => (explore ? uciLineToSan(explore.startFen, explore.moves) : []), [explore]);

  const fen = explore ? fens[explore.index] : null;
  // Feedback is worded for the reader, so the key includes whose side they're on.
  const keyAt = (i: number) => (explore && i > 0 ? `${user ?? '-'}|${fens[i - 1]}|${explore.moves[i - 1]}` : null);
  const fbKey = explore ? keyAt(explore.index) : null;
  const fbEntry = fbKey ? feedbackCache.get(fbKey) : undefined;
  const fb = fbEntry && !('error' in fbEntry) ? fbEntry : null;

  // Feedback on the move that led to the current position.
  useEffect(() => {
    if (!explore || !fbKey || feedbackCache.has(fbKey) || inflight.has(fbKey)) return;
    const i = explore.index;
    const before = fens[i - 1];
    inflight.add(fbKey);
    analyseMove(getAnalysisEngine(), before, explore.moves[i - 1], {
      depth: EXPLORE_DEPTH,
      perspective: perspectiveFor(turnOf(before), user),
      prevUci: i >= 2 ? explore.moves[i - 2] : explore.prevUci,
      linesBefore: positionCache.get(before) ?? (i === 1 ? explore.linesAtStart : undefined),
    })
      .then((r) => feedbackCache.set(fbKey, r))
      .catch((e) => feedbackCache.set(fbKey, { error: e instanceof Error ? e.message : String(e) }))
      .finally(() => {
        inflight.delete(fbKey);
        refresh();
      });
  });

  // The best moves in the current position.
  useEffect(() => {
    if (!fen || positionCache.has(fen) || inflight.has('pos|' + fen) || new Chess(fen).isGameOver()) return;
    inflight.add('pos|' + fen);
    evaluatePosition(getAnalysisEngine(), fen, EXPLORE_DEPTH - 1, 3)
      .then((lines) => positionCache.set(fen, lines))
      .catch(() => undefined)
      .finally(() => {
        inflight.delete('pos|' + fen);
        refresh();
      });
  });

  const play = (uci: string) => {
    if (!explore) return false;
    const moves = [...explore.moves.slice(0, explore.index), uci];
    setExplore({ ...explore, moves, index: moves.length });
    return true;
  };
  const setIndex = (i: number) => explore && setExplore({ ...explore, index: Math.max(0, Math.min(explore.moves.length, i)) });
  const feedbackAt = (i: number): FeedbackEntry | undefined => {
    const k = keyAt(i);
    return k ? feedbackCache.get(k) : undefined;
  };

  return {
    explore,
    start: setExplore,
    stop: () => setExplore(null),
    fens,
    sans,
    fen,
    fb,
    fbEntry,
    posLines: fen ? positionCache.get(fen) : undefined,
    play,
    setIndex,
    feedbackAt,
  };
}

/**
 * What the side that just moved is threatening in `fen` (or undefined while
 * we don't know yet). `base` is the engine's line for `fen`, if already known.
 */
export function useThreat(fen: string, enabled: boolean, base?: EngineLine): { threat: Threat | null | undefined; loading: boolean } {
  const refresh = useCacheVersion();
  useEffect(() => {
    if (!enabled || threatCache.has(fen) || inflight.has('thr|' + fen)) return;
    inflight.add('thr|' + fen);
    const side: Color = turnOf(fen) === 'w' ? 'b' : 'w';
    findThreat(getAnalysisEngine(), fen, side, THREAT_DEPTH, base?.move ? base : undefined)
      .then((t) => threatCache.set(fen, t))
      .catch(() => threatCache.set(fen, null))
      .finally(() => {
        inflight.delete('thr|' + fen);
        refresh();
      });
  });
  if (!enabled) return { threat: undefined, loading: false };
  return threatCache.has(fen) ? { threat: threatCache.get(fen) ?? null, loading: false } : { threat: undefined, loading: true };
}
