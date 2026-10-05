import { formatScore } from '../lib/eval';
import { threatSentence, type MoveFeedback, type Threat } from '../lib/explore';
import { MOTIF_LABEL } from '../lib/motifs';
import { uciLineToSan } from '../lib/pgn';
import type { Color, EngineLine, Explanation } from '../lib/types';
import { CLASS_INFO } from './ui';
import { moveNo, toWhite, turnOf, yourChances, type Exploration, type FeedbackEntry } from './useAnalysis';

// Building blocks of the analysis panel (review page and solved puzzles).

const sideName = (c: Color) => (c === 'w' ? 'White' : 'Black');

export function ExplanationBody({ explanation }: { explanation: Explanation }) {
  return (
    <>
      <p className="headline">{explanation.headline}</p>
      {explanation.details.length > 0 && (
        <ul className="details">
          {explanation.details.map((d, i) => (
            <li key={i}>{d}</li>
          ))}
        </ul>
      )}
      {(explanation.allowed.length > 0 || explanation.missed.length > 0) && (
        <div className="chips">
          {explanation.allowed.map((m) => (
            <span key={'a' + m} className="chip bad">
              allowed: {MOTIF_LABEL[m].toLowerCase()}
            </span>
          ))}
          {explanation.missed.map((m) => (
            <span key={'m' + m} className="chip">
              missed: {MOTIF_LABEL[m].toLowerCase()}
            </span>
          ))}
        </div>
      )}
    </>
  );
}

export function ThreatLine({ threat, user, loading }: { threat: Threat | null | undefined; user?: Color; loading: boolean }) {
  if (loading) return <p className="threat muted small">Looking for threats…</p>;
  if (threat === undefined) return null;
  if (!threat) return <p className="threat muted small">No immediate threats.</p>;
  return (
    <p className="threat">
      <span aria-hidden="true">⚠</span> {threatSentence(threat, user)}
    </p>
  );
}

/** The moves of the line you're exploring, clickable, with a badge on the poor ones. */
export function ExploreLine({
  explore,
  fens,
  sans,
  feedbackAt,
  setIndex,
}: {
  explore: Exploration;
  fens: string[];
  sans: string[];
  feedbackAt: (i: number) => FeedbackEntry | undefined;
  setIndex: (i: number) => void;
}) {
  return (
    <div className="explore-line" aria-label="Moves">
      <button className={`idea-move ${explore.index === 0 ? 'active' : ''}`} onClick={() => setIndex(0)}>
        Start
      </button>
      {sans.map((s, i) => {
        const f = feedbackAt(i + 1);
        const cls = f && !('error' in f) ? f.classification : null;
        const showBadge = cls && !['best', 'excellent', 'good', 'book', 'forced'].includes(cls);
        return (
          <button key={i} className={`idea-move ${explore.index === i + 1 ? 'active' : ''}`} onClick={() => setIndex(i + 1)}>
            {i === 0 || turnOf(fens[i]) === 'w' ? `${moveNo(fens[i])} ` : ''}
            {s}
            {showBadge && (
              <span className="badge" style={{ background: CLASS_INFO[cls].color }}>
                {CLASS_INFO[cls].symbol}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/** Verdict, explanation and best reply for the move that led to this position. */
export function MoveFeedbackView({
  fb,
  entry,
  pendingSan,
  user,
  onPlay,
}: {
  fb: MoveFeedback | null;
  entry?: FeedbackEntry;
  pendingSan?: string;
  user?: Color;
  onPlay: (uci: string) => void;
}) {
  if (!fb) {
    if (entry && 'error' in entry) return <p className="error">Couldn't analyse that move: {entry.error}</p>;
    return (
      <p className="muted" aria-live="polite">
        Analysing {pendingSan}…
      </p>
    );
  }
  const chances = yourChances(fb.evalAfter, user);
  const replier = fb.color === 'w' ? 'b' : 'w';
  const whose = !user ? `${sideName(replier)}'s` : replier === user ? 'Your' : "Your opponent's";
  return (
    <>
      <div className="exp-head">
        <span className="badge big" style={{ background: CLASS_INFO[fb.classification].color }}>
          {CLASS_INFO[fb.classification].symbol}
        </span>
        <div>
          <div className="exp-title">
            {moveNo(fb.fenBefore)} {fb.san} · {CLASS_INFO[fb.classification].label}
          </div>
          <div className="muted small">
            Eval {formatScore(fb.evalAfter)}
            {chances !== null && ` · your winning chances ${chances}%`}
          </div>
        </div>
      </div>
      <ExplanationBody explanation={fb.explanation} />
      {fb.reply && (
        <div className="reply-line">
          <span>
            <b>{whose} best reply:</b> {fb.replySan.join(' ')}
          </span>
          <button className="small-btn" onClick={() => onPlay(fb.reply!.move)}>
            Play it
          </button>
        </div>
      )}
    </>
  );
}

/** The engine's top moves in a position, each playable with one click. */
export function BestMoves({ fen, lines, user, onPlay }: { fen: string; lines?: EngineLine[]; user?: Color; onPlay: (uci: string) => void }) {
  if (!lines || !lines[0]?.move) return null;
  const turn = turnOf(fen);
  return (
    <div className="best-here">
      <div className="muted small">Best moves for {user ? (turn === user ? 'you' : 'your opponent') : sideName(turn)} here:</div>
      {lines.map((l) => (
        <button key={l.move} className="best-move" onClick={() => onPlay(l.move)}>
          <b>{uciLineToSan(fen, [l.move])[0]}</b>
          <span className="muted"> {formatScore(toWhite(l.score, turn))}</span>
          <span className="muted small"> {uciLineToSan(fen, l.pv.slice(1, 5)).join(' ')}</span>
        </button>
      ))}
    </div>
  );
}
