import { MOTIF_LABEL } from '../lib/motifs';
import type { Profile } from '../lib/profile';
import type { Motif, Phase } from '../lib/types';

interface Props {
  profile: Profile;
  onTrain: (angle: string) => void;
}

function Bars({ title, data, tone }: { title: string; data: [Motif, number][]; tone: 'bad' | 'good' | 'neutral' }) {
  const rows = data.slice(0, 6);
  const max = Math.max(1, ...rows.map(([, n]) => n));
  return (
    <div className="bars">
      <h3>{title}</h3>
      {rows.length === 0 && <p className="muted small">Nothing yet.</p>}
      {rows.map(([m, n]) => (
        <div className="bar-row" key={m}>
          <span className="bar-label">{MOTIF_LABEL[m]}</span>
          <span className="bar-track">
            <span className={`bar-fill ${tone}`} style={{ width: `${(n / max) * 100}%` }} />
          </span>
          <span className="bar-num">{n}</span>
        </div>
      ))}
    </div>
  );
}

export function InsightsPage({ profile: p, onTrain }: Props) {
  if (p.games === 0) {
    return (
      <div className="page">
        <section className="card">
          <h2>Insights</h2>
          <p className="muted">Review a few of your games (with your chess.com username set) and your strengths and weaknesses will appear here.</p>
        </section>
      </div>
    );
  }
  const strengths = p.insights.filter((i) => i.kind === 'strength');
  const weaknesses = p.insights.filter((i) => i.kind === 'weakness');
  const phases: Phase[] = ['opening', 'middlegame', 'endgame'];

  return (
    <div className="page">
      <section className="card stats">
        <div className="stat">
          <div className="stat-num">{p.games}</div>
          <div className="muted small">games reviewed</div>
        </div>
        <div className="stat">
          <div className="stat-num">
            {p.record.wins}/{p.record.draws}/{p.record.losses}
          </div>
          <div className="muted small">W / D / L</div>
        </div>
        <div className="stat">
          <div className="stat-num">{p.avgAccuracy}</div>
          <div className="muted small">avg accuracy</div>
        </div>
        <div className="stat">
          <div className="stat-num">
            {p.byColor.w.accuracy || '–'} / {p.byColor.b.accuracy || '–'}
          </div>
          <div className="muted small">as White / Black</div>
        </div>
      </section>

      <div className="two-col">
        <section className="card">
          <h2>Working well</h2>
          {strengths.length === 0 && <p className="muted small">Review more games to find patterns.</p>}
          {strengths.map((s, i) => (
            <div className="insight good" key={i}>
              <b>{s.title}</b>
              <p>{s.detail}</p>
            </div>
          ))}
        </section>
        <section className="card">
          <h2>To improve</h2>
          {weaknesses.length === 0 && <p className="muted small">No clear weaknesses yet — review more games.</p>}
          {weaknesses.map((w, i) => (
            <div className="insight bad" key={i}>
              <b>{w.title}</b>
              <p>{w.detail}</p>
              {w.drill && (
                <button className="small-btn" onClick={() => onTrain(w.drill!)}>
                  Train this →
                </button>
              )}
            </div>
          ))}
        </section>
      </div>

      <section className="card">
        <h2>By phase</h2>
        <table className="table">
          <thead>
            <tr>
              <th>Phase</th>
              <th>Moves</th>
              <th>Accuracy</th>
              <th>Errors / 10 moves</th>
            </tr>
          </thead>
          <tbody>
            {phases.map((ph) => (
              <tr key={ph}>
                <td>{ph}</td>
                <td>{p.byPhase[ph].moves}</td>
                <td>{p.byPhase[ph].accuracy}%</td>
                <td>{p.byPhase[ph].errorsPer10}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="muted small">
          Time trouble: {Math.round(p.timeTrouble.errorRate * 100)}% of moves with little time left were errors, vs{' '}
          {Math.round(p.timeTrouble.normalErrorRate * 100)}% otherwise. Punished {p.punishRate.punished}/{p.punishRate.chances} opponent errors.
          Converted {p.conversion.converted}/{p.conversion.winningGames} winning positions.
        </p>
      </section>

      <section className="card three-col">
        <Bars title="Tactics you allowed" data={p.allowed} tone="bad" />
        <Bars title="Chances you missed" data={p.missed} tone="neutral" />
        <Bars title="What you do well" data={p.found} tone="good" />
      </section>

      {p.openings.length > 0 && (
        <section className="card">
          <h2>Openings</h2>
          <table className="table">
            <thead>
              <tr>
                <th>Opening</th>
                <th>As</th>
                <th>Games</th>
                <th>Score</th>
                <th>Opening accuracy</th>
              </tr>
            </thead>
            <tbody>
              {p.openings.slice(0, 12).map((o) => (
                <tr key={o.name + o.color}>
                  <td>{o.name}</td>
                  <td>{o.color === 'w' ? 'White' : 'Black'}</td>
                  <td>{o.games}</td>
                  <td>{Math.round((o.score / o.games) * 100)}%</td>
                  <td>{o.avgAccuracy}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}
