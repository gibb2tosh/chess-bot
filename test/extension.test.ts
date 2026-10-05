import { describe, expect, it } from 'vitest';
import '../extension/lib.js';

const ext = (globalThis as unknown as { ChessCoachExt: {
  gameIdFromPath: (p: string) => string | null;
  isFinishedGame: (f: typeof fetch, user: string, id: string, months?: number) => Promise<boolean>;
  buildAppUrl: (app: string, user: string, game: string) => string;
  pollDelay: (ms: number) => number;
} }).ChessCoachExt;

function fakeApi(archives: Record<string, { url: string }[]>) {
  const calls: string[] = [];
  const f = (async (url: string) => {
    calls.push(url);
    if (url.endsWith('/games/archives')) {
      return new Response(JSON.stringify({ archives: Object.keys(archives) }));
    }
    return new Response(JSON.stringify({ games: archives[url] ?? [] }));
  }) as unknown as typeof fetch;
  return { f, calls };
}

describe('extension helpers', () => {
  it('recognises game pages', () => {
    expect(ext.gameIdFromPath('/game/live/123456789')).toBe('123456789');
    expect(ext.gameIdFromPath('/game/daily/987654321')).toBe('987654321');
    expect(ext.gameIdFromPath('/game/123456789')).toBe('123456789');
    expect(ext.gameIdFromPath('/analysis/game/live/123456789')).toBe('123456789');
    expect(ext.gameIdFromPath('/home')).toBeNull();
    expect(ext.gameIdFromPath('/play/online')).toBeNull();
  });

  it('only treats a game as finished once it is in the public archive', async () => {
    const A = 'https://api.chess.com/pub/player/me/games/2026/09';
    const B = 'https://api.chess.com/pub/player/me/games/2026/10';
    const inProgress = fakeApi({ [A]: [], [B]: [{ url: 'https://www.chess.com/game/live/111' }] });
    expect(await ext.isFinishedGame(inProgress.f, 'Me', '222', 1)).toBe(false);
    const done = fakeApi({ [A]: [], [B]: [{ url: 'https://www.chess.com/game/live/222' }] });
    expect(await ext.isFinishedGame(done.f, 'Me', '222', 1)).toBe(true);
    // Lower-cases the username for the API, and searches older months when asked.
    const old = fakeApi({ [A]: [{ url: 'https://www.chess.com/game/live/333' }], [B]: [] });
    expect(await ext.isFinishedGame(old.f, 'Me', '333', 1)).toBe(false);
    expect(await ext.isFinishedGame(old.f, 'Me', '333', 3)).toBe(true);
    expect(old.calls[0]).toBe('https://api.chess.com/pub/player/me/games/archives');
    // Ids are matched exactly, not as substrings.
    const near = fakeApi({ [B]: [{ url: 'https://www.chess.com/game/live/1222' }] });
    expect(await ext.isFinishedGame(near.f, 'me', '222', 1)).toBe(false);
  });

  it('builds the app link and backs off polling', () => {
    expect(ext.buildAppUrl('http://localhost:5173/', 'me', 'https://www.chess.com/game/live/1?tab=x')).toBe(
      'http://localhost:5173/?user=me&game=https%3A%2F%2Fwww.chess.com%2Fgame%2Flive%2F1',
    );
    expect(ext.pollDelay(0)).toBe(15000);
    expect(ext.pollDelay(11 * 60 * 1000)).toBe(60000);
  });
});
