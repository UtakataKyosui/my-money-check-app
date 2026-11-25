import { describe, expect, it } from 'vitest';
import { decodeCsv, parseAmount, parseCsvText, parseDate } from './parseFile';

const BANK_HEADER = '年月日,お引出し,お預入れ,お取り扱い内容,残高,メモ,ラベル';
const CARD_HEADER =
  '"利用日","利用店名・商品名","利用者","支払方法","利用金額","手数料/利息","支払総額","11月支払金額","当月請求額","12月繰越残高","新規サイン"';

describe('decodeCsv', () => {
  it('UTF-8 を復号する（ArrayBuffer / Uint8Array）', () => {
    const bytes = new TextEncoder().encode('年月日,残高');
    expect(decodeCsv(bytes)).toBe('年月日,残高');
    expect(decodeCsv(bytes.buffer.slice(0) as ArrayBuffer)).toBe('年月日,残高');
  });

  it('UTF-8 として不正なら Shift_JIS で復号する', () => {
    expect(decodeCsv(Uint8Array.from([0x94, 0x4e, 0x8c, 0x8e, 0x93, 0xfa]))).toBe('年月日');
  });

  it('UTF-8 の BOM を除去する', () => {
    const body = new TextEncoder().encode('年月日');
    const withBom = Uint8Array.from([0xef, 0xbb, 0xbf, ...body]);
    expect(decodeCsv(withBom)).toBe('年月日');
  });

  it('subarray（byteOffset 付き）でも正しく復号する', () => {
    const body = new TextEncoder().encode('xx年月日yy');
    expect(decodeCsv(body.subarray(2, body.length - 2))).toBe('年月日');
  });
});

describe('parseDate', () => {
  it.each([
    ['2026/11/1', '2026-11-01'],
    ['2026/11/01', '2026-11-01'],
    ['2026-11-01', '2026-11-01'],
    ['2026年11月1日', '2026-11-01'],
    ['20261101', '2026-11-01'],
    ['２０２６／１１／０１', '2026-11-01'],
    [' 2026/1/5 ', '2026-01-05'],
  ])('%s -> %s', (input, expected) => {
    expect(parseDate(input)).toBe(expected);
  });

  it.each(['', 'abc', '2026/13/01', '2026/02/30', '2026/11', '令和8年11月1日'])('解釈できない: %s', (input) => {
    expect(parseDate(input)).toBeNull();
  });
});

describe('parseAmount', () => {
  it.each([
    ['1,234', 1234],
    ['¥1,234', 1234],
    ['1,234円', 1234],
    ['￥１，２３４円', 1234],
    ['  500  ', 500],
    ['', 0],
    ['  ', 0],
  ])('%s -> %s', (input, expected) => {
    expect(parseAmount(input)).toBe(expected);
  });

  it('不正な金額は null', () => {
    expect(parseAmount('abc')).toBeNull();
    expect(parseAmount('12.5')).toBeNull();
    expect(parseAmount('-100')).toBeNull();
  });

  it('allowNegative なら負数を許可する', () => {
    expect(parseAmount('-1,000', true)).toBe(-1000);
    expect(parseAmount('−1,000', true)).toBe(-1000);
  });
});

describe('parseCsvText: 銀行', () => {
  const csv = [
    BANK_HEADER,
    '2026/11/05,"3,000",,ATM,"97,000",生活費,食費',
    '2026/11/01,,"250,000",給与,"100,000",,',
    '2026/11/05,500,,コンビニ,"96,500",,',
  ].join('\r\n');

  it('銀行と判定し、入出金・残高・メモ・ラベルを正規化する', () => {
    const r = parseCsvText(csv, 'bank.csv');
    expect(r.source).toBe('bank');
    expect(r.fileName).toBe('bank.csv');
    expect(r.warnings).toEqual([]);
    expect(r.transactions).toHaveLength(3);
    expect(r.transactions[0]).toEqual({
      id: 'bank.csv:3',
      source: 'bank',
      fileName: 'bank.csv',
      date: '2026-11-01',
      month: '2026-11',
      description: '給与',
      expense: 0,
      income: 250000,
      balance: 100000,
      note: undefined,
      label: undefined,
    });
    expect(r.transactions[1]).toMatchObject({
      id: 'bank.csv:2',
      expense: 3000,
      income: 0,
      balance: 97000,
      note: '生活費',
      label: '食費',
    });
  });

  it('日付昇順で、同日はファイル順を維持する', () => {
    const r = parseCsvText(csv, 'bank.csv');
    expect(r.transactions.map((t) => t.id)).toEqual(['bank.csv:3', 'bank.csv:2', 'bank.csv:4']);
    expect(r.transactions.map((t) => t.description)).toEqual(['給与', 'ATM', 'コンビニ']);
  });

  it('残高が空なら balance は undefined', () => {
    const r = parseCsvText(`${BANK_HEADER}\n2026/11/01,100,,X,,,`, 'b.csv');
    expect(r.transactions[0]?.balance).toBeUndefined();
    expect(r.transactions[0]?.expense).toBe(100);
  });

  it('列の位置ではなく見出し名で引く', () => {
    const csv2 = 'ラベル,残高,お取り扱い内容,お預入れ,お引出し,年月日\n食費,"9,000",昼食,,"1,000",2026-11-02';
    const r = parseCsvText(csv2, 'b.csv');
    expect(r.transactions[0]).toMatchObject({
      date: '2026-11-02',
      expense: 1000,
      income: 0,
      balance: 9000,
      description: '昼食',
      label: '食費',
    });
  });

  it('BOM付き・様々な日付形式を受け付ける', () => {
    const csv3 = [
      '﻿' + BANK_HEADER,
      '2026-11-01,1,,a,,,',
      '2026年11月2日,2,,b,,,',
      '20261103,3,,c,,,',
      '2026/11/4,4,,d,,,',
    ].join('\n');
    const r = parseCsvText(csv3, 'b.csv');
    expect(r.transactions.map((t) => t.date)).toEqual(['2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04']);
  });

  it('見出しだけなら取引0件', () => {
    const r = parseCsvText(BANK_HEADER, 'b.csv');
    expect(r.transactions).toEqual([]);
    expect(r.warnings).toEqual([]);
  });
});

describe('parseCsvText: 警告', () => {
  it('日付が不正な行は警告して読み飛ばす', () => {
    const r = parseCsvText(`${BANK_HEADER}\nxxxx,1,,a,,,\n2026/11/01,2,,b,,,`, 'b.csv');
    expect(r.transactions).toHaveLength(1);
    expect(r.transactions[0]?.description).toBe('b');
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0]).toContain('b.csv 2行目');
    expect(r.warnings[0]).toContain('日付');
  });

  it('金額が不正な行は警告して読み飛ばす', () => {
    const r = parseCsvText(`${BANK_HEADER}\n2026/11/01,abc,,a,,,\n2026/11/02,,,b,zzz,,\n2026/11/03,1,,ok,,,`, 'b.csv');
    expect(r.transactions.map((t) => t.description)).toEqual(['ok']);
    expect(r.warnings).toHaveLength(2);
    expect(r.warnings[0]).toContain('お引出し');
    expect(r.warnings[1]).toContain('残高');
  });

  it('列数が一致しない行は警告して読み飛ばす', () => {
    const r = parseCsvText(`${BANK_HEADER}\n2026/11/01,1,,a\n2026/11/02,2,,b,,,`, 'b.csv');
    expect(r.transactions).toHaveLength(1);
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0]).toContain('列数');
  });
});

describe('parseCsvText: 楽天カード', () => {
  const csv = [
    CARD_HEADER,
    '"2026/11/03","コンビニ","本人","1回払い","1,200","0","1,200","1,200","1,200","",""',
    '"2026/11/01","ホテル\n東京店","家族","分割3回払い","30,000","450","30,450","10,150","10,150","20,300",""',
  ].join('\r\n');

  it('カードと判定し、引用符内の改行を含む店名と可変の月見出しを扱う', () => {
    const r = parseCsvText(csv, 'card.csv');
    expect(r.source).toBe('card');
    expect(r.warnings).toEqual([]);
    expect(r.transactions).toHaveLength(2);
    expect(r.transactions[0]).toEqual({
      id: 'card.csv:3',
      source: 'card',
      fileName: 'card.csv',
      date: '2026-11-01',
      month: '2026-11',
      description: 'ホテル\n東京店',
      expense: 30450,
      income: 0,
      note: '家族',
      paymentMethod: '分割3回払い',
      usageAmount: 30000,
      fee: 450,
    });
    expect(r.transactions[1]).toMatchObject({ id: 'card.csv:2', expense: 1200, usageAmount: 1200, fee: 0 });
  });

  it('月見出しが違っても（余分/不足な列があっても）判定できる', () => {
    const h =
      '"利用日","利用店名・商品名","利用者","支払方法","利用金額","手数料/利息","支払総額","1月支払金額","2月繰越残高"';
    const r = parseCsvText(`${h}\n"2026/01/05","店","本人","1回払い","100","0","100","100",""`, 'c.csv');
    expect(r.source).toBe('card');
    expect(r.transactions[0]?.expense).toBe(100);
  });

  it('支払総額が空なら 利用金額+手数料/利息 にフォールバックする', () => {
    const r = parseCsvText(
      `${CARD_HEADER}\n"2026/11/01","店","本人","分割","10,000","300","","","","",""`,
      'c.csv',
    );
    expect(r.transactions[0]).toMatchObject({ expense: 10300, usageAmount: 10000, fee: 300 });
  });

  it('利用金額・手数料も空なら0', () => {
    const r = parseCsvText(`${CARD_HEADER}\n"2026/11/01","店","","","","","","","","",""`, 'c.csv');
    expect(r.transactions[0]).toMatchObject({ expense: 0, usageAmount: 0, fee: 0, note: undefined });
  });

  it('金額不正・日付不正・列数不一致は警告して読み飛ばす', () => {
    const r = parseCsvText(
      [
        CARD_HEADER,
        '"2026/11/01","A","本人","1回払い","abc","0","100","","","",""',
        '"bad","B","本人","1回払い","100","0","100","","","",""',
        '"2026/11/01","C","本人"',
        '"2026/11/02","D","本人","1回払い","100","0","100","","","",""',
      ].join('\n'),
      'c.csv',
    );
    expect(r.transactions.map((t) => t.description)).toEqual(['D']);
    expect(r.warnings).toHaveLength(3);
  });
});

describe('parseCsvText: 不正CSV', () => {
  it('空のCSVは失敗する', () => {
    expect(() => parseCsvText('', 'x.csv')).toThrow(/空です/);
    expect(() => parseCsvText('\n\n', 'x.csv')).toThrow(/空です/);
  });

  it('種類を判定できない見出しは失敗する', () => {
    expect(() => parseCsvText('日付,金額\n2026/11/01,100', 'x.csv')).toThrow(/判定できませんでした/);
  });

  it('必須列が欠けていると判定できない', () => {
    expect(() => parseCsvText('年月日,お引出し,お預入れ\n2026/11/01,1,', 'x.csv')).toThrow(/判定できませんでした/);
  });

  it('引用符が不正なCSVは日本語メッセージで失敗する', () => {
    expect(() => parseCsvText('"年月日,お引出し\n1,2', 'x.csv')).toThrow(/引用符/);
  });
});
