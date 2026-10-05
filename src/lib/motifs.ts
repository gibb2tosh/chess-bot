import { Chess, type Square, type PieceSymbol } from 'chess.js';
import type { Color, Motif } from './types';

export const VALUE: Record<PieceSymbol, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
export const NAME: Record<PieceSymbol, string> = {
  p: 'pawn',
  n: 'knight',
  b: 'bishop',
  r: 'rook',
  q: 'queen',
  k: 'king',
};

const FILES = 'abcdefgh';

export function opp(c: Color): Color {
  return c === 'w' ? 'b' : 'w';
}

export function colorName(c: Color): string {
  return c === 'w' ? 'White' : 'Black';
}

export function sq(file: number, rank: number): Square | null {
  if (file < 0 || file > 7 || rank < 0 || rank > 7) return null;
  return (FILES[file] + (rank + 1)) as Square;
}

export function coords(s: string): [number, number] {
  return [FILES.indexOf(s[0]), Number(s[1]) - 1];
}

export interface PieceOn {
  square: Square;
  type: PieceSymbol;
  color: Color;
}

export function pieces(chess: Chess, color?: Color): PieceOn[] {
  const out: PieceOn[] = [];
  for (const row of chess.board()) {
    for (const p of row) {
      if (p && (!color || p.color === color)) out.push({ square: p.square, type: p.type, color: p.color as Color });
    }
  }
  return out;
}

/** Material in pawns for one side (king excluded). */
export function material(chess: Chess, color: Color): number {
  return pieces(chess, color).reduce((s, p) => s + VALUE[p.type], 0);
}

/** Material balance from `pov`'s point of view. */
export function balance(chess: Chess, pov: Color): number {
  return material(chess, pov) - material(chess, opp(pov));
}

/** Non-pawn, non-king material on the board for both sides combined. */
export function nonPawnMaterial(chess: Chess): number {
  return pieces(chess).reduce((s, p) => s + (p.type === 'p' || p.type === 'k' ? 0 : VALUE[p.type]), 0);
}

function attackersOf(chess: Chess, square: Square, by: Color): Square[] {
  return chess.attackers(square, by);
}

/**
 * A piece is "hanging" when the opponent can win material by capturing it:
 * it is attacked and either undefended, or attacked by something cheaper.
 */
export function isHanging(chess: Chess, square: Square): boolean {
  const p = chess.get(square);
  if (!p || p.type === 'k') return false;
  const owner = p.color as Color;
  const attackers = attackersOf(chess, square, opp(owner));
  if (attackers.length === 0) return false;
  const defenders = attackersOf(chess, square, owner);
  if (defenders.length === 0) return true;
  const cheapest = Math.min(...attackers.map((s) => VALUE[chess.get(s)!.type] || 100));
  return cheapest < VALUE[p.type];
}

export function hangingPieces(chess: Chess, color: Color): PieceOn[] {
  return pieces(chess, color).filter((p) => p.type !== 'k' && isHanging(chess, p.square));
}

/** Squares of `targetColor` pieces attacked by the piece on `from`. */
export function attackedBy(chess: Chess, from: Square): PieceOn[] {
  const attacker = chess.get(from);
  if (!attacker) return [];
  const targetColor = opp(attacker.color as Color);
  return pieces(chess, targetColor).filter((t) => attackersOf(chess, t.square, attacker.color as Color).includes(from));
}

/**
 * Fork: after a move, the moved piece attacks two or more targets that are
 * each worth attacking (king, more valuable than the attacker, or undefended).
 */
export function forkTargets(chess: Chess, from: Square): PieceOn[] {
  const attacker = chess.get(from);
  if (!attacker) return [];
  const own = attacker.color as Color;
  const targets = attackedBy(chess, from).filter((t) => {
    if (t.type === 'k') return true;
    if (VALUE[t.type] > VALUE[attacker.type]) return true;
    return attackersOf(chess, t.square, t.color).length === 0;
  });
  // A fork only works if the forking piece isn't simply lost for free.
  const attackerSafe =
    attackersOf(chess, from, opp(own)).length === 0 || attackersOf(chess, from, own).length > 0 || chess.inCheck();
  return targets.length >= 2 && attackerSafe ? targets : [];
}

const RAYS: Record<string, [number, number][]> = {
  b: [
    [1, 1],
    [1, -1],
    [-1, 1],
    [-1, -1],
  ],
  r: [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ],
};
RAYS.q = [...RAYS.b, ...RAYS.r];

export interface LineTactic {
  kind: 'pin' | 'skewer';
  slider: PieceOn;
  front: PieceOn;
  back: PieceOn;
}

/** Pins and skewers created by sliders of `color`. */
export function lineTactics(chess: Chess, color: Color): LineTactic[] {
  const out: LineTactic[] = [];
  for (const s of pieces(chess, color)) {
    const rays = RAYS[s.type];
    if (!rays) continue;
    const [f0, r0] = coords(s.square);
    for (const [df, dr] of rays) {
      const hits: PieceOn[] = [];
      let f = f0 + df;
      let r = r0 + dr;
      while (hits.length < 2) {
        const at = sq(f, r);
        if (!at) break;
        const p = chess.get(at);
        if (p) {
          if (p.color === color) break;
          hits.push({ square: at, type: p.type, color: p.color as Color });
        }
        f += df;
        r += dr;
      }
      if (hits.length < 2) continue;
      const [front, back] = hits;
      const fv = front.type === 'k' ? 100 : VALUE[front.type];
      const bv = back.type === 'k' ? 100 : VALUE[back.type];
      if (bv > fv && bv > VALUE[s.type] - 1 && front.type !== 'p') out.push({ kind: 'pin', slider: s, front, back });
      else if (bv > fv && front.type === 'p') continue;
      else if (fv > bv && fv > VALUE[s.type]) out.push({ kind: 'skewer', slider: s, front, back });
    }
  }
  return out;
}

/** Make a FEN where it's `color`'s turn (a "null move"); null if that's illegal (side not to move in check). */
export function withTurn(fen: string, color: Color): string | null {
  const parts = fen.split(' ');
  if (parts[1] === color) return fen;
  parts[1] = color;
  parts[3] = '-';
  const f = parts.join(' ');
  try {
    const c = new Chess(f);
    // If the side that just passed is now giving check we're fine; the side
    // not to move must not be in check.
    const other = new Chess(fen);
    if (other.inCheck()) return null;
    return c.fen();
  } catch {
    return null;
  }
}

/** Does `color` threaten mate in one if it were their move? Returns the mating SAN if so. */
export function mateThreat(fen: string, color: Color): string | null {
  const f = withTurn(fen, color);
  if (!f) return null;
  const c = new Chess(f);
  for (const m of c.moves({ verbose: true })) {
    c.move(m);
    const mate = c.isCheckmate();
    c.undo();
    if (mate) return m.san;
  }
  return null;
}

export function isBackRankMate(chess: Chess): boolean {
  if (!chess.isCheckmate()) return false;
  const loser = chess.turn() as Color;
  const king = pieces(chess, loser).find((p) => p.type === 'k')!;
  const backRank = loser === 'w' ? '1' : '8';
  if (king.square[1] !== backRank) return false;
  const checkers = attackersOf(chess, king.square, opp(loser));
  return checkers.some((s) => {
    const t = chess.get(s)!.type;
    return (t === 'r' || t === 'q') && s[1] === backRank;
  });
}

export interface LineResult {
  /** Material change for `pov` from the start to the end of the line. */
  materialDelta: number;
  mate: boolean;
  matedSide?: Color;
  promotion: boolean;
  sans: string[];
  plies: number;
  /** Material change for `pov` after the first exchange in the line settles. */
  settledDelta: number;
}

/**
 * Play out an engine line and report what it achieves. We stop at `maxPlies`
 * but extend by one ply if the cut lands in the middle of an exchange.
 */
export function playLine(fen: string, uci: string[], pov: Color, maxPlies = 8): LineResult {
  const chess = new Chess(fen);
  const start = balance(chess, pov);
  const sans: string[] = [];
  const deltas: number[] = [];
  const captures: boolean[] = [];
  let promotion = false;
  let i = 0;
  for (; i < uci.length; i++) {
    if (i >= maxPlies) {
      const prev = sans[sans.length - 1] ?? '';
      if (!prev.includes('x') || i >= maxPlies + 2) break;
    }
    const u = uci[i];
    let m;
    try {
      m = chess.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] });
    } catch {
      break;
    }
    sans.push(m.san);
    deltas.push(balance(chess, pov) - start);
    captures.push(!!m.captured);
    if (m.promotion) promotion = true;
    if (chess.isGameOver()) {
      i++;
      break;
    }
  }
  const mate = chess.isCheckmate();
  // The first point where the next move isn't a capture: the opening exchange is over.
  const settle = captures.findIndex((_, k) => !captures[k + 1]);
  return {
    settledDelta: settle >= 0 ? deltas[settle] : 0,
    materialDelta: balance(chess, pov) - start,
    mate,
    matedSide: mate ? (chess.turn() as Color) : undefined,
    promotion,
    sans,
    plies: sans.length,
  };
}

/** Squares adjacent to the king (pawn shield region) for king-safety checks. */
export function kingShieldSquares(kingSq: Square, color: Color): Square[] {
  const [f, r] = coords(kingSq);
  const dir = color === 'w' ? 1 : -1;
  const out: Square[] = [];
  for (const df of [-1, 0, 1]) {
    for (const dr of [1, 2]) {
      const s = sq(f + df, r + dr * dir);
      if (s) out.push(s);
    }
  }
  return out;
}

export function isDeveloped(type: PieceSymbol, square: Square, color: Color): boolean {
  const home = color === 'w' ? '1' : '8';
  if (type === 'n' || type === 'b') return square[1] !== home;
  return false;
}

export interface PawnFeatures {
  doubled: number;
  isolated: number;
  passed: Square[];
}

export function pawnFeatures(chess: Chess, color: Color): PawnFeatures {
  const own = pieces(chess, color).filter((p) => p.type === 'p');
  const theirs = pieces(chess, opp(color)).filter((p) => p.type === 'p');
  const byFile = new Map<number, number[]>();
  for (const p of own) {
    const [f, r] = coords(p.square);
    byFile.set(f, [...(byFile.get(f) ?? []), r]);
  }
  let doubled = 0;
  let isolated = 0;
  for (const [f, ranks] of byFile) {
    if (ranks.length > 1) doubled += ranks.length - 1;
    if (!byFile.has(f - 1) && !byFile.has(f + 1)) isolated += ranks.length;
  }
  const passed: Square[] = [];
  for (const p of own) {
    const [f, r] = coords(p.square);
    const blocked = theirs.some((t) => {
      const [tf, tr] = coords(t.square);
      if (Math.abs(tf - f) > 1) return false;
      return color === 'w' ? tr > r : tr < r;
    });
    if (!blocked) passed.push(p.square);
  }
  return { doubled, isolated, passed };
}

export function mobility(fen: string, color: Color): number {
  const f = withTurn(fen, color) ?? fen;
  try {
    return new Chess(f).moves().length;
  } catch {
    return 0;
  }
}

export function uniq<T>(xs: T[]): T[] {
  return [...new Set(xs)];
}

export const MOTIF_LABEL: Record<Motif, string> = {
  'hanging-piece': 'Hanging pieces',
  fork: 'Forks',
  pin: 'Pins',
  skewer: 'Skewers',
  'discovered-attack': 'Discovered attacks',
  'mate-threat': 'Mate threats',
  'back-rank': 'Back-rank weakness',
  mate: 'Checkmates',
  'material-win': 'Winning material',
  'trapped-piece': 'Trapped pieces',
  promotion: 'Promotion',
  'king-safety': 'King safety',
  development: 'Development',
  'early-queen': 'Early queen moves',
  castling: 'Castling',
  'pawn-structure': 'Pawn structure',
  'passed-pawn': 'Passed pawns',
  'center-control': 'Centre control',
  'piece-activity': 'Piece activity',
  'trade-when-ahead': 'Trading when ahead',
  defence: 'Defence',
};
