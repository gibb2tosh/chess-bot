import { useEffect, useRef } from 'react';
import type { PlyAnalysis } from '../lib/types';
import { CLASS_INFO } from './ui';

interface Props {
  plies: PlyAnalysis[];
  current: number;
  onSelect: (ply: number) => void;
}

export function MoveList({ plies, current, onSelect }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  // Keep the current move visible by scrolling the list itself. (scrollIntoView
  // would also scroll the page, pushing the explanation out of view.)
  useEffect(() => {
    const list = ref.current;
    const el = list?.querySelector<HTMLElement>('.mv.active');
    if (!list || !el) return;
    const top = el.offsetTop; // relative to the list, which is position: relative
    const bottom = top + el.offsetHeight;
    if (top < list.scrollTop) list.scrollTop = top;
    else if (bottom > list.scrollTop + list.clientHeight) list.scrollTop = bottom - list.clientHeight;
  }, [current]);

  const rows: { n: number; w?: PlyAnalysis; b?: PlyAnalysis }[] = [];
  for (const p of plies) {
    if (p.color === 'w' || rows.length === 0) rows.push({ n: p.moveNumber, [p.color]: p });
    else rows[rows.length - 1].b = p;
  }

  const cell = (p?: PlyAnalysis) => {
    if (!p) return <span className="mv empty" />;
    const info = CLASS_INFO[p.classification];
    const showBadge = !['best', 'excellent', 'good', 'book', 'forced'].includes(p.classification);
    return (
      <button className={`mv ${current === p.ply ? 'active' : ''}`} onClick={() => onSelect(p.ply)} title={info.label}>
        {p.san}
        {showBadge && (
          <span className="badge" style={{ background: info.color }}>
            {info.symbol}
          </span>
        )}
      </button>
    );
  };

  return (
    <div className="move-list" ref={ref}>
      {rows.map((r) => (
        <div className="move-row" key={r.n}>
          <span className="mv-num">{r.n}.</span>
          {cell(r.w)}
          {cell(r.b)}
        </div>
      ))}
    </div>
  );
}
