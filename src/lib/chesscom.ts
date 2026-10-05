import { openingFromEcoUrl } from './pgn';
import type { GameMeta } from './types';

// Chess.com's Published-Data API: public, read-only, CORS-enabled.
// https://www.chess.com/news/view/published-data-api
const API = 'https://api.chess.com/pub';

interface ChessComPlayer {
  username: string;
  rating: number;
  result: string;
}

export interface ChessComGame {
  url: string;
  pgn?: string;
  time_control: string;
  time_class: string;
  end_time: number;
  rated: boolean;
  rules: string;
  uuid?: string;
  eco?: string;
  white: ChessComPlayer;
  black: ChessComPlayer;
}

async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, { signal });
  if (res.status === 404) throw new Error('Player not found on chess.com');
  if (!res.ok) throw new Error(`chess.com API error ${res.status}`);
  return res.json() as Promise<T>;
}

export async function fetchArchives(username: string, signal?: AbortSignal): Promise<string[]> {
  const data = await getJson<{ archives: string[] }>(`${API}/player/${encodeURIComponent(username.toLowerCase())}/games/archives`, signal);
  return data.archives ?? [];
}

function resultString(g: ChessComGame): string {
  if (g.white.result === 'win') return '1-0';
  if (g.black.result === 'win') return '0-1';
  return '1/2-1/2';
}

export function toMeta(g: ChessComGame): GameMeta | null {
  if (g.rules !== 'chess' || !g.pgn) return null;
  return {
    id: g.uuid ?? g.url,
    url: g.url,
    white: g.white.username,
    black: g.black.username,
    whiteElo: g.white.rating,
    blackElo: g.black.rating,
    result: resultString(g),
    timeControl: g.time_control,
    timeClass: g.time_class,
    endTime: g.end_time,
    opening: openingFromEcoUrl(g.eco),
    pgn: g.pgn,
    source: 'chess.com',
  };
}

/** Most recent games first. Walks back through monthly archives until `limit` games are found. */
export async function fetchRecentGames(username: string, limit = 30, signal?: AbortSignal): Promise<GameMeta[]> {
  const archives = await fetchArchives(username, signal);
  const out: GameMeta[] = [];
  for (let i = archives.length - 1; i >= 0 && out.length < limit; i--) {
    const { games } = await getJson<{ games: ChessComGame[] }>(archives[i], signal);
    const metas = games
      .map(toMeta)
      .filter((m): m is GameMeta => m !== null)
      .sort((a, b) => (b.endTime ?? 0) - (a.endTime ?? 0));
    out.push(...metas);
  }
  return out.slice(0, limit);
}

/** Find a specific game by its chess.com URL or numeric id (searches the last few months). */
export async function findGame(username: string, urlOrId: string, signal?: AbortSignal): Promise<GameMeta | null> {
  const id = urlOrId.match(/(\d{6,})/)?.[1];
  if (!id) return null;
  const archives = await fetchArchives(username, signal);
  for (let i = archives.length - 1; i >= Math.max(0, archives.length - 3); i--) {
    const { games } = await getJson<{ games: ChessComGame[] }>(archives[i], signal);
    const g = games.find((x) => x.url.endsWith(`/${id}`));
    if (g) return toMeta(g);
  }
  return null;
}

export function opponentOf(meta: GameMeta, username: string): { name: string; elo?: number } {
  const u = username.toLowerCase();
  return meta.white.toLowerCase() === u ? { name: meta.black, elo: meta.blackElo } : { name: meta.white, elo: meta.whiteElo };
}
