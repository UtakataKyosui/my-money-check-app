/**
 * RFC4180 準拠の最小CSVパーサ。
 * - 引用符内の改行・カンマ、"" エスケープに対応
 * - CRLF / LF / CR を行区切りとして扱う
 * - 先頭のBOMは除去、空行は除去
 * - 引用符が不正な場合は日本語メッセージの Error を投げる
 */
export function parseCsv(text: string): string[][] {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);

  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  /** 現在のフィールドが引用符で始まったか */
  let quoted = false;
  /** 引用符内にいるか */
  let inQuotes = false;
  /** 閉じ引用符の直後か（次は , 改行 終端のみ許可） */
  let afterQuote = false;
  /** 現在の物理行番号（エラーメッセージ用） */
  let line = 1;
  let quoteStartLine = 1;

  const endField = () => {
    row.push(field);
    field = '';
    quoted = false;
    afterQuote = false;
  };
  const endRow = () => {
    endField();
    // 空行（フィールドが1つで空）は捨てる
    if (!(row.length === 1 && row[0] === '')) rows.push(row);
    row = [];
  };

  const n = text.length;
  for (let i = 0; i < n; i++) {
    const c = text[i] as string;

    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
          afterQuote = true;
        }
      } else {
        if (c === '\n') line++;
        field += c;
      }
      continue;
    }

    if (c === '"') {
      if (field === '' && !quoted && !afterQuote) {
        inQuotes = true;
        quoted = true;
        quoteStartLine = line;
        continue;
      }
      throw new Error(`CSVの形式が不正です: ${line}行目に引用符の位置が正しくない箇所があります。`);
    }

    if (c === ',') {
      endField();
      continue;
    }

    if (c === '\r' || c === '\n') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      endRow();
      line++;
      continue;
    }

    if (afterQuote) {
      throw new Error(`CSVの形式が不正です: ${line}行目で、引用符で閉じた項目の後に余分な文字があります。`);
    }
    field += c;
  }

  if (inQuotes) {
    throw new Error(`CSVの形式が不正です: ${quoteStartLine}行目で開いた引用符が閉じられていません。`);
  }
  // 末尾に改行がないケース
  if (field !== '' || quoted || afterQuote || row.length > 0) endRow();

  return rows;
}
