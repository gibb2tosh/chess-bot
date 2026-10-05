import { useEffect, useRef, useState } from 'react';

export interface ChartSeries {
  key: string;
  label: string;
  /** CSS colour, normally one of the --series-N tokens. */
  color: string;
}

export interface ChartPoint {
  label: string;
  /** Shown under the label in the tooltip (e.g. "8 games"). */
  note?: string;
  values: Record<string, number | null>;
}

interface Props {
  title: string;
  series: ChartSeries[];
  points: ChartPoint[];
  format: (n: number) => string;
  /** Force the y-axis to start at 0 (counts) instead of fitting the data (accuracy). */
  zeroBased?: boolean;
  /** Fixed upper bound for the y-axis, e.g. 100 for percentages. */
  yMax?: number;
  height?: number;
}

const PAD = { top: 12, right: 16, bottom: 26, left: 36 };

function niceStep(range: number, ticks: number) {
  const raw = range / ticks;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  return (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10) * mag;
}

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.floor(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

/**
 * Small multi-series line chart: hairline grid, 2px lines, ringed markers,
 * a crosshair that snaps to the nearest point with a tooltip listing every
 * series, keyboard stepping, and a table view for screen readers / exact values.
 */
export function LineChart({ title, series, points, format, zeroBased, yMax, height = 170 }: Props) {
  const [wrapRef, width] = useWidth<HTMLDivElement>();
  const [active, setActive] = useState<number | null>(null);

  const all = points.flatMap((p) => series.map((s) => p.values[s.key])).filter((v): v is number => v !== null && v !== undefined);
  let lo = zeroBased ? 0 : Math.min(...all);
  let hi = yMax ?? Math.max(...all);
  if (!all.length) {
    lo = 0;
    hi = 1;
  }
  if (hi - lo < 1e-9) hi = lo + 1;
  const step = niceStep(hi - lo, 3);
  lo = Math.floor(lo / step) * step;
  hi = yMax ?? Math.ceil(hi / step) * step;
  const ticks: number[] = [];
  for (let v = lo; v <= hi + step / 1000; v += step) ticks.push(Math.round(v * 1000) / 1000);

  const w = Math.max(width, 200);
  const innerW = w - PAD.left - PAD.right;
  const innerH = height - PAD.top - PAD.bottom;
  const n = points.length;
  const x = (i: number) => PAD.left + (n === 1 ? innerW / 2 : (i / (n - 1)) * innerW);
  const y = (v: number) => PAD.top + innerH - ((v - lo) / (hi - lo)) * innerH;

  // Show as many x labels as fit (~70px each), always including the last.
  const every = Math.max(1, Math.ceil(n / Math.max(1, Math.floor(innerW / 70))));
  const showLabel = (i: number) => i === n - 1 || (i % every === 0 && n - 1 - i >= every / 2);

  const nearest = (clientX: number, rect: DOMRect) => {
    const px = clientX - rect.left;
    if (n === 1) return 0;
    return Math.max(0, Math.min(n - 1, Math.round(((px - PAD.left) / innerW) * (n - 1))));
  };

  const single = series.length === 1;
  const activePoint = active !== null ? points[active] : null;
  const tooltipLeft = active !== null ? Math.min(Math.max(x(active) - 70, 0), w - 150) : 0;

  return (
    <figure className="chart">
      <figcaption className="chart-title">{title}</figcaption>
      {!single && (
        <div className="chart-legend" aria-hidden="true">
          {series.map((s) => (
            <span key={s.key} className="legend-item">
              <span className="legend-key" style={{ background: s.color }} />
              {s.label}
            </span>
          ))}
        </div>
      )}
      <div className="chart-plot" ref={wrapRef}>
        {width > 0 && (
          <svg
            width={w}
            height={height}
            role="img"
            aria-label={`${title}. Use the table below for exact values.`}
            tabIndex={0}
            onPointerMove={(e) => setActive(nearest(e.clientX, e.currentTarget.getBoundingClientRect()))}
            onPointerLeave={() => setActive(null)}
            onFocus={() => setActive((a) => a ?? n - 1)}
            onBlur={() => setActive(null)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowLeft') setActive((a) => Math.max(0, (a ?? n) - 1));
              if (e.key === 'ArrowRight') setActive((a) => Math.min(n - 1, (a ?? -1) + 1));
            }}
          >
            {ticks.map((t) => (
              <g key={t}>
                <line className="chart-grid" x1={PAD.left} x2={w - PAD.right} y1={y(t)} y2={y(t)} />
                <text className="chart-axis" x={PAD.left - 6} y={y(t)} dy="0.32em" textAnchor="end">
                  {format(t)}
                </text>
              </g>
            ))}
            {points.map((p, i) =>
              showLabel(i) ? (
                <text key={i} className="chart-axis" x={x(i)} y={height - 6} textAnchor={n > 1 && i === n - 1 ? 'end' : n > 1 && i === 0 ? 'start' : 'middle'}>
                  {p.label}
                </text>
              ) : null,
            )}
            {active !== null && <line className="chart-crosshair" x1={x(active)} x2={x(active)} y1={PAD.top} y2={PAD.top + innerH} />}
            {series.map((s) => {
              const pts = points.map((p, i) => [i, p.values[s.key]] as const).filter((d): d is readonly [number, number] => d[1] != null);
              const d = pts.map(([i, v], k) => `${k ? 'L' : 'M'}${x(i)},${y(v)}`).join(' ');
              return (
                <g key={s.key}>
                  <path d={d} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
                  {pts.map(([i, v]) => (
                    <circle
                      key={i}
                      cx={x(i)}
                      cy={y(v)}
                      r={active === i ? 5 : 4}
                      fill={s.color}
                      stroke="var(--surface)"
                      strokeWidth={2}
                    />
                  ))}
                </g>
              );
            })}
            {single &&
              (() => {
                const s = series[0];
                const last = [...points].reverse().find((p) => p.values[s.key] != null);
                if (!last) return null;
                const i = points.lastIndexOf(last);
                return (
                  <text className="chart-endlabel" x={x(i)} y={y(last.values[s.key]!) - 10} textAnchor={n > 1 ? 'end' : 'middle'}>
                    {format(last.values[s.key]!)}
                  </text>
                );
              })()}
          </svg>
        )}
        {activePoint && (
          <div className="chart-tooltip" style={{ left: tooltipLeft }} aria-hidden="true">
            <div className="tt-head">
              {activePoint.label}
              {activePoint.note && <span className="muted"> · {activePoint.note}</span>}
            </div>
            {series.map((s) => (
              <div className="tt-row" key={s.key}>
                <span className="tt-key" style={{ background: s.color }} />
                <b>{activePoint.values[s.key] != null ? format(activePoint.values[s.key]!) : '–'}</b>
                <span className="muted">{s.label}</span>
              </div>
            ))}
          </div>
        )}
      </div>
      <details className="chart-table">
        <summary>Show as table</summary>
        <table className="table">
          <thead>
            <tr>
              <th>Period</th>
              {series.map((s) => (
                <th key={s.key}>{s.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {points.map((p) => (
              <tr key={p.label}>
                <td>
                  {p.label}
                  {p.note && <span className="muted small"> ({p.note})</span>}
                </td>
                {series.map((s) => (
                  <td key={s.key}>{p.values[s.key] != null ? format(p.values[s.key]!) : '–'}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}
