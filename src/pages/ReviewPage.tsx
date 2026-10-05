import { useEffect, useMemo, useRef, useState } from 'react';
import { Chess } from 'chess.js';
import { BestMoves, ExplanationBody, ExploreLine, MoveFeedbackView, ThreatLine } from '../components/AnalysisParts';
import { Board, lastMoveHighlight, type BoardArrow } from '../components/Board';
import { EvalBar } from '../components/EvalBar';
import { EvalGraph } from '../components/EvalGraph';
import { MoveList } from '../components/MoveList';
import { CLASS_INFO, SUMMARY_CLASSES } from '../components/ui';
import { toWhite, turnOf, useExploration, useThreat, yourChances } from '../components/useAnalysis';
import { formatScore } from '../lib/eval';
import type { Threat } from '../lib/explore';
import { trimSolution } from '../lib/puzzles';
import { explainPly } from '../lib/review';
import type { Classification, Color, GameReview, Puzzle, Score } from '../lib/types';

interface Props {
  review: GameReview;
  claudeKey?: string;
  onPractice: (fen: string, botElo: number, userColor: Color, label: string) => void;
  onSavePuzzle: (p: Puzzle) => void;
  /** Tell the app which side you played (when your username didn't match). */
  onSetSide: (side: Color) => void;
}

const GREEN = 'rgba(80, 160, 80, 0.85)';
const RED = 'rgba(205, 60, 50, 0.85)';
const ORANGE = 'rgba(235, 140, 20, 0.9)';
const BAD: Classification[] = ['inaccuracy', 'mistake', 'blunder', 'miss'];

function readShowThreats(): boolean {
  try {
    return localStorage.getItem('cc.showThreats') === '1';
  } catch {
    return false;
  }
}

export function ReviewPage({ review, claudeKey, onPractice, onSavePuzzle, onSetSide }: Props) {
  const { plies, meta } = review;
  const user = review.userColor;
  const [current, setCurrent] = useState(() => review.keyMoments.find((k) => plies[k - 1]?.color === (user ?? plies[k - 1]?.color)) ?? 0);
  const [orientation, setOrientation] = useState<'white' | 'black'>(user === 'b' ? 'black' : 'white');
  const [idea, setIdea] = useState<{ index: number; step: number } | null>(null);
  const analysis = useExploration(user);
  const { explore } = analysis;
  const [showThreats, setShowThreats] = useState(readShowThreats);
  const [coach, setCoach] = useState<Record<number, string>>({});
  const [coachLoading, setCoachLoading] = useState(false);
  const [saved, setSaved] = useState<Set<number>>(new Set());

  const ply = current > 0 ? plies[current - 1] : null;
  // Re-worded for whoever is reading: your moves, your opponent's moves, or neutral.
  const explanation = useMemo(() => (current > 0 ? explainPly(plies, current - 1, user) : null), [plies, current, user]);

  const go = (n: number) => {
    setIdea(null);
    analysis.stop();
    setCurrent(Math.max(0, Math.min(plies.length, n)));
  };

  // --- what's on the board ----------------------------------------------------
  const ideaData = idea && explanation ? explanation.ideas[idea.index] : null;
  const ideaFen = useMemo(() => {
    if (!ideaData || !idea) return null;
    const c = new Chess(ideaData.fen);
    for (const u of ideaData.uci.slice(0, idea.step)) c.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] });
    return c.fen();
  }, [ideaData, idea]);

  const gameFen = ply ? ply.fenAfter : (plies[0]?.fenBefore ?? new Chess().fen());
  const fen = analysis.fen ?? ideaFen ?? gameFen;
  const turn = turnOf(fen);

  const { fb, fbEntry, posLines } = analysis;

  // Threats: from the move feedback while exploring, otherwise looked up for the position shown.
  const exploringMove = !!explore && explore.index > 0;
  const gameBase = !explore && current < plies.length ? plies[current].lines[0] : undefined;
  const looked = useThreat(fen, showThreats && !exploringMove, gameBase);
  const threat: Threat | null | undefined = !showThreats ? undefined : exploringMove ? fb?.threat : looked.threat;
  const threatLoading = showThreats && !exploringMove && looked.loading;

  const toggleThreats = () => {
    setShowThreats((v) => {
      try {
        localStorage.setItem('cc.showThreats', v ? '0' : '1');
      } catch {
        /* per-viewer preference only */
      }
      return !v;
    });
  };

  // --- trying your own moves ----------------------------------------------------
  const onBoardMove = (uci: string): boolean => {
    if (explore) return analysis.play(uci);
    if (idea && ideaData) {
      const moves = [...ideaData.uci.slice(0, idea.step), uci];
      analysis.start({ startFen: ideaData.fen, label: `from "${ideaData.label}"`, moves, index: moves.length });
      setIdea(null);
      return true;
    }
    // Playing the move that was actually played just steps the game forward.
    if (current < plies.length && plies[current].uci === uci) {
      go(current + 1);
      return true;
    }
    analysis.start({
      startFen: gameFen,
      label: ply ? `after ${ply.moveNumber}${ply.color === 'w' ? '.' : '...'} ${ply.san}` : 'from the start',
      moves: [uci],
      index: 1,
      prevUci: ply?.uci,
      linesAtStart: current < plies.length ? plies[current].lines : undefined,
    });
    return true;
  };

  const setExploreIndex = analysis.setIndex;

  // Keyboard: ←/→ step through the game (or your line while exploring); Esc leaves your line.
  const keyHandler = useRef<(e: KeyboardEvent) => void>(() => undefined);
  const handleKey = (e: KeyboardEvent) => {
    const tag = (e.target as HTMLElement)?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (explore) {
      if (e.key === 'ArrowLeft') setExploreIndex(explore.index - 1);
      else if (e.key === 'ArrowRight') setExploreIndex(explore.index + 1);
      else if (e.key === 'Escape') analysis.stop();
      return;
    }
    if (e.key === 'ArrowLeft') go(current - 1);
    else if (e.key === 'ArrowRight') go(current + 1);
  };
  useEffect(() => {
    keyHandler.current = handleKey;
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => keyHandler.current(e);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // --- board decorations ----------------------------------------------------------
  const arrows: BoardArrow[] = [];
  let highlights: Record<string, string> = {};
  if (explore) {
    const last = explore.moves[explore.index - 1];
    if (last) {
      const c = fb ? CLASS_INFO[fb.classification].color : null;
      highlights = c ? { [last.slice(0, 2)]: `${c}66`, [last.slice(2, 4)]: `${c}aa` } : lastMoveHighlight(last);
    }
    if (fb?.reply) arrows.push({ from: fb.reply.move.slice(0, 2), to: fb.reply.move.slice(2, 4), color: RED });
  } else if (ideaData && idea && idea.step > 0) {
    highlights = lastMoveHighlight(ideaData.uci[idea.step - 1]);
  } else if (ideaData && idea) {
    const u = ideaData.uci[0];
    if (u) arrows.push({ from: u.slice(0, 2), to: u.slice(2, 4), color: GREEN });
  } else if (ply) {
    const color = CLASS_INFO[ply.classification].color;
    highlights = { [ply.uci.slice(0, 2)]: `${color}66`, [ply.uci.slice(2, 4)]: `${color}aa` };
    if (ply.bestUci && ply.bestUci !== ply.uci && !['best', 'forced'].includes(ply.classification)) {
      arrows.push({ from: ply.bestUci.slice(0, 2), to: ply.bestUci.slice(2, 4), color: GREEN });
    }
  }
  if (threat) arrows.push({ from: threat.uci[0].slice(0, 2), to: threat.uci[0].slice(2, 4), color: ORANGE });

  const gameEval = ply ? ply.evalAfter : (plies[0]?.evalBefore ?? { cp: 0 });
  const evalScore: Score = explore ? (fb?.evalAfter ?? (posLines?.[0] ? toWhite(posLines[0].score, turn) : gameEval)) : gameEval;

  // --- practice & helpers --------------------------------------------------------------
  // The bot always plays your opponent, at their rating.
  const botEloFor = (you: Color) => (you === 'w' ? meta.blackElo : meta.whiteElo) ?? 1200;
  const userElo = user === 'w' ? meta.whiteElo : user === 'b' ? meta.blackElo : undefined;

  const ask = async () => {
    if (!ply || !claudeKey || !explanation) return;
    setCoachLoading(true);
    try {
      // Loaded lazily so the Anthropic SDK is only downloaded if you use it.
      const { askCoach } = await import('../lib/coach');
      const text = await askCoach(claudeKey, ply, { studentRating: userElo, studentColor: user, explanation });
      setCoach((c) => ({ ...c, [ply.ply]: text }));
    } catch (e) {
      setCoach((c) => ({ ...c, [ply.ply]: `⚠ ${e instanceof Error ? e.message : String(e)}` }));
    } finally {
      setCoachLoading(false);
    }
  };

  const savePuzzle = () => {
    if (!ply || !explanation) return;
    const best = ply.lines[0];
    if (!best?.move) return;
    const now = Date.now();
    onSavePuzzle({
      id: `${meta.id}#${ply.ply}`,
      fen: ply.fenBefore,
      solution: trimSolution(ply.fenBefore, best.pv, best.score.mate),
      color: ply.color,
      themes: explanation.missed.length ? explanation.missed : explanation.played.length ? explanation.played : ['material-win'],
      source: user && ply.color !== user ? 'opponent-blunder' : 'own-mistake',
      gameId: meta.id,
      ply: ply.ply,
      playedSan: ply.san,
      createdAt: now,
      box: 0,
      due: now,
      attempts: 0,
      solved: 0,
    });
    setSaved((s) => new Set(s).add(ply.ply));
  };

  const practiceButtons = () => {
    if (!ply) return null;
    const label = `${ply.moveNumber}${ply.color === 'w' ? '.' : '...'} ${ply.san}`;
    if (user && ply.color !== user) {
      // Your opponent's move: practise from the position it left you in.
      return (
        <button className="primary" onClick={() => onPractice(ply.fenAfter, botEloFor(user), user, `After ${label} — vs ${botEloFor(user)}`)}>
          {BAD.includes(ply.classification) ? 'Punish it vs bot' : 'Play from here vs bot'}
        </button>
      );
    }
    const you = user ?? ply.color;
    return (
      <>
        <button className="primary" onClick={() => onPractice(ply.fenBefore, botEloFor(you), you, `Retry ${label} — vs ${botEloFor(you)}`)}>
          Retry this moment vs bot
        </button>
        <button onClick={() => onPractice(ply.fenAfter, botEloFor(you), you, `After ${label} — vs ${botEloFor(you)}`)}>Play from here</button>
      </>
    );
  };

  // --- render ------------------------------------------------------------------------
  const nav = explore
    ? {
        start: () => setExploreIndex(0),
        prev: () => setExploreIndex(explore.index - 1),
        next: () => setExploreIndex(explore.index + 1),
        end: () => setExploreIndex(explore.moves.length),
      }
    : { start: () => go(0), prev: () => go(current - 1), next: () => go(current + 1), end: () => go(plies.length) };

  return (
    <div className="review">
      <div className="board-col">
        <div className="player-tag">
          {orientation === 'white' ? `${meta.black} (${meta.blackElo ?? '?'})` : `${meta.white} (${meta.whiteElo ?? '?'})`}
        </div>
        <div className="board-row">
          <EvalBar score={evalScore} orientation={orientation} />
          <Board id="review-board" fen={fen} orientation={orientation} arrows={arrows} highlights={highlights} onMove={onBoardMove} />
        </div>
        <div className="player-tag">
          {orientation === 'white' ? `${meta.white} (${meta.whiteElo ?? '?'})` : `${meta.black} (${meta.blackElo ?? '?'})`}
        </div>
        <div className="nav">
          <button onClick={nav.start} aria-label="Start">⏮</button>
          <button onClick={nav.prev} aria-label="Previous">◀</button>
          <button onClick={nav.next} aria-label="Next">▶</button>
          <button onClick={nav.end} aria-label="End">⏭</button>
          <button onClick={() => setOrientation((o) => (o === 'white' ? 'black' : 'white'))} aria-label="Flip board">⇅</button>
        </div>
        <div className="row board-tools">
          <label className="toggle">
            <input type="checkbox" checked={showThreats} onChange={toggleThreats} /> Show threats
          </label>
          <span className="muted small">Drag a piece to try your own move.</span>
        </div>
        <EvalGraph plies={plies} current={current} onSelect={go} />
      </div>

      <div className="side-col">
        {explore ? (
          <section className="card explanation explore">
            <div className="row space-between">
              <div>
                <b>Your analysis</b> <span className="muted small">{explore.label}</span>
              </div>
              <button onClick={analysis.stop}>✕ Back to game</button>
            </div>
            <ExploreLine explore={explore} fens={analysis.fens} sans={analysis.sans} feedbackAt={analysis.feedbackAt} setIndex={setExploreIndex} />
            {explore.index === 0 ? (
              <p className="muted">Make a move on the board — you'll get instant feedback on it, and the best reply.</p>
            ) : (
              <MoveFeedbackView fb={fb} entry={fbEntry} pendingSan={analysis.sans[explore.index - 1]} user={user} onPlay={onBoardMove} />
            )}
            <ThreatLine threat={threat} user={user} loading={threatLoading} />
            <BestMoves fen={fen} lines={posLines} user={user} onPlay={onBoardMove} />

            <div className="actions">
              <button
                className="primary"
                onClick={() => onPractice(fen, botEloFor(user ?? turn), user ?? turn, `Your analysis — vs ${botEloFor(user ?? turn)}`)}
              >
                Play this position vs bot
              </button>
            </div>
          </section>
        ) : ply && explanation ? (
          <section className="card explanation">
            <div className="exp-head">
              <span className="badge big" style={{ background: CLASS_INFO[ply.classification].color }}>
                {CLASS_INFO[ply.classification].symbol}
              </span>
              <div>
                <div className="exp-title">
                  {ply.moveNumber}
                  {ply.color === 'w' ? '.' : '...'} {ply.san} · {CLASS_INFO[ply.classification].label}
                  {user && <span className="muted small"> · {ply.color === user ? 'your move' : "opponent's move"}</span>}
                </div>
                <div className="muted small">
                  Eval {formatScore(ply.evalAfter)}
                  {yourChances(ply.evalAfter, user) !== null && ` · your winning chances ${yourChances(ply.evalAfter, user)}%`} · best was {ply.bestSan}
                  {ply.timeSpent !== undefined && ` · ${Math.round(ply.timeSpent)}s spent`}
                </div>
              </div>
            </div>
            <ExplanationBody explanation={explanation} />
            <ThreatLine threat={threat} user={user} loading={threatLoading} />

            <div className="ideas">
              {explanation.ideas.map((it, i) => (
                <div key={i} className={`idea ${idea?.index === i ? 'active' : ''}`}>
                  <button className="idea-label" onClick={() => setIdea(idea?.index === i ? null : { index: i, step: 0 })}>
                    {idea?.index === i ? '✕' : '▶'} {it.label}
                  </button>
                  <div className="idea-line">
                    {it.san.map((s, j) => (
                      <button
                        key={j}
                        className={`idea-move ${idea?.index === i && idea.step === j + 1 ? 'active' : ''}`}
                        onClick={() => setIdea({ index: i, step: j + 1 })}
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                  {idea?.index === i && (
                    <div className="row small-gap">
                      <button onClick={() => setIdea({ index: i, step: Math.max(0, idea.step - 1) })}>◀ Back</button>
                      <button onClick={() => setIdea({ index: i, step: Math.min(it.uci.length, idea.step + 1) })}>Step ▶</button>
                    </div>
                  )}
                </div>
              ))}
            </div>

            <div className="actions">
              {practiceButtons()}
              <button onClick={savePuzzle} disabled={saved.has(ply.ply) || !ply.lines[0]?.move}>
                {saved.has(ply.ply) ? 'Saved ✓' : 'Save as puzzle'}
              </button>
              {claudeKey && (
                <button onClick={ask} disabled={coachLoading}>
                  {coachLoading ? 'Asking Claude…' : 'Ask Claude why'}
                </button>
              )}
            </div>
            {coach[ply.ply] && <div className="coach">{coach[ply.ply]}</div>}
          </section>
        ) : (
          <section className="card">
            <p className="headline">Start position. Use ▶ / → to step through, or jump to a key moment below.</p>
            <ThreatLine threat={threat} user={user} loading={threatLoading} />
          </section>
        )}

        <section className="card">
          {!user && (
            <div className="side-picker">
              <p className="small">
                <b>Which side were you?</b> Then the review talks to you about your moves and your opponent's.
              </p>
              <div className="row">
                <button
                  onClick={() => {
                    onSetSide('w');
                    setOrientation('white');
                  }}
                >
                  White ({meta.white})
                </button>
                <button
                  onClick={() => {
                    onSetSide('b');
                    setOrientation('black');
                  }}
                >
                  Black ({meta.black})
                </button>
              </div>
            </div>
          )}
          <div className="summary">
            {(['w', 'b'] as Color[]).map((c) => (
              <div key={c} className={`acc ${user === c ? 'me' : ''}`}>
                <div className="muted small">
                  {c === 'w' ? meta.white : meta.black}
                  {user === c && ' (you)'}
                </div>
                <div className="acc-num">{review.accuracy[c]}</div>
                <div className="muted small">accuracy</div>
              </div>
            ))}
          </div>
          <table className="counts">
            <tbody>
              {SUMMARY_CLASSES.map((k) => (
                <tr key={k}>
                  <td className="num">{review.counts.w[k]}</td>
                  <td>
                    <span className="badge" style={{ background: CLASS_INFO[k].color }}>
                      {CLASS_INFO[k].symbol}
                    </span>{' '}
                    {CLASS_INFO[k].label}
                  </td>
                  <td className="num">{review.counts.b[k]}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {review.keyMoments.length > 0 && (
            <>
              <h3>Key moments</h3>
              <div className="chips">
                {review.keyMoments.map((k) => {
                  const p = plies[k - 1];
                  return (
                    <button key={k} className="chip clickable" style={{ borderColor: CLASS_INFO[p.classification].color }} onClick={() => go(k)}>
                      {p.moveNumber}
                      {p.color === 'w' ? '.' : '...'} {p.san} {CLASS_INFO[p.classification].symbol}
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </section>

        <section className="card">
          <MoveList plies={plies} current={current} onSelect={go} />
        </section>
      </div>
    </div>
  );
}
