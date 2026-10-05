import { useState } from 'react';
import { fetchRecentGames } from '../lib/chesscom';
import { metaFromPgn } from '../lib/pgn';
import type { QueueState } from '../lib/reviewQueue';
import { findReviewOf } from '../lib/reviewStore';
import type { GameMeta, GameReview } from '../lib/types';
import { timeAgo } from '../components/ui';

export interface BulkResult {
  found: number;
  added: number;
  alreadyReviewed: number;
  tooShort: number;
}

interface Props {
  username: string;
  setUsername: (u: string) => void;
  depth: number;
  reviews: GameReview[];
  reviewsLoaded: boolean;
  queue: QueueState;
  onReview: (meta: GameMeta) => void;
  onBulk: (count: number, depth: number) => Promise<BulkResult>;
  onCancel: () => void;
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
}

const QUICK_DEPTH = 10;

function resultFor(meta: GameMeta, username: string): 'win' | 'loss' | 'draw' | '' {
  const u = username.toLowerCase();
  const color = meta.white.toLowerCase() === u ? 'w' : meta.black.toLowerCase() === u ? 'b' : null;
  if (!color || meta.result === '*') return '';
  if (meta.result === '1/2-1/2') return 'draw';
  return (meta.result === '1-0') === (color === 'w') ? 'win' : 'loss';
}

function formatMinutes(ms: number): string {
  const min = Math.round(ms / 60000);
  if (min < 1) return 'under a minute';
  if (min < 90) return `about ${min} min`;
  return `about ${Math.round(min / 6) / 10} h`;
}

export function GamesPage(props: Props) {
  const { username, setUsername, depth, reviews, reviewsLoaded, queue, onReview, onBulk, onCancel, onOpen, onDelete } = props;
  const [name, setName] = useState(username);
  const [games, setGames] = useState<GameMeta[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [pgn, setPgn] = useState('');
  const [bulkCount, setBulkCount] = useState(25);
  const [bulkDepth, setBulkDepth] = useState(QUICK_DEPTH);
  const [bulkMsg, setBulkMsg] = useState('');
  const [bulkBusy, setBulkBusy] = useState(false);
  const reviewedOf = (g: GameMeta) => findReviewOf(reviews, g);
  const queuedIds = new Set(queue.pending.map((j) => j.meta.id));
  const running = queue.current;

  const load = async () => {
    if (!name.trim()) return;
    setUsername(name.trim());
    setLoading(true);
    setError('');
    try {
      setGames(await fetchRecentGames(name.trim(), 40));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const startBulk = async () => {
    setBulkBusy(true);
    setBulkMsg('');
    try {
      const r = await onBulk(bulkCount, bulkDepth);
      const notes = [r.alreadyReviewed && `${r.alreadyReviewed} already reviewed`, r.tooShort && `${r.tooShort} too short to be useful`].filter(Boolean);
      setBulkMsg(
        r.found === 0
          ? 'No games found for this account.'
          : r.added === 0
            ? `Nothing new to review${notes.length ? ` (${notes.join(', ')})` : ''}.`
            : `Queued ${r.added} game${r.added === 1 ? '' : 's'}${notes.length ? ` (${notes.join(', ')})` : ''}.`,
      );
    } catch (e) {
      setBulkMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBulkBusy(false);
    }
  };

  const reviewPgn = () => {
    try {
      onReview(metaFromPgn(pgn));
      setPgn('');
      setError('');
    } catch {
      setError("That PGN couldn't be read. Paste the full game including the move list.");
    }
  };

  const status = (id: string) => {
    if (running?.job.meta.id === id) return <span className="progress-text">{Math.round((running.done / running.total) * 100)}%</span>;
    if (queuedIds.has(id)) return <span className="muted small">Queued</span>;
    return null;
  };

  const batch = queue.batch;
  const batchDone = batch ? batch.completed + batch.failed : 0;
  const showBatch = batch && batch.total > 1;
  const remainingGames = queue.pending.length + (running ? 1 - running.done / running.total : 0);
  const eta = batch?.msPerGame ? batch.msPerGame * remainingGames : null;

  return (
    <div className="page">
      <section className="card">
        <h2>Your chess.com games</h2>
        <form
          className="row"
          onSubmit={(e) => {
            e.preventDefault();
            load();
          }}
        >
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="chess.com username" aria-label="chess.com username" />
          <button type="submit" className="primary" disabled={loading}>
            {loading ? 'Loading…' : 'Load games'}
          </button>
        </form>
        {error && <p className="error">{error}</p>}
        {games.length > 0 && (
          <ul className="game-list">
            {games.map((g) => {
              const res = resultFor(g, username);
              return (
                <li key={g.id} className="game-item">
                  <span className={`result-dot ${res}`} title={res} />
                  <div className="game-main">
                    <div className="players">
                      <b>{g.white}</b> ({g.whiteElo}) vs <b>{g.black}</b> ({g.blackElo})
                    </div>
                    <div className="muted small">
                      {g.timeClass} · {g.result} · {g.opening ?? 'Unknown opening'} · {timeAgo(g.endTime)}
                    </div>
                  </div>
                  {status(g.id) ??
                    (reviewedOf(g) ? (
                      <button onClick={() => onOpen(reviewedOf(g)!.meta.id)}>Open review</button>
                    ) : (
                      <button className="primary" onClick={() => onReview(g)}>
                        Review
                      </button>
                    ))}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="card">
        <h2>Review your history</h2>
        <p className="muted small">
          Insights and progress charts need about 20 reviewed games to be reliable. This reviews your recent games one after another in the
          background — keep this tab open while it runs.
        </p>
        {showBatch ? (
          <div className="bulk-status" aria-live="polite">
            <div className="row space-between">
              <span>
                Reviewed {batchDone} of {batch.total}
                {batch.failed > 0 && ` (${batch.failed} failed)`}
                {eta !== null && ` · ${formatMinutes(eta)} left`}
              </span>
              <button onClick={onCancel}>Cancel</button>
            </div>
            <div className="progress wide" role="progressbar" aria-label="Bulk review progress" aria-valuenow={batchDone} aria-valuemax={batch.total}>
              <div className="progress-fill" style={{ width: `${((batchDone + (running ? running.done / running.total : 0)) / batch.total) * 100}%` }} />
            </div>
            {running && (
              <p className="muted small">
                Now: {running.job.meta.white} vs {running.job.meta.black}
              </p>
            )}
          </div>
        ) : (
          <div className="row">
            <label>
              Last{' '}
              <select value={bulkCount} onChange={(e) => setBulkCount(Number(e.target.value))} aria-label="Number of games">
                {[10, 25, 50, 100].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>{' '}
              games
            </label>
            <label>
              <select value={bulkDepth} onChange={(e) => setBulkDepth(Number(e.target.value))} aria-label="Analysis speed">
                <option value={QUICK_DEPTH}>Quick (depth {QUICK_DEPTH})</option>
                {depth !== QUICK_DEPTH && <option value={depth}>Thorough (depth {depth})</option>}
              </select>
            </label>
            <button className="primary" onClick={startBulk} disabled={!username || bulkBusy || !reviewsLoaded}>
              {bulkBusy ? 'Fetching games…' : 'Review games'}
            </button>
          </div>
        )}
        {!username && <p className="muted small">Enter your chess.com username above first.</p>}
        {bulkMsg && <p className="small">{bulkMsg}</p>}
      </section>

      <section className="card">
        <h2>Or paste a PGN</h2>
        <textarea value={pgn} onChange={(e) => setPgn(e.target.value)} rows={5} placeholder="[Event ...]  1. e4 e5 2. Nf3 ..." aria-label="PGN" />
        <button className="primary" disabled={!pgn.trim()} onClick={reviewPgn}>
          Review PGN
        </button>
        {running && running.job.meta.source === 'pgn' && (
          <p className="muted">Reviewing… {Math.round((running.done / running.total) * 100)}%</p>
        )}
      </section>

      {!reviewsLoaded ? (
        <p className="muted">Loading your reviews…</p>
      ) : (
        reviews.length > 0 && (
          <section className="card">
            <h2>Reviewed games ({reviews.length})</h2>
            <ul className="game-list">
              {reviews.map((r) => {
                const res = resultFor(r.meta, username);
                const c = r.userColor;
                return (
                  <li key={r.meta.id} className="game-item">
                    <span className={`result-dot ${res}`} />
                    <div className="game-main">
                      <div className="players">
                        <b>{r.meta.white}</b> vs <b>{r.meta.black}</b>
                      </div>
                      <div className="muted small">
                        {c ? `Your accuracy ${r.accuracy[c]}%` : `Accuracy ${r.accuracy.w}% / ${r.accuracy.b}%`}
                        {r.meta.opening ? ` · ${r.meta.opening}` : ''}
                        {r.meta.endTime ? ` · ${timeAgo(r.meta.endTime)}` : ''}
                      </div>
                    </div>
                    <button onClick={() => onOpen(r.meta.id)}>Open</button>
                    <button className="ghost" aria-label="Delete review" onClick={() => onDelete(r.meta.id)}>
                      ✕
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        )
      )}
    </div>
  );
}
