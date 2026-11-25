/** 金額・日付の表示用フォーマッタ（純粋関数）。 */

const MINUS = '−'; // −

function group(n: number): string {
  return Math.abs(Math.round(n))
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** 1234 -> `1,234円`、-1234 -> `-1,234円` */
export function formatYen(n: number): string {
  const r = Math.round(n);
  if (r === 0) return '0円';
  return `${r < 0 ? '-' : ''}${group(r)}円`;
}

/** 1234 -> `+1,234円`、-1234 -> `−1,234円`（U+2212）、0 -> `0円` */
export function formatSignedYen(n: number): string {
  const r = Math.round(n);
  if (r === 0) return '0円';
  return `${r < 0 ? MINUS : '+'}${group(r)}円`;
}

/** '2026-11' -> `2026年11月`（不正な形式はそのまま返す） */
export function formatMonth(month: string): string {
  const m = /^(\d{4})-(\d{1,2})$/.exec(month);
  if (!m) return month;
  return `${m[1]}年${Number(m[2])}月`;
}

/** '2026-11-01' -> `2026/11/01`（不正な形式はそのまま返す） */
export function formatDate(date: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return date;
  return `${m[1]}/${m[2]}/${m[3]}`;
}
