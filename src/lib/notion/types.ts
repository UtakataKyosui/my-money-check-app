/** 中継関数 `POST /api/notion/query` が返す Notion のページ（行）。properties は Notion の生のプロパティオブジェクト。 */
export interface NotionPage {
  id: string;
  properties: Record<string, unknown>;
}

export interface NotionQueryResponse {
  dataSourceId: string;
  /** プロパティ名 → Notion のプロパティ型名。dataSourceId なしの最初の呼び出しのときだけ返る。 */
  schema?: Record<string, string>;
  results: NotionPage[];
  nextCursor: string | null;
}

/** 中継関数が返すエラーコード */
export type NotionErrorCode =
  | 'invalid_request'
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'rate_limited'
  | 'upstream_error'
  | 'internal_error'
  | 'method_not_allowed';

export const NOTION_ERROR_CODES: readonly NotionErrorCode[] = [
  'invalid_request',
  'unauthorized',
  'forbidden',
  'not_found',
  'rate_limited',
  'upstream_error',
  'internal_error',
  'method_not_allowed',
];

export type NotionErrorKind = NotionErrorCode | 'network_error' | 'schema_mismatch' | 'too_many_rows';

/** Notion の取得で起きたエラー。message は日本語でそのまま表示できる。 */
export class NotionError extends Error {
  code: NotionErrorKind;
  status?: number;
  retryAfter?: number;
  details?: string[];

  constructor(
    code: NotionErrorKind,
    message: string,
    options: { status?: number; retryAfter?: number; details?: string[] } = {},
  ) {
    super(message);
    this.name = 'NotionError';
    this.code = code;
    if (options.status !== undefined) this.status = options.status;
    if (options.retryAfter !== undefined) this.retryAfter = options.retryAfter;
    if (options.details !== undefined) this.details = options.details;
  }
}
