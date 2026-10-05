import { formatScore, winProb } from '../lib/eval';
import type { Score } from '../lib/types';

/** Vertical evaluation bar. `score` is from White's point of view. */
export function EvalBar({ score, orientation }: { score: Score; orientation: 'white' | 'black' }) {
  const white = winProb(score) * 100;
  const flipped = orientation === 'black';
  return (
    <div className={`eval-bar ${flipped ? 'flipped' : ''}`} aria-label={`Evaluation ${formatScore(score)}`}>
      <div className="eval-white" style={{ height: `${white}%` }} />
      <span className={`eval-label ${white >= 50 ? 'on-white' : 'on-black'}`}>{formatScore(score).replace('+', '')}</span>
    </div>
  );
}
