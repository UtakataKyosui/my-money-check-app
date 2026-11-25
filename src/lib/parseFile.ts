import type { ParsedFile, SourceKind, Transaction } from '../types';
import { parseCsv } from './csv';

/** バイト列を文字列にする。UTF-8 として不正なら Shift_JIS とみなす。 */
export function decodeCsv(bytes: ArrayBuffer | Uint8Array): string {
  const view = ArrayBuffer.isView(bytes)
    ? new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    : new Uint8Array(bytes);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(view);
  } catch {
    return new TextDecoder('shift_jis').decode(view);
  }
}

const BANK_REQUIRED = ['年月日', 'お引出し', 'お預入れ', 'お取り扱い内容', '残高'] as const;
const CARD_REQUIRED = [
  '利用日',
  '利用店名・商品名',
  '利用者',
  '支払方法',
  '利用金額',
  '手数料/利息',
  '支払総額',
] as const;

/** 全角英数記号を半角にし、前後の空白を除く */
function normalize(s: string): string {
  return s.normalize('NFKC').trim();
}

/** 日付文字列を YYYY-MM-DD にする。解釈できなければ null。 */
export function parseDate(raw: string): string | null {
  const s = normalize(raw);
  const m =
    /^(\d{4})[/\-.](\d{1,2})[/\-.](\d{1,2})$/.exec(s) ??
    /^(\d{4})年\s*(\d{1,2})月\s*(\d{1,2})日$/.exec(s) ??
    /^(\d{4})(\d{2})(\d{2})$/.exec(s);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  const p = (n: number, w: number) => String(n).padStart(w, '0');
  return `${p(y, 4)}-${p(mo, 2)}-${p(d, 2)}`;
}

/**
 * 金額文字列を整数にする。空は0、不正は null。
 * allowNegative が true のときのみ先頭の負号を許可する（残高用）。
 */
export function parseAmount(raw: string, allowNegative = false): number | null {
  let s = normalize(raw)
    .replace(/[¥￥円,\s]/g, '')
    .replace(/^[−‐‑–—ー]/, '-');
  if (s === '') return 0;
  let sign = 1;
  if (allowNegative && s.startsWith('-')) {
    sign = -1;
    s = s.slice(1);
  }
  if (!/^\d+$/.test(s)) return null;
  const n = Number(s);
  if (!Number.isSafeInteger(n)) return null;
  return sign * n;
}

function detectKind(header: string[]): SourceKind | null {
  const has = (cols: readonly string[]) => cols.every((c) => header.includes(c));
  if (has(BANK_REQUIRED)) return 'bank';
  if (has(CARD_REQUIRED)) return 'card';
  return null;
}

/** CSV文字列を取引に正規化する。見出し行から銀行/カードを自動判定する。 */
export function parseCsvText(text: string, fileName: string): ParsedFile {
  const rows = parseCsv(text);
  if (rows.length === 0) {
    throw new Error(`${fileName}: CSVが空です。見出し行を含むファイルを選んでください。`);
  }
  const header = (rows[0] as string[]).map(normalize);
  const source = detectKind(header);
  if (!source) {
    throw new Error(
      `${fileName}: 見出し行から種類を判定できませんでした。三井住友銀行の入出金明細、または楽天カードの利用明細のCSVを選んでください。`,
    );
  }

  const idx = (name: string): number => header.indexOf(name);
  const warnings: string[] = [];
  const transactions: Transaction[] = [];

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r] as string[];
    const rowNo = r + 1; // 見出しが1行目
    const where = `${fileName} ${rowNo}行目`;

    if (row.length !== header.length) {
      warnings.push(`${where}: 列数が見出しと一致しないため読み飛ばしました（${row.length}列、期待は${header.length}列）。`);
      continue;
    }
    const cell = (name: string): string => {
      const i = idx(name);
      return i < 0 ? '' : (row[i] ?? '');
    };

    const dateRaw = cell(source === 'bank' ? '年月日' : '利用日');
    const date = parseDate(dateRaw);
    if (!date) {
      warnings.push(`${where}: 日付「${dateRaw.trim()}」を解釈できないため読み飛ばしました。`);
      continue;
    }
    const base = { id: `${fileName}:${rowNo}`, source, date, month: date.slice(0, 7), fileName };

    if (source === 'bank') {
      const expense = parseAmount(cell('お引出し'));
      const income = parseAmount(cell('お預入れ'));
      const balance = parseAmount(cell('残高'), true);
      const bad = expense === null ? 'お引出し' : income === null ? 'お預入れ' : balance === null ? '残高' : null;
      if (bad || expense === null || income === null || balance === null) {
        warnings.push(`${where}: 金額（${bad}）を解釈できないため読み飛ばしました。`);
        continue;
      }
      const hasBalance = cell('残高').trim() !== '';
      transactions.push({
        ...base,
        description: cell('お取り扱い内容').trim(),
        expense,
        income,
        balance: hasBalance ? balance : undefined,
        note: cell('メモ').trim() || undefined,
        label: cell('ラベル').trim() || undefined,
      });
    } else {
      const usage = parseAmount(cell('利用金額'));
      const fee = parseAmount(cell('手数料/利息'));
      const total = parseAmount(cell('支払総額'));
      const bad = usage === null ? '利用金額' : fee === null ? '手数料/利息' : total === null ? '支払総額' : null;
      if (bad || usage === null || fee === null || total === null) {
        warnings.push(`${where}: 金額（${bad}）を解釈できないため読み飛ばしました。`);
        continue;
      }
      const totalEmpty = cell('支払総額').trim() === '';
      transactions.push({
        ...base,
        description: cell('利用店名・商品名').trim(),
        expense: totalEmpty ? usage + fee : total,
        income: 0,
        note: cell('利用者').trim() || undefined,
        paymentMethod: cell('支払方法').trim() || undefined,
        usageAmount: usage,
        fee,
      });
    }
  }

  // Array.prototype.sort は安定なので、同日はファイル順が保たれる
  transactions.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  return { fileName, source, transactions, warnings };
}
