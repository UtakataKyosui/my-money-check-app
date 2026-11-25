import type { ParsedFile, Transaction } from '../../types';
import { getProp, readDate, readInt, readText, readTitle, rowLabel } from './props';
import type { NotionPage } from './types';

export const BANK_FILE_NAME = 'Notion（三井住友銀行）';

/** Notion の行（三井住友銀行の口座明細）を、CSVと同じ形の ParsedFile にする。 */
export function pagesToBankFile(pages: NotionPage[]): ParsedFile {
  const fileName = BANK_FILE_NAME;
  const warnings: string[] = [];
  const transactions: Transaction[] = [];

  for (const page of pages) {
    const description = readTitle(page);

    const dateRes = readDate(getProp(page, '年月日'));
    const date = dateRes.ok ? dateRes.value : null;
    if (date === null) {
      warnings.push(`${rowLabel(fileName, description, null)} 『年月日』を日付として解釈できないため読み飛ばしました。`);
      continue;
    }
    const where = rowLabel(fileName, description, date);

    const expense = readInt(getProp(page, 'お引出し'), 'お引出し', false);
    const income = readInt(getProp(page, 'お預入れ'), 'お預入れ', false);
    const balance = readInt(getProp(page, '残高'), '残高', true);
    const bad = expense.error ?? income.error ?? balance.error;
    if (bad) {
      warnings.push(`${where} ${bad}ため読み飛ばしました。`);
      continue;
    }

    const note = readText(getProp(page, 'メモ'));
    const label = readText(getProp(page, 'ラベル'));
    for (const [name, r] of [['メモ', note], ['ラベル', label]] as const) {
      if (!r.ok) warnings.push(`${where} 『${name}』を文字列として読み取れないため無視しました。`);
    }

    transactions.push({
      id: `notion:${page.id}`,
      source: 'bank',
      date,
      month: date.slice(0, 7),
      fileName,
      description,
      expense: expense.value ?? 0,
      income: income.value ?? 0,
      balance: balance.value ?? undefined,
      note: (note.ok && note.value?.trim()) || undefined,
      label: (label.ok && label.value?.trim()) || undefined,
    });
  }

  // Array.prototype.sort は安定なので、同日は Notion から届いた順が保たれる
  transactions.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return { fileName, source: 'bank', transactions, warnings };
}
