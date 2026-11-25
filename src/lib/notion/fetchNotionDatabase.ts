import type { ParsedFile } from '../../types';
import { pagesToBankFile } from './mapBank';
import { pagesToCardFiles } from './mapCard';
import { validateSchema } from './validateSchema';
import { NOTION_ERROR_CODES, NotionError, type NotionErrorCode, type NotionPage, type NotionQueryResponse } from './types';

export const DEFAULT_ENDPOINT = '/api/notion/query';
export const MAX_ROWS = 20000;
const MAX_RETRIES = 3;
const DEFAULT_RETRY_SECONDS = 1;
const MAX_RETRY_SECONDS = 10;

export interface FetchNotionArgs {
  token: string;
  databaseId: string;
  kind: 'bank' | 'card';
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
  endpoint?: string;
  /** 取得済みの累積行数 */
  onProgress?: (rows: number) => void;
  /** 待機（テスト用に差し替え可能） */
  sleep?: (ms: number) => Promise<void>;
}

function defaultSleep(signal?: AbortSignal): (ms: number) => Promise<void> {
  return (ms) =>
    new Promise<void>((resolve, reject) => {
      if (signal?.aborted) {
        reject(signal.reason);
        return;
      }
      const onAbort = () => {
        clearTimeout(timer);
        reject(signal?.reason);
      };
      const timer = setTimeout(() => {
        signal?.removeEventListener('abort', onAbort);
        resolve();
      }, ms);
      signal?.addEventListener('abort', onAbort, { once: true });
    });
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isAbort(e: unknown, signal?: AbortSignal): boolean {
  return signal?.aborted === true || (isRecord(e) && e.name === 'AbortError');
}

/** 文字列からトークンを伏せる（念のため）。 */
function redact(text: string, token: string): string {
  const t = token.trim();
  return t === '' ? text : text.split(t).join('***');
}

function codeFromStatus(status: number): NotionErrorCode {
  switch (status) {
    case 400:
      return 'invalid_request';
    case 401:
      return 'unauthorized';
    case 403:
      return 'forbidden';
    case 404:
      return 'not_found';
    case 405:
      return 'method_not_allowed';
    case 429:
      return 'rate_limited';
    case 502:
      return 'upstream_error';
    default:
      return status >= 500 ? 'internal_error' : 'invalid_request';
  }
}

function fallbackMessage(status: number): string {
  switch (status) {
    case 404:
      return '中継サーバー（/api/notion/query）が見つかりません。サーバーが起動しているか確認してください。';
    case 429:
      return 'Notion のリクエスト制限に達しました。しばらく待ってからもう一度お試しください。';
    default:
      return `中継サーバーからエラー応答がありました（HTTP ${status}）。`;
  }
}

function retryAfterSeconds(body: unknown, res: Response): number | undefined {
  if (isRecord(body) && typeof body.retryAfter === 'number' && Number.isFinite(body.retryAfter) && body.retryAfter >= 0) {
    return body.retryAfter;
  }
  const header = Number(res.headers?.get?.('retry-after'));
  return Number.isFinite(header) && header >= 0 && res.headers?.get?.('retry-after') ? header : undefined;
}

async function errorFromResponse(res: Response, token: string): Promise<NotionError> {
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    body = undefined;
  }
  const err = isRecord(body) && isRecord(body.error) ? body.error : undefined;
  const code =
    err && typeof err.code === 'string' && (NOTION_ERROR_CODES as readonly string[]).includes(err.code)
      ? (err.code as NotionErrorCode)
      : codeFromStatus(res.status);
  const message =
    err && typeof err.message === 'string' && err.message.trim() !== ''
      ? redact(err.message, token)
      : fallbackMessage(res.status);
  return new NotionError(code, message, { status: res.status, retryAfter: retryAfterSeconds(body, res) });
}

function parseResponse(body: unknown, status: number): NotionQueryResponse {
  const bad = () =>
    new NotionError('upstream_error', '中継サーバーの応答の形式が正しくありません。', { status });
  if (!isRecord(body) || typeof body.dataSourceId !== 'string' || !Array.isArray(body.results)) throw bad();
  const nextCursor = body.nextCursor ?? null;
  if (nextCursor !== null && typeof nextCursor !== 'string') throw bad();
  const results: NotionPage[] = [];
  for (const r of body.results) {
    if (!isRecord(r) || typeof r.id !== 'string' || !isRecord(r.properties)) throw bad();
    results.push({ id: r.id, properties: r.properties });
  }
  let schema: Record<string, string> | undefined;
  if (body.schema !== undefined && body.schema !== null) {
    if (!isRecord(body.schema)) throw bad();
    schema = {};
    for (const [k, v] of Object.entries(body.schema)) {
      if (typeof v === 'string') schema[k] = v;
    }
  }
  return { dataSourceId: body.dataSourceId, schema, results, nextCursor };
}

/**
 * Notion のデータベースの全行を中継関数経由で取得し、CSVと同じ形の ParsedFile に変換する。
 * rowCount は Notion から受け取った行（ページ）数。
 */
export async function fetchNotionDatabase(args: FetchNotionArgs): Promise<{ files: ParsedFile[]; rowCount: number }> {
  const { token, databaseId, kind, signal, onProgress } = args;
  const endpoint = args.endpoint ?? DEFAULT_ENDPOINT;
  const doFetch: typeof fetch = args.fetchImpl ?? ((input, init) => globalThis.fetch(input, init));
  const sleep = args.sleep ?? defaultSleep(signal);

  const request = async (body: Record<string, string>): Promise<NotionQueryResponse> => {
    for (let attempt = 0; ; attempt++) {
      signal?.throwIfAborted();
      let res: Response;
      try {
        res = await doFetch(endpoint, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-notion-token': token },
          body: JSON.stringify(body),
          signal,
        });
      } catch (e) {
        if (isAbort(e, signal)) throw e;
        throw new NotionError(
          'network_error',
          '中継サーバーに接続できませんでした。ネットワーク接続とサーバーの状態を確認してください。',
        );
      }

      if (!res.ok) {
        const err = await errorFromResponse(res, token);
        if (err.code === 'rate_limited' && attempt < MAX_RETRIES) {
          const seconds = Math.min(err.retryAfter ?? DEFAULT_RETRY_SECONDS, MAX_RETRY_SECONDS);
          await sleep(seconds * 1000);
          continue;
        }
        throw err;
      }

      let json: unknown;
      try {
        json = await res.json();
      } catch (e) {
        if (isAbort(e, signal)) throw e;
        throw new NotionError('upstream_error', '中継サーバーの応答を読み取れませんでした。', { status: res.status });
      }
      return parseResponse(json, res.status);
    }
  };

  const pages: NotionPage[] = [];
  let dataSourceId: string | undefined;
  let cursor: string | undefined;

  for (;;) {
    const body: Record<string, string> = { databaseId };
    if (dataSourceId !== undefined) body.dataSourceId = dataSourceId;
    if (cursor !== undefined) body.startCursor = cursor;
    const first = dataSourceId === undefined;

    const res = await request(body);

    if (first && res.schema) {
      const v = validateSchema(kind, res.schema);
      if (!v.ok) {
        throw new NotionError(
          'schema_mismatch',
          `Notion のデータベースの形式が合っていません（${v.errors.length}件）。${v.errors[0]}`,
          { details: v.errors },
        );
      }
    }
    dataSourceId = res.dataSourceId;

    pages.push(...res.results);
    if (pages.length > MAX_ROWS) {
      throw new NotionError(
        'too_many_rows',
        `行数が多すぎるため取り込めません（上限は${MAX_ROWS.toLocaleString('ja-JP')}行）。データベースを分けるか、古い行を別のデータベースに移してください。`,
      );
    }
    onProgress?.(pages.length);

    if (res.nextCursor === null) break;
    if (res.nextCursor === cursor) {
      throw new NotionError('upstream_error', '中継サーバーの応答が正しくありません（続きの位置が進みません）。');
    }
    cursor = res.nextCursor;
  }

  const files = kind === 'bank' ? [pagesToBankFile(pages)] : pagesToCardFiles(pages);
  return { files, rowCount: pages.length };
}
