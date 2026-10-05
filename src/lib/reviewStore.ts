import { gamePlayedAt } from './pgn';
import type { GameReview } from './types';

// Reviews are ~1.5 KB per half-move, so a few dozen games would overflow
// localStorage (~5 MB). They live in IndexedDB instead, which has room for
// thousands. Small things (settings, puzzles) stay in localStorage.

const DB_NAME = 'chess-coach';
const DB_VERSION = 1;
const STORE = 'reviews';
const LEGACY_KEY = 'cc.reviews';

let dbPromise: Promise<IDBDatabase> | null = null;
/** Used when IndexedDB is unavailable (some private-browsing modes): reviews last for the session only. */
let memoryFallback: Map<string, GameReview> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
      };
      req.onsuccess = () => {
        const db = req.result;
        // Let a newer version of the app (in another tab) upgrade the schema.
        db.onversionchange = () => {
          db.close();
          dbPromise = null;
        };
        resolve(db);
      };
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error('IndexedDB is blocked by another tab'));
    });
    dbPromise.catch(() => {
      dbPromise = null;
    });
  }
  return dbPromise;
}

function tx<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  return openDb().then(
    (db) =>
      new Promise<T | undefined>((resolve, reject) => {
        const t = db.transaction(STORE, mode);
        const req = fn(t.objectStore(STORE));
        t.oncomplete = () => resolve(req ? req.result : undefined);
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(t.error ?? new Error('IndexedDB transaction aborted'));
      }),
  );
}

async function withFallback<T>(idb: () => Promise<T>, mem: (m: Map<string, GameReview>) => T): Promise<T> {
  if (memoryFallback) return mem(memoryFallback);
  try {
    return await idb();
  } catch (e) {
    console.warn('IndexedDB unavailable; reviews will only be kept for this session.', e);
    memoryFallback = new Map();
    return mem(memoryFallback);
  }
}

/**
 * The same chess.com game can arrive with different ids (API uuid vs. the PGN's
 * Link when pasted), so match on the game URL as well.
 */
export function findReviewOf(reviews: GameReview[], meta: { id: string; url?: string }): GameReview | undefined {
  return reviews.find((r) => r.meta.id === meta.id || (!!meta.url && r.meta.url === meta.url));
}

/** Newest game first. */
export function sortReviews(rs: GameReview[]): GameReview[] {
  return [...rs].sort((a, b) => gamePlayedAt(b) - gamePlayedAt(a));
}

export async function loadReviews(): Promise<GameReview[]> {
  await migrateLegacy();
  const all = await withFallback(
    async () => ((await tx<GameReview[]>('readonly', (s) => s.getAll() as IDBRequest<GameReview[]>)) ?? []),
    (m) => [...m.values()],
  );
  return sortReviews(all);
}

export async function saveReview(r: GameReview): Promise<void> {
  await withFallback(
    async () => {
      await tx('readwrite', (s) => s.put(r, r.meta.id));
    },
    (m) => {
      m.set(r.meta.id, r);
    },
  );
}

export async function deleteReview(id: string): Promise<void> {
  await withFallback(
    async () => {
      await tx('readwrite', (s) => s.delete(id));
    },
    (m) => {
      m.delete(id);
    },
  );
}

let migrated = false;
/** One-time move of reviews saved by the first version (localStorage) into IndexedDB. */
async function migrateLegacy(): Promise<void> {
  if (migrated) return;
  migrated = true;
  let legacy: GameReview[] = [];
  try {
    legacy = JSON.parse(localStorage.getItem(LEGACY_KEY) ?? '[]');
  } catch {
    return;
  }
  if (!legacy.length) return;
  try {
    for (const r of legacy) await saveReview(r);
    // Only drop the old copy once it's safely in IndexedDB.
    if (!memoryFallback) localStorage.removeItem(LEGACY_KEY);
  } catch (e) {
    console.warn('Could not migrate saved reviews', e);
  }
}

/** For tests: close and forget cached connections/state. */
export async function _resetForTests() {
  if (dbPromise) (await dbPromise.catch(() => null))?.close();
  dbPromise = null;
  memoryFallback = null;
  migrated = false;
}
