import type {
  Filters,
  GroupSummary,
  MonthlySummary,
  ParsedFile,
  SourceKind,
  Transaction,
} from '../types';

const OTHER_KEY = 'その他';

function normalize(s: string): string {
  return s.normalize('NFKC');
}

function compareDate(a: Transaction, b: Transaction): number {
  return a.date < b.date ? -1 : a.date > b.date ? 1 : 0;
}

/**
 * 全ファイルの取引を結合し、日付昇順（安定）で返す。
 * 銀行のみ、別ファイル由来で (date, description, expense, income, balance) が
 * 全て同じ行は重複として除く。同一ファイル内の同一行は残す。カードは除去しない。
 */
export function mergeTransactions(files: ParsedFile[]): Transaction[] {
  const owner = new Map<string, number>();
  const all: Transaction[] = [];
  files.forEach((file, fileIndex) => {
    for (const tx of file.transactions) {
      if (tx.source === 'bank') {
        const key = JSON.stringify([
          tx.date,
          tx.description,
          tx.expense,
          tx.income,
          tx.balance ?? null,
        ]);
        const first = owner.get(key);
        if (first === undefined) {
          owner.set(key, fileIndex);
        } else if (first !== fileIndex) {
          continue;
        }
      }
      all.push(tx);
    }
  });
  return all.sort(compareDate);
}

/** 存在する月(YYYY-MM)を昇順・重複なしで返す。 */
export function listMonths(txs: Transaction[]): string[] {
  return [...new Set(txs.map((t) => t.month))].sort();
}

export function applyFilters(txs: Transaction[], filters: Filters): Transaction[] {
  const months = new Set(filters.months);
  const sources = new Set<SourceKind>(filters.sources);
  const terms = normalize(filters.keyword)
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length > 0);
  return txs.filter((t) => {
    if (months.size > 0 && !months.has(t.month)) return false;
    if (sources.size > 0 && !sources.has(t.source)) return false;
    if (terms.length > 0) {
      const desc = normalize(t.description).toLowerCase();
      if (!terms.every((term) => desc.includes(term))) return false;
    }
    return true;
  });
}

export function totals(txs: Transaction[]): {
  income: number;
  expense: number;
  net: number;
  count: number;
} {
  let income = 0;
  let expense = 0;
  for (const t of txs) {
    income += t.income;
    expense += t.expense;
  }
  return { income, expense, net: income - expense, count: txs.length };
}

/** 月ごとの集計（月昇順）。 */
export function summarizeByMonth(txs: Transaction[]): MonthlySummary[] {
  const map = new Map<string, MonthlySummary>();
  for (const t of txs) {
    let s = map.get(t.month);
    if (!s) {
      s = {
        month: t.month,
        income: 0,
        expense: 0,
        net: 0,
        bankExpense: 0,
        cardExpense: 0,
        count: 0,
      };
      map.set(t.month, s);
    }
    s.income += t.income;
    s.expense += t.expense;
    if (t.source === 'bank') s.bankExpense += t.expense;
    else s.cardExpense += t.expense;
    s.count += 1;
  }
  const list = [...map.values()];
  for (const s of list) s.net = s.income - s.expense;
  return list.sort((a, b) => (a.month < b.month ? -1 : a.month > b.month ? 1 : 0));
}

/**
 * 支出(expense>0)を摘要（NFKC正規化+trim）ごとに合算し、total降順（同額はキー昇順）。
 * limit 指定時は上位 limit 件＋残りを「その他」にまとめる。
 */
export function groupByDescription(
  txs: Transaction[],
  opts?: { source?: SourceKind; limit?: number },
): GroupSummary[] {
  const map = new Map<string, GroupSummary>();
  for (const t of txs) {
    if (t.expense <= 0) continue;
    if (opts?.source && t.source !== opts.source) continue;
    const key = normalize(t.description).trim();
    const g = map.get(key);
    if (g) {
      g.total += t.expense;
      g.count += 1;
    } else {
      map.set(key, { key, total: t.expense, count: 1 });
    }
  }
  const sorted = [...map.values()].sort(
    (a, b) => b.total - a.total || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0),
  );
  const limit = opts?.limit;
  if (limit === undefined || sorted.length <= limit) return sorted;
  const n = Math.max(0, Math.floor(limit));
  const head = sorted.slice(0, n);
  const rest = sorted.slice(n);
  head.push({
    key: OTHER_KEY,
    total: rest.reduce((sum, g) => sum + g.total, 0),
    count: rest.reduce((sum, g) => sum + g.count, 0),
  });
  return head;
}

/** 銀行取引のみ。日ごとの最終残高（残高のある行のみ、同日は最後の行）。日付昇順。 */
export function dailyBalance(txs: Transaction[]): { date: string; balance: number }[] {
  const bank = txs.filter((t) => t.source === 'bank' && t.balance !== undefined);
  const sorted = [...bank].sort(compareDate);
  const byDate = new Map<string, number>();
  for (const t of sorted) byDate.set(t.date, t.balance as number);
  return [...byDate.entries()].map(([date, balance]) => ({ date, balance }));
}
