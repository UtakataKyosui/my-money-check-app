import { parseDate } from '../parseFile';
import type { NotionPage } from './types';

/** プロパティ値の読み取り結果。value が null なら「空」。ok:false は型や形式が合わない。 */
export type Read<T> = { ok: true; value: T | null } | { ok: false; reason: 'type' | 'format' };

type Obj = Record<string, unknown>;

function isObj(v: unknown): v is Obj {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function getProp(page: NotionPage, name: string): Obj | undefined {
  const props = page.properties;
  if (!isObj(props) || !Object.prototype.hasOwnProperty.call(props, name)) return undefined;
  const v = props[name];
  return isObj(v) ? v : undefined;
}

export function hasProp(pages: NotionPage[], name: string): boolean {
  return pages.some((p) => isObj(p.properties) && Object.prototype.hasOwnProperty.call(p.properties, name));
}

const TYPE_ERR = { ok: false, reason: 'type' } as const;
const FORMAT_ERR = { ok: false, reason: 'format' } as const;

/** 数値型: number / formula(number) / rollup(number)。未設定のプロパティは空。 */
export function readNumber(prop: Obj | undefined): Read<number> {
  if (!prop) return { ok: true, value: null };
  let holder: Obj | undefined;
  switch (prop.type) {
    case 'number':
      if (prop.number === null || prop.number === undefined) return { ok: true, value: null };
      return typeof prop.number === 'number' && Number.isFinite(prop.number)
        ? { ok: true, value: prop.number }
        : TYPE_ERR;
    case 'formula':
      holder = isObj(prop.formula) ? prop.formula : undefined;
      break;
    case 'rollup':
      holder = isObj(prop.rollup) ? prop.rollup : undefined;
      break;
    default:
      return TYPE_ERR;
  }
  if (!holder || holder.type !== 'number') return TYPE_ERR;
  if (holder.number === null || holder.number === undefined) return { ok: true, value: null };
  return typeof holder.number === 'number' && Number.isFinite(holder.number)
    ? { ok: true, value: holder.number }
    : TYPE_ERR;
}

/** `start` の文字列から YYYY-MM-DD を取り出す（日時なら先頭10文字の日付部分）。 */
function dateFromStart(start: unknown): Read<string> {
  if (start === null || start === undefined) return { ok: true, value: null };
  if (typeof start !== 'string') return FORMAT_ERR;
  const head = start.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(head) || (start.length > 10 && !/^[T\s]/.test(start.slice(10)))) {
    return FORMAT_ERR;
  }
  const d = parseDate(head);
  return d ? { ok: true, value: d } : FORMAT_ERR;
}

function readDateObject(v: unknown): Read<string> {
  if (v === null || v === undefined) return { ok: true, value: null };
  if (!isObj(v)) return FORMAT_ERR;
  return dateFromStart(v.start);
}

/** 日付型: date / formula(date)。値は YYYY-MM-DD。 */
export function readDate(prop: Obj | undefined): Read<string> {
  if (!prop) return { ok: true, value: null };
  if (prop.type === 'date') return readDateObject(prop.date);
  if (prop.type === 'formula' && isObj(prop.formula) && prop.formula.type === 'date') {
    return readDateObject(prop.formula.date);
  }
  return TYPE_ERR;
}

function joinRichText(v: unknown): string | null {
  if (!Array.isArray(v)) return null;
  let out = '';
  for (const part of v) {
    if (!isObj(part)) continue;
    if (typeof part.plain_text === 'string') out += part.plain_text;
    else if (isObj(part.text) && typeof part.text.content === 'string') out += part.text.content;
  }
  return out;
}

function nameOf(v: unknown): string {
  return isObj(v) && typeof v.name === 'string' ? v.name : '';
}

/** テキスト型: title / rich_text / select / multi_select(、連結) / status / url / email / phone_number / formula(string)。 */
export function readText(prop: Obj | undefined): Read<string> {
  if (!prop) return { ok: true, value: null };
  const str = (v: unknown): Read<string> =>
    v === null || v === undefined ? { ok: true, value: '' } : typeof v === 'string' ? { ok: true, value: v } : TYPE_ERR;
  switch (prop.type) {
    case 'title': {
      const t = joinRichText(prop.title);
      return t === null ? TYPE_ERR : { ok: true, value: t };
    }
    case 'rich_text': {
      const t = joinRichText(prop.rich_text);
      return t === null ? TYPE_ERR : { ok: true, value: t };
    }
    case 'select':
      return { ok: true, value: nameOf(prop.select) };
    case 'multi_select':
      return Array.isArray(prop.multi_select)
        ? { ok: true, value: prop.multi_select.map(nameOf).filter((n) => n !== '').join('、') }
        : TYPE_ERR;
    case 'status':
      return { ok: true, value: nameOf(prop.status) };
    case 'url':
    case 'email':
    case 'phone_number':
      return str(prop[prop.type as string]);
    case 'formula':
      return isObj(prop.formula) && prop.formula.type === 'string' ? str(prop.formula.string) : TYPE_ERR;
    default:
      return TYPE_ERR;
  }
}

/** タイトル型のプロパティ（ページに1つ）の文字列。 */
export function readTitle(page: NotionPage): string {
  const props = page.properties;
  if (!isObj(props)) return '';
  for (const v of Object.values(props)) {
    if (isObj(v) && v.type === 'title') {
      const r = readText(v);
      return r.ok && r.value !== null ? r.value.trim() : '';
    }
  }
  return '';
}

/** 支払い月の文字列表現を YYYY-MM にする。 */
export function parseMonthText(raw: string): string | null {
  const s = raw.normalize('NFKC').trim();
  if (s === '') return null;
  const m =
    /^(\d{4})[/\-.](\d{1,2})$/.exec(s) ??
    /^(\d{4})年\s*(\d{1,2})月$/.exec(s) ??
    /^(\d{4})(\d{2})$/.exec(s);
  if (m) {
    const mo = Number(m[2]);
    return mo >= 1 && mo <= 12 ? `${m[1]}-${String(mo).padStart(2, '0')}` : null;
  }
  // 日付まで入っているテキストは年月部分を使う
  const d = parseDate(s.replace(/T.*$/, ''));
  return d ? d.slice(0, 7) : null;
}

/** 支払い月: テキスト系または日付系。値は YYYY-MM。 */
export function readMonth(prop: Obj | undefined): Read<string> {
  if (!prop) return { ok: true, value: null };
  if (prop.type === 'date') {
    const r = readDateObject(prop.date);
    return r.ok && r.value !== null ? { ok: true, value: r.value.slice(0, 7) } : r;
  }
  if (prop.type === 'formula' && isObj(prop.formula) && prop.formula.type === 'date') {
    const r = readDateObject(prop.formula.date);
    return r.ok && r.value !== null ? { ok: true, value: r.value.slice(0, 7) } : r;
  }
  const t = readText(prop);
  if (!t.ok) return t;
  if (t.value === null || t.value.trim() === '') return { ok: true, value: null };
  const mo = parseMonthText(t.value);
  return mo ? { ok: true, value: mo } : FORMAT_ERR;
}

export interface IntRead {
  /** 空なら null */
  value: number | null;
  /** 読み飛ばし/無視の理由（日本語の語句。「『名前』が…」の後に続く） */
  error?: string;
}

/**
 * 金額プロパティを整数として読む。
 * error には `が負の値` / `が整数ではない` / `の値を数値として読み取れない` のいずれかが入る。
 */
export function readInt(prop: Obj | undefined, name: string, allowNegative: boolean): IntRead {
  const r = readNumber(prop);
  if (!r.ok) return { value: null, error: `『${name}』の値を数値として読み取れない` };
  if (r.value === null) return { value: null };
  if (!Number.isSafeInteger(r.value)) return { value: null, error: `『${name}』が整数ではない` };
  if (!allowNegative && r.value < 0) return { value: null, error: `『${name}』が負の値` };
  return { value: r.value };
}

/** 警告メッセージの先頭（対象の特定）。 */
export function rowLabel(fileName: string, description: string, date: string | null): string {
  return `${fileName} 「${description === '' ? '（摘要なし）' : description}」(${date ?? '日付なし'}):`;
}
