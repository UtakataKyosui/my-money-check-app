import { formatDate, formatYen } from '../lib/format';

interface Point {
  date: string;
  balance: number;
}

interface Props {
  points: Point[];
}

const W = 640;
const H = 260;
const PAD = { left: 92, right: 20, top: 16, bottom: 36 };
const TICKS = 4;

function toTime(date: string): number {
  return Date.parse(`${date}T00:00:00Z`);
}

export function BalanceChart({ points }: Props) {
  if (points.length === 0) {
    return (
      <section className="panel" aria-labelledby="balance-title">
        <h2 id="balance-title">銀行の残高推移</h2>
        <p className="muted">条件に合う銀行の明細がありません。</p>
      </section>
    );
  }

  const times = points.map((p) => toTime(p.date));
  const t0 = Math.min(...times);
  const t1 = Math.max(...times);
  let lo = Math.min(...points.map((p) => p.balance));
  let hi = Math.max(...points.map((p) => p.balance));
  if (lo === hi) {
    lo -= 1;
    hi += 1;
  }
  const span = hi - lo;
  lo -= span * 0.05;
  hi += span * 0.05;

  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const x = (t: number) => (t1 === t0 ? PAD.left + plotW / 2 : PAD.left + ((t - t0) / (t1 - t0)) * plotW);
  const y = (v: number) => PAD.top + (1 - (v - lo) / (hi - lo)) * plotH;

  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(times[i] as number).toFixed(1)},${y(p.balance).toFixed(1)}`).join(' ');
  const ticks = Array.from({ length: TICKS + 1 }, (_, i) => lo + ((hi - lo) * i) / TICKS);
  const first = points[0] as Point;
  const last = points[points.length - 1] as Point;
  const label = `銀行の残高推移。${formatDate(first.date)}は${formatYen(first.balance)}、${formatDate(last.date)}は${formatYen(last.balance)}。`;

  return (
    <section className="panel" aria-labelledby="balance-title">
      <h2 id="balance-title">銀行の残高推移</h2>
      <div className="chart-scroll">
        <svg className="line-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label}>
          {ticks.map((v, i) => (
            <g key={i}>
              <line className="grid" x1={PAD.left} x2={W - PAD.right} y1={y(v)} y2={y(v)} />
              <text className="axis" x={PAD.left - 8} y={y(v)} textAnchor="end" dominantBaseline="middle">
                {formatYen(Math.round(v))}
              </text>
            </g>
          ))}
          <text className="axis" x={PAD.left} y={H - 10} textAnchor="start">
            {formatDate(first.date)}
          </text>
          {points.length > 1 && (
            <text className="axis" x={W - PAD.right} y={H - 10} textAnchor="end">
              {formatDate(last.date)}
            </text>
          )}
          <path className="line" d={path} fill="none" />
          {points.length <= 80 &&
            points.map((p, i) => (
              <circle key={p.date} className="dot" cx={x(times[i] as number)} cy={y(p.balance)} r={3}>
                <title>{`${formatDate(p.date)}: ${formatYen(p.balance)}`}</title>
              </circle>
            ))}
        </svg>
      </div>
    </section>
  );
}
