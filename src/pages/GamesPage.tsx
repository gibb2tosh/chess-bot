import { useState } from 'react';
import { fetchRecentGames } from '../lib/chesscom';
import { metaFromPgn } from '../lib/pgn';
import type { GameMeta, GameReview } from '../lib/types';
import { timeAgo } from '../components/ui';

interface Props {
  username: string;
  setUsername: (u: string) => void;
  reviews: GameReview[];
  progress: { id: string; done: number; total: number } | null;
  onReview: (meta: GameMeta) => void;
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
}

function resultFor(meta: GameMeta, username: string): 'win' | 'loss' | 'draw' | '' {
  const u = username.toLowerCase();
  const color = meta.white.toLowerCase() === u ? 'w' : meta.black.toLowerCase() === u ? 'b' : null;
  if (!color || meta.result === '*') return '';
  if (meta.result === '1/2-1/2') return 'draw';
  return (meta.result === '1-0') === (color === 'w') ? 'win' : 'loss';
}

export function GamesPage({ username, setUsername, reviews, progress, onReview, onOpen, onDelete }: Props) {
  const [name, setName] = useState(username);
  const [games, setGames] = useState<GameMeta[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [pgn, setPgn] = useState('');
  const reviewed = new Map(reviews.map((r) => [r.meta.id, r]));

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

  const reviewPgn = () => {
    try {
      onReview(metaFromPgn(pgn));
      setPgn('');
      setError('');
    } catch {
      setError("That PGN couldn't be read. Paste the full game including the move list.");
    }
  };

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
              const done = reviewed.get(g.id);
              const running = progress?.id === g.id;
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
                  {running ? (
                    <span className="progress-text">
                      {Math.round((progress.done / progress.total) * 100)}%
                    </span>
                  ) : done ? (
                    <button onClick={() => onOpen(g.id)}>Open review</button>
                  ) : (
                    <button className="primary" disabled={!!progress} onClick={() => onReview(g)}>
                      Review
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="card">
        <h2>Or paste a PGN</h2>
        <textarea value={pgn} onChange={(e) => setPgn(e.target.value)} rows={5} placeholder="[Event ...]  1. e4 e5 2. Nf3 ..." aria-label="PGN" />
        <button className="primary" disabled={!pgn.trim() || !!progress} onClick={reviewPgn}>
          Review PGN
        </button>
        {progress && !games.some((g) => g.id === progress.id) && (
          <p className="muted">Reviewing… {Math.round((progress.done / progress.total) * 100)}%</p>
        )}
      </section>

      {reviews.length > 0 && (
        <section className="card">
          <h2>Reviewed games</h2>
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
                      {c ? `Your accuracy ${r.accuracy[c]}%` : `Accuracy ${r.accuracy.w}% / ${r.accuracy.b}%`} · {r.meta.opening ?? ''}
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
      )}
    </div>
  );
}
