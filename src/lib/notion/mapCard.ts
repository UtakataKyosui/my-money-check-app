import type { ParsedFile, Transaction } from '../../types';
import { getProp, hasProp, readDate, readInt, readMonth, readText, readTitle, rowLabel } from './props';
import type { NotionPage } from './types';

export const CARD_FILE_NAME = 'Notion（楽天カード）';

function cardFileName(month: string | undefined): string {
  return month === undefined ? CARD_FILE_NAME : `Notion（楽天カード・${month}払い）`;
}

interface Group {
  month: string | undefined;
  fileName: string;
  transactions: Transaction[];
  warnings: string[];
  /** 取り込んだ行の「今回支払金額」の合計 */
  payTotal: number;
  /** 取り込んだ行に「今回支払金額」の値（null以外）が1件以上あるか */
  hasPayValue: boolean;
}

/**
 * Notion の行（楽天カードの利用明細）を、支払い月ごとの ParsedFile にする。
 * 支払い月の昇順、支払い月なしは最後。行が無ければ空配列。
 */
export function pagesToCardFiles(pages: NotionPage[]): ParsedFile[] {
  const hasPayProp = hasProp(pages, '今回支払金額');
  const groups = new Map<string, Group>();
  const groupFor = (month: string | undefined): Group => {
    const key = month ?? '';
    let g = groups.get(key);
    if (!g) {
      g = {
        month,
        fileName: cardFileName(month),
        transactions: [],
        warnings: [],
        payTotal: 0,
        hasPayValue: false,
      };
      groups.set(key, g);
    }
    return g;
  };

  for (const page of pages) {
    const description = readTitle(page);
    const dateRes = readDate(getProp(page, '利用日'));
    const date = dateRes.ok ? dateRes.value : null;

    // 支払い月が解釈できない行は、支払い月なしとして扱う（警告は日付が分かれば添える）
    const monthRes = readMonth(getProp(page, '支払い月'));
    const month = monthRes.ok && monthRes.value !== null ? monthRes.value : undefined;
    const group = groupFor(month);
    const where = rowLabel(group.fileName, description, date);
    if (!monthRes.ok) {
      group.warnings.push(`${where} 『支払い月』を解釈できないため、支払い月なしとして扱いました。`);
    }

    if (date === null) {
      group.warnings.push(`${where} 『利用日』を日付として解釈できないため読み飛ばしました。`);
      continue;
    }

    const usage = readInt(getProp(page, '利用金額'), '利用金額', true);
    const fee = readInt(getProp(page, '手数料/利息'), '手数料/利息', true);
    const total = readInt(getProp(page, '支払総額'), '支払総額', true);
    const bad = usage.error ?? fee.error ?? total.error;
    if (bad) {
      group.warnings.push(`${where} ${bad}ため読み飛ばしました。`);
      continue;
    }

    if (hasPayProp) {
      const pay = readInt(getProp(page, '今回支払金額'), '今回支払金額', true);
      if (pay.error) {
        group.warnings.push(`${where} ${pay.error}ため、0円として数えました。`);
      } else if (pay.value !== null) {
        group.payTotal += pay.value;
        group.hasPayValue = true;
      }
    }

    const note = readText(getProp(page, '利用者'));
    const method = readText(getProp(page, '支払方法'));
    for (const [name, r] of [['利用者', note], ['支払方法', method]] as const) {
      if (!r.ok) group.warnings.push(`${where} 『${name}』を文字列として読み取れないため無視しました。`);
    }

    const usageAmount = usage.value ?? 0;
    const feeAmount = fee.value ?? 0;
    const net = total.value === null ? usageAmount + feeAmount : total.value;
    group.transactions.push({
      id: `notion:${page.id}`,
      source: 'card',
      date,
      month: date.slice(0, 7),
      fileName: group.fileName,
      description,
      // 返金（負の金額）は収入側に計上する
      expense: Math.max(net, 0),
      income: Math.max(-net, 0),
      note: (note.ok && note.value?.trim()) || undefined,
      paymentMethod: (method.ok && method.value?.trim()) || undefined,
      usageAmount,
      fee: feeAmount,
    });
  }

  const ordered = [...groups.values()].sort((a, b) => {
    if (a.month === b.month) return 0;
    if (a.month === undefined) return 1;
    if (b.month === undefined) return -1;
    return a.month < b.month ? -1 : 1;
  });

  return ordered.map((g) => {
    g.transactions.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    const file: ParsedFile = {
      fileName: g.fileName,
      source: 'card',
      transactions: g.transactions,
      warnings: g.warnings,
    };
    if (g.month !== undefined && hasPayProp && g.hasPayValue) {
      file.paymentMonth = g.month;
      file.paymentTotal = g.payTotal;
    }
    return file;
  });
}
