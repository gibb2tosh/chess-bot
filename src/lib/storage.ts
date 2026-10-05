import type { Puzzle } from './types';

// Everything lives in the browser. Nothing is sent anywhere except chess.com /
// lichess (public APIs) and, if you enable it, Anthropic. Settings and puzzles
// are small and live in localStorage; reviews are big and live in IndexedDB
// (see reviewStore.ts).

export interface Settings {
  username: string;
  depth: number;
  autoWatch: boolean;
  anthropicKey: string;
  useClaude: boolean;
}

const KEYS = { settings: 'cc.settings', puzzles: 'cc.puzzles', seen: 'cc.seen' };

export const DEFAULT_SETTINGS: Settings = { username: '', depth: 14, autoWatch: false, anthropicKey: '', useClaude: false };

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function loadSettings(): Settings {
  return { ...DEFAULT_SETTINGS, ...read<Partial<Settings>>(KEYS.settings, {}) };
}
export function saveSettings(s: Settings) {
  write(KEYS.settings, s);
}

export function loadPuzzles(): Puzzle[] {
  return read<Puzzle[]>(KEYS.puzzles, []);
}

export function savePuzzles(ps: Puzzle[]) {
  write(KEYS.puzzles, ps);
}

/** Add puzzles, keeping existing progress for ones we already have. */
export function addPuzzles(newOnes: Puzzle[]): Puzzle[] {
  const existing = loadPuzzles();
  const ids = new Set(existing.map((p) => p.id));
  const merged = [...existing, ...newOnes.filter((p) => !ids.has(p.id))];
  savePuzzles(merged);
  return merged;
}

export function updatePuzzle(p: Puzzle): Puzzle[] {
  const all = loadPuzzles().map((x) => (x.id === p.id ? p : x));
  savePuzzles(all);
  return all;
}

export function removePuzzle(id: string): Puzzle[] {
  const all = loadPuzzles().filter((x) => x.id !== id);
  savePuzzles(all);
  return all;
}

/** Game ids we've already noticed (so the watcher only auto-reviews new games). */
export function loadSeen(): string[] {
  return read<string[]>(KEYS.seen, []);
}
export function saveSeen(ids: string[]) {
  write(KEYS.seen, ids.slice(-500));
}
