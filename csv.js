const formats = {
  bank: ['年月日', 'お引出し', 'お預入れ', 'お取り扱い内容', '残高', 'メモ', 'ラベル'],
  card: ['利用日', '利用店名・商品名', '利用者', '支払方法', '利用金額', '手数料/利息', '支払総額'],
};

export function decodeCsv(bytes) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('shift_jis', { fatal: true }).decode(bytes);
  }
}

export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  let closed = false;

  text = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
          closed = true;
        }
      } else {
        field += char;
      }
    } else if (char === ',') {
      row.push(field);
      field = '';
      closed = false;
    } else if (char === '\r' || char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      closed = false;
      if (char === '\r' && text[i + 1] === '\n') i++;
    } else if (char === '"' && !field && !closed) {
      quoted = true;
    } else if (char === '"' || closed) {
      throw new Error('CSVの引用符の形式が正しくありません。');
    } else {
      field += char;
    }
  }
  if (quoted) throw new Error('CSVの引用符が閉じられていません。');
  if (field || row.length || closed) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((values) => values.some((value) => value.trim() !== ''));
}

function amount(value, label, rowNumber) {
  const cleaned = value.trim().replace(/^[¥￥]/, '').replace(/円$/, '').trim();
  if (!cleaned) return 0n;
  if (!/^[+-]?(?:\d+|\d{1,3}(?:,\d{3})+)$/.test(cleaned)) {
    throw new Error(`${rowNumber}行目の「${label}」は金額として読み取れません。`);
  }
  return BigInt(cleaned.replaceAll(',', ''));
}

export function readStatement(text) {
  const [header, ...rows] = parseCsv(text);
  if (!header) throw new Error('CSVに見出しがありません。');
  const columns = header.map((name) => name.trim());
  const type = Object.keys(formats).find((key) =>
    formats[key].every((name) => columns.filter((column) => column === name).length === 1),
  );
  if (!type) throw new Error('対応する銀行またはカードのCSV見出しが見つかりません。');

  const totals = type === 'bank' ? { withdrawal: 0n, deposit: 0n } : { payment: 0n };
  rows.forEach((row, index) => {
    if (row.length !== columns.length) {
      throw new Error(`${index + 2}行目の列数が見出しと一致しません。`);
    }
    if (type === 'bank') {
      totals.withdrawal += amount(row[columns.indexOf('お引出し')], 'お引出し', index + 2);
      totals.deposit += amount(row[columns.indexOf('お預入れ')], 'お預入れ', index + 2);
    } else {
      totals.payment += amount(row[columns.indexOf('支払総額')], '支払総額', index + 2);
    }
  });
  return { type, columns, rows, totals };
}
