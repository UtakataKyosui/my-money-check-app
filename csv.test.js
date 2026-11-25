import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { decodeCsv, parseCsv, readStatement } from './csv.js';

const bankHeader = '年月日,お引出し,お預入れ,お取り扱い内容,残高,メモ,ラベル';
const cardHeader = '"利用日","利用店名・商品名","利用者","支払方法","利用金額","手数料/利息","支払総額","11月支払金額","当月請求額","12月繰越残高","新規サイン"';

test('銀行明細の入出金を集計する', () => {
  const result = readStatement(`\uFEFF${bankHeader}\r\n2026/11/01,"1,200",,振込,"9,000",,\r\n2026/11/02,,"12,000",給与,"21,000",,\r\n`);
  assert.equal(result.type, 'bank');
  assert.deepEqual(result.totals, { withdrawal: 1200n, deposit: 12000n });
  assert.equal(result.rows.length, 2);
});

test('カード明細の可変の月見出しと引用符を読み取り、支払総額を集計する', () => {
  const result = readStatement(`${cardHeader}\n"2026/11/01","店, ""商品""\n売場","本人","1回","1,000","50","1,050","1,050","1,050","0",""\n`);
  assert.equal(result.type, 'card');
  assert.equal(result.rows[0][1], '店, "商品"\n売場');
  assert.equal(result.totals.payment, 1050n);
});

test('UTF-8とShift_JISを読み取る', () => {
  assert.equal(decodeCsv(new TextEncoder().encode('年月日')), '年月日');
  assert.equal(decodeCsv(Uint8Array.from([0x94, 0x4e, 0x8c, 0x8e, 0x93, 0xfa])), '年月日');
});

test('不正なCSVや金額はエラーにする', () => {
  assert.throws(() => parseCsv('"閉じない'), /引用符/);
  assert.throws(() => parseCsv('"値"余分'), /引用符/);
  assert.throws(() => readStatement('不明,見出し\n1,2'), /見出し/);
  assert.throws(() => readStatement(`${bankHeader}\n2026/11/01,1`), /列数/);
  assert.throws(() => readStatement(`${bankHeader}\n2026/11/01,不明,,振込,0,,`), /金額/);
});
