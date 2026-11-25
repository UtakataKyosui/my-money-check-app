import { describe, expect, it } from 'vitest';
import type { ParsedFile, ProvisionalPayment, Transaction } from '../../types';
import { parseCsvText } from '../parseFile';
import { resolveProvisional } from '../provisional';
import { transactionKey } from '../tags';
import { pagesToBankFile } from './mapBank';
import { pagesToCardFiles } from './mapCard';
import { bankRow, cardRow, num, rich } from './testHelpers';

/** id / fileName を除いた比較用の形。undefined のキーは落とす。 */
function strip(t: Transaction): Omit<Transaction, 'id' | 'fileName'> {
  const { id: _id, fileName: _f, ...rest } = t;
  return JSON.parse(JSON.stringify(rest)) as Omit<Transaction, 'id' | 'fileName'>;
}

const BANK_CSV = [
  '年月日,お引出し,お預入れ,お取り扱い内容,残高,メモ,ラベル',
  '2026/11/05,1200,,ｶ)ﾗｸﾃﾝｶ-ﾄﾞ,98800,カード引落,固定費',
  '2026/11/01,,250000,給与,250000,,',
  '2026/11/05,500,,ｺﾝﾋﾞﾆ,98300,,',
  '2026/10/31,0,0,残高確認,-100,,',
  '2026/11/02,3000,,ATM,,現金,',
].join('\n');

const BANK_PAGES = [
  bankRow({ desc: 'ｶ)ﾗｸﾃﾝｶ-ﾄﾞ', date: '2026-11-05', out: 1200, balance: 98800, memo: 'カード引落', label: '固定費' }),
  bankRow({ desc: '給与', date: '2026-11-01', inn: 250000, balance: 250000 }),
  bankRow({ desc: 'ｺﾝﾋﾞﾆ', date: '2026-11-05', out: 500, balance: 98300 }),
  bankRow({ desc: '残高確認', date: '2026-10-31', out: 0, inn: 0, balance: -100 }),
  bankRow({ desc: 'ATM', date: '2026-11-02', out: 3000, memo: '現金' }),
];

const CARD_CSV = [
  '利用日,利用店名・商品名,利用者,支払方法,利用金額,手数料/利息,支払総額,11月支払金額',
  '2026/10/03,Amazon.co.jp,本人,1回,3980,0,3980,3980',
  '2026/10/05,返金 ショップ,本人,1回,-1500,0,-1500,-1500',
  '2026/10/07,分割 家電,家族,分割3回,30000,300,10100,10100',
  '2026/10/10,空の支払総額,本人,1回,1000,50,,1050',
  '2026/10/10,メモなし,,,200,0,200,200',
  '2026/10/02,分割 先月分,本人,分割3回,9000,0,3000,3000',
].join('\n');

const card = (o: Parameters<typeof cardRow>[0]) => cardRow({ ...o, month: rich('2026-11'), pay: num(o.total ?? (o.usage ?? 0) + (o.fee ?? 0)) });
const CARD_PAGES = [
  card({ desc: 'Amazon.co.jp', date: '2026-10-03', usage: 3980, fee: 0, total: 3980, user: '本人', method: '1回' }),
  card({ desc: '返金 ショップ', date: '2026-10-05', usage: -1500, fee: 0, total: -1500, user: '本人', method: '1回' }),
  card({ desc: '分割 家電', date: '2026-10-07', usage: 30000, fee: 300, total: 10100, user: '家族', method: '分割3回' }),
  card({ desc: '空の支払総額', date: '2026-10-10', usage: 1000, fee: 50, user: '本人', method: '1回' }),
  card({ desc: 'メモなし', date: '2026-10-10', usage: 200, fee: 0, total: 200 }),
  card({ desc: '分割 先月分', date: '2026-10-02', usage: 9000, fee: 0, total: 3000, user: '本人', method: '分割3回' }),
];

describe('CSV と Notion の一致（銀行）', () => {
  const csv = parseCsvText(BANK_CSV, 'bank.csv');
  const notion = pagesToBankFile(BANK_PAGES);

  it('取引の内容・順序・日付・金額・note が一致する（id/fileName を除く）', () => {
    expect(csv.warnings).toEqual([]);
    expect(notion.warnings).toEqual([]);
    expect(notion.source).toBe(csv.source);
    expect(notion.transactions.map(strip)).toEqual(csv.transactions.map(strip));
  });

  it('transactionKey が一致する', () => {
    expect(notion.transactions.map(transactionKey)).toEqual(csv.transactions.map(transactionKey));
  });

  it('不正な行の読み飛ばしも一致する（小数・負数）', () => {
    const csvBad = parseCsvText(
      ['年月日,お引出し,お預入れ,お取り扱い内容,残高', '2026/11/01,100.5,,A,', '2026/11/01,-5,,B,', '2026/11/01,5,,C,'].join('\n'),
      'b.csv',
    );
    const nBad = pagesToBankFile([
      bankRow({ desc: 'A', date: '2026-11-01', out: 100.5 }),
      bankRow({ desc: 'B', date: '2026-11-01', out: -5 }),
      bankRow({ desc: 'C', date: '2026-11-01', out: 5 }),
    ]);
    expect(nBad.transactions.map(strip)).toEqual(csvBad.transactions.map(strip));
    expect(nBad.warnings).toHaveLength(csvBad.warnings.length);
  });
});

describe('CSV と Notion の一致（カード）', () => {
  const csv = parseCsvText(CARD_CSV, 'card.csv');
  const files = pagesToCardFiles(CARD_PAGES);

  it('支払い月が同じなら1つの ParsedFile になり、取引が一致する', () => {
    expect(csv.warnings).toEqual([]);
    expect(files).toHaveLength(1);
    const notion = files[0] as ParsedFile;
    expect(notion.warnings).toEqual([]);
    expect(notion.transactions.map(strip)).toEqual(csv.transactions.map(strip));
  });

  it('paymentMonth / paymentTotal が CSV と一致する', () => {
    const notion = files[0] as ParsedFile;
    expect(csv.paymentMonth).toBe('2026-11');
    expect(notion.paymentMonth).toBe(csv.paymentMonth);
    expect(notion.paymentTotal).toBe(csv.paymentTotal);
    expect(csv.paymentTotal).toBe(3980 - 1500 + 10100 + 1050 + 200 + 3000);
  });

  it('transactionKey が一致する（返金・支払総額が空の行を含む）', () => {
    const notion = files[0] as ParsedFile;
    expect(notion.transactions.map(transactionKey)).toEqual(csv.transactions.map(transactionKey));
  });

  it('暫定支払いの置き換え（resolveProvisional）が CSV と同じ金額になる', () => {
    const item: ProvisionalPayment = {
      id: 'p1',
      month: '2026-11',
      label: '楽天カード 11月分',
      amount: 99999,
      kind: 'card',
      confirmed: false,
    };
    const viaCsv = resolveProvisional([item], [csv]);
    const viaNotion = resolveProvisional([item], files);
    expect(viaNotion.active).toEqual([]);
    expect(viaNotion.superseded).toHaveLength(1);
    expect(viaNotion.superseded[0]?.by).toBe('Notion（楽天カード・2026-11払い）');
    expect(viaNotion.effective[0]?.amount).toBe(viaCsv.effective[0]?.amount);
    expect(viaNotion.effective[0]?.fromCsv).toBe(true);
  });

  it('今回支払金額の列が無ければ paymentMonth が付かず、暫定値は置き換えられない', () => {
    const noPay = pagesToCardFiles(CARD_PAGES.map((p) => {
      const { 今回支払金額: _p, ...rest } = p.properties;
      return { id: p.id, properties: rest };
    }));
    expect(noPay[0]?.paymentMonth).toBeUndefined();
    const item: ProvisionalPayment = { id: 'p1', month: '2026-11', label: 'x', amount: 5, kind: 'card', confirmed: false };
    const r = resolveProvisional([item], noPay);
    expect(r.active).toEqual([item]);
    expect(r.superseded).toEqual([]);
  });
});
