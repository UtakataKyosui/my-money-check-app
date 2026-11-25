import { formatSignedYen, formatYen } from '../lib/format';
import { formatCount } from './labels';

export interface SummaryTotals {
  income: number;
  expense: number;
  net: number;
  count: number;
}

/** 手入力の暫定支払いの合計（CSVの数値とは別枠） */
export interface ProvisionalSummary {
  total: number;
  confirmed: number;
  estimated: number;
  count: number;
}

interface Props {
  totals: SummaryTotals;
  bankExpense: number;
  cardExpense: number;
  provisional: ProvisionalSummary;
}

export function SummaryCards({ totals, bankExpense, cardExpense, provisional }: Props) {
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
      <h3 className="cards-title">暫定支払い（手入力・上の数値には含まれません）</h3>
      <dl className="cards cards-sub cards-provisional">
        <div className="card card-sub">
          <dt>暫定支払い合計（手入力）</dt>
          <dd data-testid="summary-provisional-total">{formatYen(provisional.total)}</dd>
        </div>
        <div className="card card-sub">
          <dt>うち確定</dt>
          <dd data-testid="summary-provisional-confirmed">{formatYen(provisional.confirmed)}</dd>
        </div>
        <div className="card card-sub">
          <dt>うち見込み</dt>
          <dd data-testid="summary-provisional-estimated">{formatYen(provisional.estimated)}</dd>
        </div>
      </dl>
      <p className="note" role="note">
        注意: 銀行口座からのカード代金の引き落としと、カードの利用明細は同じ支出を二重に数えることがあります。
        そのため、合算した支出合計と収支は「参考値」です。実際の支出は「銀行の支出」と「カードの支出」を見比べて判断してください。
        「暫定支払い（手入力）」は手入力した金額で、CSVの取引とは別に集計しています。収入・支出・銀行／カードの数値には含まれません。
        同じ支払いがCSVにも載ったときは、二重計上にならないよう暫定支払いの方を削除してください。
      </p>
    </section>
  );
}
