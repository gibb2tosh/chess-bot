import { useEffect, useMemo, useRef, useState } from 'react';
import { Chess } from 'chess.js';
import { BestMoves, ExploreLine, MoveFeedbackView, ThreatLine } from '../components/AnalysisParts';
import { Board, lastMoveHighlight, type BoardArrow } from '../components/Board';
import { EvalBar } from '../components/EvalBar';
import { CLASS_INFO } from '../components/ui';
import { toWhite, turnOf, useExploration, useThreat } from '../components/useAnalysis';
import { getAnalysisEngine } from '../lib/engine';
import { flip, winProb } from '../lib/eval';
import { fetchThemedPuzzle } from '../lib/lichess';
import { MOTIF_LABEL } from '../lib/motifs';
import { uciLineToSan } from '../lib/pgn';
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

type State = 'solving' | 'checking' | 'correct' | 'solved';

/** When the engine accepts a move that isn't the stored answer, we remember both. */
interface Alternative {
  /** Moves played before the alternative (from the puzzle start). */
  before: string[];
  uci: string;
  san: string;
  /** The stored answer from that point on. */
  expected: string[];
  expectedSan: string[];
}

const GREEN = 'rgba(80, 160, 80, 0.85)';
const RED = 'rgba(205, 60, 50, 0.85)';
const ORANGE = 'rgba(235, 140, 20, 0.9)';

function applyMove(f: string, uci: string) {
  const c = new Chess(f);
  c.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
  return c.fen();
}

function Solver({ puzzle, onDone, onNext, onClose }: { puzzle: Puzzle; onDone: (ok: boolean) => void; onNext: () => void; onClose: () => void }) {
  const [step, setStep] = useState(0);
  const [fen, setFen] = useState(puzzle.fen);
  const [played, setPlayed] = useState<string[]>([]);
  const [state, setState] = useState<State>('solving');
  const [last, setLast] = useState<string | undefined>();
  const [message, setMessage] = useState('');
  const [hintArrow, setHintArrow] = useState<BoardArrow | null>(null);
  const [failedOnce, setFailedOnce] = useState(false);
  const [alternative, setAlternative] = useState<Alternative | null>(null);
  const [showThreats, setShowThreats] = useState(false);

  const solverColor = puzzle.color;
  // Once solved, the board turns into an analysis board (same as "try your own moves" in reviews).
  const analysis = useExploration(solverColor);
  const done = state === 'solved';

  const finish = (msg: string, moves: string[]) => {
    setState('solved');
    setMessage(msg);
    onDone(!failedOnce);
    analysis.start({ startFen: puzzle.fen, label: 'Puzzle', moves, index: moves.length });
  };

  const advance = (afterFen: string, nextStep: number, moves: string[]) => {
    if (nextStep >= puzzle.solution.length) {
      finish(failedOnce ? 'Solved (after a retry).' : 'Solved! ✓', moves);
      return;
    }
    const reply = puzzle.solution[nextStep];
    setState('correct');
    setTimeout(() => {
      setFen(applyMove(afterFen, reply));
      setLast(reply);
      setPlayed([...moves, reply]);
      setStep(nextStep + 1);
      setState('solving');
    }, 450);
  };

  const acceptAlternative = (uci: string, msg: string, moves: string[]) => {
    const expected = puzzle.solution.slice(step);
    if (expected.length && expected[0] !== uci) {
      setAlternative({
        before: played,
        uci,
        san: uciLineToSan(fen, [uci])[0] ?? uci,
        expected,
        expectedSan: uciLineToSan(fen, expected),
      });
    }
    finish(msg, moves);
  };

  const onMove = (uci: string): boolean => {
    if (state !== 'solving') return false;
    const expected = puzzle.solution[step];
    const after = applyMove(fen, uci);
    const moves = [...played, uci];
    setHintArrow(null);
    if (uci === expected || (expected && uci.slice(0, 4) === expected.slice(0, 4) && !expected[4])) {
      setFen(after);
      setLast(uci);
      setPlayed(moves);
      advance(after, step + 1, moves);
      return true;
    }
    if (new Chess(after).isCheckmate()) {
      setFen(after);
      setLast(uci);
      setPlayed(moves);
      acceptAlternative(uci, 'Checkmate — that works too! ✓', moves);
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
          setPlayed(moves);
          acceptAlternative(uci, 'Not the move we had, but the engine agrees it works just as well. ✓', moves);
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
    setHintArrow({ from: u.slice(0, 2), to: u.slice(2, 4), color: GREEN });
  };

  // --- analysis board after solving ----------------------------------------------------
  const { explore, fb, fbEntry, posLines } = analysis;
  const boardFen = done && analysis.fen ? analysis.fen : fen;
  const exploringMove = done && !!explore && explore.index > 0;
  const looked = useThreat(boardFen, done && showThreats && !exploringMove);
  const threat = !done || !showThreats ? undefined : exploringMove ? fb?.threat : looked.threat;

  const showLine = (moves: string[], index: number, label: string) =>
    analysis.start({ startFen: puzzle.fen, label, moves, index });

  // ←/→ step through the moves once solved.
  const keyHandler = useRef<(e: KeyboardEvent) => void>(() => undefined);
  const handleKey = (e: KeyboardEvent) => {
    if (!done || !explore) return;
    if (e.key === 'ArrowLeft') analysis.setIndex(explore.index - 1);
    else if (e.key === 'ArrowRight') analysis.setIndex(explore.index + 1);
  };
  useEffect(() => {
    keyHandler.current = handleKey;
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => keyHandler.current(e);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const arrows: BoardArrow[] = [];
  let highlights = lastMoveHighlight(last);
  if (!done && hintArrow) arrows.push(hintArrow);
  if (done && explore) {
    const lastMove = explore.moves[explore.index - 1];
    if (lastMove) {
      const c = fb ? CLASS_INFO[fb.classification].color : null;
      highlights = c ? { [lastMove.slice(0, 2)]: `${c}66`, [lastMove.slice(2, 4)]: `${c}aa` } : lastMoveHighlight(lastMove);
    } else highlights = {};
    if (fb?.reply) arrows.push({ from: fb.reply.move.slice(0, 2), to: fb.reply.move.slice(2, 4), color: RED });
  }
  if (threat) arrows.push({ from: threat.uci[0].slice(0, 2), to: threat.uci[0].slice(2, 4), color: ORANGE });

  const turn = turnOf(boardFen);
  const evalScore = fb?.evalAfter ?? (posLines?.[0] ? toWhite(posLines[0].score, turn) : null);
  const toMove = solverColor === 'w' ? 'White' : 'Black';
  const solutionSan = useMemo(() => uciLineToSan(puzzle.fen, puzzle.solution), [puzzle]);

  return (
    <div className="review">
      <div className="board-col">
        <div className="board-row">
          {done && evalScore && <EvalBar score={evalScore} orientation={solverColor === 'w' ? 'white' : 'black'} />}
          <Board
            id="puzzle-board"
            fen={boardFen}
            orientation={solverColor === 'w' ? 'white' : 'black'}
            onMove={done ? analysis.play : onMove}
            arrows={arrows}
            highlights={highlights}
          />
        </div>
        {done && explore && (
          <>
            <div className="nav">
              <button onClick={() => analysis.setIndex(0)} aria-label="Start">⏮</button>
              <button onClick={() => analysis.setIndex(explore.index - 1)} aria-label="Previous">◀</button>
              <button onClick={() => analysis.setIndex(explore.index + 1)} aria-label="Next">▶</button>
              <button onClick={() => analysis.setIndex(explore.moves.length)} aria-label="End">⏭</button>
            </div>
            <div className="row board-tools">
              <label className="toggle">
                <input type="checkbox" checked={showThreats} onChange={(e) => setShowThreats(e.target.checked)} /> Show threats
              </label>
              <span className="muted small">Drag a piece to try other moves.</span>
            </div>
          </>
        )}
      </div>
      <div className="side-col">
        <section className="card">
          <h2>{done ? 'Puzzle solved' : `${toMove} to move`}</h2>
          <p className="muted">
            {SOURCE_LABEL[puzzle.source]}
            {puzzle.playedSan && ` — in the game, ${puzzle.playedSan} was played.`}
          </p>
          <p className={`status ${state}`}>
            {state === 'checking' ? 'Checking with the engine…' : state === 'correct' ? 'Correct! Keep going…' : message || 'Find the best move.'}
          </p>
          {alternative && (
            <div className="alt-answer">
              <p>
                Your move <b>{alternative.san}</b> works too. The puzzle's answer was <b>{alternative.expectedSan[0]}</b>
                {alternative.expectedSan.length > 1 && <> ({alternative.expectedSan.join(' ')})</>}.
              </p>
              <div className="row small-gap">
                <button onClick={() => showLine([...alternative.before, ...alternative.expected], alternative.before.length + 1, "Puzzle's answer")}>
                  Show the puzzle's answer
                </button>
                <button onClick={() => showLine([...alternative.before, alternative.uci], alternative.before.length + 1, 'Your answer')}>
                  Back to your move
                </button>
              </div>
            </div>
          )}
          {puzzle.hint && !done && (
            <details>
              <summary>Hint</summary>
              {puzzle.hint}
            </details>
          )}
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

        {done && explore && (
          <section className="card explanation explore">
            <div className="row space-between">
              <b>Analysis</b>
              {!alternative && (
                <button className="small-btn" onClick={() => showLine(puzzle.solution, puzzle.solution.length, 'Puzzle')}>
                  Reset to the solution
                </button>
              )}
            </div>
            <ExploreLine explore={explore} fens={analysis.fens} sans={analysis.sans} feedbackAt={analysis.feedbackAt} setIndex={analysis.setIndex} />
            {explore.index === 0 ? (
              <p className="muted">
                The puzzle position. The solution was <b>{solutionSan.join(' ')}</b> — step through it with ▶, or drag a piece to try something else.
              </p>
            ) : (
              <MoveFeedbackView fb={fb} entry={fbEntry} pendingSan={analysis.sans[explore.index - 1]} user={solverColor} onPlay={analysis.play} />
            )}
            <ThreatLine threat={threat} user={solverColor} loading={done && showThreats && !exploringMove && looked.loading} />
            <BestMoves fen={boardFen} lines={posLines} user={solverColor} onPlay={analysis.play} />
          </section>
        )}
      </div>
    </div>
  );
}
