import { winProb } from '../lib/eval';
import type { PlyAnalysis } from '../lib/types';
import { CLASS_INFO } from './ui';

interface Props {
  plies: PlyAnalysis[];
  current: number; // 0 = start position, n = after ply n
  onSelect: (ply: number) => void;
}

/** White's winning chances over the game; click to jump to a move. */
export function EvalGraph({ plies, current, onSelect }: Props) {
  const W = 600;
  const H = 90;
  const n = plies.length;
  if (n === 0) return null;
  const x = (i: number) => (i / n) * W;
  const y = (p: number) => H - p * H;
  const pts = [[0, winProb(plies[0].evalBefore)], ...plies.map((p, i) => [i + 1, winProb(p.evalAfter)])];
  const area = `M0,${H} ` + pts.map(([i, p]) => `L${x(i)},${y(p)}`).join(' ') + ` L${W},${H} Z`;
  const marks = plies.filter((p) => ['blunder', 'mistake', 'miss', 'brilliant', 'great'].includes(p.classification));

  return (
    <svg
      className="eval-graph"
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      role="img"
      aria-label="Evaluation graph"
      onClick={(e) => {
        const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
        onSelect(Math.round(((e.clientX - r.left) / r.width) * n));
      }}
    >
      <rect x="0" y="0" width={W} height={H} className="eg-bg" />
      <path d={area} className="eg-area" />
      <line x1="0" x2={W} y1={H / 2} y2={H / 2} className="eg-mid" />
      <line x1={x(current)} x2={x(current)} y1="0" y2={H} className="eg-cursor" />
      {marks.map((p) => (
        <circle key={p.ply} cx={x(p.ply)} cy={y(winProb(p.evalAfter))} r="4" fill={CLASS_INFO[p.classification].color} stroke="#fff" strokeWidth="1" />
      ))}
    </svg>
  );
}
