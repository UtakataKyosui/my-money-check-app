import { describe, expect, it, vi } from 'vitest';
import type { Filters, MonthlySummary, ParsedFile, ProvisionalPayment, Transaction } from '../types';
import {
  PROVISIONAL_STORAGE_KEY,
  combineTotals,
  createProvisionalId,
  filterProvisional,
  listAllMonths,
  loadProvisional,
  mergeMonthlyWithProvisional,
  provisionalByMonth,
  provisionalFromCsvByMonth,
  provisionalTotals,
  resolveProvisional,
  saveProvisional,
  validateProvisionalInput,
  withProvisionalExpense,
} from './provisional';

const base = {
  month: '2026-11',
  label: '楽天カード 11月分',
  amount: '12345',
  kind: 'card' as const,
  confirmed: true,
};

function errorsOf(input: Parameters<typeof validateProvisionalInput>[0]) {
  const r = validateProvisionalInput(input);
  if (r.ok) throw new Error('expected validation failure');
  return r.errors;
}

function valueOf(input: Parameters<typeof validateProvisionalInput>[0]) {
  const r = validateProvisionalInput(input);
  if (!r.ok) throw new Error(`expected ok: ${JSON.stringify(r.errors)}`);
  return r.value;
}

describe('validateProvisionalInput', () => {
  it('正常な入力を値にする（noteなしはundefined）', () => {
    expect(valueOf(base)).toEqual({
      month: '2026-11',
      label: '楽天カード 11月分',
      amount: 12345,
      kind: 'card',
      confirmed: true,
      note: undefined,
    });
  });

  it('kind と confirmed をそのまま引き継ぐ', () => {
    const v = valueOf({ ...base, kind: 'other', confirmed: false });
    expect(v.kind).toBe('other');
    expect(v.confirmed).toBe(false);
  });

  describe('month', () => {
    it.each([
      ['2026-11', '2026-11'],
      ['2026/11', '2026-11'],
      ['2026/1', '2026-01'],
      ['2026-1', '2026-01'],
      ['2026.03', '2026-03'],
      ['2026年11月', '2026-11'],
      ['2026年1月', '2026-01'],
      ['2026年11', '2026-11'],
      ['２０２６－１１', '2026-11'],
      ['２０２６／１１', '2026-11'],
      ['２０２６年１１月', '2026-11'],
      ['  2026-12  ', '2026-12'],
      ['2026-01', '2026-01'],
    ])('%s を %s にする', (input, expected) => {
      expect(valueOf({ ...base, month: input }).month).toBe(expected);
    });

    it.each(['', '   ', '2026', '2026-00', '2026-13', '2026-1-1', '26-11', '202611', 'abc', '2026年13月', '11月', '0000-05'])(
      '%j は不可',
      (input) => {
        const e = errorsOf({ ...base, month: input });
        expect(e.month).toMatch(/月/);
        expect(e.label).toBeUndefined();
        expect(e.amount).toBeUndefined();
      },
    );
  });

  describe('label', () => {
    it('trim する（NFKC正規化はしない）', () => {
      expect(valueOf({ ...base, label: '  　ＡＢＣ カード　 ' }).label).toBe('ＡＢＣ カード');
    });

    it.each(['', '   ', '\t\n', '　'])('%j は不可', (input) => {
      const e = errorsOf({ ...base, label: input });
      expect(e.label).toBeTruthy();
      expect(e.month).toBeUndefined();
    });
  });

  describe('amount', () => {
    it.each([
      ['1', 1],
      ['100', 100],
      ['12,345', 12345],
      ['１２３４５', 12345],
      ['１，２３４', 1234],
      ['¥12,345', 12345],
      ['￥12,345', 12345],
      ['12345円', 12345],
      ['¥ 1,234 円', 1234],
      [' 1 000 ', 1000],
      ['0012', 12],
    ])('%s を %i にする', (input, expected) => {
      expect(valueOf({ ...base, amount: input }).amount).toBe(expected);
    });

    it.each(['', '  ', '0', '００', '¥0', '-100', '−100', '100.5', '1.0', 'abc', '12a', '円', '1e3', '9999999999999999999'])(
      '%j は不可',
      (input) => {
        const e = errorsOf({ ...base, amount: input });
        expect(e.amount).toBeTruthy();
        expect(e.month).toBeUndefined();
      },
    );
  });

  describe('note', () => {
    it('trim する', () => {
      expect(valueOf({ ...base, note: '  分割払い  ' }).note).toBe('分割払い');
    });

    it('空白のみなら undefined', () => {
      expect(valueOf({ ...base, note: '   ' }).note).toBeUndefined();
      expect(valueOf({ ...base, note: '' }).note).toBeUndefined();
    });
  });

  it('複数のエラーをまとめて返す', () => {
    const e = errorsOf({ ...base, month: 'x', label: '', amount: '0' });
    expect(Object.keys(e).sort()).toEqual(['amount', 'label', 'month']);
    for (const msg of Object.values(e)) expect(msg).toMatch(/[ぁ-んァ-ヶ一-龠]/);
  });
});

describe('createProvisionalId', () => {
  it('呼ぶたびに異なる空でない文字列を返す', () => {
    const ids = new Set(Array.from({ length: 50 }, () => createProvisionalId()));
    expect(ids.size).toBe(50);
    for (const id of ids) expect(id.length).toBeGreaterThan(0);
  });

  it('crypto.randomUUID が無ければ時刻+乱数にフォールバックする', () => {
    vi.stubGlobal('crypto', undefined);
    try {
      const a = createProvisionalId();
      const b = createProvisionalId();
      expect(a).toMatch(/^p-/);
      expect(a).not.toBe(b);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('randomUUID が例外を投げてもフォールバックする', () => {
    vi.stubGlobal('crypto', {
      randomUUID: () => {
        throw new Error('insecure');
      },
    });
    try {
      expect(createProvisionalId()).toMatch(/^p-/);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

const item = (over: Partial<ProvisionalPayment> = {}): ProvisionalPayment => ({
  id: 'a',
  month: '2026-11',
  label: '楽天カード',
  amount: 1000,
  kind: 'card',
  confirmed: true,
  ...over,
});

describe('loadProvisional / saveProvisional', () => {
  it('保存したものを読み戻せる（キー名も固定）', () => {
    const data = new Map<string, string>();
    const storage = {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => void data.set(k, v),
    };
    const items = [item(), item({ id: 'b', note: 'メモ', confirmed: false, kind: 'other' })];
    saveProvisional(items, storage);
    expect([...data.keys()]).toEqual(['my-money-check:provisional:v1']);
    expect(PROVISIONAL_STORAGE_KEY).toBe('my-money-check:provisional:v1');
    expect(loadProvisional(storage)).toEqual([
      { ...items[0], note: undefined },
      items[1],
    ]);
  });

  it('値が無ければ空配列', () => {
    expect(loadProvisional({ getItem: () => null })).toEqual([]);
  });

  it('getItem が例外を投げても空配列', () => {
    expect(
      loadProvisional({
        getItem: () => {
          throw new Error('denied');
        },
      }),
    ).toEqual([]);
  });

  it('setItem が例外を投げても握りつぶす', () => {
    expect(() =>
      saveProvisional([item()], {
        setItem: () => {
          throw new Error('quota');
        },
      }),
    ).not.toThrow();
  });

  it('壊れたJSONは空配列', () => {
    expect(loadProvisional({ getItem: () => '{not json' })).toEqual([]);
  });

  it('配列でないJSONは空配列', () => {
    expect(loadProvisional({ getItem: () => '{"a":1}' })).toEqual([]);
    expect(loadProvisional({ getItem: () => '"x"' })).toEqual([]);
    expect(loadProvisional({ getItem: () => 'null' })).toEqual([]);
  });

  it('不正な要素は無視し、有効な要素だけ返す', () => {
    const good = item({ id: 'good' });
    const raw = [
      good,
      null,
      42,
      'str',
      [],
      { ...good, id: '' },
      { ...good, id: 1 },
      { ...good, id: 'm1', month: '2026-13' },
      { ...good, id: 'm2', month: '2026/11' },
      { ...good, id: 'l1', label: '   ' },
      { ...good, id: 'am1', amount: 0 },
      { ...good, id: 'am2', amount: -5 },
      { ...good, id: 'am3', amount: 1.5 },
      { ...good, id: 'am4', amount: '100' },
      { ...good, id: 'k1', kind: 'cash' },
      { ...good, id: 'c1', confirmed: 'yes' },
      { ...good, id: 'n1', note: 5 },
      { id: 'missing' },
    ];
    expect(loadProvisional({ getItem: () => JSON.stringify(raw) })).toEqual([
      { ...good, note: undefined },
    ]);
  });

  it('id が重複する要素は最初のものだけ残す', () => {
    const raw = [item({ id: 'x', amount: 1 }), item({ id: 'x', amount: 2 })];
    const loaded = loadProvisional({ getItem: () => JSON.stringify(raw) });
    expect(loaded).toHaveLength(1);
    expect(loaded[0]?.amount).toBe(1);
  });

  it('空文字のnoteは undefined になり、未知のフィールドは落とす', () => {
    const raw = [{ ...item(), note: '  ', extra: 'zzz' }];
    const loaded = loadProvisional({ getItem: () => JSON.stringify(raw) });
    expect(loaded).toEqual([item()]);
    expect(loaded[0]).not.toHaveProperty('extra');
  });

  it('storage 省略時は globalThis.localStorage を使う', () => {
    localStorage.clear();
    saveProvisional([item({ id: 'ls' })]);
    expect(localStorage.getItem(PROVISIONAL_STORAGE_KEY)).toContain('"ls"');
    expect(loadProvisional().map((p) => p.id)).toEqual(['ls']);
    localStorage.clear();
  });

  it('globalThis.localStorage へのアクセス自体が例外でも落ちない', () => {
    const spy = vi.spyOn(globalThis, 'localStorage', 'get').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError');
    });
    try {
      expect(loadProvisional()).toEqual([]);
      expect(() => saveProvisional([item()])).not.toThrow();
    } finally {
      spy.mockRestore();
    }
  });

  it('localStorage が無い環境でも落ちない', () => {
    vi.stubGlobal('localStorage', undefined);
    try {
      expect(loadProvisional()).toEqual([]);
      expect(() => saveProvisional([item()])).not.toThrow();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('filterProvisional', () => {
  const items = [
    item({ id: '1', month: '2026-10', label: '楽天カード 10月分', amount: 100 }),
    item({ id: '2', month: '2026-11', label: '楽天カード 11月分', amount: 200, note: 'ボーナス払い' }),
    item({ id: '3', month: '2026-11', label: 'ＡＭＥＸ', amount: 300, kind: 'card', confirmed: false }),
    item({ id: '4', month: '2026-12', label: '家賃', amount: 400, kind: 'bank' }),
  ];
  const f = (over: Partial<Filters> = {}): Filters => ({ months: [], sources: [], keyword: '', ...over });
  const ids = (xs: ProvisionalPayment[]) => xs.map((x) => x.id);

  it('フィルタなしは全件（新しい配列）', () => {
    const r = filterProvisional(items, f());
    expect(ids(r)).toEqual(['1', '2', '3', '4']);
    expect(r).not.toBe(items);
  });

  it('月で絞り込む', () => {
    expect(ids(filterProvisional(items, f({ months: ['2026-11'] })))).toEqual(['2', '3']);
    expect(ids(filterProvisional(items, f({ months: ['2026-10', '2026-12'] })))).toEqual(['1', '4']);
    expect(filterProvisional(items, f({ months: ['2025-01'] }))).toEqual([]);
  });

  it('sources は無視する', () => {
    expect(ids(filterProvisional(items, f({ sources: ['bank'] })))).toEqual(['1', '2', '3', '4']);
    expect(ids(filterProvisional(items, f({ sources: ['card'], months: ['2026-12'] })))).toEqual(['4']);
  });

  it('キーワードは label を大文字小文字・全半角を区別せず部分一致', () => {
    expect(ids(filterProvisional(items, f({ keyword: 'amex' })))).toEqual(['3']);
    expect(ids(filterProvisional(items, f({ keyword: 'ＡＭＥＸ' })))).toEqual(['3']);
    expect(ids(filterProvisional(items, f({ keyword: '１１月' })))).toEqual(['2']);
  });

  it('キーワードは note も対象', () => {
    expect(ids(filterProvisional(items, f({ keyword: 'ボーナス' })))).toEqual(['2']);
  });

  it('空白区切りはAND（label と note をまたいでよい）', () => {
    expect(ids(filterProvisional(items, f({ keyword: '楽天 ボーナス' })))).toEqual(['2']);
    expect(ids(filterProvisional(items, f({ keyword: '楽天 家賃' })))).toEqual([]);
    expect(ids(filterProvisional(items, f({ keyword: '楽天　カード' })))).toEqual(['1', '2']);
  });

  it('空白のみのキーワードは無視、月と併用できる', () => {
    expect(filterProvisional(items, f({ keyword: '   ' }))).toHaveLength(4);
    expect(ids(filterProvisional(items, f({ months: ['2026-11'], keyword: '楽天' })))).toEqual(['2']);
  });

  it('note が無い項目でも "undefined" にヒットしない', () => {
    expect(filterProvisional(items, f({ keyword: 'undefined' }))).toEqual([]);
  });
});

describe('provisionalTotals', () => {
  it('空配列はすべて0', () => {
    expect(provisionalTotals([])).toEqual({ total: 0, confirmed: 0, estimated: 0, count: 0 });
  });

  it('確定と見込みを分けて合計する', () => {
    const items = [
      item({ id: '1', amount: 1000, confirmed: true }),
      item({ id: '2', amount: 250, confirmed: false }),
      item({ id: '3', amount: 3000, confirmed: true }),
      item({ id: '4', amount: 50, confirmed: false }),
    ];
    expect(provisionalTotals(items)).toEqual({ total: 4300, confirmed: 4000, estimated: 300, count: 4 });
  });
});

describe('provisionalByMonth', () => {
  it('月ごとに集計し、月昇順で返す', () => {
    const items = [
      item({ id: '1', month: '2026-12', amount: 500, confirmed: false }),
      item({ id: '2', month: '2026-10', amount: 100, confirmed: true }),
      item({ id: '3', month: '2026-12', amount: 700, confirmed: true }),
      item({ id: '4', month: '2026-10', amount: 20, confirmed: false }),
    ];
    expect(provisionalByMonth(items)).toEqual([
      { month: '2026-10', total: 120, confirmed: 100, estimated: 20, count: 2 },
      { month: '2026-12', total: 1200, confirmed: 700, estimated: 500, count: 2 },
    ]);
  });

  it('空配列は空', () => {
    expect(provisionalByMonth([])).toEqual([]);
  });
});

describe('mergeMonthlyWithProvisional / listAllMonths', () => {
  const summary = (month: string, over: Partial<MonthlySummary> = {}): MonthlySummary => ({
    month,
    income: 300,
    expense: 200,
    net: 100,
    bankExpense: 120,
    cardExpense: 80,
    count: 5,
    ...over,
  });

  it('両方にある月は暫定の数値を付与する', () => {
    const rows = mergeMonthlyWithProvisional(
      [summary('2026-10')],
      [{ month: '2026-10', total: 150, confirmed: 100, estimated: 50, count: 2 }],
    );
    expect(rows).toEqual([
      { ...summary('2026-10'), provisional: 150, provisionalConfirmed: 100, provisionalEstimated: 50, provisionalCount: 2, provisionalFromCsv: 0 },
    ]);
  });

  it('暫定のみの月は CSV 側を0にした行として追加され、月昇順になる', () => {
    const rows = mergeMonthlyWithProvisional(
      [summary('2026-10'), summary('2026-12')],
      [
        { month: '2026-11', total: 90, confirmed: 90, estimated: 0, count: 1 },
        { month: '2027-01', total: 10, confirmed: 0, estimated: 10, count: 1 },
      ],
    );
    expect(rows.map((r) => r.month)).toEqual(['2026-10', '2026-11', '2026-12', '2027-01']);
    expect(rows[1]).toEqual({
      month: '2026-11',
      income: 0,
      expense: 0,
      net: 0,
      bankExpense: 0,
      cardExpense: 0,
      count: 0,
      provisional: 90,
      provisionalConfirmed: 90,
      provisionalEstimated: 0,
      provisionalCount: 1,
      provisionalFromCsv: 0,
    });
    expect(rows[3]?.provisionalEstimated).toBe(10);
  });

  it('CSVのみの月は暫定が0', () => {
    const [row] = mergeMonthlyWithProvisional([summary('2026-10')], []);
    expect(row).toMatchObject({
      income: 300,
      provisional: 0,
      provisionalConfirmed: 0,
      provisionalEstimated: 0,
      provisionalCount: 0,
    });
  });

  it('入力を変更しない', () => {
    const monthly = [summary('2026-10')];
    const snapshot = JSON.stringify(monthly);
    mergeMonthlyWithProvisional(monthly, [{ month: '2026-10', total: 1, confirmed: 1, estimated: 0, count: 1 }]);
    expect(JSON.stringify(monthly)).toBe(snapshot);
  });

  it('両方空なら空', () => {
    expect(mergeMonthlyWithProvisional([], [])).toEqual([]);
  });

  it('listAllMonths は和集合を昇順・重複なしで返す', () => {
    const items = [
      item({ id: '1', month: '2026-12' }),
      item({ id: '2', month: '2026-10' }),
      item({ id: '3', month: '2026-12' }),
    ];
    expect(listAllMonths(['2026-11', '2026-10', '2026-11'], items)).toEqual(['2026-10', '2026-11', '2026-12']);
    expect(listAllMonths([], [])).toEqual([]);
    expect(listAllMonths(['2026-01'], [])).toEqual(['2026-01']);
  });
});

describe('pinned（validate / load / save）', () => {
  it('pinned: true は value に含まれ、false/未指定ではプロパティ自体が出ない', () => {
    expect(valueOf({ ...base, pinned: true })).toHaveProperty('pinned', true);
    expect(valueOf({ ...base, pinned: false })).not.toHaveProperty('pinned');
    expect(valueOf(base)).not.toHaveProperty('pinned');
  });

  it('save → load で pinned: true が保たれる', () => {
    const data = new Map<string, string>();
    const storage = {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => void data.set(k, v),
    };
    saveProvisional([item({ id: 'p', pinned: true }), item({ id: 'q' })], storage);
    const loaded = loadProvisional(storage);
    expect(loaded[0]).toHaveProperty('pinned', true);
    expect(loaded[1]).not.toHaveProperty('pinned');
  });

  it('load: pinned: false / null は出さず、boolean 以外の要素は無視する', () => {
    const raw = [
      { ...item({ id: 'f' }), pinned: false },
      { ...item({ id: 'n' }), pinned: null },
      { ...item({ id: 'bad1' }), pinned: 'yes' },
      { ...item({ id: 'bad2' }), pinned: 1 },
      { ...item({ id: 't' }), pinned: true },
    ];
    const loaded = loadProvisional({ getItem: () => JSON.stringify(raw) });
    expect(loaded.map((p) => p.id)).toEqual(['f', 'n', 't']);
    expect(loaded[0]).not.toHaveProperty('pinned');
    expect(loaded[1]).not.toHaveProperty('pinned');
    expect(loaded[2]).toHaveProperty('pinned', true);
  });
});

describe('provisionalFromCsvByMonth と mergeMonthlyWithProvisional の CSV 由来分', () => {
  const summary = (month: string): MonthlySummary => ({
    month,
    income: 0,
    expense: 100,
    net: -100,
    bankExpense: 0,
    cardExpense: 100,
    count: 1,
  });

  it('fromCsv の項目だけを月ごとに合計する', () => {
    const m = provisionalFromCsvByMonth([
      item({ id: 'a', month: '2026-11', amount: 100, fromCsv: true }),
      item({ id: 'b', month: '2026-11', amount: 50, fromCsv: true }),
      item({ id: 'c', month: '2026-11', amount: 999 }),
      item({ id: 'd', month: '2026-12', amount: 7, fromCsv: true }),
    ]);
    expect([...m.entries()]).toEqual([
      ['2026-11', 150],
      ['2026-12', 7],
    ]);
  });

  it('月次の行に provisionalFromCsv として付与され、確定の内数のまま', () => {
    const items = [item({ id: 'a', month: '2026-11', amount: 50000, confirmed: true, fromCsv: true })];
    const rows = mergeMonthlyWithProvisional(
      [summary('2026-10')],
      provisionalByMonth(items),
      provisionalFromCsvByMonth(items),
    );
    expect(rows.map((r) => r.month)).toEqual(['2026-10', '2026-11']);
    expect(rows[1]).toMatchObject({
      provisional: 50000,
      provisionalConfirmed: 50000,
      provisionalFromCsv: 50000,
    });
    expect(rows[0]?.provisionalFromCsv).toBe(0);
  });
});

describe('resolveProvisional', () => {
  const tx = (source: 'bank' | 'card', month: string): Transaction => ({
    id: `${source}:${month}`,
    source,
    date: `${month}-01`,
    month,
    description: 'x',
    expense: 100,
    income: 0,
    fileName: 'f.csv',
  });
  const file = (
    fileName: string,
    source: 'bank' | 'card',
    months: string[],
    paymentMonth?: string,
    paymentTotal?: number,
  ): ParsedFile => ({
    fileName,
    source,
    transactions: months.map((m) => tx(source, m)),
    warnings: [],
    ...(paymentMonth ? { paymentMonth } : {}),
    ...(paymentTotal !== undefined ? { paymentTotal } : {}),
  });
  const prov = (id: string, over: Partial<ProvisionalPayment> = {}) =>
    item({ id, month: '2026-11', kind: 'card', ...over });

  it('ファイルが無ければすべて active', () => {
    const items = [prov('a'), prov('b', { kind: 'bank' })];
    expect(resolveProvisional(items, [])).toEqual({ active: items, superseded: [], effective: items });
  });

  it('card: paymentMonth が一致するカードCSVで置き換える', () => {
    const a = prov('a');
    const r = resolveProvisional([a], [file('card.csv', 'card', ['2026-10'], '2026-11')]);
    expect(r.active).toEqual([]);
    expect(r.superseded).toEqual([{ item: a, by: 'card.csv' }]);
    // paymentTotal が分からないCSVでは上書きできず、集計からは外れる
    expect(r.effective).toEqual([]);
  });

  it('card: paymentTotal があれば replacement（CSVの支払額で上書き）を付け、effective にその位置で差し込む', () => {
    const a = prov('a', { amount: 48500, confirmed: false, note: 'メモ' });
    const r = resolveProvisional([a], [file('card.csv', 'card', ['2026-10'], '2026-11', 50000)]);
    expect(r.active).toEqual([]);
    const replacement = { ...a, amount: 50000, confirmed: true, fromCsv: true };
    expect(r.superseded).toEqual([{ item: a, by: 'card.csv', replacement }]);
    expect(r.effective).toEqual([replacement]);
    expect(r.superseded[0]?.replacement).not.toHaveProperty('pinned');
    // 元の項目は変更しない
    expect(a).toEqual(prov('a', { amount: 48500, confirmed: false, note: 'メモ' }));
  });

  it('card: paymentTotal が0でも replacement を付け、負なら amount は0に丸める', () => {
    const a = prov('a');
    const zero = resolveProvisional([a], [file('card.csv', 'card', [], '2026-11', 0)]);
    expect(zero.effective).toEqual([{ ...a, amount: 0, confirmed: true, fromCsv: true }]);
    const neg = resolveProvisional([a], [file('card.csv', 'card', [], '2026-11', -300)]);
    expect(neg.superseded[0]?.replacement?.amount).toBe(0);
    expect(neg.effective).toEqual([{ ...a, amount: 0, confirmed: true, fromCsv: true }]);
  });

  it('effective: 入力の並び順を保ち、card は replacement、bank は除外、pinned/other は active のまま', () => {
    const items = [
      prov('1', { month: '2026-12' }),
      prov('2'),
      prov('3', { kind: 'other' }),
      prov('4', { kind: 'bank' }),
      prov('5', { pinned: true }),
      prov('6', { month: '2026-10' }),
    ];
    const files = [
      file('c.csv', 'card', ['2026-10'], '2026-11', 7000),
      file('b.csv', 'bank', ['2026-11']),
    ];
    const r = resolveProvisional(items, files);
    expect(r.active.map((p) => p.id)).toEqual(['1', '3', '5', '6']);
    expect(r.superseded.map((s) => s.item.id)).toEqual(['2', '4']);
    expect(r.effective.map((p) => p.id)).toEqual(['1', '2', '3', '5', '6']);
    expect(r.effective[1]).toMatchObject({ id: '2', amount: 7000, confirmed: true, fromCsv: true });
    // active のものは同一の項目をそのまま使う
    expect(r.effective[0]).toBe(items[0]);
    expect(r.effective[2]).toBe(items[2]);
    expect(r.effective[3]).toBe(items[4]);
  });

  it('card: 月が不一致 / paymentMonth なし / 銀行CSVでは置き換えない', () => {
    const a = prov('a');
    const files = [
      file('c1.csv', 'card', ['2026-11'], '2026-12'),
      file('c2.csv', 'card', ['2026-11']),
      file('b.csv', 'bank', ['2026-11'], '2026-11'),
    ];
    expect(resolveProvisional([a], files)).toEqual({ active: [a], superseded: [], effective: [a] });
  });

  it('bank: 該当月の取引を含む銀行CSVで置き換える', () => {
    const a = prov('a', { kind: 'bank' });
    const r = resolveProvisional([a], [file('bank.csv', 'bank', ['2026-10', '2026-11'])]);
    expect(r.active).toEqual([]);
    expect(r.superseded).toEqual([{ item: a, by: 'bank.csv' }]);
    expect(r.superseded[0]).not.toHaveProperty('replacement');
    // 銀行はその月の取引がCSVに実在するので、暫定値を外すだけ
    expect(r.effective).toEqual([]);
  });

  it('bank: 該当月の取引が無い / カードCSVでは置き換えない', () => {
    const a = prov('a', { kind: 'bank' });
    const files = [
      file('bank.csv', 'bank', ['2026-10', '2026-12']),
      file('card.csv', 'card', ['2026-11'], '2026-11'),
    ];
    expect(resolveProvisional([a], files)).toEqual({ active: [a], superseded: [], effective: [a] });
  });

  it('other は常に active', () => {
    const a = prov('a', { kind: 'other' });
    const files = [file('b.csv', 'bank', ['2026-11']), file('c.csv', 'card', [], '2026-11')];
    expect(resolveProvisional([a], files)).toEqual({ active: [a], superseded: [], effective: [a] });
  });

  it('pinned は常に active', () => {
    const a = prov('a', { pinned: true });
    const b = prov('b', { kind: 'bank', pinned: true });
    const files = [file('b.csv', 'bank', ['2026-11']), file('c.csv', 'card', [], '2026-11')];
    expect(resolveProvisional([a, b], files)).toEqual({ active: [a, b], superseded: [], effective: [a, b] });
  });

  it('複数ファイルが該当する場合は by がファイル名昇順で最初のもの', () => {
    const a = prov('a');
    const b = prov('b', { kind: 'bank' });
    const files = [
      file('z.csv', 'card', [], '2026-11'),
      file('m.csv', 'bank', ['2026-11']),
      file('a.csv', 'card', [], '2026-11'),
      file('c.csv', 'bank', ['2026-11']),
    ];
    const r = resolveProvisional([a, b], files);
    expect(r.superseded).toEqual([
      { item: a, by: 'a.csv' },
      { item: b, by: 'c.csv' },
    ]);
  });

  it('active / superseded とも入力の並び順を保ち、入力配列を変更しない', () => {
    const items = [
      prov('1', { month: '2026-12' }),
      prov('2'),
      prov('3', { kind: 'other' }),
      prov('4'),
      prov('5', { pinned: true }),
      prov('6', { month: '2026-10' }),
    ];
    const copy = [...items];
    const files = [file('c.csv', 'card', [], '2026-11')];
    const r = resolveProvisional(items, files);
    expect(r.active.map((p) => p.id)).toEqual(['1', '3', '5', '6']);
    expect(r.superseded.map((s) => s.item.id)).toEqual(['2', '4']);
    expect(items).toEqual(copy);
    expect(files[0]?.fileName).toBe('c.csv');
  });
});

describe('combineTotals', () => {
  it('支出は CSV + 暫定、収支は 収入 − 支出。件数はCSVのまま', () => {
    expect(combineTotals({ income: 560000, expense: 395750, count: 20 }, { total: 100000 })).toEqual({
      income: 560000,
      expense: 495750,
      net: 64250,
      count: 20,
      provisionalExpense: 100000,
    });
  });

  it('CSVが無く暫定だけなら、支出＝暫定、収支＝−暫定', () => {
    expect(combineTotals({ income: 0, expense: 0, count: 0 }, { total: 169627 })).toEqual({
      income: 0,
      expense: 169627,
      net: -169627,
      count: 0,
      provisionalExpense: 169627,
    });
  });

  it('暫定が0なら CSV の合計と一致する', () => {
    const r = combineTotals({ income: 100, expense: 30, count: 2 }, provisionalTotals([]));
    expect(r).toMatchObject({ income: 100, expense: 30, net: 70, count: 2, provisionalExpense: 0 });
  });

  it('provisionalTotals の確定・見込みの合計（total）をそのまま使う', () => {
    const items: ProvisionalPayment[] = [
      { id: '1', month: '2026-11', label: 'a', amount: 100, kind: 'other', confirmed: true },
      { id: '2', month: '2026-11', label: 'b', amount: 50, kind: 'other', confirmed: false },
    ];
    expect(combineTotals({ income: 0, expense: 10, count: 1 }, provisionalTotals(items)).expense).toBe(160);
  });
});

describe('withProvisionalExpense', () => {
  const summary = (month: string, over: Partial<MonthlySummary> = {}): MonthlySummary => ({
    month,
    income: 300,
    expense: 200,
    net: 100,
    bankExpense: 120,
    cardExpense: 80,
    count: 5,
    ...over,
  });

  it('各月の支出・収支に暫定を含め、CSV由来の列はそのまま残す。暫定のみの月も反映する', () => {
    const rows = mergeMonthlyWithProvisional(
      [summary('2026-10')],
      [
        { month: '2026-10', total: 150, confirmed: 100, estimated: 50, count: 2 },
        { month: '2026-11', total: 90, confirmed: 90, estimated: 0, count: 1 },
      ],
    );
    const out = withProvisionalExpense(rows);
    expect(out[0]).toMatchObject({
      month: '2026-10',
      income: 300,
      expense: 200,
      net: 100,
      bankExpense: 120,
      cardExpense: 80,
      provisional: 150,
      totalExpense: 350,
      totalNet: -50,
    });
    expect(out[1]).toMatchObject({ month: '2026-11', income: 0, expense: 0, totalExpense: 90, totalNet: -90 });
  });

  it('CSVの支払額で上書きした分（provisionalFromCsv）は支出・収支に加算しない（二重計上の回避）', () => {
    const rows = mergeMonthlyWithProvisional(
      [summary('2026-10', { expense: 200, cardExpense: 200, bankExpense: 0 })],
      [
        { month: '2026-10', total: 150, confirmed: 150, estimated: 0, count: 2 },
        { month: '2026-11', total: 90, confirmed: 90, estimated: 0, count: 1 },
      ],
      new Map([['2026-10', 100], ['2026-11', 90]]),
    );
    const out = withProvisionalExpense(rows);
    // 10月: 暫定150のうち100はCSV由来なので、加算されるのは50だけ
    expect(out[0]).toMatchObject({ month: '2026-10', provisional: 150, provisionalFromCsv: 100, totalExpense: 250, totalNet: 50 });
    // 11月: 暫定がすべてCSV由来なら、支出・収支は変わらない（行と表示だけ残る）
    expect(out[1]).toMatchObject({ month: '2026-11', provisional: 90, provisionalFromCsv: 90, totalExpense: 0, totalNet: 0 });
  });

  it('暫定が無い月は CSV と同じ値で、入力は変更しない', () => {
    const rows = mergeMonthlyWithProvisional([summary('2026-10')], []);
    const copy = JSON.parse(JSON.stringify(rows));
    const out = withProvisionalExpense(rows);
    expect(out[0]).toMatchObject({ totalExpense: 200, totalNet: 100 });
    expect(rows).toEqual(copy);
  });
});
