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
  /**
   * カードのみ: このCSVの支払い月 YYYY-MM。見出しの「◯月支払金額」の月と
   * 利用日から推定する。判定できなければ undefined。
   */
  paymentMonth?: string;
  /**
   * カードのみ: 見出し「◯月支払金額」の列の合計（この支払い月に実際に支払う金額、円）。
   * 分割払いなどで支払総額の合計と異なる場合がある。paymentMonth が判定できたときだけ設定する。
   */
  paymentTotal?: number;
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

export type ProvisionalKind = 'card' | 'bank' | 'other';

/**
 * 手入力の暫定支払い。CSVにまだ出ていない（または含まれない）支払い金額を
 * ユーザーが入力するためのもの。CSV由来の取引とは別に管理し、混ぜて集計しない。
 */
export interface ProvisionalPayment {
  id: string;
  /** 支払い月 YYYY-MM */
  month: string;
  /** 支払先・内容（例: 楽天カード 11月分） */
  label: string;
  /** 金額（正の整数・円） */
  amount: number;
  kind: ProvisionalKind;
  /** true=金額が確定済み / false=見込み */
  confirmed: boolean;
  note?: string;
  /** true なら、同じ支払いのCSVが読み込まれても暫定値を使い続ける（CSVによる置き換えを無効にする） */
  pinned?: boolean;
  /** 実行時に導出される項目だけが true: 暫定値をCSVの金額で上書きした結果（保存はしない） */
  fromCsv?: boolean;
}

/** CSVによって暫定値が置き換えられた項目 */
export interface SupersededProvisional {
  item: ProvisionalPayment;
  /** 置き換えたCSVのファイル名 */
  by: string;
  /**
   * 暫定値をCSVの金額で上書きした導出項目（id は item と同じ、amount はCSVの支払額、
   * confirmed は true、fromCsv は true）。カードのCSVで支払額が分かる場合だけ設定する。
   * 銀行の置き換えでは、CSV側にその月の取引が実在するので設定しない。
   */
  replacement?: ProvisionalPayment;
}

export interface ProvisionalMonth {
  month: string; // YYYY-MM
  total: number;
  confirmed: number;
  estimated: number;
  count: number;
}

/** タグの色。実際の色は CSS 側で色名ごとに定義する（ライト/ダーク両対応）。 */
export type TagColor = 'blue' | 'green' | 'orange' | 'red' | 'purple' | 'teal' | 'pink' | 'gray';

export interface Tag {
  id: string;
  /** 表示名（例: 家賃、サブスク）。空でなく、他のタグと重複しない */
  name: string;
  color: TagColor;
}

/** 自動タグ付けのルール: 摘要に keyword が含まれる明細に tagId を付ける（NFKC正規化・大文字小文字無視の部分一致） */
export interface TagRule {
  id: string;
  keyword: string;
  tagId: string;
}

/**
 * タグ・ルール・手動の上書きをまとめたもの。ブラウザーのlocalStorageに保存する（CSVの内容は保存しない）。
 * overrides は「明細キー → そのタグ一覧」。存在する場合はルールより優先し、空配列は「タグなし」を意味する。
 * 明細キーは取引なら `transactionKey`、暫定支払いなら `prov:<id>`。
 */
export interface TagStore {
  tags: Tag[];
  rules: TagRule[];
  overrides: Record<string, string[]>;
}

/** タグ別の支出。tagId が null の行は「タグなし」。複数タグの明細は各タグに全額を計上する。 */
export interface TagSummary {
  tagId: string | null;
  total: number;
  count: number;
}
