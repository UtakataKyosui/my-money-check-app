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
  /** CSVで置き換えられた暫定支払いの件数（CSVの支払額で上書きしたものを含む） */
  supersededCount?: number;
  /** うち、CSVの支払額で上書きして集計に含めている件数と、その合計（円） */
  csvOverriddenCount?: number;
  csvOverriddenTotal?: number;
}

export function SummaryCards({
  totals,
  bankExpense,
  cardExpense,
  provisional,
  supersededCount = 0,
  csvOverriddenCount = 0,
  csvOverriddenTotal = 0,
}: Props) {
  // 置き換えのうち、CSVの支払額での上書きができず暫定値を外したもの（銀行CSVなど）
  const removedCount = Math.max(0, supersededCount - csvOverriddenCount);
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
      {csvOverriddenCount > 0 && (
        <p className="muted small prov-superseded-note" data-testid="summary-provisional-csv-override">
          CSVの支払額で上書き {formatCount(csvOverriddenCount)}（合計 {formatYen(csvOverriddenTotal)}）:
          暫定値の代わりにCSVの支払額を、支払い月の暫定支払いとして集計しています。「うち確定」に含まれます。
        </p>
      )}
      {removedCount > 0 && (
        <p className="muted small prov-superseded-note" data-testid="summary-provisional-superseded">
          CSVで置き換え済み {formatCount(removedCount)}（集計に含まれません）
        </p>
      )}
      <p className="note" role="note">
        注意: 銀行口座からのカード代金の引き落としと、カードの利用明細は同じ支出を二重に数えることがあります。
        そのため、合算した支出合計と収支は「参考値」です。実際の支出は「銀行の支出」と「カードの支出」を見比べて判断してください。
        「暫定支払い（手入力）」は手入力した金額で、CSVの取引とは別に集計しています。収入・支出・銀行／カードの数値には含まれません。
        同じ支払いのCSVを読み込むと、カードの暫定支払いはCSVの支払額で上書きされ（支払い月の行に残ります）、銀行の暫定支払いはその月の取引がCSVにあるため集計から外れます（CSVを削除すると元に戻ります）。
      </p>
    </section>
  );
}
