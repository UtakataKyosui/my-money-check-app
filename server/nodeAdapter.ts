/**
 * Node の IncomingMessage / ServerResponse（Vercel の VercelRequest / VercelResponse を含む）と
 * Web 標準の Request / Response を相互変換するアダプタ。
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { MAX_BODY_BYTES } from './notionCore.js';

/** Vercel はパース済みの body を `req.body` に載せることがある。 */
export type NodeRequestLike = IncomingMessage & { body?: unknown };

export type WebHandler = (request: Request) => Promise<Response>;

const BODYLESS_METHODS = new Set(['GET', 'HEAD']);

function toHeaders(req: IncomingMessage): Headers {
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    // HTTP/2 の疑似ヘッダー（:method など）は Headers に入れられない
    if (value === undefined || name.startsWith(':')) {
      continue;
    }
    try {
      headers.set(name, Array.isArray(value) ? value.join(', ') : value);
    } catch {
      // 不正なヘッダーは捨てる
    }
  }
  return headers;
}

function toUrl(req: IncomingMessage): string {
  // connect の use(path) は req.url からプレフィックスを外すので originalUrl を優先する
  const original = (req as IncomingMessage & { originalUrl?: string }).originalUrl;
  const path = original ?? req.url ?? '/';
  try {
    return new URL(path, `http://${req.headers.host ?? 'localhost'}`).toString();
  } catch {
    return new URL(path, 'http://localhost').toString();
  }
}

/** ストリームを最大 limit バイトまで読む。超えた分は読み捨てる（呼び出し側が上限超過を判定する）。 */
async function readStream(
  stream: AsyncIterable<unknown>,
  limit: number,
): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let total = 0;
  for await (const chunk of stream) {
    if (total >= limit) {
      continue;
    }
    const bytes =
      typeof chunk === 'string' ? Buffer.from(chunk) : (chunk as Uint8Array);
    chunks.push(bytes);
    total += bytes.byteLength;
  }
  return Buffer.concat(chunks).subarray(0, limit);
}

async function readBody(req: NodeRequestLike): Promise<Uint8Array | undefined> {
  const parsed = req.body;
  if (parsed !== undefined && parsed !== null) {
    if (typeof parsed === 'string') {
      return new TextEncoder().encode(parsed);
    }
    if (parsed instanceof Uint8Array) {
      return parsed;
    }
    return new TextEncoder().encode(JSON.stringify(parsed));
  }
  if (req.readableEnded) {
    return undefined;
  }
  // 上限ちょうどより 1 バイト多く読み、コア側で「大きすぎる」と判定させる
  return readStream(req, MAX_BODY_BYTES + 1);
}

export async function toWebRequest(req: NodeRequestLike): Promise<Request> {
  const method = (req.method ?? 'GET').toUpperCase();
  const headers = toHeaders(req);
  if (BODYLESS_METHODS.has(method)) {
    return new Request(toUrl(req), { method, headers });
  }
  const body = await readBody(req);
  // 本文の長さは実際に読んだ内容で決まるので、元の content-length は使わない
  headers.delete('content-length');
  headers.delete('transfer-encoding');
  return new Request(toUrl(req), {
    method,
    headers,
    ...(body ? { body: body as NonNullable<RequestInit['body']> } : {}),
  });
}

export async function sendWebResponse(
  res: ServerResponse,
  response: Response,
): Promise<void> {
  res.statusCode = response.status;
  response.headers.forEach((value, name) => {
    res.setHeader(name, value);
  });
  const body = Buffer.from(await response.arrayBuffer());
  res.setHeader('content-length', body.byteLength);
  res.end(body);
}

const FALLBACK_BODY = JSON.stringify({
  error: {
    code: 'internal_error',
    message:
      'サーバーで予期しないエラーが発生しました。しばらく待ってからもう一度お試しください。',
  },
});

/** Node 形式のハンドラから Web 標準のハンドラを呼ぶ。例外は内容を出さずに 500 にする。 */
export async function handleNodeRequest(
  req: NodeRequestLike,
  res: ServerResponse,
  handler: WebHandler,
): Promise<void> {
  try {
    await sendWebResponse(res, await handler(await toWebRequest(req)));
  } catch {
    if (!res.headersSent) {
      res.statusCode = 500;
      res.setHeader('content-type', 'application/json; charset=utf-8');
      res.setHeader('cache-control', 'no-store');
      res.end(FALLBACK_BODY);
    } else {
      res.end();
    }
  }
}
