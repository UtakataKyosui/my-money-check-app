import type {
  Filters,
  MonthlySummary,
  ProvisionalKind,
  ProvisionalMonth,
  ProvisionalPayment,
  ParsedFile,
  SupersededProvisional,
} from '../types';

export const PROVISIONAL_STORAGE_KEY = 'my-money-check:provisional:v1';

const KINDS: readonly ProvisionalKind[] = ['card', 'bank', 'other'];

function normalize(s: string): string {
  return s.normalize('NFKC');
}

function compareString(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export interface ProvisionalInput {
  month: string;
  label: string;
  amount: string;
  kind: ProvisionalKind;
  confirmed: boolean;
  note?: string;
  pinned?: boolean;
}

export type ProvisionalValidation =
  | { ok: true; value: Omit<ProvisionalPayment, 'id'> }
  | { ok: false; errors: { month?: string; label?: string; amount?: string } };

/** 月の入力を YYYY-MM に正規化する。解釈できなければ null。 */
function parseMonth(raw: string): string | null {
  const s = normalize(raw).trim();
  const m = /^(\d{4})\s*(?:[-/.]|年)\s*(\d{1,2})\s*月?$/.exec(s);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  if (year < 1 || month < 1 || month > 12) return null;
  return `${m[1]}-${String(month).padStart(2, '0')}`;
}

/** 正の整数の金額（円）。全角数字・`,`・`¥`・`円`・空白を許容。 */
function parsePositiveAmount(raw: string): number | null {
  const s = normalize(raw).replace(/[¥￥円,\s]/g, '');
  if (!/^\d+$/.test(s)) return null;
  const n = Number(s);
  if (!Number.isSafeInteger(n) || n <= 0) return null;
  return n;
}

export function validateProvisionalInput(input: ProvisionalInput): ProvisionalValidation {
  const errors: { month?: string; label?: string; amount?: string } = {};

  const month = parseMonth(input.month);
  if (month === null) {
    errors.month = '支払い月は「2026-11」のように年と月（1〜12月）で入力してください。';
  }

  const label = input.label.trim();
  if (label === '') {
    errors.label = '支払先・内容を入力してください。';
  }

  const amount = parsePositiveAmount(input.amount);
  if (amount === null) {
    errors.amount = '金額は1円以上の整数で入力してください（例: 12,345）。';
  }

  if (month === null || label === '' || amount === null) {
    return { ok: false, errors };
  }

  const note = input.note?.trim();
  return {
    ok: true,
    value: {
      month,
      label,
      amount,
      kind: input.kind,
      confirmed: input.confirmed,
      note: note ? note : undefined,
      ...(input.pinned ? { pinned: true } : {}),
    },
  };
}

export function createProvisionalId(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c && typeof c.randomUUID === 'function') {
    try {
      return c.randomUUID();
    } catch {
      // 非セキュアコンテキストなどでは下のフォールバックを使う
    }
  }
  return `p-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function getDefaultStorage(): Storage | undefined {
  try {
    return globalThis.localStorage ?? undefined;
  } catch {
    return undefined;
  }
}

function toValidItem(raw: unknown): ProvisionalPayment | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== 'string' || r.id === '') return null;
  if (typeof r.month !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(r.month)) return null;
  if (typeof r.label !== 'string' || r.label.trim() === '') return null;
  if (typeof r.amount !== 'number' || !Number.isSafeInteger(r.amount) || r.amount <= 0) return null;
  if (typeof r.kind !== 'string' || !KINDS.includes(r.kind as ProvisionalKind)) return null;
  if (typeof r.confirmed !== 'boolean') return null;
  if (r.note !== undefined && r.note !== null && typeof r.note !== 'string') return null;
  if (r.pinned !== undefined && r.pinned !== null && typeof r.pinned !== 'boolean') return null;
  const note = typeof r.note === 'string' && r.note.trim() !== '' ? r.note : undefined;
  return {
    id: r.id,
    month: r.month,
    label: r.label,
    amount: r.amount,
    kind: r.kind as ProvisionalKind,
    confirmed: r.confirmed,
    note,
    ...(r.pinned === true ? { pinned: true } : {}),
  };
}

/** 保存済みの暫定支払いを読む。読めない・壊れている場合は空、不正な要素は無視する。 */
export function loadProvisional(storage?: Pick<Storage, 'getItem'>): ProvisionalPayment[] {
  try {
    const store = storage ?? getDefaultStorage();
    if (!store) return [];
    const text = store.getItem(PROVISIONAL_STORAGE_KEY);
    if (text === null || text === undefined) return [];
    const data: unknown = JSON.parse(text);
    if (!Array.isArray(data)) return [];
    const seen = new Set<string>();
    const items: ProvisionalPayment[] = [];
    for (const raw of data) {
      const item = toValidItem(raw);
      if (!item || seen.has(item.id)) continue;
      seen.add(item.id);
      items.push(item);
    }
    return items;
  } catch {
    return [];
  }
}

/** 暫定支払いを保存する。保存できない環境でも例外にしない。 */
export function saveProvisional(
  items: ProvisionalPayment[],
  storage?: Pick<Storage, 'setItem'>,
): void {
  try {
    const store = storage ?? getDefaultStorage();
    if (!store) return;
    store.setItem(PROVISIONAL_STORAGE_KEY, JSON.stringify(items));
  } catch {
    // 容量超過・プライベートモードなどは無視
  }
}

/** 月とキーワード（label+note）だけを適用する。sources は無視する。 */
export function filterProvisional(
  items: ProvisionalPayment[],
  filters: Filters,
): ProvisionalPayment[] {
  const months = new Set(filters.months);
  const terms = normalize(filters.keyword)
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length > 0);
  return items.filter((p) => {
    if (months.size > 0 && !months.has(p.month)) return false;
    if (terms.length > 0) {
      const haystack = normalize(`${p.label} ${p.note ?? ''}`).toLowerCase();
      if (!terms.every((term) => haystack.includes(term))) return false;
    }
    return true;
  });
}

export function provisionalTotals(items: ProvisionalPayment[]): {
  total: number;
  confirmed: number;
  estimated: number;
  count: number;
} {
  let confirmed = 0;
  let estimated = 0;
  for (const p of items) {
    if (p.confirmed) confirmed += p.amount;
    else estimated += p.amount;
  }
  return { total: confirmed + estimated, confirmed, estimated, count: items.length };
}

/** 月ごとの暫定支払い集計（月昇順）。 */
export function provisionalByMonth(items: ProvisionalPayment[]): ProvisionalMonth[] {
  const map = new Map<string, ProvisionalMonth>();
  for (const p of items) {
    let m = map.get(p.month);
    if (!m) {
      m = { month: p.month, total: 0, confirmed: 0, estimated: 0, count: 0 };
      map.set(p.month, m);
    }
    m.total += p.amount;
    if (p.confirmed) m.confirmed += p.amount;
    else m.estimated += p.amount;
    m.count += 1;
  }
  return [...map.values()].sort((a, b) => compareString(a.month, b.month));
}

export interface MonthlyRow extends MonthlySummary {
  provisional: number;
  provisionalConfirmed: number;
  provisionalEstimated: number;
  provisionalCount: number;
}

/** CSV由来の月次集計と暫定支払いの月次集計を月の和集合で結合する（月昇順）。 */
export function mergeMonthlyWithProvisional(
  monthly: MonthlySummary[],
  prov: ProvisionalMonth[],
): MonthlyRow[] {
  const provByMonth = new Map(prov.map((p) => [p.month, p]));
  const monthlyByMonth = new Map(monthly.map((m) => [m.month, m]));
  const months = [...new Set([...monthlyByMonth.keys(), ...provByMonth.keys()])].sort(
    compareString,
  );
  return months.map((month): MonthlyRow => {
    const base: MonthlySummary = monthlyByMonth.get(month) ?? {
      month,
      income: 0,
      expense: 0,
      net: 0,
      bankExpense: 0,
      cardExpense: 0,
      count: 0,
    };
    const p = provByMonth.get(month);
    return {
      ...base,
      provisional: p?.total ?? 0,
      provisionalConfirmed: p?.confirmed ?? 0,
      provisionalEstimated: p?.estimated ?? 0,
      provisionalCount: p?.count ?? 0,
    };
  });
}

/** CSV由来の月と暫定支払いの月の和集合（昇順・重複なし）。 */
export function listAllMonths(txMonths: string[], items: ProvisionalPayment[]): string[] {
  return [...new Set([...txMonths, ...items.map((p) => p.month)])].sort(compareString);
}

/**
 * CSVに同じ支払いが含まれる暫定支払いを active から外し superseded に分ける。入力の並び順を保つ。
 * - pinned、または kind が 'other' は常に active。
 * - card: source が card で paymentMonth が一致するファイルがあれば置き換え（by はファイル名昇順で最初）。
 * - bank: source が bank で、その月の取引を1件でも含むファイルがあれば置き換え。
 */
export function resolveProvisional(
  items: ProvisionalPayment[],
  files: ParsedFile[],
): { active: ProvisionalPayment[]; superseded: SupersededProvisional[] } {
  const sorted = [...files].sort((a, b) => compareString(a.fileName, b.fileName));
  const active: ProvisionalPayment[] = [];
  const superseded: SupersededProvisional[] = [];
  for (const item of items) {
    let by: string | undefined;
    if (!item.pinned && item.kind !== 'other') {
      by = sorted.find((f) =>
        item.kind === 'card'
          ? f.source === 'card' && f.paymentMonth === item.month
          : f.source === 'bank' && f.transactions.some((t) => t.month === item.month),
      )?.fileName;
    }
    if (by === undefined) active.push(item);
    else superseded.push({ item, by });
  }
  return { active, superseded };
}
