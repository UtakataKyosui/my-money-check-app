import type { ProvisionalPayment, Tag, TagColor, TagRule, TagStore, TagSummary, Transaction } from '../types';

export const TAG_COLORS: readonly TagColor[] = [
  'blue',
  'green',
  'orange',
  'red',
  'purple',
  'teal',
  'pink',
  'gray',
];

/** 「タグなし」で絞り込むための予約ID。タグのIDとしては使わない。 */
export const UNTAGGED = '__untagged__';

export const TAGS_STORAGE_KEY = 'my-money-check:tags:v1';
export const MAX_TAG_NAME_LENGTH = 20;
const MAX_KEYWORD_LENGTH = 50;

export type Result<T> = ({ ok: true } & T) | { ok: false; error: string };

export function emptyTagStore(): TagStore {
  return { tags: [], rules: [], overrides: {} };
}

/** NFKC正規化して小文字にする（全角半角・大文字小文字を区別しない比較用）。 */
function fold(s: string): string {
  return s.normalize('NFKC').toLowerCase();
}

/** ルールのキーワードの比較用の形。NFKC・小文字化したうえで前後の空白を除く。 */
function foldKeyword(s: string): string {
  return fold(s).trim();
}

function hasOwn(obj: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

function isTagColor(v: unknown): v is TagColor {
  return typeof v === 'string' && (TAG_COLORS as readonly string[]).includes(v);
}

export function createTagId(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c && typeof c.randomUUID === 'function') {
    try {
      return c.randomUUID();
    } catch {
      // 非セキュアコンテキストなどでは下のフォールバックを使う
    }
  }
  return `t-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

// ---------------------------------------------------------------------------
// キー
// ---------------------------------------------------------------------------

/**
 * cyrb53: 文字列から53ビットのハッシュを作る（暗号用ではない。キーの衝突を避けるためだけに使う）。
 * 取引の日付・摘要・金額をlocalStorageに読める形で残さないために、明細キーをハッシュにする。
 */
function hash53(text: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

/**
 * 取引の手動タグの識別キー。同じ取引元・日付・摘要・金額の明細は同じキーになる。
 * 日付・摘要・金額そのものは保存せず、そのハッシュだけを `tx:` つきで返す。
 */
export function transactionKey(tx: Transaction): string {
  return `tx:${hash53(`${tx.source}|${tx.date}|${tx.description}|${tx.expense}|${tx.income}`)}`;
}

export function provisionalKey(p: Pick<ProvisionalPayment, 'id'>): string {
  return `prov:${p.id}`;
}

// ---------------------------------------------------------------------------
// 解決
// ---------------------------------------------------------------------------

/** 明細に付いているタグID。override があればそれ、無ければルールの一致結果。store.tags の並び順で重複なし。 */
export function tagIdsFor(store: TagStore, key: string, text: string): string[] {
  let wanted: Set<string>;
  if (hasOwn(store.overrides, key)) {
    wanted = new Set(store.overrides[key] ?? []);
  } else {
    wanted = new Set();
    const haystack = fold(text);
    for (const rule of store.rules) {
      const kw = foldKeyword(rule.keyword);
      if (kw !== '' && haystack.includes(kw)) wanted.add(rule.tagId);
    }
  }
  return store.tags.filter((t) => wanted.has(t.id)).map((t) => t.id);
}

/** ルール追加前のプレビュー用: keyword に一致する摘要の件数。tagIdsFor と同じ照合。 */
export function countRuleMatches(keyword: string, texts: string[]): number {
  const kw = foldKeyword(keyword);
  if (kw === '') return 0;
  let n = 0;
  for (const text of texts) {
    if (fold(text).includes(kw)) n += 1;
  }
  return n;
}

// ---------------------------------------------------------------------------
// タグの編集
// ---------------------------------------------------------------------------

function validateName(store: TagStore, name: string, selfId?: string): Result<{ name: string }> {
  const trimmed = name.trim();
  if (trimmed === '') return { ok: false, error: 'タグ名を入力してください。' };
  if (Array.from(trimmed).length > MAX_TAG_NAME_LENGTH) {
    return { ok: false, error: `タグ名は${MAX_TAG_NAME_LENGTH}文字以内で入力してください。` };
  }
  const folded = fold(trimmed);
  if (store.tags.some((t) => t.id !== selfId && fold(t.name) === folded)) {
    return { ok: false, error: '同じ名前のタグがすでにあります。' };
  }
  return { ok: true, name: trimmed };
}

function leastUsedColor(tags: Tag[]): TagColor {
  let best: TagColor = TAG_COLORS[0] ?? 'blue';
  let bestCount = Infinity;
  for (const color of TAG_COLORS) {
    const count = tags.filter((t) => t.color === color).length;
    if (count < bestCount) {
      best = color;
      bestCount = count;
    }
  }
  return best;
}

export function addTag(
  store: TagStore,
  name: string,
  color?: TagColor,
): Result<{ store: TagStore; tag: Tag }> {
  const v = validateName(store, name);
  if (!v.ok) return v;
  const tag: Tag = {
    id: createTagId(),
    name: v.name,
    color: color ?? leastUsedColor(store.tags),
  };
  return { ok: true, store: { ...store, tags: [...store.tags, tag] }, tag };
}

export function renameTag(store: TagStore, id: string, name: string): Result<{ store: TagStore }> {
  if (!store.tags.some((t) => t.id === id)) {
    return { ok: false, error: 'タグが見つかりません。' };
  }
  const v = validateName(store, name, id);
  if (!v.ok) return v;
  return {
    ok: true,
    store: { ...store, tags: store.tags.map((t) => (t.id === id ? { ...t, name: v.name } : t)) },
  };
}

export function setTagColor(store: TagStore, id: string, color: TagColor): TagStore {
  return { ...store, tags: store.tags.map((t) => (t.id === id ? { ...t, color } : t)) };
}

/** タグと、そのタグを参照するルール・overrides のタグIDを取り除く。空になった override は「タグなし」として残す。 */
export function deleteTag(store: TagStore, id: string): TagStore {
  return {
    tags: store.tags.filter((t) => t.id !== id),
    rules: store.rules.filter((r) => r.tagId !== id),
    overrides: Object.fromEntries(
      Object.entries(store.overrides).map(([key, ids]) => [key, ids.filter((x) => x !== id)]),
    ),
  };
}

// ---------------------------------------------------------------------------
// ルール・上書き
// ---------------------------------------------------------------------------

export function addRule(
  store: TagStore,
  keyword: string,
  tagId: string,
): Result<{ store: TagStore; rule: TagRule }> {
  const trimmed = keyword.trim();
  if (trimmed === '') return { ok: false, error: 'キーワードを入力してください。' };
  if (Array.from(trimmed).length > MAX_KEYWORD_LENGTH) {
    return { ok: false, error: `キーワードは${MAX_KEYWORD_LENGTH}文字以内で入力してください。` };
  }
  if (!store.tags.some((t) => t.id === tagId)) {
    return { ok: false, error: 'タグが見つかりません。' };
  }
  const folded = foldKeyword(trimmed);
  if (folded === '') return { ok: false, error: 'キーワードを入力してください。' };
  if (store.rules.some((r) => r.tagId === tagId && foldKeyword(r.keyword) === folded)) {
    return { ok: false, error: '同じキーワードのルールがすでにあります。' };
  }
  const rule: TagRule = { id: createTagId(), keyword: trimmed, tagId };
  return { ok: true, store: { ...store, rules: [...store.rules, rule] }, rule };
}

export function removeRule(store: TagStore, ruleId: string): TagStore {
  return { ...store, rules: store.rules.filter((r) => r.id !== ruleId) };
}

/** tagIds が null なら上書きを削除（ルールに戻る）。空配列は「タグなし」の明示。 */
export function setOverride(store: TagStore, key: string, tagIds: string[] | null): TagStore {
  if (tagIds === null) {
    if (!hasOwn(store.overrides, key)) return store;
    return {
      ...store,
      overrides: Object.fromEntries(Object.entries(store.overrides).filter(([k]) => k !== key)),
    };
  }
  const existing = new Set(store.tags.map((t) => t.id));
  const ids = [...new Set(tagIds)].filter((id) => existing.has(id));
  return { ...store, overrides: { ...store.overrides, [key]: ids } };
}

// ---------------------------------------------------------------------------
// 集計・絞り込み
// ---------------------------------------------------------------------------

export interface TaggableItem {
  key: string;
  text: string;
  amount: number;
}

/**
 * タグ別の支出。amount > 0 の項目だけを対象に、付いている各タグに全額を計上する。
 * タグなしは tagId=null の行（常に最後）。total 降順、同額は store.tags の順。
 */
export function summarizeByTag(items: TaggableItem[], store: TagStore): TagSummary[] {
  const byTag = new Map<string, TagSummary>();
  const untagged: TagSummary = { tagId: null, total: 0, count: 0 };
  for (const item of items) {
    if (!(item.amount > 0) || !Number.isFinite(item.amount)) continue;
    const ids = tagIdsFor(store, item.key, item.text);
    if (ids.length === 0) {
      untagged.total += item.amount;
      untagged.count += 1;
      continue;
    }
    for (const id of ids) {
      let row = byTag.get(id);
      if (!row) {
        row = { tagId: id, total: 0, count: 0 };
        byTag.set(id, row);
      }
      row.total += item.amount;
      row.count += 1;
    }
  }
  const rows: TagSummary[] = [];
  for (const tag of store.tags) {
    const row = byTag.get(tag.id);
    if (row) rows.push(row);
  }
  // Array.prototype.sort は安定なので、同額は store.tags の順のまま残る
  rows.sort((a, b) => b.total - a.total);
  if (untagged.count > 0) rows.push(untagged);
  return rows;
}

export function matchesTagFilter(tagIds: string[], selected: string[]): boolean {
  if (selected.length === 0) return true;
  if (tagIds.length === 0) return selected.includes(UNTAGGED);
  return tagIds.some((id) => selected.includes(id));
}

// ---------------------------------------------------------------------------
// 保存
// ---------------------------------------------------------------------------

function getDefaultStorage(): Storage | undefined {
  try {
    return globalThis.localStorage ?? undefined;
  } catch {
    return undefined;
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function sanitizeStore(data: unknown): TagStore {
  const store = emptyTagStore();
  if (!isRecord(data)) return store;

  const tagIds = new Set<string>();
  const names = new Set<string>();
  if (Array.isArray(data.tags)) {
    for (const raw of data.tags) {
      if (!isRecord(raw)) continue;
      const { id, name, color } = raw;
      if (typeof id !== 'string' || id === '' || id === UNTAGGED || tagIds.has(id)) continue;
      if (typeof name !== 'string' || name.trim() === '' || !isTagColor(color)) continue;
      const folded = fold(name.trim());
      if (names.has(folded)) continue;
      tagIds.add(id);
      names.add(folded);
      store.tags.push({ id, name: name.trim(), color });
    }
  }

  if (Array.isArray(data.rules)) {
    const ruleIds = new Set<string>();
    const pairs = new Set<string>();
    for (const raw of data.rules) {
      if (!isRecord(raw)) continue;
      const { id, keyword, tagId } = raw;
      if (typeof id !== 'string' || id === '' || ruleIds.has(id)) continue;
      if (typeof keyword !== 'string' || foldKeyword(keyword) === '') continue;
      if (typeof tagId !== 'string' || !tagIds.has(tagId)) continue;
      const pair = JSON.stringify([foldKeyword(keyword), tagId]);
      if (pairs.has(pair)) continue;
      ruleIds.add(id);
      pairs.add(pair);
      store.rules.push({ id, keyword: keyword.trim(), tagId });
    }
  }

  if (isRecord(data.overrides)) {
    // fromEntries は own プロパティとして定義するので "__proto__" というキーでも安全
    store.overrides = Object.fromEntries(
      Object.entries(data.overrides).flatMap(([key, value]): [string, string[]][] => {
        if (!Array.isArray(value)) return [];
        const ids = [
          ...new Set(value.filter((v): v is string => typeof v === 'string' && tagIds.has(v))),
        ];
        return [[key, ids]];
      }),
    );
  }
  return store;
}

/** 保存済みのタグ設定を読む。読めない・壊れている場合は空ストア、不正な要素は捨てる。 */
export function loadTagStore(storage?: Pick<Storage, 'getItem'>): TagStore {
  try {
    const s = storage ?? getDefaultStorage();
    if (!s) return emptyTagStore();
    const text = s.getItem(TAGS_STORAGE_KEY);
    if (text === null || text === undefined) return emptyTagStore();
    return sanitizeStore(JSON.parse(text));
  } catch {
    return emptyTagStore();
  }
}

/** タグ設定を保存する。保存できない環境でも例外にしない。 */
export function saveTagStore(store: TagStore, storage?: Pick<Storage, 'setItem'>): void {
  try {
    const s = storage ?? getDefaultStorage();
    if (!s) return;
    s.setItem(TAGS_STORAGE_KEY, JSON.stringify(store));
  } catch {
    // 容量超過・プライベートモードなどは無視
  }
}

// ---------------------------------------------------------------------------
// おすすめタグ
// ---------------------------------------------------------------------------

export const SUGGESTED_TAGS: readonly { name: string; color: TagColor }[] = [
  { name: '家賃', color: 'blue' },
  { name: 'サブスク', color: 'purple' },
  { name: '光熱費', color: 'orange' },
  { name: '通信費', color: 'teal' },
  { name: '食費', color: 'green' },
  { name: '交通費', color: 'pink' },
  { name: '日用品', color: 'red' },
  { name: '保険', color: 'blue' },
  { name: 'その他', color: 'gray' },
];

/** 名前が未登録のおすすめタグだけを追加する。 */
export function addSuggestedTags(store: TagStore): TagStore {
  const names = new Set(store.tags.map((t) => fold(t.name.trim())));
  const added: Tag[] = [];
  for (const s of SUGGESTED_TAGS) {
    if (names.has(fold(s.name))) continue;
    added.push({ id: createTagId(), name: s.name, color: s.color });
  }
  return added.length === 0 ? store : { ...store, tags: [...store.tags, ...added] };
}
