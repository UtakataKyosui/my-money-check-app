// @vitest-environment node
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { handleNotionQuery } from './notionCore.js';

const TOKEN = 'ntn_test_token_SECRET_1234567890';
const DB_ID = '12345678-90ab-cdef-1234-567890abcdef';
const DS_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

type Recorded = { method: string; path: string; auth: string | undefined; body: unknown };
type Reply = { status: number; body: unknown; headers?: Record<string, string> };
type Route = (req: Recorded) => Reply;

let server: Server;
let baseUrl: string;
let route: Route = () => ({ status: 500, body: {} });
let calls: Recorded[] = [];

function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8');
      resolve(text ? JSON.parse(text) : undefined);
    });
  });
}

beforeAll(async () => {
  server = createServer((req, res) => {
    void readBody(req).then((body) => {
      const recorded: Recorded = {
        method: req.method ?? '',
        path: req.url ?? '',
        auth: req.headers.authorization,
        body,
      };
      calls.push(recorded);
      const reply = route(recorded);
      res.statusCode = reply.status;
      res.setHeader('content-type', 'application/json');
      for (const [k, v] of Object.entries(reply.headers ?? {})) res.setHeader(k, v);
      res.end(typeof reply.body === 'string' ? reply.body : JSON.stringify(reply.body));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

afterEach(() => {
  calls = [];
  route = () => ({ status: 500, body: {} });
  vi.restoreAllMocks();
});

const database = {
  object: 'database',
  id: DB_ID,
  data_sources: [
    { id: DS_ID, name: '明細' },
    { id: '11111111-1111-1111-1111-111111111111', name: '別' },
  ],
};
const dataSource = {
  object: 'data_source',
  id: DS_ID,
  properties: {
    お引出し: { id: 'a', name: 'お引出し', type: 'number', number: { format: 'number' } },
    年月日: { id: 'b', name: '年月日', type: 'date', date: {} },
    お取り扱い内容: { id: 'c', name: 'お取り扱い内容', type: 'title', title: {} },
  },
};
const page = (id: string) => ({
  object: 'page',
  id,
  url: `https://www.notion.so/${id}`,
  properties: {
    お引出し: { id: 'a', type: 'number', number: 1200 },
    お取り扱い内容: { id: 'c', type: 'title', title: [{ plain_text: 'コンビニ' }] },
  },
});
const list = (results: unknown[], next: string | null = null) => ({
  object: 'list',
  type: 'page_or_data_source',
  page_or_data_source: {},
  results,
  next_cursor: next,
  has_more: next !== null,
});

function request(
  body: unknown,
  init: { method?: string; token?: string | null; rawBody?: string } = {},
): Request {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (init.token !== null) headers['x-notion-token'] = init.token ?? TOKEN;
  const method = init.method ?? 'POST';
  return new Request('http://localhost/api/notion/query', {
    method,
    headers,
    ...(method === 'GET' || method === 'HEAD'
      ? {}
      : { body: init.rawBody ?? JSON.stringify(body) }),
  });
}

const call = (req: Request) => handleNotionQuery(req, { baseUrl });

describe('handleNotionQuery', () => {
  it('最初の呼び出しでデータソースを解決し、schema と dataSourceId を返す', async () => {
    route = (r) => {
      if (r.path === `/v1/databases/${DB_ID}`) return { status: 200, body: database };
      if (r.path === `/v1/data_sources/${DS_ID}`) return { status: 200, body: dataSource };
      if (r.path === `/v1/data_sources/${DS_ID}/query`) {
        return { status: 200, body: list([page('p1'), page('p2')]) };
      }
      return { status: 500, body: {} };
    };

    const res = await call(request({ databaseId: DB_ID }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      dataSourceId: DS_ID,
      schema: { お引出し: 'number', 年月日: 'date', お取り扱い内容: 'title' },
      results: [
        { id: 'p1', properties: page('p1').properties },
        { id: 'p2', properties: page('p2').properties },
      ],
      nextCursor: null,
    });
    expect(calls.map((c) => c.path)).toEqual([
      `/v1/databases/${DB_ID}`,
      `/v1/data_sources/${DS_ID}`,
      `/v1/data_sources/${DS_ID}/query`,
    ]);
    // ユーザーのトークンで Notion に問い合わせる
    expect(calls.every((c) => c.auth === `Bearer ${TOKEN}`)).toBe(true);
    expect(calls[2]?.body).toMatchObject({ page_size: 100 });
  });

  it('dataSourceId 指定時はクエリのみで schema を返さない', async () => {
    route = () => ({ status: 200, body: list([page('p1')]) });
    const res = await call(request({ databaseId: DB_ID, dataSourceId: DS_ID }));
    expect(res.status).toBe(200);
    const json = (await res.json()) as Record<string, unknown>;
    expect(json).toEqual({
      dataSourceId: DS_ID,
      results: [{ id: 'p1', properties: page('p1').properties }],
      nextCursor: null,
    });
    expect('schema' in json).toBe(false);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.path).toBe(`/v1/data_sources/${DS_ID}/query`);
  });

  it('ページネーション: start_cursor を渡し、nextCursor を返す', async () => {
    route = (r) => {
      const cursor = (r.body as { start_cursor?: string }).start_cursor;
      return cursor === 'cur-1'
        ? { status: 200, body: list([page('p2')], null) }
        : { status: 200, body: list([page('p1')], 'cur-1') };
    };
    const first = (await (
      await call(request({ databaseId: DB_ID, dataSourceId: DS_ID }))
    ).json()) as { nextCursor: string | null };
    expect(first.nextCursor).toBe('cur-1');

    const second = (await (
      await call(request({ databaseId: DB_ID, dataSourceId: DS_ID, startCursor: first.nextCursor }))
    ).json()) as { nextCursor: string | null; results: { id: string }[] };
    expect(second.nextCursor).toBeNull();
    expect(second.results.map((r) => r.id)).toEqual(['p2']);
    expect(calls[1]?.body).toMatchObject({ start_cursor: 'cur-1' });
  });

  it('部分オブジェクトやページ以外は結果から除外する', async () => {
    route = () => ({
      status: 200,
      body: list([
        { object: 'page', id: 'partial' },
        page('full'),
        { object: 'data_source', id: DS_ID },
      ]),
    });
    const json = (await (
      await call(request({ databaseId: DB_ID, dataSourceId: DS_ID }))
    ).json()) as { results: { id: string }[] };
    expect(json.results.map((r) => r.id)).toEqual(['full']);
  });

  it('データソースが 1 つも無ければ 404', async () => {
    route = () => ({ status: 200, body: { ...database, data_sources: [] } });
    const res = await call(request({ databaseId: DB_ID }));
    expect(res.status).toBe(404);
    const json = (await res.json()) as { error: { code: string; message: string } };
    expect(json.error.code).toBe('not_found');
    expect(json.error.message).toContain('データソース');
  });

  it('databaseId はハイフン無しの UUID も受け付ける', async () => {
    route = () => ({ status: 200, body: list([]) });
    const res = await call(
      request({ databaseId: DB_ID.replaceAll('-', ''), dataSourceId: DS_ID }),
    );
    expect(res.status).toBe(200);
  });

  describe('Notion のエラーの写像', () => {
    const cases: Array<{
      name: string;
      reply: Reply;
      status: number;
      code: string;
      message: string;
    }> = [
      {
        name: '401 unauthorized',
        reply: { status: 401, body: { object: 'error', status: 401, code: 'unauthorized', message: 'API token is invalid.' } },
        status: 401,
        code: 'unauthorized',
        message: 'Notionのトークンが無効です',
      },
      {
        name: '403 restricted_resource',
        reply: { status: 403, body: { object: 'error', status: 403, code: 'restricted_resource', message: 'x' } },
        status: 403,
        code: 'forbidden',
        message: '権限',
      },
      {
        name: '404 object_not_found',
        reply: { status: 404, body: { object: 'error', status: 404, code: 'object_not_found', message: 'x' } },
        status: 404,
        code: 'not_found',
        message: 'データベースが見つかりません。インテグレーションにデータベースを共有しているか確認してください',
      },
      {
        name: '400 validation_error',
        reply: { status: 400, body: { object: 'error', status: 400, code: 'validation_error', message: 'x' } },
        status: 400,
        code: 'invalid_request',
        message: 'データベースのIDが正しいか',
      },
      {
        name: '500 internal_server_error',
        reply: { status: 500, body: { object: 'error', status: 500, code: 'internal_server_error', message: 'x' } },
        status: 502,
        code: 'upstream_error',
        message: 'Notionで一時的な問題',
      },
      {
        name: '503 service_unavailable',
        reply: { status: 503, body: { object: 'error', status: 503, code: 'service_unavailable', message: 'x' } },
        status: 502,
        code: 'upstream_error',
        message: 'Notionで一時的な問題',
      },
      {
        name: 'JSON ではない 502',
        reply: { status: 502, body: '<html>Bad Gateway</html>' },
        status: 502,
        code: 'upstream_error',
        message: 'Notionで一時的な問題',
      },
    ];

    it.each(cases)('$name', async ({ reply, status, code, message }) => {
      route = () => reply;
      const res = await call(request({ databaseId: DB_ID }));
      expect(res.status).toBe(status);
      const json = (await res.json()) as { error: { code: string; message: string } };
      expect(json.error.code).toBe(code);
      expect(json.error.message).toContain(message);
      expect(json.error.message).not.toMatch(/invalid|Bad Gateway|API token/i); // 英語の生メッセージを漏らさない
    });

    it('429 rate_limited は retryAfter（秒）を付ける', async () => {
      route = () => ({
        status: 429,
        headers: { 'retry-after': '7' },
        body: { object: 'error', status: 429, code: 'rate_limited', message: 'x' },
      });
      const res = await call(request({ databaseId: DB_ID, dataSourceId: DS_ID }));
      expect(res.status).toBe(429);
      expect(res.headers.get('retry-after')).toBe('7');
      expect(await res.json()).toEqual({
        error: {
          code: 'rate_limited',
          message: 'Notionへのリクエストが多すぎます。しばらく待ってからもう一度お試しください。',
        },
        retryAfter: 7,
      });
      expect(calls).toHaveLength(1); // 中継側では再試行しない
    });

    it('429 で Retry-After が無ければ既定値を付ける', async () => {
      route = () => ({
        status: 429,
        body: { object: 'error', status: 429, code: 'rate_limited', message: 'x' },
      });
      const json = (await (await call(request({ databaseId: DB_ID, dataSourceId: DS_ID }))).json()) as {
        retryAfter: number;
      };
      expect(json.retryAfter).toBeGreaterThan(0);
    });

    it('接続できないときは 502 upstream_error', async () => {
      const res = await handleNotionQuery(request({ databaseId: DB_ID }), {
        baseUrl: 'http://127.0.0.1:1',
      });
      expect(res.status).toBe(502);
      const json = (await res.json()) as { error: { code: string; message: string } };
      expect(json.error.code).toBe('upstream_error');
      expect(json.error.message).toContain('接続できませんでした');
    });
  });

  describe('リクエストの検証', () => {
    it('POST 以外は 405', async () => {
      for (const method of ['GET', 'PUT', 'DELETE']) {
        const res = await call(request({}, { method }));
        expect(res.status).toBe(405);
        expect(res.headers.get('allow')).toBe('POST');
        const json = (await res.json()) as { error: { code: string } };
        expect(json.error.code).toBe('method_not_allowed');
      }
      expect(calls).toHaveLength(0);
    });

    it('トークン未指定・空は 400', async () => {
      for (const token of [null, '', '   ']) {
        const res = await call(request({ databaseId: DB_ID }, { token }));
        expect(res.status).toBe(400);
        const json = (await res.json()) as { error: { code: string; message: string } };
        expect(json.error.code).toBe('invalid_request');
        expect(json.error.message).toContain('トークン');
      }
      expect(calls).toHaveLength(0);
    });

    it.each([
      ['JSON ではない', { rawBody: '{not json' }],
      ['配列', { rawBody: '[]' }],
      ['空ボディ', { rawBody: '' }],
    ])('ボディが %s なら 400', async (_name, init) => {
      const res = await call(request(undefined, init));
      expect(res.status).toBe(400);
      expect(((await res.json()) as { error: { code: string } }).error.code).toBe('invalid_request');
    });

    it.each([
      ['未指定', {}],
      ['数値', { databaseId: 123 }],
      ['UUID でない', { databaseId: 'not-a-uuid' }],
      ['パス操作', { databaseId: '../users/me' }],
      ['dataSourceId が不正', { databaseId: DB_ID, dataSourceId: 'zzz' }],
      ['startCursor が文字列でない', { databaseId: DB_ID, startCursor: 5 }],
    ])('入力が %s なら 400（Notion には送らない）', async (_name, body) => {
      const res = await call(request(body));
      expect(res.status).toBe(400);
      const json = (await res.json()) as { error: { code: string; message: string } };
      expect(json.error.code).toBe('invalid_request');
      expect(json.error.message).toMatch(/[ぁ-ん]/);
      expect(calls).toHaveLength(0);
    });

    it('大きすぎるボディは 400', async () => {
      const res = await call(request({ databaseId: DB_ID, startCursor: 'x'.repeat(70_000) }));
      expect(res.status).toBe(400);
      expect(calls).toHaveLength(0);
    });
  });

  describe('秘匿とキャッシュ', () => {
    it('成功・失敗のどちらでも cache-control: no-store を付ける', async () => {
      route = () => ({ status: 200, body: list([]) });
      const ok = await call(request({ databaseId: DB_ID, dataSourceId: DS_ID }));
      expect(ok.status).toBe(200);
      expect(ok.headers.get('cache-control')).toBe('no-store');
      expect(ok.headers.get('content-type')).toContain('application/json');

      route = () => ({ status: 401, body: { object: 'error', status: 401, code: 'unauthorized', message: 'x' } });
      const ng = await call(request({ databaseId: DB_ID, dataSourceId: DS_ID }));
      expect(ng.headers.get('cache-control')).toBe('no-store');

      const bad = await call(request({}, { token: null }));
      expect(bad.headers.get('cache-control')).toBe('no-store');

      const method = await call(request({}, { method: 'GET' }));
      expect(method.headers.get('cache-control')).toBe('no-store');
    });

    it('トークンやボディをログに出さない', async () => {
      const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) =>
        vi.spyOn(console, m).mockImplementation(() => {}),
      );
      const reply: Reply[] = [
        { status: 200, body: list([page('p1')]) },
        { status: 401, body: { object: 'error', status: 401, code: 'unauthorized', message: 'x' } },
        { status: 429, body: { object: 'error', status: 429, code: 'rate_limited', message: 'x' } },
        { status: 500, body: { object: 'error', status: 500, code: 'internal_server_error', message: 'x' } },
      ];
      for (const r of reply) {
        route = () => r;
        await call(request({ databaseId: DB_ID, dataSourceId: DS_ID }));
      }
      await call(request({ databaseId: 'bad' }));
      await call(request({}, { token: null }));
      await handleNotionQuery(request({ databaseId: DB_ID }), { baseUrl: 'http://127.0.0.1:1' });

      for (const spy of spies) {
        expect(spy).not.toHaveBeenCalled();
      }
    });

    it('レスポンスにトークンを含めない', async () => {
      route = () => ({ status: 401, body: { object: 'error', status: 401, code: 'unauthorized', message: TOKEN } });
      const res = await call(request({ databaseId: DB_ID, dataSourceId: DS_ID }));
      expect(await res.text()).not.toContain(TOKEN);
    });
  });

  it('NOTION_API_BASE_URL 環境変数で接続先を差し替えられる', async () => {
    route = () => ({ status: 200, body: list([]) });
    vi.stubEnv('NOTION_API_BASE_URL', baseUrl);
    try {
      const res = await handleNotionQuery(request({ databaseId: DB_ID, dataSourceId: DS_ID }));
      expect(res.status).toBe(200);
      expect(calls).toHaveLength(1);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
