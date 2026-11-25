import { formatSignedYen, formatYen } from '../lib/format';
import { formatCount } from './labels';

export interface SummaryTotals {
  income: number;
  expense: number;
  net: number;
  count: number;
}

interface Props {
  totals: SummaryTotals;
  bankExpense: number;
  cardExpense: number;
}

export function SummaryCards({ totals, bankExpense, cardExpense }: Props) {
  return (
    <section className="panel" aria-labelledby="summary-title">
      <h2 id="summary-title">概要（絞り込み後）</h2>
      <dl className="cards">
        <div className="card">
          <dt>収入合計</dt>
          <dd data-testid="summary-income">{formatYen(totals.income)}</dd>
        </div>
        <div className="card">
          <dt>支出合計（参考値）</dt>
          <dd data-testid="summary-expense">{formatYen(totals.expense)}</dd>
        </div>
        <div className="card">
          <dt>収支（参考値）</dt>
          <dd data-testid="summary-net" className={totals.net < 0 ? 'neg' : 'pos'}>
            {formatSignedYen(totals.net)}
          </dd>
        </div>
        <div className="card">
          <dt>件数</dt>
          <dd data-testid="summary-count">{formatCount(totals.count)}</dd>
        </div>
      </dl>
      <dl className="cards cards-sub">
        <div className="card card-sub">
          <dt>銀行の支出</dt>
          <dd data-testid="summary-bank-expense">{formatYen(bankExpense)}</dd>
        </div>
        <div className="card card-sub">
          <dt>カードの支出</dt>
          <dd data-testid="summary-card-expense">{formatYen(cardExpense)}</dd>
        </div>
      </dl>
      <p className="note" role="note">
        注意: 銀行口座からのカード代金の引き落としと、カードの利用明細は同じ支出を二重に数えることがあります。
        そのため、合算した支出合計と収支は「参考値」です。実際の支出は「銀行の支出」と「カードの支出」を見比べて判断してください。
      </p>
    </section>
  );
}
