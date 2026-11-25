/** 共通の型定義。lib/ と components/ はこの型を契約として実装する。 */

export type SourceKind = 'bank' | 'card';

/** 正規化済みの1取引。金額は円の整数。 */
export interface Transaction {
  /** ソース内で一意なID（`${fileName}:${行番号}`） */
  id: string;
  source: SourceKind;
  /** 日付 YYYY-MM-DD */
  date: string;
  /** 対象月 YYYY-MM（date から導出） */
  month: string;
  /** 摘要（銀行: お取り扱い内容 / カード: 利用店名・商品名） */
  description: string;
  /** 支出額（正の整数。銀行はお引出し、カードは支払総額） */
  expense: number;
  /** 収入額（正の整数。銀行はお預入れ。カードは返金など負の支払総額の絶対値、それ以外は0） */
  income: number;
  /** 銀行のみ: 取引後残高 */
  balance?: number;
  /** 銀行: メモ。カード: 利用者 */
  note?: string;
  /** 銀行のラベル */
  label?: string;
  /** カードのみ */
  paymentMethod?: string;
  /** カードのみ: 利用金額・手数料/利息 */
  usageAmount?: number;
  fee?: number;
  /** 元ファイル名 */
  fileName: string;
}

export interface ParsedFile {
  fileName: string;
  source: SourceKind;
  transactions: Transaction[];
  /** 読み飛ばした行の警告（日本語メッセージ） */
  warnings: string[];
}

export interface MonthlySummary {
  month: string; // YYYY-MM
  income: number;
  expense: number;
  /** income - expense */
  net: number;
  bankExpense: number;
  cardExpense: number;
  count: number;
}

export interface GroupSummary {
  key: string;
  total: number;
  count: number;
}

export interface Filters {
  /** 空配列なら全期間 */
  months: string[];
  sources: SourceKind[];
  /** 摘要の部分一致（大文字小文字・全半角を区別しない） */
  keyword: string;
}
