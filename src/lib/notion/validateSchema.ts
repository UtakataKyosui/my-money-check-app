import { BANK_SPEC, CARD_SPEC, type NotionPropertyKind } from './schema';

/** Notion のプロパティ型名の日本語表示名 */
const TYPE_LABELS: Record<string, string> = {
  title: 'タイトル',
  rich_text: 'テキスト',
  number: '数値',
  select: 'セレクト',
  multi_select: 'マルチセレクト',
  status: 'ステータス',
  date: '日付',
  people: 'ユーザー',
  files: 'ファイル＆メディア',
  checkbox: 'チェックボックス',
  url: 'URL',
  email: 'メール',
  phone_number: '電話番号',
  formula: '数式',
  relation: 'リレーション',
  rollup: 'ロールアップ',
  created_time: '作成日時',
  created_by: '作成者',
  last_edited_time: '最終更新日時',
  last_edited_by: '最終更新者',
  unique_id: 'ID',
  button: 'ボタン',
  verification: '認証',
  place: '場所',
};

export function notionTypeLabel(type: string): string {
  return TYPE_LABELS[type] ?? type;
}

/** 種別の日本語表示（「〜型」） */
export function kindLabel(kind: NotionPropertyKind): string {
  switch (kind) {
    case 'title':
      return 'タイトル型';
    case 'date':
      return '日付型';
    case 'number':
      return '数値型';
    case 'text':
      return 'テキスト型';
    case 'month':
      return 'テキスト型または日付型';
  }
}

/**
 * 取得した schema（プロパティ名 → 型名）が仕様を満たすか確認する。
 * 必須の欠落・型の不一致・タイトル型なしをエラーにする。任意プロパティは存在して型が合わないときだけエラー。
 * `formula` はどの種別にも許容する（結果の型は行ごとに確認する）。
 */
export function validateSchema(
  kind: 'bank' | 'card',
  schema: Record<string, string>,
): { ok: true } | { ok: false; errors: string[] } {
  const spec = kind === 'bank' ? BANK_SPEC : CARD_SPEC;
  const errors: string[] = [];
  const has = (name: string) => Object.prototype.hasOwnProperty.call(schema, name);

  for (const prop of spec.properties) {
    if (prop.name === null) {
      const hasTitle = Object.values(schema).some((t) => t === 'title');
      if (!hasTitle) {
        errors.push(
          `タイトル型のプロパティがありません（推奨名は『${spec.recommendedTitleName}』）。Notion のデータベースにはタイトル型のプロパティが必要です。`,
        );
      }
      continue;
    }
    if (!has(prop.name)) {
      if (prop.required) {
        errors.push(`『${prop.name}』プロパティ（${kindLabel(prop.kind)}）がありません。`);
      }
      continue;
    }
    const actual = String(schema[prop.name]);
    if (!prop.types.includes(actual)) {
      errors.push(
        `『${prop.name}』は${kindLabel(prop.kind)}である必要がありますが、現在は「${notionTypeLabel(actual)}」です。`,
      );
    }
  }
  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}
