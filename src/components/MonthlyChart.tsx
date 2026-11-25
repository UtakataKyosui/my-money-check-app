import { formatMonth, formatYen } from '../lib/format';
import type { MonthlyDisplayRow } from '../lib/provisional';

interface Props {
  rows: MonthlyDisplayRow[];
}

/** CSSだけで描く簡易の横棒グラフ。数値は隣の表に同じものがあるため、読み上げ対象からは外す。 */
export function MonthlyChart({ rows }: Props) {
  const hasProvisional = rows.some((r) => r.provisional > 0);
  const max = Math.max(1, ...rows.flatMap((r) => [r.income, r.totalExpense]));
  const pct = (n: number) => `${Math.max(0, (n / max) * 100)}%`;

  return (
    <figure className="chart" aria-label="月別の収入・支出の棒グラフ（支出には暫定支払いを含む）">
      <figcaption className="chart-legend">
        <span className="legend-item">
          <span className="swatch swatch-income" aria-hidden="true" />
          収入
        </span>
        <span className="legend-item">
          <span className="swatch swatch-expense" aria-hidden="true" />
          支出（銀行＋カード・参考値）
        </span>
        {hasProvisional && (
          <span className="legend-item">
            <span className="swatch swatch-provisional" aria-hidden="true" />
            暫定支払い（手入力・支出に含む）
          </span>
        )}
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
                {/* 支出バーは CSV の支出（銀行＋カード）に暫定支払いを積んだ合計の長さ */}
                <div className="bar-stack" style={{ width: pct(r.totalExpense) }}>
                  {r.totalExpense === 0 || r.expense > 0 ? (
                    <div
                      className="bar bar-expense"
                      style={{ width: r.totalExpense === 0 ? '100%' : `${(r.expense / r.totalExpense) * 100}%` }}
                    />
                  ) : null}
                  {r.provisional > 0 && (
                    <div
                      className="bar bar-provisional"
                      style={{ width: `${(r.provisional / r.totalExpense) * 100}%` }}
                    />
                  )}
                </div>
                <span className="bar-value">{formatYen(r.totalExpense)}</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </figure>
  );
}
