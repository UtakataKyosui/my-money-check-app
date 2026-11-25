/**
 * Notion API 中継のコア処理。Web 標準の Request / Response だけに依存する。
 *
 * - トークンはリクエストごとに `x-notion-token` ヘッダーで受け取る。保存もログ出力もしない。
 * - 接続先（baseUrl）は呼び出し側の options または環境変数 NOTION_API_BASE_URL のみで決める。
 *   リクエスト由来の値は使わない（SSRF 防止）。テスト・E2E 用の差し替え口。
 */
import {
  APIErrorCode,
  APIResponseError,
  Client,
  ClientErrorCode,
  isFullPage,
  isNotionClientError,
  RequestTimeoutError,
} from '@notionhq/client';

export const NOTION_TOKEN_HEADER = 'x-notion-token';
/** リクエストボディの上限（バイト）。databaseId などしか受け取らないので小さくてよい。 */
export const MAX_BODY_BYTES = 64 * 1024;

const PAGE_SIZE = 100;
/** Notion への 1 リクエストあたりのタイムアウト。最初の呼び出しは最大 3 回直列に呼ぶ。 */
const NOTION_TIMEOUT_MS = 10_000;
const DEFAULT_RETRY_AFTER_SECONDS = 5;
const MAX_CURSOR_LENGTH = 1024;

const UUID_PATTERN =
  /^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i;

export type NotionQueryOptions = {
  /** Notion API の接続先。未指定なら環境変数 NOTION_API_BASE_URL、それも無ければ SDK 既定。 */
  baseUrl?: string;
};

export type NotionQueryResult = {
  id: string;
  properties: Record<string, unknown>;
};

export type NotionQuerySuccess = {
  dataSourceId: string;
  schema?: Record<string, string>;
  results: NotionQueryResult[];
  nextCursor: string | null;
};

export type NotionQueryErrorBody = {
  error: { code: string; message: string };
  retryAfter?: number;
};

/** 画面にそのまま出せる日本語メッセージ付きのエラー。 */
class RelayError extends Error {
  readonly status: number;
  readonly code: string;
  readonly retryAfter: number | undefined;

  constructor(
    status: number,
    code: string,
    message: string,
    retryAfter?: number,
  ) {
    super(message);
    this.name = 'RelayError';
    this.status = status;
    this.code = code;
    this.retryAfter = retryAfter;
  }
}

const MESSAGES = {
  methodNotAllowed: 'このエンドポイントは POST のみ対応しています。',
  tokenMissing:
    'Notionのトークンが指定されていません。設定画面でインテグレーションのトークンを入力してください。',
  bodyInvalid:
    'リクエストの形式が正しくありません。アプリを再読み込みしてもう一度お試しください。',
  bodyTooLarge: 'リクエストが大きすぎます。',
  databaseIdInvalid:
    'データベースIDの形式が正しくありません。NotionのデータベースのURLまたはIDを確認してください。',
  dataSourceIdInvalid:
    'データソースIDの形式が正しくありません。設定を選び直してください。',
  cursorInvalid:
    'ページ送りの位置が正しくありません。最初から読み込み直してください。',
  unauthorized:
    'Notionのトークンが無効です。インテグレーションのトークンを確認して入力し直してください。',
  forbidden:
    'このデータベースを読み取る権限がありません。インテグレーションに「コンテンツを読み取る」権限があるか確認してください。',
  notFound:
    'データベースが見つかりません。インテグレーションにデータベースを共有しているか確認してください。',
  noDataSource:
    'このデータベースにはデータソースがありません。Notionでデータベースの内容を確認してください。',
  rateLimited:
    'Notionへのリクエストが多すぎます。しばらく待ってからもう一度お試しください。',
  notionRejected:
    'Notionがリクエストを受け付けませんでした。データベースのIDが正しいか確認してください。',
  upstream:
    'Notionで一時的な問題が起きています。しばらく待ってからもう一度お試しください。',
  upstreamTimeout:
    'Notionからの応答がありませんでした。しばらく待ってからもう一度お試しください。',
  upstreamNetwork:
    'Notionに接続できませんでした。ネットワークの状態を確認してもう一度お試しください。',
  internal:
    'サーバーで予期しないエラーが発生しました。しばらく待ってからもう一度お試しください。',
} as const;

function jsonResponse(
  body: NotionQuerySuccess | NotionQueryErrorBody,
  status: number,
  extraHeaders?: Record<string, string>,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      ...extraHeaders,
    },
  });
}

function errorResponse(error: RelayError): Response {
  const body: NotionQueryErrorBody = {
    error: { code: error.code, message: error.message },
  };
  const headers: Record<string, string> = {};
  if (error.retryAfter !== undefined) {
    body.retryAfter = error.retryAfter;
    headers['retry-after'] = String(error.retryAfter);
  }
  if (error.status === 405) {
    headers['allow'] = 'POST';
  }
  return jsonResponse(body, error.status, headers);
}

type ParsedRequest = {
  token: string;
  databaseId: string;
  dataSourceId: string | undefined;
  startCursor: string | undefined;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function invalid(message: string): RelayError {
  return new RelayError(400, 'invalid_request', message);
}

async function parseRequest(request: Request): Promise<ParsedRequest> {
  const token = request.headers.get(NOTION_TOKEN_HEADER)?.trim() ?? '';
  if (token === '') {
    throw invalid(MESSAGES.tokenMissing);
  }

  const declaredLength = Number(request.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    throw invalid(MESSAGES.bodyTooLarge);
  }
  let text: string;
  try {
    text = await request.text();
  } catch {
    throw invalid(MESSAGES.bodyInvalid);
  }
  if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) {
    throw invalid(MESSAGES.bodyTooLarge);
  }

  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw invalid(MESSAGES.bodyInvalid);
  }
  if (!isRecord(json)) {
    throw invalid(MESSAGES.bodyInvalid);
  }

  const { databaseId, dataSourceId, startCursor } = json;
  if (typeof databaseId !== 'string' || !UUID_PATTERN.test(databaseId)) {
    throw invalid(MESSAGES.databaseIdInvalid);
  }
  if (
    dataSourceId !== undefined &&
    dataSourceId !== null &&
    (typeof dataSourceId !== 'string' || !UUID_PATTERN.test(dataSourceId))
  ) {
    throw invalid(MESSAGES.dataSourceIdInvalid);
  }
  if (
    startCursor !== undefined &&
    startCursor !== null &&
    (typeof startCursor !== 'string' || startCursor.length > MAX_CURSOR_LENGTH)
  ) {
    throw invalid(MESSAGES.cursorInvalid);
  }

  return {
    token,
    databaseId,
    dataSourceId: dataSourceId || undefined,
    startCursor: startCursor || undefined,
  };
}

function readHeader(headers: unknown, name: string): string | undefined {
  if (headers instanceof Headers) {
    return headers.get(name) ?? undefined;
  }
  if (isRecord(headers)) {
    for (const [key, value] of Object.entries(headers)) {
      if (key.toLowerCase() === name && typeof value === 'string') {
        return value;
      }
    }
  }
  return undefined;
}

function retryAfterSeconds(headers: unknown): number {
  const raw = readHeader(headers, 'retry-after');
  const seconds = raw === undefined ? NaN : Number.parseInt(raw, 10);
  return Number.isFinite(seconds) && seconds > 0
    ? seconds
    : DEFAULT_RETRY_AFTER_SECONDS;
}

function fromStatus(status: number, headers: unknown): RelayError {
  switch (status) {
    case 401:
      return new RelayError(401, 'unauthorized', MESSAGES.unauthorized);
    case 403:
      return new RelayError(403, 'forbidden', MESSAGES.forbidden);
    case 404:
      return new RelayError(404, 'not_found', MESSAGES.notFound);
    case 429:
      return new RelayError(
        429,
        'rate_limited',
        MESSAGES.rateLimited,
        retryAfterSeconds(headers),
      );
    default:
      return new RelayError(502, 'upstream_error', MESSAGES.upstream);
  }
}

const NETWORK_ERROR_CODE = /^(E[A-Z0-9_]+|UND_ERR\w*)$/;

function isNetworkFailure(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  if (error.name === 'AbortError' || error.name === 'TimeoutError') {
    return true;
  }
  // fetch は接続失敗を TypeError('fetch failed')（cause に errno 系コード）で投げる。
  // Notion の応答が JSON でなかった場合は SyntaxError。どちらも Notion 側の問題として扱う。
  if (error instanceof SyntaxError) {
    return true;
  }
  const cause: unknown = error.cause;
  const causeCode = isRecord(cause) ? cause['code'] : undefined;
  return (
    (error instanceof TypeError && /fetch failed|network/i.test(error.message)) ||
    (typeof causeCode === 'string' && NETWORK_ERROR_CODE.test(causeCode))
  );
}

/** SDK や実行時のエラーを RelayError に写像する。元のメッセージは外に出さない。 */
function toRelayError(error: unknown): RelayError {
  if (error instanceof RelayError) {
    return error;
  }

  if (APIResponseError.isAPIResponseError(error)) {
    switch (error.code) {
      case APIErrorCode.Unauthorized:
        return fromStatus(401, error.headers);
      case APIErrorCode.RestrictedResource:
        return fromStatus(403, error.headers);
      case APIErrorCode.ObjectNotFound:
        return fromStatus(404, error.headers);
      case APIErrorCode.RateLimited:
        return fromStatus(429, error.headers);
      case APIErrorCode.InvalidJSON:
      case APIErrorCode.InvalidRequestURL:
      case APIErrorCode.InvalidRequest:
      case APIErrorCode.ValidationError:
        return invalid(MESSAGES.notionRejected);
      default:
        return fromStatus(error.status, error.headers);
    }
  }

  if (isNotionClientError(error)) {
    if (error.code === ClientErrorCode.RequestTimeout) {
      return new RelayError(502, 'upstream_error', MESSAGES.upstreamTimeout);
    }
    if (error.code === ClientErrorCode.InvalidPathParameter) {
      return invalid(MESSAGES.databaseIdInvalid);
    }
    if (error.code === ClientErrorCode.ResponseError && 'status' in error) {
      return fromStatus(error.status, error.headers);
    }
    return new RelayError(502, 'upstream_error', MESSAGES.upstream);
  }

  if (error instanceof RequestTimeoutError) {
    return new RelayError(502, 'upstream_error', MESSAGES.upstreamTimeout);
  }
  if (isNetworkFailure(error)) {
    return new RelayError(502, 'upstream_error', MESSAGES.upstreamNetwork);
  }
  return new RelayError(500, 'internal_error', MESSAGES.internal);
}

function resolveBaseUrl(options: NotionQueryOptions | undefined): string | undefined {
  const fromOptions = options?.baseUrl;
  if (fromOptions) {
    return fromOptions;
  }
  const fromEnv =
    typeof process !== 'undefined' ? process.env['NOTION_API_BASE_URL'] : undefined;
  return fromEnv || undefined;
}

async function resolveDataSource(
  client: Client,
  databaseId: string,
): Promise<{ dataSourceId: string; schema: Record<string, string> }> {
  const database = await client.databases.retrieve({ database_id: databaseId });
  if (!('data_sources' in database)) {
    // 部分オブジェクト = 内容を読める状態ではない（共有されていない等）
    throw new RelayError(404, 'not_found', MESSAGES.notFound);
  }
  const first = database.data_sources[0];
  if (!first) {
    throw new RelayError(404, 'not_found', MESSAGES.noDataSource);
  }

  const dataSource = await client.dataSources.retrieve({
    data_source_id: first.id,
  });
  const schema: Record<string, string> = {};
  for (const [name, property] of Object.entries(dataSource.properties)) {
    schema[name] = property.type;
  }
  return { dataSourceId: first.id, schema };
}

async function run(
  request: Request,
  options: NotionQueryOptions | undefined,
): Promise<NotionQuerySuccess> {
  const { token, databaseId, dataSourceId, startCursor } =
    await parseRequest(request);

  const baseUrl = resolveBaseUrl(options);
  const client = new Client({
    auth: token,
    timeoutMs: NOTION_TIMEOUT_MS,
    // 429 は自前で retryAfter を返し、再試行はブラウザ側（react-query）に任せる
    retry: false,
    // SDK 既定のロガーは console に出すため、何も出さないものに差し替える
    logger: () => {},
    ...(baseUrl ? { baseUrl } : {}),
  });

  let resolvedId = dataSourceId;
  let schema: Record<string, string> | undefined;
  if (!resolvedId) {
    const resolved = await resolveDataSource(client, databaseId);
    resolvedId = resolved.dataSourceId;
    schema = resolved.schema;
  }

  const response = await client.dataSources.query({
    data_source_id: resolvedId,
    page_size: PAGE_SIZE,
    ...(startCursor ? { start_cursor: startCursor } : {}),
  });

  const results: NotionQueryResult[] = [];
  for (const item of response.results) {
    if (item.object === 'page' && isFullPage(item)) {
      results.push({ id: item.id, properties: item.properties });
    }
  }

  return {
    dataSourceId: resolvedId,
    ...(schema ? { schema } : {}),
    results,
    nextCursor: response.next_cursor ?? null,
  };
}

export async function handleNotionQuery(
  request: Request,
  options?: NotionQueryOptions,
): Promise<Response> {
  if (request.method !== 'POST') {
    return errorResponse(
      new RelayError(405, 'method_not_allowed', MESSAGES.methodNotAllowed),
    );
  }
  try {
    return jsonResponse(await run(request, options), 200);
  } catch (error) {
    // 内容（トークン・本文・Notion の応答）をログに出さないため、ここでは何も記録しない
    return errorResponse(toRelayError(error));
  }
}
