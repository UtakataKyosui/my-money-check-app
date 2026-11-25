/**
 * Notion データベースの形式（仕様）をデータとして持つ。
 * 検証（validateSchema）・変換（mapBank / mapCard）・アプリ内ヘルプ・READMEの表が同じ定義を使う。
 */

export type NotionPropertyKind = 'title' | 'date' | 'number' | 'text' | 'month';

export interface NotionPropertySpec {
  /** プロパティ名。タイトル型は名前が自由なので null */
  name: string | null;
  kind: NotionPropertyKind;
  required: boolean;
  /** 許容する Notion のプロパティ型名（schema の型名と比較する） */
  types: readonly string[];
  /** 対応するCSVの列名（あれば） */
  csvColumn?: string;
  /** 日本語の説明（何に使われるか） */
  description: string;
  /** 入力例 */
  example: string;
}

export interface NotionDatabaseSpec {
  kind: 'bank' | 'card';
  /** 例: 「銀行（三井住友銀行の口座明細）」 */
  title: string;
  /** タイトル型プロパティの推奨名 */
  recommendedTitleName: string;
  properties: readonly NotionPropertySpec[];
}

const TITLE_TYPES = ['title'] as const;
const DATE_TYPES = ['date', 'formula'] as const;
const NUMBER_TYPES = ['number', 'formula', 'rollup'] as const;
const TEXT_TYPES = [
  'rich_text',
  'select',
  'multi_select',
  'status',
  'url',
  'email',
  'phone_number',
  'formula',
  'title',
] as const;
const MONTH_TYPES = [...TEXT_TYPES, 'date'] as const;

export const BANK_SPEC: NotionDatabaseSpec = {
  kind: 'bank',
  title: '銀行（三井住友銀行の口座明細）',
  recommendedTitleName: 'お取り扱い内容',
  properties: [
    {
      name: null,
      kind: 'title',
      required: true,
      types: TITLE_TYPES,
      csvColumn: 'お取り扱い内容',
      description: '摘要（取引の内容）。タイトル型のプロパティで、名前は自由です。',
      example: 'ｶ)ﾗｸﾃﾝｶ-ﾄﾞ',
    },
    {
      name: '年月日',
      kind: 'date',
      required: true,
      types: DATE_TYPES,
      csvColumn: '年月日',
      description: '取引日。',
      example: '2026-11-05',
    },
    {
      name: 'お引出し',
      kind: 'number',
      required: true,
      types: NUMBER_TYPES,
      csvColumn: 'お引出し',
      description: '支出額（円の整数）。空欄は0として扱います。負の値や小数の行は読み飛ばします。',
      example: '1200',
    },
    {
      name: 'お預入れ',
      kind: 'number',
      required: true,
      types: NUMBER_TYPES,
      csvColumn: 'お預入れ',
      description: '収入額（円の整数）。空欄は0として扱います。負の値や小数の行は読み飛ばします。',
      example: '250000',
    },
    {
      name: '残高',
      kind: 'number',
      required: false,
      types: NUMBER_TYPES,
      csvColumn: '残高',
      description: '取引後の残高（円の整数）。空欄なら残高なしとして扱います。',
      example: '1234567',
    },
    {
      name: 'メモ',
      kind: 'text',
      required: false,
      types: TEXT_TYPES,
      csvColumn: 'メモ',
      description: '銀行の明細のメモ。',
      example: '11月分',
    },
    {
      name: 'ラベル',
      kind: 'text',
      required: false,
      types: TEXT_TYPES,
      csvColumn: 'ラベル',
      description: '銀行の明細のラベル。',
      example: '固定費',
    },
  ],
};

export const CARD_SPEC: NotionDatabaseSpec = {
  kind: 'card',
  title: 'カード（楽天カードの利用明細）',
  recommendedTitleName: '利用店名・商品名',
  properties: [
    {
      name: null,
      kind: 'title',
      required: true,
      types: TITLE_TYPES,
      csvColumn: '利用店名・商品名',
      description: '摘要（利用店名・商品名）。タイトル型のプロパティで、名前は自由です。',
      example: 'Amazon.co.jp',
    },
    {
      name: '利用日',
      kind: 'date',
      required: true,
      types: DATE_TYPES,
      csvColumn: '利用日',
      description: 'カードを利用した日。',
      example: '2026-11-03',
    },
    {
      name: '利用金額',
      kind: 'number',
      required: true,
      types: NUMBER_TYPES,
      csvColumn: '利用金額',
      description: '利用金額（円の整数）。返金は負の値にします。',
      example: '3980',
    },
    {
      name: '手数料/利息',
      kind: 'number',
      required: false,
      types: NUMBER_TYPES,
      csvColumn: '手数料/利息',
      description: '分割・リボ払いの手数料や利息（円の整数）。空欄は0として扱います。',
      example: '120',
    },
    {
      name: '支払総額',
      kind: 'number',
      required: false,
      types: NUMBER_TYPES,
      csvColumn: '支払総額',
      description:
        '支出額として集計する金額（円の整数）。空欄なら 利用金額＋手数料/利息 です。負の値は返金として収入に計上します。',
      example: '4100',
    },
    {
      name: '利用者',
      kind: 'text',
      required: false,
      types: TEXT_TYPES,
      csvColumn: '利用者',
      description: '利用者（本人・家族など）。',
      example: '本人',
    },
    {
      name: '支払方法',
      kind: 'text',
      required: false,
      types: TEXT_TYPES,
      csvColumn: '支払方法',
      description: '支払方法（1回払い・分割など）。',
      example: '1回',
    },
    {
      name: '支払い月',
      kind: 'month',
      required: false,
      types: MONTH_TYPES,
      description:
        'その明細を請求・支払う月。「2026-11」「2026/11」「2026年11月」のテキスト、または日付（年月の部分を使います）。支払い月ごとに別のファイルとして取り込みます。',
      example: '2026-11',
    },
    {
      name: '今回支払金額',
      kind: 'number',
      required: false,
      types: NUMBER_TYPES,
      csvColumn: '◯月支払金額',
      description:
        'その明細について、支払い月に実際に支払う金額（円の整数）。分割払いでは支払総額と異なります。支払い月ごとの合計が、暫定の支払い予定の置き換えに使われます。',
      example: '2050',
    },
  ],
};

export const NOTION_SPECS = [BANK_SPEC, CARD_SPEC] as const;
