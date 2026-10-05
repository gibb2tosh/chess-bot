import { afterAll, describe, expect, it } from 'vitest';
import { Chess } from 'chess.js';
import { reviewGame } from '../src/lib/review';
import { metaFromPgn } from '../src/lib/pgn';
import { extractPuzzles } from '../src/lib/puzzles';
import { buildProfile } from '../src/lib/profile';
import { botMove } from '../src/lib/bot';
import { createNodeEngine } from './nodeEngine';

const { engine, quit } = createNodeEngine();
afterAll(() => quit());

// Black blunders a knight with 4...Nd4?? and then walks into Scholar's-mate ideas.
const PGN = `[Event "Test"]
[White "alice"]
[Black "bob"]
[WhiteElo "1200"]
[BlackElo "1180"]
[Result "1-0"]
[TimeControl "300+0"]

1. e4 {[%clk 0:05:00]} e5 {[%clk 0:04:58]} 2. Bc4 {[%clk 0:04:55]} Nc6 {[%clk 0:04:50]} 3. Qh5 {[%clk 0:04:50]} Nf6 {[%clk 0:04:40]} 4. Qxf7# {[%clk 0:04:45]} 1-0`;

describe('full review pipeline with Stockfish', () => {
  it('flags the losing move, explains it, and makes a puzzle', async () => {
    const meta = metaFromPgn(PGN);
    const review = await reviewGame(meta, engine, { depth: 10, username: 'bob' });
    expect(review.userColor).toBe('b');
    expect(review.plies).toHaveLength(7);

    const nf6 = review.plies.find((p) => p.san === 'Nf6')!;
    expect(nf6.classification).toBe('blunder');
    expect(nf6.explanation.headline).toMatch(/mate/i);
    expect(nf6.explanation.allowed).toContain('mate');
    expect(nf6.bestSan).toMatch(/g6|Qe7|Qf6/);

    const mate = review.plies.find((p) => p.san === 'Qxf7#')!;
    expect(['best', 'great', 'brilliant']).toContain(mate.classification);
    expect(mate.explanation.played).toContain('mate');

    expect(review.accuracy.w).toBeGreaterThan(review.accuracy.b);
    expect(review.plies[1].clock).toBe(298);
    expect(review.plies[3].timeSpent).toBe(8);

    // Puzzle from bob's (defensive) blunder: find the move that stops mate.
    const puzzles = extractPuzzles(review);
    expect(puzzles.length).toBeGreaterThanOrEqual(1);
    const pz = puzzles[0];
    expect(pz.color).toBe('b');
    expect(pz.fen).toBe(nf6.fenBefore);
    new Chess(pz.fen).move({ from: pz.solution[0].slice(0, 2), to: pz.solution[0].slice(2, 4) });

    const profile = buildProfile([review]);
    expect(profile.games).toBe(1);
    expect(profile.record.losses).toBe(1);
    expect(profile.allowed.map(([m]) => m)).toContain('mate');
  }, 60_000);

  it('detects a tactical fork in the explanation', async () => {
    // 1.e4 e5 2.Nf3 Nc6 3.Bc4 Nd4? 4.Nxe5? Qg5! forks e5 and g2 (classic trap).
    const pgn = `[White "a"]\n[Black "b"]\n[Result "*"]\n\n1. e4 e5 2. Nf3 Nc6 3. Bc4 Nd4 4. Nxe5 Qg5 *`;
    const review = await reviewGame(metaFromPgn(pgn), engine, { depth: 12, username: 'a' });
    const nxe5 = review.plies.find((p) => p.san === 'Nxe5')!;
    expect(['mistake', 'blunder', 'inaccuracy']).toContain(nxe5.classification);
    const qg5 = review.plies.find((p) => p.san === 'Qg5')!;
    expect(qg5.explanation.played).toContain('fork');
    expect(qg5.explanation.headline).toMatch(/fork|attacks/);
  }, 60_000);

  it('the bot plays legal moves at any rating', async () => {
    const fen = 'r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3';
    for (const elo of [500, 1500, 2300]) {
      const mv = await botMove(engine, fen, elo);
      expect(() => new Chess(fen).move({ from: mv.slice(0, 2), to: mv.slice(2, 4), promotion: mv[4] })).not.toThrow();
    }
  }, 60_000);
});
