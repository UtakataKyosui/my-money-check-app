import { formatMonth, formatSignedYen, formatYen } from '../lib/format';
import type { MonthlyDisplayRow } from '../lib/provisional';
import { MonthlyChart } from './MonthlyChart';

interface Props {
  rows: MonthlyDisplayRow[];
}

export function MonthlyTable({ rows }: Props) {
  return (
    <section className="panel" aria-labelledby="monthly-title">
      <h2 id="monthly-title">月別サマリー</h2>
      {rows.length === 0 ? (
        <p className="muted">条件に合う明細・暫定支払いがありません。</p>
      ) : (
        <>
          <MonthlyChart rows={rows} />
          <div className="table-scroll" tabIndex={0} role="region" aria-label="月別サマリーの表">
            <table className="num-table">
              <thead>
                <tr>
                  <th scope="col">月</th>
                  <th scope="col" className="num">収入</th>
                  <th scope="col" className="num">支出（参考値）</th>
                  <th scope="col" className="num">収支（参考値）</th>
                  <th scope="col" className="num">銀行の支出</th>
                  <th scope="col" className="num">カードの支出</th>
                  <th scope="col" className="num">件数</th>
                  <th scope="col" className="num">暫定支払い（手入力）</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.month}>
                    <th scope="row">{formatMonth(r.month)}</th>
                    <td className="num">{formatYen(r.income)}</td>
                    <td className="num">{formatYen(r.totalExpense)}</td>
                    <td className={`num ${r.totalNet < 0 ? 'neg' : 'pos'}`}>{formatSignedYen(r.totalNet)}</td>
                    <td className="num">{formatYen(r.bankExpense)}</td>
                    <td className="num">{formatYen(r.cardExpense)}</td>
                    <td className="num">{r.count.toLocaleString('ja-JP')}</td>
                    <td className="num">
                      {formatYen(r.provisional)}
                      {r.provisionalCount > 0 && (
                        <span className="cell-sub muted">
                          確定 {formatYen(r.provisionalConfirmed)} / 見込み {formatYen(r.provisionalEstimated)}
                        </span>
                      )}
                      {r.provisionalFromCsv > 0 && (
                        <span className="cell-sub muted">CSV確定 {formatYen(r.provisionalFromCsv)}（確定に含む）</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="muted small">
            支出（参考値）・収支（参考値）には「暫定支払い（手入力）」を含みます。銀行の支出・カードの支出はCSVの取引だけです。
          </p>
        </>
      )}
    </section>
  );
}
