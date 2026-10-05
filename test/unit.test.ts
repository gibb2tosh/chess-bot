import { describe, expect, it } from 'vitest';
import { Chess } from 'chess.js';
import { MATED, flip, gameAccuracy, moveAccuracy, winProb } from '../src/lib/eval';
import { parseInfo } from '../src/lib/engine';
import { forkTargets, hangingPieces, lineTactics, mateThreat, playLine } from '../src/lib/motifs';
import { classifyMove, phaseOf } from '../src/lib/classify';
import { describeMove } from '../src/lib/explain';
import { pickMove, styleForRating } from '../src/lib/bot';
import { schedule, trimSolution } from '../src/lib/puzzles';
import { puzzleFromLichess } from '../src/lib/lichess';
import { openingFromEcoUrl, parsePgn } from '../src/lib/pgn';
import type { Puzzle } from '../src/lib/types';

describe('eval', () => {
  it('maps scores to win probability', () => {
    expect(winProb({ cp: 0 })).toBeCloseTo(0.5);
    expect(winProb({ cp: 300 })).toBeGreaterThan(0.7);
    expect(winProb({ mate: 3 })).toBe(1);
    expect(winProb({ mate: -2 })).toBe(0);
    expect(winProb(MATED)).toBe(0);
    expect(winProb(flip(MATED))).toBe(1);
  });
  it('computes accuracy', () => {
    expect(moveAccuracy(50, 50)).toBeGreaterThan(99);
    expect(moveAccuracy(80, 20)).toBeLessThan(10);
    expect(gameAccuracy([100, 100, 10])).toBeLessThan(70);
  });
});

describe('uci parsing', () => {
  it('parses info lines', () => {
    const l = parseInfo('info depth 12 seldepth 13 multipv 2 score cp 269 nodes 1 nps 1 hashfull 5 time 56 pv c4f7 e8e7 f7g8');
    expect(l).toMatchObject({ multipv: 2, depth: 12, score: { cp: 269 }, move: 'c4f7', pv: ['c4f7', 'e8e7', 'f7g8'] });
    expect(parseInfo('info depth 3 score mate -2 upperbound pv a1a2')?.score).toEqual({ mate: -2 });
    expect(parseInfo('info string NNUE enabled')).toBeNull();
  });
});

describe('motifs', () => {
  it('finds hanging pieces', () => {
    const c = new Chess('4k3/8/8/3n4/4P3/8/8/4K3 b - - 0 1');
    expect(hangingPieces(c, 'b').map((p) => p.square)).toEqual(['d5']);
  });
  it('detects a knight fork', () => {
    const c = new Chess('r3k3/8/8/8/8/8/8/4K3 w - - 0 1');
    c.put({ type: 'n', color: 'w' }, 'c7');
    expect(forkTargets(c, 'c7').map((t) => t.type).sort()).toEqual(['k', 'r']);
  });
  it('detects pins', () => {
    const c = new Chess('4k3/4n3/8/8/8/8/8/4RK2 w - - 0 1');
    expect(lineTactics(c, 'w')[0]).toMatchObject({ kind: 'pin', front: { square: 'e7' }, back: { type: 'k' } });
  });
  it('detects mate threats', () => {
    // Scholar's mate set-up: White threatens Qxf7#.
    const fen = 'r1bqkbnr/pppp1ppp/2n5/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR b KQkq - 3 3';
    expect(mateThreat(fen, 'w')).toBe('Qxf7#');
  });
  it('plays out lines and counts material', () => {
    const r = playLine('4k3/8/8/3n4/4P3/8/8/4K3 w - - 0 1', ['e4d5'], 'w');
    expect(r.materialDelta).toBe(3);
  });
});

describe('wording', () => {
  it('describes amounts of material and matches verbs to "you"', async () => {
    const { materialAmount, agree } = await import('../src/lib/explain');
    expect(materialAmount(7)).toBe('a rook and two pawns');
    expect(materialAmount(12)).toBe("more than a queen's worth of material");
    expect(agree('you', 'wins a piece')).toBe('win a piece');
    expect(agree('you', 'pushes a passed pawn')).toBe('push a passed pawn');
    expect(agree('your opponent', 'wins a piece')).toBe('wins a piece');
  });
});

describe('describeMove', () => {
  it('explains a fork', () => {
    const f = describeMove('r3k3/8/8/1N6/8/8/8/4K3 w - - 0 1', 'b5c7');
    expect(f.motifs).toContain('fork');
    expect(f.phrases.join(' ')).toMatch(/forks the king and the rook on a8/);
  });
  it('recognises castling and development', () => {
    expect(describeMove('r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4', 'e1g1').motifs).toContain('castling');
    expect(describeMove('rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2', 'g1f3').motifs).toContain('development');
  });
});

describe('classification', () => {
  const fen = 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2';
  const lines = [
    { move: 'g1f3', pv: ['g1f3'], score: { cp: 40 }, depth: 10 },
    { move: 'b1c3', pv: ['b1c3'], score: { cp: 30 }, depth: 10 },
  ];
  it('grades by expected-points loss', () => {
    expect(classifyMove({ fenBefore: fen, playedUci: 'g1f3', lines, afterScore: { cp: 40 } }).classification).toBe('best');
    expect(classifyMove({ fenBefore: fen, playedUci: 'a2a3', lines, afterScore: { cp: -20 } }).classification).toBe('inaccuracy');
    expect(classifyMove({ fenBefore: fen, playedUci: 'd1h5', lines, afterScore: { cp: -350 } }).classification).toBe('blunder');
  });
  it('detects phases', () => {
    expect(phaseOf(fen, 2)).toBe('opening');
    expect(phaseOf('4k3/pp6/8/8/8/8/PP6/4K2R w - - 0 40', 40)).toBe('endgame');
  });
});

describe('bot', () => {
  it('weakens with lower rating', () => {
    expect(styleForRating(800).temperature).toBeGreaterThan(styleForRating(2000).temperature);
    expect(styleForRating(800).depth).toBeLessThan(styleForRating(2000).depth);
  });
  it('picks among candidates by softmax over loss', () => {
    const cands = [
      { move: 'a', win: 0.6 },
      { move: 'b', win: 0.3 },
    ];
    const strong = pickMove(cands, 0.005, () => 0.99);
    expect(strong.candidates[0].p).toBeGreaterThan(0.999);
    const weak = pickMove(cands, 0.3, () => 0.99);
    expect(weak.move).toBe('b');
  });
});

describe('puzzles', () => {
  it('trims a winning line to its forcing part', () => {
    // White wins the rook with a fork: Nc7+ Kd8 Nxa8.
    const sol = trimSolution('r3k3/8/8/1N6/8/8/8/4K3 w - - 0 1', ['b5c7', 'e8d8', 'c7a8', 'd8c8', 'e1e2']);
    expect(sol).toEqual(['b5c7', 'e8d8', 'c7a8']);
  });
  it('schedules with Leitner boxes', () => {
    const p = { box: 0, due: 0, attempts: 0, solved: 0 } as Puzzle;
    const ok = schedule(p, true, 0);
    expect(ok.box).toBe(1);
    expect(ok.due).toBe(24 * 3600 * 1000);
    expect(schedule(ok, false, 0).box).toBe(0);
  });
  it('parses lichess puzzles', () => {
    const p = puzzleFromLichess({
      game: { pgn: 'e4 e5 Bc4 Nc6 Qh5 Nf6' },
      puzzle: { id: 'x', rating: 900, solution: ['h5f7'], themes: ['mateIn1', 'opening'], initialPly: 5 },
    })!;
    expect(p.color).toBe('w');
    expect(p.themes).toContain('mate');
  });
});

describe('pgn', () => {
  it('reads clocks and openings', () => {
    const g = parsePgn('[White "a"]\n[Black "b"]\n\n1. e4 {[%clk 0:03:00]} e5 {[%clk 0:02:58.5]} *');
    expect(g.moves.map((m) => m.clock)).toEqual([180, 178.5]);
    // Malformed header lines from other tools are skipped rather than rejecting the game.
    expect(parsePgn('[White "a"]\n[X-Source "tool"]\n\n1. e4 e5 *').moves).toHaveLength(2);
    expect(() => parsePgn('[White "a"]\n\n1. e4 Ke7?? Qxe9 *')).toThrow();
    expect(openingFromEcoUrl('https://www.chess.com/openings/Italian-Game-Two-Knights-Defense-4.d3')).toBe('Italian Game Two Knights Defense');
  });
});
