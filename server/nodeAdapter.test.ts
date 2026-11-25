// @vitest-environment node
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { handleNodeRequest, type NodeRequestLike } from './nodeAdapter.js';

let server: Server | undefined;

async function start(
  prepare: (req: NodeRequestLike) => void,
  handler: (request: Request) => Promise<Response>,
): Promise<string> {
  server = createServer((req, res) => {
    prepare(req);
    void handleNodeRequest(req, res, handler);
  });
  await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

afterEach(async () => {
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  server = undefined;
});

const echo = async (request: Request) =>
  Response.json({
    method: request.method,
    url: new URL(request.url).pathname + new URL(request.url).search,
    token: request.headers.get('x-notion-token'),
    body: await request.text(),
  });

describe('handleNodeRequest', () => {
  it('ストリームの本文・ヘッダー・URL を Web の Request に渡し、Response を書き戻す', async () => {
    const base = await start(() => {}, echo);
    const res = await fetch(`${base}/api/notion/query?x=1`, {
      method: 'POST',
      headers: { 'x-notion-token': 't', 'content-type': 'application/json' },
      body: '{"a":"日本語"}',
    });
    expect(await res.json()).toEqual({
      method: 'POST',
      url: '/api/notion/query?x=1',
      token: 't',
      body: '{"a":"日本語"}',
    });
  });

  it('Vercel のようにパース済みの req.body があればそれを使う', async () => {
    const base = await start((req) => {
      req.body = { databaseId: 'x' };
    }, echo);
    const res = await fetch(`${base}/`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{"ignored":true}',
    });
    expect(((await res.json()) as { body: string }).body).toBe('{"databaseId":"x"}');
    // ストリームを読まなくても応答できる（接続を詰まらせない）
  });

  it('GET では本文を付けない', async () => {
    const base = await start(() => {}, echo);
    const res = await fetch(`${base}/`);
    expect(await res.json()).toMatchObject({ method: 'GET', body: '' });
  });

  it('巨大な本文は上限で打ち切る', async () => {
    const base = await start(() => {}, echo);
    const res = await fetch(`${base}/`, { method: 'POST', body: 'x'.repeat(200_000) });
    const { body } = (await res.json()) as { body: string };
    expect(body.length).toBeLessThan(70_000);
  });

  it('ハンドラが例外を投げたら内容を出さずに 500 の JSON を返す', async () => {
    const base = await start(() => {}, async () => {
      throw new Error('secret detail');
    });
    const res = await fetch(`${base}/`, { method: 'POST', body: '{}' });
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(text).not.toContain('secret detail');
    expect(JSON.parse(text).error.code).toBe('internal_error');
  });
});
