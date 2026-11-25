import { describe, expect, it } from 'vitest';
import { pagesToBankFile } from './mapBank';
import {
  bankRow,
  checkbox,
  date,
  formulaBool,
  formulaDate,
  formulaNum,
  formulaStr,
  multi,
  num,
  page,
  rich,
  rollupArray,
  rollupNum,
  select,
  status,
  title,
} from './testHelpers';

describe('pagesToBankFile', () => {
  it('基本の変換（id・fileName・month・source）', () => {
    const f = pagesToBankFile([
      bankRow({ id: 'abc', desc: 'ｶ)ﾗｸﾃﾝｶ-ﾄﾞ', date: '2026-11-05', out: 1200, balance: 99000, memo: 'メモ1', label: 'カード' }),
    ]);
    expect(f.fileName).toBe('Notion（三井住友銀行）');
    expect(f.source).toBe('bank');
    expect(f.warnings).toEqual([]);
    expect(f.paymentMonth).toBeUndefined();
    expect(f.paymentTotal).toBeUndefined();
    expect(f.transactions).toEqual([
      {
        id: 'notion:abc',
        source: 'bank',
        date: '2026-11-05',
        month: '2026-11',
        description: 'ｶ)ﾗｸﾃﾝｶ-ﾄﾞ',
        expense: 1200,
        income: 0,
        balance: 99000,
        note: 'メモ1',
        label: 'カード',
        fileName: 'Notion（三井住友銀行）',
      },
    ]);
  });

  it('空の入出金は0、残高・メモ・ラベルが空なら undefined', () => {
    const f = pagesToBankFile([bankRow({ desc: '給与', date: '2026-11-25', inn: 250000 })]);
    const t = f.transactions[0];
    expect(t?.expense).toBe(0);
    expect(t?.income).toBe(250000);
    expect(t?.balance).toBeUndefined();
    expect(t?.note).toBeUndefined();
    expect(t?.label).toBeUndefined();
  });

  it('残高は負数も許容し、0 も残高として保持する', () => {
    const f = pagesToBankFile([
      bankRow({ desc: 'a', date: '2026-11-01', out: 1, balance: -500 }),
      bankRow({ desc: 'b', date: '2026-11-02', out: 1, balance: 0 }),
    ]);
    expect(f.transactions.map((t) => t.balance)).toEqual([-500, 0]);
  });

  it('日付昇順の安定ソート（同日は届いた順）', () => {
    const f = pagesToBankFile([
      bankRow({ id: '1', desc: 'c', date: '2026-11-10', out: 1 }),
      bankRow({ id: '2', desc: 'a', date: '2026-11-03', out: 1 }),
      bankRow({ id: '3', desc: 'b', date: '2026-11-03', out: 2 }),
      bankRow({ id: '4', desc: 'd', date: '2026-10-31', out: 1 }),
    ]);
    expect(f.transactions.map((t) => t.id)).toEqual(['notion:4', 'notion:2', 'notion:3', 'notion:1']);
  });

  it('行が無くても空の ParsedFile を返す', () => {
    expect(pagesToBankFile([])).toEqual({
      fileName: 'Notion（三井住友銀行）',
      source: 'bank',
      transactions: [],
      warnings: [],
    });
  });

  describe('プロパティ型の組み合わせ', () => {
    const base = { 年月日: date('2026-11-05'), お取り扱い内容: title('x') };

    it('数値: number / formula / rollup', () => {
      const f = pagesToBankFile([
        page({ ...base, お引出し: formulaNum(100), お預入れ: rollupNum(200), 残高: num(300) }),
      ]);
      expect(f.warnings).toEqual([]);
      expect(f.transactions[0]).toMatchObject({ expense: 100, income: 200, balance: 300 });
    });

    it('数値が空（null）の formula / rollup は空として扱う', () => {
      const f = pagesToBankFile([
        page({ ...base, お引出し: formulaNum(null), お預入れ: rollupNum(null), 残高: formulaNum(null) }),
      ]);
      expect(f.transactions[0]).toMatchObject({ expense: 0, income: 0, balance: undefined });
    });

    it('日付: date の日時は先頭10文字、formula(date) も可', () => {
      const f = pagesToBankFile([
        page({ ...base, 年月日: date('2026-11-05T23:30:00.000+09:00'), お引出し: num(1) }),
        page({ ...base, 年月日: formulaDate('2026-11-06'), お引出し: num(1) }),
        page({ ...base, 年月日: formulaDate('2026-11-07T00:00:00.000Z'), お引出し: num(1) }),
      ]);
      expect(f.warnings).toEqual([]);
      expect(f.transactions.map((t) => t.date)).toEqual(['2026-11-05', '2026-11-06', '2026-11-07']);
    });

    it('テキスト: rich_text（複数パート連結）/ select / multi_select（、連結）/ status / formula / title', () => {
      const f = pagesToBankFile([
        page({ ...base, お引出し: num(1), メモ: rich('a', 'b'), ラベル: select('固定費') }),
        page({ ...base, お引出し: num(1), メモ: multi('x', 'y'), ラベル: status('済') }),
        page({ ...base, お引出し: num(1), メモ: formulaStr('式'), ラベル: { type: 'url', url: 'https://e.com' } }),
        page({
          ...base,
          お引出し: num(1),
          メモ: { type: 'email', email: 'a@b.c' },
          ラベル: { type: 'phone_number', phone_number: '03-1234' },
        }),
        page({ ...base, お引出し: num(1), メモ: select(null), ラベル: multi() }),
      ]);
      expect(f.warnings).toEqual([]);
      expect(f.transactions.map((t) => [t.note, t.label])).toEqual([
        ['ab', '固定費'],
        ['x、y', '済'],
        ['式', 'https://e.com'],
        ['a@b.c', '03-1234'],
        [undefined, undefined],
      ]);
    });

    it('タイトルは複数パートを連結して前後空白を除く。名前は自由', () => {
      const f = pagesToBankFile([
        page({ 名前: title(' ｾﾌﾞﾝ', ' ｲﾚﾌﾞﾝ '), 年月日: date('2026-11-05'), お引出し: num(1), お預入れ: num(0) }),
      ]);
      expect(f.transactions[0]?.description).toBe('ｾﾌﾞﾝ ｲﾚﾌﾞﾝ');
    });

    it('プロパティが欠けた行（お預入れ無し）は空として扱う', () => {
      const f = pagesToBankFile([page({ ...base, お引出し: num(5) })]);
      expect(f.transactions[0]).toMatchObject({ expense: 5, income: 0 });
    });

    it('メモの型が合わない行は取り込み、メモだけ無視して警告', () => {
      const f = pagesToBankFile([page({ ...base, お引出し: num(5), メモ: num(1), ラベル: formulaBool(true) })]);
      expect(f.transactions).toHaveLength(1);
      expect(f.transactions[0]?.note).toBeUndefined();
      expect(f.warnings).toEqual([
        'Notion（三井住友銀行） 「x」(2026-11-05): 『メモ』を文字列として読み取れないため無視しました。',
        'Notion（三井住友銀行） 「x」(2026-11-05): 『ラベル』を文字列として読み取れないため無視しました。',
      ]);
    });
  });

  describe('警告（読み飛ばし）', () => {
    const where = 'Notion（三井住友銀行） 「ｶ)ﾗｸﾃﾝｶ-ﾄﾞ」(2026-11-01):';

    it('小数の金額', () => {
      const f = pagesToBankFile([bankRow({ desc: 'ｶ)ﾗｸﾃﾝｶ-ﾄﾞ', date: '2026-11-01', out: 100.5 })]);
      expect(f.transactions).toEqual([]);
      expect(f.warnings).toEqual([`${where} 『お引出し』が整数ではないため読み飛ばしました。`]);
    });

    it('お預入れの小数・負数', () => {
      const f = pagesToBankFile([
        bankRow({ desc: 'ｶ)ﾗｸﾃﾝｶ-ﾄﾞ', date: '2026-11-01', inn: 0.1 }),
        bankRow({ desc: 'ｶ)ﾗｸﾃﾝｶ-ﾄﾞ', date: '2026-11-01', inn: -5 }),
      ]);
      expect(f.warnings).toEqual([
        `${where} 『お預入れ』が整数ではないため読み飛ばしました。`,
        `${where} 『お預入れ』が負の値であるため読み飛ばしました。`,
      ]);
    });

    it('お引出しの負数', () => {
      const f = pagesToBankFile([bankRow({ desc: 'ｶ)ﾗｸﾃﾝｶ-ﾄﾞ', date: '2026-11-01', out: -1 })]);
      expect(f.warnings).toEqual([`${where} 『お引出し』が負の値であるため読み飛ばしました。`]);
    });

    it('残高の小数', () => {
      const f = pagesToBankFile([bankRow({ desc: 'ｶ)ﾗｸﾃﾝｶ-ﾄﾞ', date: '2026-11-01', out: 1, balance: 1.5 })]);
      expect(f.warnings).toEqual([`${where} 『残高』が整数ではないため読み飛ばしました。`]);
    });

    it('金額の型が違う（rollup が配列・formula が文字列・テキスト）', () => {
      const base = { お取り扱い内容: title('ｶ)ﾗｸﾃﾝｶ-ﾄﾞ'), 年月日: date('2026-11-01') };
      const f = pagesToBankFile([
        page({ ...base, お引出し: rollupArray() }),
        page({ ...base, お引出し: formulaStr('12') }),
        page({ ...base, お引出し: rich('12') }),
        page({ ...base, お引出し: num(1), お預入れ: checkbox(true) }),
      ]);
      expect(f.transactions).toEqual([]);
      expect(f.warnings).toEqual([
        `${where} 『お引出し』の値を数値として読み取れないため読み飛ばしました。`,
        `${where} 『お引出し』の値を数値として読み取れないため読み飛ばしました。`,
        `${where} 『お引出し』の値を数値として読み取れないため読み飛ばしました。`,
        `${where} 『お預入れ』の値を数値として読み取れないため読み飛ばしました。`,
      ]);
    });

    it('日付が空・不正・実在しない・テキスト型の行', () => {
      const base = { お取り扱い内容: title('x'), お引出し: num(1) };
      const f = pagesToBankFile([
        page({ ...base, 年月日: date(null) }),
        page({ ...base, 年月日: date('2026-02-30') }),
        page({ ...base, 年月日: rich('2026-11-05') }),
        page({ ...base }),
        page({ ...base, 年月日: formulaDate(null) }),
        page({ ...base, 年月日: formulaStr('2026-11-05') }),
      ]);
      expect(f.transactions).toEqual([]);
      expect(f.warnings).toHaveLength(6);
      for (const w of f.warnings) {
        expect(w).toBe('Notion（三井住友銀行） 「x」(日付なし): 『年月日』を日付として解釈できないため読み飛ばしました。');
      }
    });

    it('摘要が空の行も特定できる文面になる', () => {
      const f = pagesToBankFile([page({ 年月日: date('2026-11-01'), お引出し: num(1.5) })]);
      expect(f.warnings).toEqual([
        'Notion（三井住友銀行） 「（摘要なし）」(2026-11-01): 『お引出し』が整数ではないため読み飛ばしました。',
      ]);
    });

    it('有効な行は読み飛ばした行の影響を受けない', () => {
      const f = pagesToBankFile([
        bankRow({ desc: 'ok', date: '2026-11-02', out: 1 }),
        bankRow({ desc: 'ng', date: '2026-11-01', out: 1.5 }),
      ]);
      expect(f.transactions.map((t) => t.description)).toEqual(['ok']);
      expect(f.warnings).toHaveLength(1);
    });
  });
});
