const HEX32 = /^[0-9a-f]{32}$/i;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SEGMENT_HEX32 = /(?:^|-)([0-9a-f]{32})$/i;
const SEGMENT_UUID = /(?:^|-)([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;
const NOTION_HOST = /(^|\.)notion\.(so|site|com)$/i;

function hyphenate(hex32: string): string {
  const h = hex32.toLowerCase();
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

function tryUrl(input: string): URL | null {
  try {
    return new URL(input);
  } catch {
    // スキームなし（notion.so/...）は https を補って再度試す
    if (/^(www\.)?notion\.(so|site|com)\//i.test(input)) {
      try {
        return new URL(`https://${input}`);
      } catch {
        return null;
      }
    }
    return null;
  }
}

/**
 * Notion の URL・32桁hex・UUID からデータベースIDを取り出し、小文字のハイフン付きUUIDにする。
 * URL の `?v=` はビューIDなので無視し、パス部分のIDを使う。解釈できなければ null。
 */
export function parseDatabaseId(input: string): string | null {
  if (typeof input !== 'string') return null;
  const s = input.trim();
  if (s === '') return null;
  if (HEX32.test(s)) return hyphenate(s);
  if (UUID.test(s)) return s.toLowerCase();

  const url = tryUrl(s);
  if (!url || !/^https?:$/.test(url.protocol) || !NOTION_HOST.test(url.hostname)) return null;

  let segments: string[];
  try {
    segments = url.pathname
      .split('/')
      .filter((x) => x !== '')
      .map((x) => decodeURIComponent(x));
  } catch {
    return null;
  }
  for (let i = segments.length - 1; i >= 0; i--) {
    const seg = segments[i] as string;
    const u = SEGMENT_UUID.exec(seg);
    if (u) return (u[1] as string).toLowerCase();
    const h = SEGMENT_HEX32.exec(seg);
    if (h) return hyphenate(h[1] as string);
  }
  return null;
}
