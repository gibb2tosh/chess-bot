// Shared types for the review / training pipeline.

export type Color = 'w' | 'b';

/** Engine score from the point of view of the side to move. */
export interface Score {
  cp?: number;
  mate?: number;
}

export interface EngineLine {
  /** First move in UCI notation (e.g. "e2e4", "e7e8q"). */
  move: string;
  /** Principal variation in UCI notation, starting with `move`. */
  pv: string[];
  /** Score from the side-to-move's perspective. */
  score: Score;
  depth: number;
}

export interface AnalyseOptions {
  depth?: number;
  movetime?: number;
  multipv?: number;
}

export interface EngineLike {
  analyse(fen: string, opts: AnalyseOptions): Promise<EngineLine[]>;
}

export type Classification =
  | 'brilliant'
  | 'great'
  | 'best'
  | 'excellent'
  | 'good'
  | 'book'
  | 'inaccuracy'
  | 'mistake'
  | 'miss'
  | 'blunder'
  | 'forced';

export type Phase = 'opening' | 'middlegame' | 'endgame';

/** Tactical / strategic themes we can recognise from a position + line. */
export type Motif =
  | 'hanging-piece'
  | 'fork'
  | 'pin'
  | 'skewer'
  | 'discovered-attack'
  | 'mate-threat'
  | 'back-rank'
  | 'mate'
  | 'material-win'
  | 'trapped-piece'
  | 'promotion'
  | 'king-safety'
  | 'development'
  | 'early-queen'
  | 'castling'
  | 'pawn-structure'
  | 'passed-pawn'
  | 'center-control'
  | 'piece-activity'
  | 'trade-when-ahead'
  | 'defence';

export interface Idea {
  /** Short label, e.g. "Best line" or "Refutation". */
  label: string;
  /** SAN moves of the line, played from `fen`. */
  san: string[];
  uci: string[];
  fen: string;
}

export interface Explanation {
  /** One sentence summary shown prominently. */
  headline: string;
  /** Supporting bullet points: the why. */
  details: string[];
  /** Lines that can be stepped through on the board. */
  ideas: Idea[];
  /** Themes present in the engine's best line (what the mover could have done). */
  missed: Motif[];
  /** Themes in the opponent's refutation of the played move (what the mover allowed). */
  allowed: Motif[];
  /** Themes of the played move itself (what the mover did well). */
  played: Motif[];
}

export interface PlyAnalysis {
  ply: number; // 1-based half-move index
  moveNumber: number;
  color: Color;
  san: string;
  uci: string;
  fenBefore: string;
  fenAfter: string;
  /** Eval of the position before the move, white POV, in centipawns-ish. */
  evalBefore: Score;
  /** Eval of the position after the move, white POV. */
  evalAfter: Score;
  /** Engine's best move in the position before (UCI + SAN). */
  bestUci: string;
  bestSan: string;
  /** Top engine lines before the move (mover's POV scores). */
  lines: EngineLine[];
  /** Expected-points (0..1) the mover lost with this move. */
  epLoss: number;
  /** Win probability for the mover before/after (0..1). */
  winBefore: number;
  winAfter: number;
  classification: Classification;
  phase: Phase;
  explanation: Explanation;
  /** Seconds left on the mover's clock after the move, if known. */
  clock?: number;
  /** Seconds spent on this move, if known. */
  timeSpent?: number;
}

export interface GameMeta {
  id: string;
  url?: string;
  white: string;
  black: string;
  whiteElo?: number;
  blackElo?: number;
  result: string; // "1-0" | "0-1" | "1/2-1/2" | "*"
  timeControl?: string;
  timeClass?: string; // bullet / blitz / rapid / daily
  endTime?: number; // unix seconds
  opening?: string;
  eco?: string;
  pgn: string;
  source: 'chess.com' | 'pgn';
}

export interface GameReview {
  meta: GameMeta;
  /** Which colour the user played (undefined if neither name matched). */
  userColor?: Color;
  plies: PlyAnalysis[];
  accuracy: { w: number; b: number };
  counts: { w: Record<Classification, number>; b: Record<Classification, number> };
  /** Estimated performance-ish rating from accuracy (rough, for fun). */
  analysedAt: number;
  depth: number;
  keyMoments: number[]; // plies worth looking at
}

export interface Puzzle {
  id: string;
  fen: string;
  /** Full solution in UCI, alternating solver / opponent moves. */
  solution: string[];
  /** Colour the solver plays. */
  color: Color;
  themes: Motif[];
  source: 'own-mistake' | 'missed-punish' | 'opponent-blunder' | 'lichess';
  gameId?: string;
  ply?: number;
  /** What actually happened in the game. */
  playedSan?: string;
  hint?: string;
  rating?: number;
  createdAt: number;
  // spaced repetition (Leitner)
  box: number;
  due: number;
  attempts: number;
  solved: number;
}
