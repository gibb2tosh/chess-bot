import { Chess } from 'chess.js';
import type { Color, GameMeta } from './types';

export interface ParsedMove {
  ply: number;
  moveNumber: number;
  color: Color;
  san: string;
  uci: string;
  fenBefore: string;
  fenAfter: string;
  clock?: number;
}

export interface ParsedGame {
  headers: Record<string, string>;
  startFen: string;
  moves: ParsedMove[];
}

function parseClock(comment: string | undefined): number | undefined {
  if (!comment) return undefined;
  const m = comment.match(/\[%clk\s+(\d+):(\d+):(\d+(?:\.\d+)?)\]/);
  if (!m) return undefined;
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}

export function parsePgn(pgn: string): ParsedGame {
  const chess = new Chess();
  chess.loadPgn(pgn);
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(chess.getHeaders())) if (v != null) headers[k] = String(v);

  const comments = new Map<string, string>();
  for (const c of chess.getComments()) comments.set(c.fen, c.comment);

  const history = chess.history({ verbose: true });
  const moves: ParsedMove[] = history.map((m, i) => {
    const color = m.color as Color;
    const fenParts = m.before.split(' ');
    return {
      ply: i + 1,
      moveNumber: Number(fenParts[5]),
      color,
      san: m.san,
      uci: m.from + m.to + (m.promotion ?? ''),
      fenBefore: m.before,
      fenAfter: m.after,
      clock: parseClock(comments.get(m.after)),
    };
  });
  const startFen = history.length ? history[0].before : chess.fen();
  return { headers, startFen, moves };
}

function parseElo(v: string | undefined) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

/** Build a GameMeta from a raw PGN (used for pasted games). */
export function metaFromPgn(pgn: string, extra: Partial<GameMeta> = {}): GameMeta {
  const { headers } = parsePgn(pgn);
  const opening = headers.Opening ?? openingFromEcoUrl(headers.ECOUrl);
  const id =
    extra.id ??
    headers.Link ??
    `${headers.White}-${headers.Black}-${headers.Date}-${headers.EndTime ?? ''}-${hash(pgn)}`;
  return {
    id,
    url: headers.Link,
    white: headers.White ?? 'White',
    black: headers.Black ?? 'Black',
    whiteElo: parseElo(headers.WhiteElo),
    blackElo: parseElo(headers.BlackElo),
    result: headers.Result ?? '*',
    timeControl: headers.TimeControl,
    opening,
    eco: headers.ECO,
    pgn,
    source: 'pgn',
    ...extra,
  };
}

export function openingFromEcoUrl(url: string | undefined): string | undefined {
  if (!url) return undefined;
  const slug = url.split('/openings/')[1];
  if (!slug) return undefined;
  return decodeURIComponent(slug)
    .replace(/-\d.*$/, '') // drop the move sequence suffix chess.com appends
    .replace(/-/g, ' ');
}

function hash(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

/** Convert a UCI line to SAN from a given FEN; stops at the first illegal move. */
export function uciLineToSan(fen: string, uci: string[]): string[] {
  const chess = new Chess(fen);
  const out: string[] = [];
  for (const u of uci) {
    try {
      const m = chess.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] });
      out.push(m.san);
    } catch {
      break;
    }
  }
  return out;
}

export function uciToSan(fen: string, uci: string): string {
  return uciLineToSan(fen, [uci])[0] ?? uci;
}
