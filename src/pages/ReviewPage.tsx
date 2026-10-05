import { useEffect, useMemo, useState } from 'react';
import { Chess } from 'chess.js';
import { Board, lastMoveHighlight, type BoardArrow } from '../components/Board';
import { EvalBar } from '../components/EvalBar';
import { EvalGraph } from '../components/EvalGraph';
import { MoveList } from '../components/MoveList';
import { CLASS_INFO, SUMMARY_CLASSES } from '../components/ui';
import { formatScore } from '../lib/eval';
import { MOTIF_LABEL } from '../lib/motifs';
import { trimSolution } from '../lib/puzzles';
import type { Color, GameReview, Puzzle } from '../lib/types';

interface Props {
  review: GameReview;
  claudeKey?: string;
  onPractice: (fen: string, botElo: number, userColor: Color, label: string) => void;
  onSavePuzzle: (p: Puzzle) => void;
}

export function ReviewPage({ review, claudeKey, onPractice, onSavePuzzle }: Props) {
  const { plies, meta } = review;
  const user = review.userColor;
  const [current, setCurrent] = useState(() => review.keyMoments.find((k) => plies[k - 1]?.color === (user ?? plies[k - 1]?.color)) ?? 0);
  const [orientation, setOrientation] = useState<'white' | 'black'>(user === 'b' ? 'black' : 'white');
  const [idea, setIdea] = useState<{ index: number; step: number } | null>(null);
  const [coach, setCoach] = useState<Record<number, string>>({});
  const [coachLoading, setCoachLoading] = useState(false);
  const [saved, setSaved] = useState<Set<number>>(new Set());

  const ply = current > 0 ? plies[current - 1] : null;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT' || (e.target as HTMLElement)?.tagName === 'TEXTAREA') return;
      if (e.key === 'ArrowLeft') {
        setIdea(null);
        setCurrent((c) => Math.max(0, c - 1));
      } else if (e.key === 'ArrowRight') {
        setIdea(null);
        setCurrent((c) => Math.min(plies.length, c + 1));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [plies.length]);

  const go = (n: number) => {
    setIdea(null);
    setCurrent(Math.max(0, Math.min(plies.length, n)));
  };

  const ideaData = idea && ply ? ply.explanation.ideas[idea.index] : null;
  const ideaFen = useMemo(() => {
    if (!ideaData || !idea) return null;
    const c = new Chess(ideaData.fen);
    for (const u of ideaData.uci.slice(0, idea.step)) c.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] });
    return c.fen();
  }, [ideaData, idea]);

  const fen = ideaFen ?? (ply ? ply.fenAfter : plies[0]?.fenBefore ?? new Chess().fen());
  const evalScore = ply ? ply.evalAfter : (plies[0]?.evalBefore ?? { cp: 0 });

  const arrows: BoardArrow[] = [];
  let highlights: Record<string, string> = {};
  if (ideaData && idea && idea.step > 0) {
    highlights = lastMoveHighlight(ideaData.uci[idea.step - 1]);
  } else if (ideaData && idea) {
    const u = ideaData.uci[0];
    if (u) arrows.push({ from: u.slice(0, 2), to: u.slice(2, 4), color: 'rgba(80, 160, 80, 0.85)' });
  } else if (ply) {
    const color = CLASS_INFO[ply.classification].color;
    highlights = { [ply.uci.slice(0, 2)]: `${color}66`, [ply.uci.slice(2, 4)]: `${color}aa` };
    if (ply.bestUci && ply.bestUci !== ply.uci && !['best', 'forced'].includes(ply.classification)) {
      arrows.push({ from: ply.bestUci.slice(0, 2), to: ply.bestUci.slice(2, 4), color: 'rgba(80, 160, 80, 0.85)' });
    }
  }

  const userElo = user === 'w' ? meta.whiteElo : user === 'b' ? meta.blackElo : undefined;
  const opponentElo = (c: Color) => (c === 'w' ? meta.blackElo : meta.whiteElo) ?? 1200;

  const ask = async () => {
    if (!ply || !claudeKey) return;
    setCoachLoading(true);
    try {
      // Loaded lazily so the Anthropic SDK is only downloaded if you use it.
      const { askCoach } = await import('../lib/coach');
      const text = await askCoach(claudeKey, ply, userElo);
      setCoach((c) => ({ ...c, [ply.ply]: text }));
    } catch (e) {
      setCoach((c) => ({ ...c, [ply.ply]: `⚠ ${e instanceof Error ? e.message : String(e)}` }));
    } finally {
      setCoachLoading(false);
    }
  };

  const savePuzzle = () => {
    if (!ply) return;
    const best = ply.lines[0];
    if (!best?.move) return;
    const now = Date.now();
    onSavePuzzle({
      id: `${meta.id}#${ply.ply}`,
      fen: ply.fenBefore,
      solution: trimSolution(ply.fenBefore, best.pv, best.score.mate),
      color: ply.color,
      themes: ply.explanation.missed.length ? ply.explanation.missed : ply.explanation.played.length ? ply.explanation.played : ['material-win'],
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

  return (
    <div className="review">
      <div className="board-col">
        <div className="player-tag">
          {orientation === 'white' ? `${meta.black} (${meta.blackElo ?? '?'})` : `${meta.white} (${meta.whiteElo ?? '?'})`}
        </div>
        <div className="board-row">
          <EvalBar score={evalScore} orientation={orientation} />
          <Board id="review-board" fen={fen} orientation={orientation} arrows={arrows} highlights={highlights} />
        </div>
        <div className="player-tag">
          {orientation === 'white' ? `${meta.white} (${meta.whiteElo ?? '?'})` : `${meta.black} (${meta.blackElo ?? '?'})`}
        </div>
        <div className="nav">
          <button onClick={() => go(0)} aria-label="Start">⏮</button>
          <button onClick={() => go(current - 1)} aria-label="Previous">◀</button>
          <button onClick={() => go(current + 1)} aria-label="Next">▶</button>
          <button onClick={() => go(plies.length)} aria-label="End">⏭</button>
          <button onClick={() => setOrientation((o) => (o === 'white' ? 'black' : 'white'))} aria-label="Flip board">⇅</button>
        </div>
        <EvalGraph plies={plies} current={current} onSelect={go} />
      </div>

      <div className="side-col">
        {ply ? (
          <section className="card explanation">
            <div className="exp-head">
              <span className="badge big" style={{ background: CLASS_INFO[ply.classification].color }}>
                {CLASS_INFO[ply.classification].symbol}
              </span>
              <div>
                <div className="exp-title">
                  {ply.moveNumber}
                  {ply.color === 'w' ? '.' : '...'} {ply.san} · {CLASS_INFO[ply.classification].label}
                </div>
                <div className="muted small">
                  Eval {formatScore(ply.evalAfter)} · best was {ply.bestSan}
                  {ply.timeSpent !== undefined && ` · ${Math.round(ply.timeSpent)}s spent`}
                </div>
              </div>
            </div>
            <p className="headline">{ply.explanation.headline}</p>
            {ply.explanation.details.length > 0 && (
              <ul className="details">
                {ply.explanation.details.map((d, i) => (
                  <li key={i}>{d}</li>
                ))}
              </ul>
            )}
            {(ply.explanation.allowed.length > 0 || ply.explanation.missed.length > 0) && (
              <div className="chips">
                {ply.explanation.allowed.map((m) => (
                  <span key={'a' + m} className="chip bad">allowed: {MOTIF_LABEL[m].toLowerCase()}</span>
                ))}
                {ply.explanation.missed.map((m) => (
                  <span key={'m' + m} className="chip">missed: {MOTIF_LABEL[m].toLowerCase()}</span>
                ))}
              </div>
            )}

            <div className="ideas">
              {ply.explanation.ideas.map((it, i) => (
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
              <button
                className="primary"
                onClick={() =>
                  onPractice(ply.fenBefore, opponentElo(ply.color), ply.color, `Retry ${ply.moveNumber}${ply.color === 'w' ? '.' : '...'} vs ${opponentElo(ply.color)}`)
                }
              >
                Retry this moment vs bot
              </button>
              <button onClick={() => onPractice(fen, opponentElo(user ?? ply.color), user ?? ply.color, 'Play on from review')}>Play from here</button>
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
          </section>
        )}

        <section className="card">
          <div className="summary">
            {(['w', 'b'] as Color[]).map((c) => (
              <div key={c} className={`acc ${user === c ? 'me' : ''}`}>
                <div className="muted small">{c === 'w' ? meta.white : meta.black}</div>
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
