/** テスト用: Notion の生のプロパティオブジェクトを作る。 */
import type { NotionPage } from './types';

type P = Record<string, unknown>;

export const num = (n: number | null): P => ({ id: 'n', type: 'number', number: n });
export const date = (start: string | null, end: string | null = null): P => ({
  id: 'd',
  type: 'date',
  date: start === null ? null : { start, end, time_zone: null },
});
export const title = (...parts: string[]): P => ({
  id: 't',
  type: 'title',
  title: parts.map((plain_text) => ({ type: 'text', plain_text, text: { content: plain_text } })),
});
export const rich = (...parts: string[]): P => ({
  id: 'r',
  type: 'rich_text',
  rich_text: parts.map((plain_text) => ({ type: 'text', plain_text })),
});
export const select = (name: string | null): P => ({ id: 's', type: 'select', select: name === null ? null : { name } });
export const multi = (...names: string[]): P => ({
  id: 'm',
  type: 'multi_select',
  multi_select: names.map((name) => ({ name })),
});
export const status = (name: string | null): P => ({ id: 'st', type: 'status', status: name === null ? null : { name } });
export const formulaNum = (n: number | null): P => ({ type: 'formula', formula: { type: 'number', number: n } });
export const formulaStr = (s: string | null): P => ({ type: 'formula', formula: { type: 'string', string: s } });
export const formulaDate = (start: string | null): P => ({
  type: 'formula',
  formula: { type: 'date', date: start === null ? null : { start, end: null, time_zone: null } },
});
export const formulaBool = (b: boolean): P => ({ type: 'formula', formula: { type: 'boolean', boolean: b } });
export const rollupNum = (n: number | null): P => ({
  type: 'rollup',
  rollup: { type: 'number', number: n, function: 'sum' },
});
export const rollupArray = (): P => ({ type: 'rollup', rollup: { type: 'array', array: [], function: 'show_original' } });
export const checkbox = (b: boolean): P => ({ type: 'checkbox', checkbox: b });

let seq = 0;
export function page(properties: Record<string, unknown>, id?: string): NotionPage {
  seq += 1;
  return { id: id ?? `page-${seq}`, properties };
}

/** 銀行の行 */
export function bankRow(o: {
  desc: string;
  date: string | null;
  out?: number | null;
  inn?: number | null;
  balance?: number | null;
  memo?: string;
  label?: string;
  id?: string;
}): NotionPage {
  return page(
    {
      お取り扱い内容: title(o.desc),
      年月日: date(o.date),
      お引出し: num(o.out ?? null),
      お預入れ: num(o.inn ?? null),
      残高: num(o.balance ?? null),
      メモ: rich(...(o.memo ? [o.memo] : [])),
      ラベル: rich(...(o.label ? [o.label] : [])),
    },
    o.id,
  );
}

/** カードの行 */
export function cardRow(o: {
  desc: string;
  date: string | null;
  usage?: number | null;
  fee?: number | null;
  total?: number | null;
  user?: string;
  method?: string;
  month?: P;
  pay?: P;
  id?: string;
}): NotionPage {
  const props: Record<string, unknown> = {
    '利用店名・商品名': title(o.desc),
    利用日: date(o.date),
    利用金額: num(o.usage ?? null),
    '手数料/利息': num(o.fee ?? null),
    支払総額: num(o.total ?? null),
    利用者: rich(...(o.user ? [o.user] : [])),
    支払方法: rich(...(o.method ? [o.method] : [])),
  };
  if (o.month) props['支払い月'] = o.month;
  if (o.pay) props['今回支払金額'] = o.pay;
  return page(props, o.id);
}
