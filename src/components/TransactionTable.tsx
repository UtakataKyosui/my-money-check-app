import { useMemo, useState } from 'react';
import type { Transaction } from '../types';
import { formatDate, formatYen } from '../lib/format';
import { sourceLabel } from './labels';

export const PAGE_SIZE = 200;

type SortKey = 'date' | 'expense' | 'income';
type SortDir = 'asc' | 'desc';

interface Props {
  transactions: Transaction[];
}

function sortTransactions(txs: Transaction[], key: SortKey, dir: SortDir): Transaction[] {
  const sign = dir === 'asc' ? 1 : -1;
  return txs
    .map((tx, index) => ({ tx, index }))
    .sort((a, b) => {
      const diff = key === 'date' ? a.tx.date.localeCompare(b.tx.date) : a.tx[key] - b.tx[key];
      return diff !== 0 ? diff * sign : a.index - b.index;
    })
    .map((x) => x.tx);
}

export function TransactionTable({ transactions }: Props) {
  const [sortKey, setSortKey] = useState<SortKey>('date');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [prevTransactions, setPrevTransactions] = useState(transactions);

  // 絞り込みなどで明細が入れ替わったら、表示件数を先頭200件に戻す
  if (prevTransactions !== transactions) {
    setPrevTransactions(transactions);
    setLimit(PAGE_SIZE);
  }

  const sorted = useMemo(() => sortTransactions(transactions, sortKey, sortDir), [transactions, sortKey, sortDir]);
  const visible = sorted.slice(0, limit);
  const remaining = sorted.length - visible.length;

  const toggleSort = (key: SortKey) => {
    if (key === sortKey) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDir('desc');
    }
    setLimit(PAGE_SIZE);
  };

  const header = (key: SortKey, label: string, numeric = false) => {
    const active = sortKey === key;
    return (
      <th scope="col" className={numeric ? 'num' : undefined} aria-sort={active ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}>
        <button type="button" className="sort-btn" onClick={() => toggleSort(key)}>
          {label}
          <span aria-hidden="true" className="sort-mark">
            {active ? (sortDir === 'asc' ? '▲' : '▼') : '↕'}
          </span>
        </button>
      </th>
    );
  };

  return (
    <section className="panel" aria-labelledby="tx-title">
      <div className="panel-head">
        <h2 id="tx-title">明細</h2>
        <p className="muted small" aria-live="polite" data-testid="tx-count">
          全{transactions.length.toLocaleString('ja-JP')}件中 {visible.length.toLocaleString('ja-JP')}件を表示
        </p>
      </div>
      {transactions.length === 0 ? (
        <p className="muted">条件に合う明細がありません。</p>
      ) : (
        <>
          <div className="table-scroll" tabIndex={0} role="region" aria-label="明細の表">
            <table className="num-table tx-table">
              <caption className="sr-only">明細一覧（日付・支出・収入の見出しで並べ替えできます）</caption>
              <thead>
                <tr>
                  {header('date', '日付')}
                  <th scope="col">ソース</th>
                  <th scope="col">摘要</th>
                  {header('expense', '支出', true)}
                  {header('income', '収入', true)}
                  <th scope="col" className="num">残高</th>
                  <th scope="col">メモ</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((tx) => (
                  <tr key={tx.id}>
                    <td className="nowrap">{formatDate(tx.date)}</td>
                    <td>
                      <span className={`badge badge-${tx.source}`}>{sourceLabel(tx.source)}</span>
                    </td>
                    <td className="desc">{tx.description}</td>
                    <td className="num">{tx.expense > 0 ? formatYen(tx.expense) : ''}</td>
                    <td className="num">{tx.income > 0 ? formatYen(tx.income) : ''}</td>
                    <td className="num">{tx.balance !== undefined ? formatYen(tx.balance) : ''}</td>
                    <td className="desc">{tx.note ?? ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {remaining > 0 && (
            <p className="more">
              <button type="button" className="btn" onClick={() => setLimit(limit + PAGE_SIZE)}>
                もっと見る（残り{remaining.toLocaleString('ja-JP')}件）
              </button>
            </p>
          )}
        </>
      )}
    </section>
  );
}
