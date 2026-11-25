/** Notion 連携の設定の保存。ストレージが使えない・壊れている場合でも例外にしない。 */

export const NOTION_CONFIG_KEY = 'my-money-check:notion:v1';
export const NOTION_TOKEN_KEY = 'my-money-check:notion-token:v1';

export interface NotionConfig {
  /** 入力されたDBのURLまたはID（そのまま） */
  bankDatabase: string;
  cardDatabase: string;
  /** トークンをこのブラウザに覚えておく（localStorage）か */
  rememberToken: boolean;
}

export function defaultNotionConfig(): NotionConfig {
  return { bankDatabase: '', cardDatabase: '', rememberToken: false };
}

function local(): Storage | undefined {
  try {
    return globalThis.localStorage ?? undefined;
  } catch {
    return undefined;
  }
}

function session(): Storage | undefined {
  try {
    return globalThis.sessionStorage ?? undefined;
  } catch {
    return undefined;
  }
}

function get(s: Pick<Storage, 'getItem'> | undefined, key: string): string | null {
  try {
    const v = s?.getItem(key);
    return typeof v === 'string' ? v : null;
  } catch {
    return null;
  }
}

function set(s: Pick<Storage, 'setItem'> | undefined, key: string, value: string): void {
  try {
    s?.setItem(key, value);
  } catch {
    // 容量超過・プライベートモードなどは無視
  }
}

function remove(s: Pick<Storage, 'removeItem'> | undefined, key: string): void {
  try {
    s?.removeItem(key);
  } catch {
    // 無視
  }
}

export function loadNotionConfig(storage?: Pick<Storage, 'getItem'>): NotionConfig {
  const config = defaultNotionConfig();
  try {
    const text = get(storage ?? local(), NOTION_CONFIG_KEY);
    if (text === null) return config;
    const data: unknown = JSON.parse(text);
    if (typeof data !== 'object' || data === null || Array.isArray(data)) return config;
    const d = data as Record<string, unknown>;
    if (typeof d.bankDatabase === 'string') config.bankDatabase = d.bankDatabase;
    if (typeof d.cardDatabase === 'string') config.cardDatabase = d.cardDatabase;
    if (typeof d.rememberToken === 'boolean') config.rememberToken = d.rememberToken;
  } catch {
    // 壊れた値は既定値に戻す
  }
  return config;
}

export function saveNotionConfig(config: NotionConfig, storage?: Pick<Storage, 'setItem'>): void {
  set(
    storage ?? local(),
    NOTION_CONFIG_KEY,
    JSON.stringify({
      bankDatabase: config.bankDatabase,
      cardDatabase: config.cardDatabase,
      rememberToken: config.rememberToken,
    }),
  );
}

/** トークンを読む。まず sessionStorage、無ければ localStorage。 */
export function loadNotionToken(): string {
  const fromSession = get(session(), NOTION_TOKEN_KEY);
  if (fromSession) return fromSession;
  return get(local(), NOTION_TOKEN_KEY) || '';
}

/** remember=true なら localStorage（sessionStorage からは消す）、false なら sessionStorage（localStorage からは消す）。空文字なら両方から消す。 */
export function saveNotionToken(token: string, remember: boolean): void {
  const t = token.trim();
  if (t === '') {
    clearNotionToken();
    return;
  }
  const keep = remember ? local() : session();
  const drop = remember ? session() : local();
  set(keep, NOTION_TOKEN_KEY, t);
  remove(drop, NOTION_TOKEN_KEY);
}

export function clearNotionToken(): void {
  remove(session(), NOTION_TOKEN_KEY);
  remove(local(), NOTION_TOKEN_KEY);
}
