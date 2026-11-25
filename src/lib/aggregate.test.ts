import { describe, expect, it } from 'vitest';
import type { Filters, ParsedFile, SourceKind, Transaction } from '../types';
import {
  applyFilters,
  dailyBalance,
  groupByDescription,
  listMonths,
  mergeTransactions,
  summarizeByMonth,
  totals,
} from './aggregate';

let seq = 0;
function tx(over: Partial<Transaction> & { date: string }): Transaction {
  seq += 1;
  return {
    id: `t${seq}`,
    source: 'bank',
    month: over.date.slice(0, 7),
    description: 'テスト',
    expense: 0,
    income: 0,
    fileName: 'a.csv',
    ...over,
  };
}

function file(
  fileName: string,
  source: SourceKind,
  transactions: Transaction[],
): ParsedFile {
  return {
    fileName,
    source,
    transactions: transactions.map((t) => ({ ...t, fileName, source })),
    warnings: [],
  };
}

const noFilter: Filters = { months: [], sources: [], keyword: '' };

describe('mergeTransactions', () => {
  it('returns empty for no files / empty files', () => {
    expect(mergeTransactions([])).toEqual([]);
    expect(mergeTransactions([file('a', 'bank', [])])).toEqual([]);
  });

  it('sorts by date ascending across files, stable for same date', () => {
    const a = file('a', 'bank', [
      tx({ date: '2026-11-03', description: 'a3', expense: 1 }),
      tx({ date: '2026-11-01', description: 'a1', expense: 2 }),
    ]);
    const c = file('c', 'card', [
      tx({ date: '2026-11-01', description: 'c1', expense: 3 }),
      tx({ date: '2026-10-31', description: 'c0', expense: 4 }),
    ]);
    const merged = mergeTransactions([a, c]);
    expect(merged.map((t) => t.description)).toEqual(['c0', 'a1', 'c1', 'a3']);
  });

  it('removes identical bank rows coming from a different file', () => {
    const row = { date: '2026-11-01', description: 'ATM', expense: 5000, balance: 100 };
    const a = file('a', 'bank', [tx(row)]);
    const b = file('b', 'bank', [tx(row), tx({ date: '2026-11-02', income: 10, balance: 110 })]);
    const merged = mergeTransactions([a, b]);
    expect(merged).toHaveLength(2);
    expect(merged[0]?.fileName).toBe('a');
  });

  it('keeps identical bank rows within the same file', () => {
    const row = { date: '2026-11-01', description: 'ATM', expense: 500, balance: 100 };
    const a = file('a', 'bank', [tx(row), tx(row)]);
    expect(mergeTransactions([a])).toHaveLength(2);
  });

  it('with duplicated pairs across files keeps the first file entries only', () => {
    const row = { date: '2026-11-01', description: 'ATM', expense: 500, balance: 100 };
    const a = file('a', 'bank', [tx(row), tx(row)]);
    const b = file('b', 'bank', [tx(row), tx(row)]);
    const merged = mergeTransactions([a, b]);
    expect(merged).toHaveLength(2);
    expect(merged.every((t) => t.fileName === 'a')).toBe(true);
  });

  it('treats rows differing in any key field as distinct', () => {
    const base = { date: '2026-11-01', description: 'X', expense: 100, balance: 50 };
    const a = file('a', 'bank', [tx(base)]);
    const b = file('b', 'bank', [
      tx({ ...base, balance: 51 }),
      tx({ ...base, expense: 101 }),
      tx({ ...base, description: 'Y' }),
      tx({ ...base, date: '2026-11-02' }),
      tx({ ...base, expense: 0, income: 100 }),
      tx({ ...base, balance: undefined }),
    ]);
    expect(mergeTransactions([a, b])).toHaveLength(7);
  });

  it('does not dedupe card rows across files', () => {
    const row = { date: '2026-11-01', description: 'ストア', expense: 800 };
    const a = file('a', 'card', [tx(row)]);
    const b = file('b', 'card', [tx(row)]);
    expect(mergeTransactions([a, b])).toHaveLength(2);
  });

  it('does not mix bank and card rows when deduping', () => {
    const row = { date: '2026-11-01', description: 'ストア', expense: 800 };
    const a = file('a', 'bank', [tx(row)]);
    const b = file('b', 'card', [tx(row)]);
    expect(mergeTransactions([a, b])).toHaveLength(2);
  });
});

describe('listMonths', () => {
  it('returns empty for empty input', () => {
    expect(listMonths([])).toEqual([]);
  });
  it('returns sorted unique months across year boundary', () => {
    const txs = [
      tx({ date: '2026-01-05' }),
      tx({ date: '2025-12-31' }),
      tx({ date: '2026-01-20' }),
      tx({ date: '2025-11-01' }),
    ];
    expect(listMonths(txs)).toEqual(['2025-11', '2025-12', '2026-01']);
  });
});

describe('applyFilters', () => {
  const txs = [
    tx({ date: '2026-10-31', description: 'ＡＢＣ　Store', expense: 100 }),
    tx({ date: '2026-11-01', description: 'abc shop', expense: 200, source: 'card' }),
    tx({ date: '2026-11-02', description: 'ｾﾌﾞﾝ-ｲﾚﾌﾞﾝ', expense: 300, source: 'card' }),
    tx({ date: '2026-11-03', description: 'Salary', income: 1000 }),
  ];

  it('returns all for empty filters (and a copy-like array)', () => {
    expect(applyFilters(txs, noFilter)).toHaveLength(4);
    expect(applyFilters([], noFilter)).toEqual([]);
  });

  it('filters by months across month boundary', () => {
    const r = applyFilters(txs, { ...noFilter, months: ['2026-10'] });
    expect(r.map((t) => t.date)).toEqual(['2026-10-31']);
    const r2 = applyFilters(txs, { ...noFilter, months: ['2026-10', '2026-11'] });
    expect(r2).toHaveLength(4);
  });

  it('filters by sources', () => {
    expect(applyFilters(txs, { ...noFilter, sources: ['card'] })).toHaveLength(2);
    expect(applyFilters(txs, { ...noFilter, sources: ['bank'] })).toHaveLength(2);
    expect(applyFilters(txs, { ...noFilter, sources: ['bank', 'card'] })).toHaveLength(4);
  });

  it('keyword is case-insensitive and full/half-width insensitive', () => {
    const r = applyFilters(txs, { ...noFilter, keyword: 'abc' });
    expect(r.map((t) => t.description)).toEqual(['ＡＢＣ　Store', 'abc shop']);
    expect(applyFilters(txs, { ...noFilter, keyword: 'ＳＡＬＡＲＹ' })).toHaveLength(1);
    expect(applyFilters(txs, { ...noFilter, keyword: 'salary' })).toHaveLength(1);
  });

  it('keyword matches half-width kana against full-width kana', () => {
    expect(applyFilters(txs, { ...noFilter, keyword: 'セブン' })).toHaveLength(1);
    expect(applyFilters(txs, { ...noFilter, keyword: 'ｾﾌﾞﾝ' })).toHaveLength(1);
  });

  it('whitespace-separated keywords are ANDed (incl. full-width space)', () => {
    expect(applyFilters(txs, { ...noFilter, keyword: 'abc store' })).toHaveLength(1);
    expect(applyFilters(txs, { ...noFilter, keyword: 'abc　shop' })).toHaveLength(1);
    expect(applyFilters(txs, { ...noFilter, keyword: 'abc salary' })).toHaveLength(0);
  });

  it('blank keyword matches everything', () => {
    expect(applyFilters(txs, { ...noFilter, keyword: '   ' })).toHaveLength(4);
  });

  it('combines all filters', () => {
    const r = applyFilters(txs, { months: ['2026-11'], sources: ['card'], keyword: 'abc' });
    expect(r.map((t) => t.description)).toEqual(['abc shop']);
  });
});

describe('totals', () => {
  it('returns zeros for empty', () => {
    expect(totals([])).toEqual({ income: 0, expense: 0, net: 0, count: 0 });
  });
  it('sums income / expense / net', () => {
    const r = totals([
      tx({ date: '2026-11-01', income: 1000 }),
      tx({ date: '2026-11-02', expense: 300 }),
      tx({ date: '2026-11-03', expense: 900 }),
    ]);
    expect(r).toEqual({ income: 1000, expense: 1200, net: -200, count: 3 });
  });
});

describe('summarizeByMonth', () => {
  it('returns empty for empty', () => {
    expect(summarizeByMonth([])).toEqual([]);
  });

  it('summarizes per month ascending, splitting bank/card expense', () => {
    const txs = [
      tx({ date: '2026-11-01', expense: 100 }),
      tx({ date: '2026-10-31', income: 5000 }),
      tx({ date: '2026-11-15', expense: 400, source: 'card' }),
      tx({ date: '2026-10-05', expense: 50, source: 'card' }),
    ];
    expect(summarizeByMonth(txs)).toEqual([
      {
        month: '2026-10',
        income: 5000,
        expense: 50,
        net: 4950,
        bankExpense: 0,
        cardExpense: 50,
        count: 2,
      },
      {
        month: '2026-11',
        income: 0,
        expense: 500,
        net: -500,
        bankExpense: 100,
        cardExpense: 400,
        count: 2,
      },
    ]);
  });
});

describe('groupByDescription', () => {
  it('returns empty for empty / no expense', () => {
    expect(groupByDescription([])).toEqual([]);
    expect(groupByDescription([tx({ date: '2026-11-01', income: 100 })])).toEqual([]);
  });

  it('groups by NFKC-normalized trimmed description, total desc, key asc on tie', () => {
    const txs = [
      tx({ date: '2026-11-01', description: 'ＡＢＣ', expense: 100 }),
      tx({ date: '2026-11-02', description: ' ABC ', expense: 200 }),
      tx({ date: '2026-11-03', description: 'ZZZ', expense: 300 }),
      tx({ date: '2026-11-04', description: 'BBB', expense: 300 }),
      tx({ date: '2026-11-05', description: 'income', income: 9999 }),
    ];
    expect(groupByDescription(txs)).toEqual([
      { key: 'ABC', total: 300, count: 2 },
      { key: 'BBB', total: 300, count: 1 },
      { key: 'ZZZ', total: 300, count: 1 },
    ]);
  });

  it('filters by source', () => {
    const txs = [
      tx({ date: '2026-11-01', description: 'A', expense: 100 }),
      tx({ date: '2026-11-01', description: 'B', expense: 200, source: 'card' }),
    ];
    expect(groupByDescription(txs, { source: 'card' })).toEqual([
      { key: 'B', total: 200, count: 1 },
    ]);
    expect(groupByDescription(txs, { source: 'bank' })).toEqual([
      { key: 'A', total: 100, count: 1 },
    ]);
  });

  it('bundles the rest into その他 when limit is exceeded', () => {
    const txs = [
      tx({ date: '2026-11-01', description: 'A', expense: 500 }),
      tx({ date: '2026-11-01', description: 'B', expense: 400 }),
      tx({ date: '2026-11-01', description: 'C', expense: 30 }),
      tx({ date: '2026-11-01', description: 'C', expense: 20 }),
      tx({ date: '2026-11-01', description: 'D', expense: 10 }),
    ];
    expect(groupByDescription(txs, { limit: 2 })).toEqual([
      { key: 'A', total: 500, count: 1 },
      { key: 'B', total: 400, count: 1 },
      { key: 'その他', total: 60, count: 3 },
    ]);
  });

  it('adds no その他 when group count <= limit', () => {
    const txs = [
      tx({ date: '2026-11-01', description: 'A', expense: 500 }),
      tx({ date: '2026-11-01', description: 'B', expense: 400 }),
    ];
    expect(groupByDescription(txs, { limit: 2 })).toHaveLength(2);
    expect(groupByDescription(txs, { limit: 10 })).toHaveLength(2);
  });

  it('limit 0 puts everything into その他', () => {
    const txs = [
      tx({ date: '2026-11-01', description: 'A', expense: 500 }),
      tx({ date: '2026-11-01', description: 'B', expense: 400 }),
    ];
    expect(groupByDescription(txs, { limit: 0 })).toEqual([
      { key: 'その他', total: 900, count: 2 },
    ]);
  });
});

describe('dailyBalance', () => {
  it('returns empty for empty / no bank rows / no balance', () => {
    expect(dailyBalance([])).toEqual([]);
    expect(dailyBalance([tx({ date: '2026-11-01', source: 'card', expense: 1 })])).toEqual([]);
    expect(dailyBalance([tx({ date: '2026-11-01', expense: 1 })])).toEqual([]);
  });

  it('takes last balance of each day, ascending, across months', () => {
    const txs = [
      tx({ date: '2026-12-01', balance: 700 }),
      tx({ date: '2026-11-30', balance: 1000 }),
      tx({ date: '2026-11-30', balance: 900 }),
      tx({ date: '2026-11-29', balance: 1100 }),
      tx({ date: '2026-11-29', source: 'card', expense: 5, balance: 1 }),
      tx({ date: '2026-11-30', description: 'no balance', expense: 1 }),
    ];
    expect(dailyBalance(txs)).toEqual([
      { date: '2026-11-29', balance: 1100 },
      { date: '2026-11-30', balance: 900 },
      { date: '2026-12-01', balance: 700 },
    ]);
  });

  it('keeps balance of 0', () => {
    expect(dailyBalance([tx({ date: '2026-11-01', balance: 0 })])).toEqual([
      { date: '2026-11-01', balance: 0 },
    ]);
  });
});
