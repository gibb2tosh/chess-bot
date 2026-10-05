import { useEffect, useMemo, useState } from 'react';
import { Chess } from 'chess.js';
import { Board, lastMoveHighlight, type BoardArrow } from '../components/Board';
import { getAnalysisEngine } from '../lib/engine';
import { flip, winProb } from '../lib/eval';
import { fetchThemedPuzzle } from '../lib/lichess';
import { MOTIF_LABEL } from '../lib/motifs';
import { duePuzzles, schedule } from '../lib/puzzles';
import type { Puzzle } from '../lib/types';

interface Props {
  puzzles: Puzzle[];
  drills: { label: string; angle: string }[];
  onUpdate: (p: Puzzle) => void;
  onAdd: (ps: Puzzle[]) => void;
  onRemove: (id: string) => void;
  /** A drill requested from the Insights page; fetched on arrival. */
  autoDrill?: string | null;
  onAutoDrillStarted?: () => void;
}

const SOURCE_LABEL: Record<Puzzle['source'], string> = {
  'own-mistake': 'From your mistake',
  'missed-punish': 'Opponent erred — you missed it',
  'opponent-blunder': 'From your game',
  lichess: 'Similar pattern (lichess)',
};

export function PuzzlesPage({ puzzles, drills, onUpdate, onAdd, onRemove, autoDrill, onAutoDrillStarted }: Props) {
  const [active, setActive] = useState<Puzzle | null>(null);
  const [fetching, setFetching] = useState('');
  const [error, setError] = useState('');
  const due = useMemo(() => duePuzzles(puzzles), [puzzles]);

  const fetchDrill = async (angle: string, count = 3) => {
    setFetching(angle);
    setError('');
    try {
      const got: Puzzle[] = [];
      for (let i = 0; i < count; i++) {
        const p = await fetchThemedPuzzle(angle);
        if (p && !got.some((g) => g.id === p.id)) got.push(p);
      }
      onAdd(got);
      if (got[0]) setActive(got[0]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setFetching('');
    }
  };

  useEffect(() => {
    if (!autoDrill) return;
    onAutoDrillStarted?.();
    fetchDrill(autoDrill);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoDrill]);

  const next = () => {
    const remaining = duePuzzles(puzzles).filter((p) => p.id !== active?.id);
    setActive(remaining[0] ?? null);
  };

  return (
    <div className="page">
      {active ? (
        <Solver
          key={active.id}
          puzzle={active}
          onDone={(success) => onUpdate(schedule(active, success))}
          onNext={next}
          onClose={() => setActive(null)}
        />
      ) : (
        <section className="card">
          <h2>Puzzles from your games</h2>
          <p className="muted">
            {puzzles.length} saved · {due.length} due for review. Puzzles you solve come back less often (spaced repetition); misses come back tomorrow.
          </p>
          <button className="primary" disabled={!due.length} onClick={() => setActive(due[0])}>
            {due.length ? `Start training (${due.length} due)` : 'Nothing due — great work'}
          </button>
        </section>
      )}

      <section className="card">
        <h2>Train similar patterns</h2>
        <p className="muted small">Fetches fresh puzzles from lichess on the themes where your games show you need practice.</p>
        <div className="chips">
          {drills.map((d) => (
            <button key={d.angle} className="chip clickable" disabled={!!fetching} onClick={() => fetchDrill(d.angle)}>
              {fetching === d.angle ? 'Loading…' : d.label}
            </button>
          ))}
        </div>
        {error && <p className="error">{error}</p>}
      </section>

      {puzzles.length > 0 && (
        <section className="card">
          <h2>All puzzles</h2>
          <ul className="game-list">
            {[...puzzles].reverse().map((p) => (
              <li key={p.id} className="game-item">
                <div className="game-main">
                  <div>
                    {p.themes.map((t) => MOTIF_LABEL[t]).join(', ')} <span className="muted small">· {SOURCE_LABEL[p.source]}</span>
                  </div>
                  <div className="muted small">
                    Solved {p.solved}/{p.attempts} · box {p.box}
                    {p.playedSan && ` · you played ${p.playedSan}`}
                    {p.rating && ` · rated ${p.rating}`}
                  </div>
                </div>
                <button onClick={() => setActive(p)}>Solve</button>
                <button className="ghost" aria-label="Delete puzzle" onClick={() => onRemove(p.id)}>
                  ✕
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

type State = 'solving' | 'checking' | 'correct' | 'wrong' | 'solved' | 'failed';

function Solver({ puzzle, onDone, onNext, onClose }: { puzzle: Puzzle; onDone: (ok: boolean) => void; onNext: () => void; onClose: () => void }) {
  const [step, setStep] = useState(0);
  const [fen, setFen] = useState(puzzle.fen);
  const [state, setState] = useState<State>('solving');
  const [last, setLast] = useState<string | undefined>();
  const [message, setMessage] = useState('');
  const [hintArrow, setHintArrow] = useState<BoardArrow | null>(null);
  const [failedOnce, setFailedOnce] = useState(false);

  const solverColor = puzzle.color;

  const play = (f: string, uci: string) => {
    const c = new Chess(f);
    c.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
    return c.fen();
  };

  const finish = (ok: boolean, msg: string) => {
    setState(ok ? 'solved' : 'failed');
    setMessage(msg);
    onDone(ok && !failedOnce);
  };

  const advance = (afterFen: string, nextStep: number) => {
    if (nextStep >= puzzle.solution.length) {
      finish(true, failedOnce ? 'Solved (after a retry).' : 'Solved! ✓');
      return;
    }
    const reply = puzzle.solution[nextStep];
    setState('correct');
    setTimeout(() => {
      setFen(play(afterFen, reply));
      setLast(reply);
      setStep(nextStep + 1);
      setState('solving');
    }, 450);
  };

  const onMove = (uci: string): boolean => {
    if (state !== 'solving') return false;
    const expected = puzzle.solution[step];
    const after = play(fen, uci);
    setHintArrow(null);
    if (uci === expected || (expected && uci.slice(0, 4) === expected.slice(0, 4) && !expected[4])) {
      setFen(after);
      setLast(uci);
      advance(after, step + 1);
      return true;
    }
    if (new Chess(after).isCheckmate()) {
      setFen(after);
      setLast(uci);
      finish(true, 'Checkmate — that works too! ✓');
      return true;
    }
    // Not the stored answer: ask the engine whether it's equally good.
    setFen(after);
    setLast(uci);
    setState('checking');
    const engine = getAnalysisEngine();
    Promise.all([engine.analyse(fen, { depth: 14, multipv: 1 }), engine.analyse(after, { depth: 14, multipv: 1 })])
      .then(([[best], [reply]]) => {
        const bestWin = best ? winProb(best.score) : 0.5;
        const ourWin = reply ? winProb(flip(reply.score)) : new Chess(after).isDraw() ? 0.5 : 0;
        const holds = ourWin >= bestWin - 0.04 && (bestWin < 0.7 || ourWin >= 0.7);
        if (holds) {
          finish(true, 'Not the move we stored, but the engine agrees it works just as well. ✓');
        } else {
          setFailedOnce(true);
          setMessage('Not quite — that lets your opponent off the hook. Try again.');
          setTimeout(() => {
            setFen(fen);
            setLast(step > 0 ? puzzle.solution[step - 1] : undefined);
            setState('solving');
          }, 900);
        }
      })
      .catch(() => setState('solving'));
    return true;
  };

  const showSolution = () => {
    const u = puzzle.solution[step];
    if (!u) return;
    setFailedOnce(true);
    setHintArrow({ from: u.slice(0, 2), to: u.slice(2, 4), color: 'rgba(80, 160, 80, 0.85)' });
  };

  const done = state === 'solved' || state === 'failed';
  const toMove = solverColor === 'w' ? 'White' : 'Black';

  return (
    <div className="review">
      <div className="board-col">
        <Board
          id="puzzle-board"
          fen={fen}
          orientation={solverColor === 'w' ? 'white' : 'black'}
          onMove={done ? undefined : onMove}
          arrows={hintArrow ? [hintArrow] : []}
          highlights={lastMoveHighlight(last)}
        />
      </div>
      <div className="side-col">
        <section className="card">
          <h2>{toMove} to move</h2>
          <p className="muted">
            {SOURCE_LABEL[puzzle.source]}
            {puzzle.playedSan && ` — in the game, ${puzzle.playedSan} was played.`}
          </p>
          <p className={`status ${state}`}>
            {state === 'checking' ? 'Checking with the engine…' : state === 'correct' ? 'Correct! Keep going…' : message || 'Find the best move.'}
          </p>
          {puzzle.hint && !done && <details><summary>Hint</summary>{puzzle.hint}</details>}
          <div className="actions">
            {!done && <button onClick={showSolution}>Show move</button>}
            {done && (
              <button className="primary" onClick={onNext}>
                Next puzzle
              </button>
            )}
            <button onClick={onClose}>Back to list</button>
          </div>
          {done && (
            <div className="chips">
              {puzzle.themes.map((t) => (
                <span className="chip" key={t}>
                  {MOTIF_LABEL[t]}
                </span>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
