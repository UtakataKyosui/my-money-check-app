import type { MonthlySummary } from '../types';
import { formatMonth, formatYen } from '../lib/format';

interface Props {
  rows: MonthlySummary[];
}

/** CSSだけで描く簡易の横棒グラフ。数値は隣の表に同じものがあるため、読み上げ対象からは外す。 */
export function MonthlyChart({ rows }: Props) {
  const max = Math.max(1, ...rows.flatMap((r) => [r.income, r.expense]));
  const pct = (n: number) => `${Math.max(0, (n / max) * 100)}%`;

  return (
    <figure className="chart" aria-label="月別の収入と支出の棒グラフ">
      <figcaption className="chart-legend">
        <span className="legend-item">
          <span className="swatch swatch-income" aria-hidden="true" />
          収入
        </span>
        <span className="legend-item">
          <span className="swatch swatch-expense" aria-hidden="true" />
          支出（銀行＋カード・参考値）
        </span>
      </figcaption>
      <div className="mbars" aria-hidden="true">
        {rows.map((r) => (
          <div key={r.month} className="mbar-row">
            <div className="mbar-label">{formatMonth(r.month)}</div>
            <div className="mbar-tracks">
              <div className="bar-track">
                <div className="bar bar-income" style={{ width: pct(r.income) }} />
                <span className="bar-value">{formatYen(r.income)}</span>
              </div>
              <div className="bar-track">
                <div className="bar bar-expense" style={{ width: pct(r.expense) }} />
                <span className="bar-value">{formatYen(r.expense)}</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </figure>
  );
}
