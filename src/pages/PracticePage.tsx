import { useCallback, useEffect, useRef, useState } from 'react';
import { Chess } from 'chess.js';
import { Board, lastMoveHighlight, type BoardArrow } from '../components/Board';
import { botMove } from '../lib/bot';
import { getAnalysisEngine, getBotEngine } from '../lib/engine';
import { flip, formatScore } from '../lib/eval';
import type { Color, Score } from '../lib/types';

export interface PracticeSetup {
  fen: string;
  botElo: number;
  userColor: Color;
  label: string;
}

const START = new Chess().fen();

export function PracticePage({ setup }: { setup: PracticeSetup | null }) {
  const [config, setConfig] = useState<PracticeSetup>(setup ?? { fen: START, botElo: 1200, userColor: 'w', label: 'Free play' });
  const [history, setHistory] = useState<string[]>([config.fen]);
  const [moves, setMoves] = useState<string[]>([]);
  const [thinking, setThinking] = useState(false);
  const [hint, setHint] = useState<BoardArrow | null>(null);
  const [evalScore, setEvalScore] = useState<Score | null>(null);
  const gameId = useRef(0);

  const fen = history[history.length - 1];
  const chess = new Chess(fen);
  const turn = chess.turn() as Color;
  const over = chess.isGameOver();

  const restart = useCallback((c: PracticeSetup) => {
    gameId.current++;
    setConfig(c);
    setHistory([c.fen]);
    setMoves([]);
    setHint(null);
    setEvalScore(null);
    setThinking(false);
  }, []);

  // Bot's turn.
  useEffect(() => {
    if (over || turn === config.userColor) return;
    const id = gameId.current;
    setThinking(true);
    const started = Date.now();
    botMove(getBotEngine(), fen, config.botElo)
      .then(async (uci) => {
        // Small delay so the bot doesn't feel instant.
        const wait = Math.max(0, 400 - (Date.now() - started));
        await new Promise((r) => setTimeout(r, wait));
        if (id !== gameId.current) return;
        const c = new Chess(fen);
        c.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
        setHistory((h) => [...h, c.fen()]);
        setMoves((m) => [...m, uci]);
      })
      .catch(() => undefined)
      .finally(() => {
        if (id === gameId.current) setThinking(false);
      });
  }, [fen, turn, over, config.userColor, config.botElo]);

  const onMove = (uci: string) => {
    if (thinking || over || turn !== config.userColor) return false;
    const c = new Chess(fen);
    try {
      c.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
    } catch {
      return false;
    }
    setHint(null);
    setEvalScore(null);
    setHistory((h) => [...h, c.fen()]);
    setMoves((m) => [...m, uci]);
    return true;
  };

  const undo = () => {
    gameId.current++;
    setThinking(false);
    // Take back to the user's last turn.
    let n = history.length - 1;
    if (n === 0) return;
    n--;
    while (n > 0 && new Chess(history[n]).turn() !== config.userColor) n--;
    setHistory(history.slice(0, n + 1));
    setMoves(moves.slice(0, n));
    setHint(null);
  };

  const showHint = async () => {
    const [best] = await getAnalysisEngine().analyse(fen, { depth: 14, multipv: 1 });
    if (best?.move) setHint({ from: best.move.slice(0, 2), to: best.move.slice(2, 4), color: 'rgba(80, 160, 80, 0.85)' });
  };

  const showEval = async () => {
    const [best] = await getAnalysisEngine().analyse(fen, { depth: 14, multipv: 1 });
    if (best) setEvalScore(turn === 'w' ? best.score : flip(best.score));
  };

  let status = thinking ? `Bot (~${config.botElo}) is thinking…` : turn === config.userColor ? 'Your move' : '';
  if (chess.isCheckmate()) status = turn === config.userColor ? 'Checkmate — the bot wins.' : 'Checkmate — you win! 🎉';
  else if (chess.isDraw() || chess.isStalemate()) status = 'Draw.';

  const sanMoves = (() => {
    const c = new Chess(config.fen);
    return moves.map((u) => c.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] }).san);
  })();

  return (
    <div className="review">
      <div className="board-col">
        <Board
          id="practice-board"
          fen={fen}
          orientation={config.userColor === 'w' ? 'white' : 'black'}
          onMove={onMove}
          arrows={hint ? [hint] : []}
          highlights={lastMoveHighlight(moves[moves.length - 1])}
        />
      </div>
      <div className="side-col">
        <section className="card">
          <h2>{config.label}</h2>
          <p className="status">{status}</p>
          <div className="row">
            <label>
              Bot rating{' '}
              <input
                type="number"
                min={400}
                max={2800}
                step={50}
                value={config.botElo}
                onChange={(e) => setConfig({ ...config, botElo: Number(e.target.value) || 1200 })}
                style={{ width: '6rem' }}
              />
            </label>
          </div>
          <div className="actions">
            <button onClick={undo} disabled={history.length <= 1}>Take back</button>
            <button onClick={showHint} disabled={thinking || over}>Hint</button>
            <button onClick={showEval}>Evaluate {evalScore && `(${formatScore(evalScore)})`}</button>
            <button onClick={() => restart({ ...config })}>Restart position</button>
            <button onClick={() => restart({ ...config, userColor: config.userColor === 'w' ? 'b' : 'w' })}>Switch sides</button>
            <button onClick={() => restart({ ...config, fen: START, label: 'Free play' })}>New game</button>
          </div>
          <p className="muted small">
            The bot imitates a ~{config.botElo} player: it searches shallower and sometimes picks a weaker move, roughly as often as players
            at that level do.
          </p>
        </section>
        <section className="card">
          <div className="pgn-line">
            {sanMoves.map((s, i) => (
              <span key={i}>{s} </span>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
