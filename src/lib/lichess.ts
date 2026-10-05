import { Chess } from 'chess.js';
import type { Color, Motif, Puzzle } from './types';

// Lichess puzzle API (public, CORS-enabled). `angle` is a puzzle theme
// (fork, pin, mateIn2, endgame, ...) or an opening family (Sicilian_Defense).
const API = 'https://lichess.org/api/puzzle';

interface LichessPuzzleResponse {
  game: { pgn: string };
  puzzle: { id: string; rating: number; solution: string[]; themes: string[]; initialPly: number };
}

const THEME_TO_MOTIF: Record<string, Motif> = {
  fork: 'fork',
  pin: 'pin',
  skewer: 'skewer',
  discoveredAttack: 'discovered-attack',
  hangingPiece: 'hanging-piece',
  backRankMate: 'back-rank',
  mateIn1: 'mate',
  mateIn2: 'mate',
  mateIn3: 'mate',
  trappedPiece: 'trapped-piece',
  promotion: 'promotion',
  advancedPawn: 'passed-pawn',
  kingsideAttack: 'king-safety',
  defensiveMove: 'defence',
};

/**
 * Lichess gives the game moves up to the puzzle start. The position to solve is
 * after all of those moves; we verify the first solution move is legal there.
 */
export function puzzleFromLichess(data: LichessPuzzleResponse, now = Date.now()): Puzzle | null {
  const sans = data.game.pgn.trim().split(/\s+/).filter((t) => !/^\d+\.+$/.test(t));
  const chess = new Chess();
  for (const s of sans) {
    try {
      chess.move(s);
    } catch {
      return null;
    }
  }
  const tryFen = (c: Chess) => {
    const first = data.puzzle.solution[0];
    try {
      new Chess(c.fen()).move({ from: first.slice(0, 2), to: first.slice(2, 4), promotion: first[4] });
      return c.fen();
    } catch {
      return null;
    }
  };
  const fen = tryFen(chess);
  if (!fen) return null;
  const themes = data.puzzle.themes.map((t) => THEME_TO_MOTIF[t]).filter((m): m is Motif => !!m);
  return {
    id: `lichess:${data.puzzle.id}`,
    fen,
    solution: data.puzzle.solution,
    color: chess.turn() as Color,
    themes: themes.length ? themes : ['material-win'],
    source: 'lichess',
    rating: data.puzzle.rating,
    createdAt: now,
    box: 0,
    due: now,
    attempts: 0,
    solved: 0,
  };
}

export async function fetchThemedPuzzle(angle: string, signal?: AbortSignal): Promise<Puzzle | null> {
  const res = await fetch(`${API}/next?angle=${encodeURIComponent(angle)}`, {
    headers: { Accept: 'application/json' },
    signal,
  });
  if (!res.ok) throw new Error(`lichess API error ${res.status}`);
  const data = (await res.json()) as LichessPuzzleResponse;
  return puzzleFromLichess(data);
}
