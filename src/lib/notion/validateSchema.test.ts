import { describe, expect, it } from 'vitest';
import { BANK_SPEC, CARD_SPEC, NOTION_SPECS } from './schema';
import { validateSchema } from './validateSchema';

const bankSchema = (): Record<string, string> => ({
  お取り扱い内容: 'title',
  年月日: 'date',
  お引出し: 'number',
  お預入れ: 'number',
});
const cardSchema = (): Record<string, string> => ({
  '利用店名・商品名': 'title',
  利用日: 'date',
  利用金額: 'number',
});

function errorsOf(kind: 'bank' | 'card', schema: Record<string, string>): string[] {
  const r = validateSchema(kind, schema);
  if (r.ok) throw new Error('expected failure');
  return r.errors;
}

describe('validateSchema（銀行）', () => {
  it('必須だけで ok', () => {
    expect(validateSchema('bank', bankSchema())).toEqual({ ok: true });
  });

  it('任意プロパティも合っていれば ok（タイトル名は自由）', () => {
    expect(
      validateSchema('bank', {
        名前: 'title',
        年月日: 'formula',
        お引出し: 'rollup',
        お預入れ: 'formula',
        残高: 'number',
        メモ: 'select',
        ラベル: 'multi_select',
      }),
    ).toEqual({ ok: true });
  });

  it('必須の欠落を全部報告する', () => {
    const errors = errorsOf('bank', {});
    expect(errors).toHaveLength(4);
    expect(errors.join('\n')).toContain('タイトル型のプロパティがありません');
    expect(errors.join('\n')).toContain('『年月日』プロパティ（日付型）がありません。');
    expect(errors.join('\n')).toContain('『お引出し』プロパティ（数値型）がありません。');
    expect(errors.join('\n')).toContain('『お預入れ』プロパティ（数値型）がありません。');
  });

  it('型の不一致は日本語の型名つき', () => {
    const errors = errorsOf('bank', { ...bankSchema(), お引出し: 'rich_text' });
    expect(errors).toEqual(['『お引出し』は数値型である必要がありますが、現在は「テキスト」です。']);
  });

  it('日付の不一致', () => {
    expect(errorsOf('bank', { ...bankSchema(), 年月日: 'rich_text' })).toEqual([
      '『年月日』は日付型である必要がありますが、現在は「テキスト」です。',
    ]);
  });

  it('タイトル型が無い', () => {
    const { お取り扱い内容: _t, ...rest } = bankSchema();
    const errors = errorsOf('bank', { ...rest, お取り扱い内容x: 'rich_text' });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('タイトル型');
  });

  it('任意プロパティが無いのは ok、あって型が違うならエラー', () => {
    expect(validateSchema('bank', bankSchema()).ok).toBe(true);
    expect(errorsOf('bank', { ...bankSchema(), 残高: 'date' })).toEqual([
      '『残高』は数値型である必要がありますが、現在は「日付」です。',
    ]);
    expect(errorsOf('bank', { ...bankSchema(), メモ: 'number' })).toEqual([
      '『メモ』はテキスト型である必要がありますが、現在は「数値」です。',
    ]);
    expect(errorsOf('bank', { ...bankSchema(), ラベル: 'checkbox' })).toEqual([
      '『ラベル』はテキスト型である必要がありますが、現在は「チェックボックス」です。',
    ]);
  });

  it('未知の型名はそのまま表示する', () => {
    expect(errorsOf('bank', { ...bankSchema(), 残高: 'brand_new' })[0]).toContain('現在は「brand_new」です');
  });
});

describe('validateSchema（カード）', () => {
  it('必須だけで ok', () => {
    expect(validateSchema('card', cardSchema())).toEqual({ ok: true });
  });

  it('全プロパティ（支払い月は日付でもテキストでも可）', () => {
    const full = {
      ...cardSchema(),
      '手数料/利息': 'number',
      支払総額: 'formula',
      利用者: 'rich_text',
      支払方法: 'select',
      今回支払金額: 'rollup',
    };
    expect(validateSchema('card', { ...full, 支払い月: 'rich_text' })).toEqual({ ok: true });
    expect(validateSchema('card', { ...full, 支払い月: 'date' })).toEqual({ ok: true });
    expect(validateSchema('card', { ...full, 支払い月: 'select' })).toEqual({ ok: true });
    expect(validateSchema('card', { ...full, 支払い月: 'formula' })).toEqual({ ok: true });
  });

  it('必須の欠落', () => {
    const errors = errorsOf('card', {});
    expect(errors).toHaveLength(3);
    expect(errors.join('\n')).toContain('『利用日』プロパティ（日付型）がありません。');
    expect(errors.join('\n')).toContain('『利用金額』プロパティ（数値型）がありません。');
  });

  it('支払い月・今回支払金額の型不一致', () => {
    expect(errorsOf('card', { ...cardSchema(), 支払い月: 'number' })).toEqual([
      '『支払い月』はテキスト型または日付型である必要がありますが、現在は「数値」です。',
    ]);
    expect(errorsOf('card', { ...cardSchema(), 今回支払金額: 'rich_text' })).toEqual([
      '『今回支払金額』は数値型である必要がありますが、現在は「テキスト」です。',
    ]);
  });

  it('複数のエラーをまとめて返す', () => {
    const errors = errorsOf('card', { ...cardSchema(), 利用金額: 'select', 支払総額: 'date', 利用日: 'number' });
    expect(errors).toHaveLength(3);
  });
});

describe('NOTION_SPECS', () => {
  it('銀行とカードの順で、タイトル型は name:null で1つだけ', () => {
    expect(NOTION_SPECS).toEqual([BANK_SPEC, CARD_SPEC]);
    for (const spec of NOTION_SPECS) {
      const titles = spec.properties.filter((p) => p.kind === 'title');
      expect(titles).toHaveLength(1);
      expect(titles[0]?.name).toBeNull();
      expect(titles[0]?.required).toBe(true);
      expect(spec.recommendedTitleName).toBe(titles[0]?.csvColumn);
      for (const p of spec.properties) {
        expect(p.types.length).toBeGreaterThan(0);
        expect(p.description).not.toBe('');
        expect(p.example).not.toBe('');
        if (p.name !== null) expect(p.kind).not.toBe('title');
      }
    }
  });

  it('必須・任意が仕様どおり', () => {
    const req = (s: typeof BANK_SPEC) => s.properties.filter((p) => p.required).map((p) => p.name);
    expect(req(BANK_SPEC)).toEqual([null, '年月日', 'お引出し', 'お預入れ']);
    expect(req(CARD_SPEC)).toEqual([null, '利用日', '利用金額']);
    expect(CARD_SPEC.properties.map((p) => p.name)).toEqual([
      null,
      '利用日',
      '利用金額',
      '手数料/利息',
      '支払総額',
      '利用者',
      '支払方法',
      '支払い月',
      '今回支払金額',
    ]);
  });

  it('formula はどの種別にも許容される', () => {
    for (const spec of NOTION_SPECS) {
      for (const p of spec.properties) {
        if (p.kind === 'title') expect(p.types).not.toContain('formula');
        else expect(p.types).toContain('formula');
      }
    }
  });
});
