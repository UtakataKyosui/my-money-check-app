import { describe, expect, it } from 'vitest';
import { pagesToCardFiles } from './mapCard';
import {
  cardRow,
  date,
  formulaDate,
  formulaNum,
  formulaStr,
  multi,
  num,
  page,
  rich,
  rollupNum,
  select,
  title,
} from './testHelpers';

describe('pagesToCardFiles', () => {
  it('行が無ければ空配列', () => {
    expect(pagesToCardFiles([])).toEqual([]);
  });

  it('支払い月なしは1つの ParsedFile（paymentMonth/paymentTotal なし）', () => {
    const files = pagesToCardFiles([
      cardRow({ id: 'p1', desc: 'Amazon', date: '2026-11-03', usage: 3980, total: 3980, user: '本人', method: '1回' }),
    ]);
    expect(files).toHaveLength(1);
    const f = files[0];
    expect(f?.fileName).toBe('Notion（楽天カード）');
    expect(f?.source).toBe('card');
    expect(f?.paymentMonth).toBeUndefined();
    expect(f?.paymentTotal).toBeUndefined();
    expect(f?.transactions).toEqual([
      {
        id: 'notion:p1',
        source: 'card',
        date: '2026-11-03',
        month: '2026-11',
        description: 'Amazon',
        expense: 3980,
        income: 0,
        note: '本人',
        paymentMethod: '1回',
        usageAmount: 3980,
        fee: 0,
        fileName: 'Notion（楽天カード）',
      },
    ]);
  });

  describe('金額の規則（CSVと同じ）', () => {
    const one = (o: Parameters<typeof cardRow>[0]) => pagesToCardFiles([cardRow(o)])[0]?.transactions[0];

    it('支払総額が空なら 利用金額＋手数料/利息', () => {
      expect(one({ desc: 'a', date: '2026-11-01', usage: 1000, fee: 50 })).toMatchObject({
        expense: 1050,
        income: 0,
        usageAmount: 1000,
        fee: 50,
      });
    });

    it('支払総額があればそれを使う（0も有効）', () => {
      expect(one({ desc: 'a', date: '2026-11-01', usage: 30000, fee: 300, total: 10100 })).toMatchObject({
        expense: 10100,
        income: 0,
      });
      expect(one({ desc: 'a', date: '2026-11-01', usage: 30000, total: 0 })).toMatchObject({ expense: 0, income: 0 });
    });

    it('負の支払総額は返金として income。usageAmount・fee は符号つき', () => {
      expect(one({ desc: 'refund', date: '2026-11-01', usage: -1500, total: -1500 })).toMatchObject({
        expense: 0,
        income: 1500,
        usageAmount: -1500,
        fee: 0,
      });
    });

    it('支払総額が空で利用金額が負でも返金', () => {
      expect(one({ desc: 'refund', date: '2026-11-01', usage: -800, fee: 0 })).toMatchObject({
        expense: 0,
        income: 800,
      });
    });

    it('利用金額が空は0として取り込む（CSVと同じ）', () => {
      expect(one({ desc: 'a', date: '2026-11-01' })).toMatchObject({ expense: 0, income: 0, usageAmount: 0, fee: 0 });
    });

    it('手数料/利息・利用金額・支払総額の小数は読み飛ばして警告', () => {
      const files = pagesToCardFiles([
        cardRow({ desc: 'A', date: '2026-11-01', usage: 1.5 }),
        cardRow({ desc: 'B', date: '2026-11-01', usage: 1, fee: 0.5 }),
        cardRow({ desc: 'C', date: '2026-11-01', usage: 1, total: 2.5 }),
      ]);
      expect(files[0]?.transactions).toEqual([]);
      expect(files[0]?.warnings).toEqual([
        'Notion（楽天カード） 「A」(2026-11-01): 『利用金額』が整数ではないため読み飛ばしました。',
        'Notion（楽天カード） 「B」(2026-11-01): 『手数料/利息』が整数ではないため読み飛ばしました。',
        'Notion（楽天カード） 「C」(2026-11-01): 『支払総額』が整数ではないため読み飛ばしました。',
      ]);
    });
  });

  describe('プロパティ型の組み合わせ', () => {
    it('formula / rollup の数値、select / multi_select / formula の文字列', () => {
      const files = pagesToCardFiles([
        page({
          '利用店名・商品名': title('X'),
          利用日: formulaDate('2026-11-04'),
          利用金額: formulaNum(1000),
          '手数料/利息': rollupNum(20),
          支払総額: formulaNum(null),
          利用者: select('本人'),
          支払方法: multi('分割', '3回'),
        }),
        page({
          名前: title('Y'),
          利用日: date('2026-11-05T10:00:00.000+09:00'),
          利用金額: num(500),
          利用者: formulaStr('家族'),
          支払方法: rich('1回'),
        }),
      ]);
      expect(files[0]?.warnings).toEqual([]);
      expect(files[0]?.transactions.map((t) => [t.description, t.date, t.expense, t.note, t.paymentMethod])).toEqual([
        ['X', '2026-11-04', 1020, '本人', '分割、3回'],
        ['Y', '2026-11-05', 500, '家族', '1回'],
      ]);
    });

    it('型が合わない行: 利用金額がテキストなら読み飛ばし、利用者が数値なら無視', () => {
      const files = pagesToCardFiles([
        page({ 名前: title('A'), 利用日: date('2026-11-01'), 利用金額: rich('100') }),
        page({ 名前: title('B'), 利用日: date('2026-11-01'), 利用金額: num(100), 利用者: num(1) }),
      ]);
      expect(files[0]?.transactions.map((t) => t.description)).toEqual(['B']);
      expect(files[0]?.transactions[0]?.note).toBeUndefined();
      expect(files[0]?.warnings).toEqual([
        'Notion（楽天カード） 「A」(2026-11-01): 『利用金額』の値を数値として読み取れないため読み飛ばしました。',
        'Notion（楽天カード） 「B」(2026-11-01): 『利用者』を文字列として読み取れないため無視しました。',
      ]);
    });

    it('日付が解釈できない行は読み飛ばして警告', () => {
      const files = pagesToCardFiles([cardRow({ desc: 'Z', date: null, usage: 1 }), cardRow({ desc: 'W', date: '2026-11-02', usage: 1 })]);
      expect(files[0]?.transactions.map((t) => t.description)).toEqual(['W']);
      expect(files[0]?.warnings).toEqual([
        'Notion（楽天カード） 「Z」(日付なし): 『利用日』を日付として解釈できないため読み飛ばしました。',
      ]);
    });
  });

  describe('支払い月の形式', () => {
    const monthOf = (prop: Record<string, unknown>) =>
      pagesToCardFiles([cardRow({ desc: 'a', date: '2026-10-20', usage: 1, month: prop })]).map((f) => f.fileName);

    it.each([
      ['rich_text 2026-11', rich('2026-11')],
      ['rich_text 2026/11', rich('2026/11')],
      ['rich_text 2026/1 (1桁)', rich('2026/1')],
      ['rich_text 2026年11月', rich('2026年11月')],
      ['rich_text 全角', rich('２０２６年１１月')],
      ['rich_text 202611', rich('202611')],
      ['rich_text 日付 2026-11-27', rich('2026-11-27')],
      ['select', select('2026-11')],
      ['date 2026-11-27', date('2026-11-27')],
      ['date 日時', date('2026-11-27T09:00:00.000+09:00')],
      ['formula(date)', formulaDate('2026-11-01')],
      ['formula(string)', formulaStr('2026年11月')],
    ])('%s', (label, prop) => {
      const expected = label.includes('2026/1 ') ? 'Notion（楽天カード・2026-01払い）' : 'Notion（楽天カード・2026-11払い）';
      expect(monthOf(prop)).toEqual([expected]);
    });

    it('空の支払い月は「なし」として扱う', () => {
      expect(monthOf(rich())).toEqual(['Notion（楽天カード）']);
      expect(monthOf(date(null))).toEqual(['Notion（楽天カード）']);
      expect(monthOf(select(null))).toEqual(['Notion（楽天カード）']);
    });

    it('解釈できない支払い月は警告して「なし」として取り込む', () => {
      const files = pagesToCardFiles([
        cardRow({ desc: 'a', date: '2026-10-20', usage: 100, month: rich('来月') }),
        cardRow({ desc: 'b', date: '2026-10-21', usage: 100, month: rich('2026-13') }),
        cardRow({ desc: 'c', date: '2026-10-22', usage: 100, month: num(11) }),
      ]);
      expect(files).toHaveLength(1);
      expect(files[0]?.fileName).toBe('Notion（楽天カード）');
      expect(files[0]?.transactions).toHaveLength(3);
      expect(files[0]?.warnings).toEqual([
        'Notion（楽天カード） 「a」(2026-10-20): 『支払い月』を解釈できないため、支払い月なしとして扱いました。',
        'Notion（楽天カード） 「b」(2026-10-21): 『支払い月』を解釈できないため、支払い月なしとして扱いました。',
        'Notion（楽天カード） 「c」(2026-10-22): 『支払い月』を解釈できないため、支払い月なしとして扱いました。',
      ]);
    });
  });

  describe('支払い月ごとのグルーピング', () => {
    it('月昇順、支払い月なしを最後。各グループの fileName / 取引の fileName', () => {
      const files = pagesToCardFiles([
        cardRow({ id: 'a', desc: 'a', date: '2026-11-20', usage: 100 }),
        cardRow({ id: 'b', desc: 'b', date: '2026-11-10', usage: 200, month: rich('2026-12') }),
        cardRow({ id: 'c', desc: 'c', date: '2026-10-10', usage: 300, month: rich('2026-11') }),
        cardRow({ id: 'd', desc: 'd', date: '2026-10-05', usage: 400, month: rich('2026-11') }),
        cardRow({ id: 'e', desc: 'e', date: '2026-12-01', usage: 500, month: rich('2027-01') }),
      ]);
      expect(files.map((f) => f.fileName)).toEqual([
        'Notion（楽天カード・2026-11払い）',
        'Notion（楽天カード・2026-12払い）',
        'Notion（楽天カード・2027-01払い）',
        'Notion（楽天カード）',
      ]);
      expect(files[0]?.transactions.map((t) => t.id)).toEqual(['notion:d', 'notion:c']); // 日付昇順
      for (const f of files) {
        for (const t of f.transactions) expect(t.fileName).toBe(f.fileName);
      }
    });

    it('警告は行が属するグループの ParsedFile に入る', () => {
      const files = pagesToCardFiles([
        cardRow({ desc: 'ok', date: '2026-10-10', usage: 100, month: rich('2026-11') }),
        cardRow({ desc: 'ng', date: '2026-10-11', usage: 1.5, month: rich('2026-11') }),
        cardRow({ desc: 'ng2', date: '2026-10-12', usage: 1.5 }),
      ]);
      expect(files[0]?.warnings).toEqual([
        'Notion（楽天カード・2026-11払い） 「ng」(2026-10-11): 『利用金額』が整数ではないため読み飛ばしました。',
      ]);
      expect(files[1]?.warnings).toEqual([
        'Notion（楽天カード） 「ng2」(2026-10-12): 『利用金額』が整数ではないため読み飛ばしました。',
      ]);
    });
  });

  describe('paymentMonth / paymentTotal', () => {
    it('今回支払金額のプロパティが無ければ設定しない', () => {
      const files = pagesToCardFiles([cardRow({ desc: 'a', date: '2026-10-10', usage: 100, month: rich('2026-11') })]);
      expect(files[0]?.paymentMonth).toBeUndefined();
      expect(files[0]?.paymentTotal).toBeUndefined();
      expect('paymentMonth' in (files[0] as object)).toBe(false);
    });

    it('支払い月あり＋値が1件以上あれば両方を設定（合計。空は0、負は負のまま）', () => {
      const files = pagesToCardFiles([
        cardRow({ desc: 'a', date: '2026-10-10', usage: 3000, month: rich('2026-11'), pay: num(1000) }),
        cardRow({ desc: 'b', date: '2026-10-11', usage: 500, month: rich('2026-11'), pay: num(null) }),
        cardRow({ desc: 'c', date: '2026-10-12', usage: -300, total: -300, month: rich('2026-11'), pay: num(-300) }),
        cardRow({ desc: 'd', date: '2026-10-13', usage: 10, month: rich('2026-11'), pay: formulaNum(50) }),
        cardRow({ desc: 'e', date: '2026-10-14', usage: 10, month: rich('2026-11'), pay: rollupNum(5) }),
      ]);
      expect(files[0]?.paymentMonth).toBe('2026-11');
      expect(files[0]?.paymentTotal).toBe(1000 + 0 - 300 + 50 + 5);
    });

    it('値がすべて空のグループには設定しない（プロパティは存在）', () => {
      const files = pagesToCardFiles([
        cardRow({ desc: 'a', date: '2026-10-10', usage: 3000, month: rich('2026-11'), pay: num(null) }),
        cardRow({ desc: 'b', date: '2026-11-10', usage: 3000, month: rich('2026-12'), pay: num(700) }),
      ]);
      expect(files[0]?.paymentMonth).toBeUndefined();
      expect(files[0]?.paymentTotal).toBeUndefined();
      expect(files[1]?.paymentMonth).toBe('2026-12');
      expect(files[1]?.paymentTotal).toBe(700);
    });

    it('値が 0 だけでも設定する（null 以外）', () => {
      const files = pagesToCardFiles([
        cardRow({ desc: 'a', date: '2026-10-10', usage: 3000, month: rich('2026-11'), pay: num(0) }),
      ]);
      expect(files[0]?.paymentMonth).toBe('2026-11');
      expect(files[0]?.paymentTotal).toBe(0);
    });

    it('支払い月なしのグループには、値があっても設定しない', () => {
      const files = pagesToCardFiles([cardRow({ desc: 'a', date: '2026-10-10', usage: 3000, pay: num(1000) })]);
      expect(files[0]?.paymentMonth).toBeUndefined();
      expect(files[0]?.paymentTotal).toBeUndefined();
    });

    it('読み飛ばした行の今回支払金額は数えない', () => {
      const files = pagesToCardFiles([
        cardRow({ desc: 'a', date: '2026-10-10', usage: 100, month: rich('2026-11'), pay: num(100) }),
        cardRow({ desc: 'bad', date: '2026-10-11', usage: 1.5, month: rich('2026-11'), pay: num(999) }),
        cardRow({ desc: 'nodate', date: null, usage: 1, month: rich('2026-11'), pay: num(888) }),
      ]);
      expect(files[0]?.paymentTotal).toBe(100);
    });

    it('今回支払金額が不正な行は0円として数え、警告する', () => {
      const files = pagesToCardFiles([
        cardRow({ desc: 'a', date: '2026-10-10', usage: 100, month: rich('2026-11'), pay: num(100) }),
        cardRow({ desc: 'b', date: '2026-10-11', usage: 100, month: rich('2026-11'), pay: num(10.5) }),
        cardRow({ desc: 'c', date: '2026-10-12', usage: 100, month: rich('2026-11'), pay: rich('50') }),
      ]);
      expect(files[0]?.transactions).toHaveLength(3);
      expect(files[0]?.paymentTotal).toBe(100);
      expect(files[0]?.warnings).toEqual([
        'Notion（楽天カード・2026-11払い） 「b」(2026-10-11): 『今回支払金額』が整数ではないため、0円として数えました。',
        'Notion（楽天カード・2026-11払い） 「c」(2026-10-12): 『今回支払金額』の値を数値として読み取れないため、0円として数えました。',
      ]);
    });

    it('グループごとに独立して合計する', () => {
      const files = pagesToCardFiles([
        cardRow({ desc: 'a', date: '2026-10-10', usage: 100, month: rich('2026-11'), pay: num(100) }),
        cardRow({ desc: 'b', date: '2026-10-11', usage: 600, month: rich('2026-12'), pay: num(200) }),
        cardRow({ desc: 'c', date: '2026-10-12', usage: 100, month: rich('2026-11'), pay: num(50) }),
      ]);
      expect(files.map((f) => [f.paymentMonth, f.paymentTotal])).toEqual([
        ['2026-11', 150],
        ['2026-12', 200],
      ]);
    });
  });
});
