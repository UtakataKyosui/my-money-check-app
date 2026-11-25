import { describe, expect, it, vi } from 'vitest';
import { fetchNotionDatabase } from './fetchNotionDatabase';
import { NotionError } from './types';
import { bankRow, cardRow, num, rich } from './testHelpers';

const TOKEN = 'secret_TOKEN_abc123XYZ';
const DB = '01234567-89ab-cdef-0123-456789abcdef';
const BANK_SCHEMA = { お取り扱い内容: 'title', 年月日: 'date', お引出し: 'number', お預入れ: 'number', 残高: 'number' };
const CARD_SCHEMA = { '利用店名・商品名': 'title', 利用日: 'date', 利用金額: 'number', 支払い月: 'rich_text', 今回支払金額: 'number' };

type Handler = (body: Record<string, unknown>, init: RequestInit, call: number) => Response | Promise<Response>;

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
}

function makeFetch(handler: Handler) {
  const calls: { url: string; init: RequestInit; body: Record<string, unknown> }[] = [];
  const impl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    calls.push({ url: String(input), init: init ?? {}, body });
    return handler(body, init ?? {}, calls.length);
  });
  return { impl: impl as unknown as typeof fetch, calls };
}

const noSleep = () => vi.fn(async () => undefined);

async function rejection(p: Promise<unknown>): Promise<unknown> {
  try {
    await p;
  } catch (e) {
    return e;
  }
  throw new Error('expected rejection');
}

describe('fetchNotionDatabase', () => {
  it('ページネーションで全行を取得し、銀行の ParsedFile にする', async () => {
    const pages = [
      [bankRow({ id: 'a', desc: 'A', date: '2026-11-02', out: 100 }), bankRow({ id: 'b', desc: 'B', date: '2026-11-01', out: 200 })],
      [bankRow({ id: 'c', desc: 'C', date: '2026-11-03', inn: 300 })],
      [bankRow({ id: 'd', desc: 'D', date: '2026-11-04', out: 400 })],
    ];
    const { impl, calls } = makeFetch((body) => {
      if (body.dataSourceId === undefined) {
        return json(200, { dataSourceId: 'ds1', schema: BANK_SCHEMA, results: pages[0], nextCursor: 'c1' });
      }
      return body.startCursor === 'c1'
        ? json(200, { dataSourceId: 'ds1', results: pages[1], nextCursor: 'c2' })
        : json(200, { dataSourceId: 'ds1', results: pages[2], nextCursor: null });
    });
    const progress: number[] = [];
    const r = await fetchNotionDatabase({
      token: TOKEN,
      databaseId: DB,
      kind: 'bank',
      fetchImpl: impl,
      onProgress: (n) => progress.push(n),
    });
    expect(r.rowCount).toBe(4);
    expect(progress).toEqual([2, 3, 4]);
    expect(r.files).toHaveLength(1);
    expect(r.files[0]?.fileName).toBe('Notion（三井住友銀行）');
    expect(r.files[0]?.transactions.map((t) => t.id)).toEqual(['notion:b', 'notion:a', 'notion:c', 'notion:d']);

    expect(calls).toHaveLength(3);
    expect(calls.map((c) => c.body)).toEqual([
      { databaseId: DB },
      { databaseId: DB, dataSourceId: 'ds1', startCursor: 'c1' },
      { databaseId: DB, dataSourceId: 'ds1', startCursor: 'c2' },
    ]);
    for (const c of calls) {
      expect(c.url).toBe('/api/notion/query');
      expect(c.init.method).toBe('POST');
      expect(c.init.headers).toEqual({ 'content-type': 'application/json', 'x-notion-token': TOKEN });
    }
  });

  it('endpoint を差し替えられる', async () => {
    const { impl, calls } = makeFetch(() => json(200, { dataSourceId: 'ds', schema: BANK_SCHEMA, results: [], nextCursor: null }));
    await fetchNotionDatabase({ token: TOKEN, databaseId: DB, kind: 'bank', fetchImpl: impl, endpoint: 'https://x.test/q' });
    expect(calls[0]?.url).toBe('https://x.test/q');
  });

  it('カードは支払い月ごとのファイルに分かれる', async () => {
    const { impl } = makeFetch(() =>
      json(200, {
        dataSourceId: 'ds',
        schema: CARD_SCHEMA,
        results: [
          cardRow({ desc: 'a', date: '2026-10-01', usage: 100, month: rich('2026-11'), pay: num(100) }),
          cardRow({ desc: 'b', date: '2026-10-02', usage: 200 }),
        ],
        nextCursor: null,
      }),
    );
    const r = await fetchNotionDatabase({ token: TOKEN, databaseId: DB, kind: 'card', fetchImpl: impl });
    expect(r.rowCount).toBe(2);
    expect(r.files.map((f) => [f.fileName, f.paymentMonth, f.paymentTotal])).toEqual([
      ['Notion（楽天カード・2026-11払い）', '2026-11', 100],
      ['Notion（楽天カード）', undefined, undefined],
    ]);
  });

  it('空のデータベース（銀行は空ファイル、カードは0件）', async () => {
    const mk = (schema: Record<string, string>) =>
      makeFetch(() => json(200, { dataSourceId: 'ds', schema, results: [], nextCursor: null })).impl;
    const bank = await fetchNotionDatabase({ token: TOKEN, databaseId: DB, kind: 'bank', fetchImpl: mk(BANK_SCHEMA) });
    expect(bank.rowCount).toBe(0);
    expect(bank.files[0]?.transactions).toEqual([]);
    const cardR = await fetchNotionDatabase({ token: TOKEN, databaseId: DB, kind: 'card', fetchImpl: mk(CARD_SCHEMA) });
    expect(cardR).toEqual({ files: [], rowCount: 0 });
  });

  describe('schema_mismatch', () => {
    it('行を取得せずに投げる（以降の呼び出しをしない）', async () => {
      const { impl, calls } = makeFetch(() =>
        json(200, {
          dataSourceId: 'ds',
          schema: { お取り扱い内容: 'title', 年月日: 'rich_text' },
          results: [bankRow({ desc: 'A', date: '2026-11-01', out: 1 })],
          nextCursor: 'more',
        }),
      );
      const progress = vi.fn();
      const e = await rejection(
        fetchNotionDatabase({ token: TOKEN, databaseId: DB, kind: 'bank', fetchImpl: impl, onProgress: progress }),
      );
      expect(e).toBeInstanceOf(NotionError);
      const err = e as NotionError;
      expect(err.code).toBe('schema_mismatch');
      expect(err.details).toEqual([
        '『年月日』は日付型である必要がありますが、現在は「テキスト」です。',
        '『お引出し』プロパティ（数値型）がありません。',
        '『お預入れ』プロパティ（数値型）がありません。',
      ]);
      expect(err.message).toContain('形式が合っていません');
      expect(err.message).toContain('3件');
      expect(calls).toHaveLength(1);
      expect(progress).not.toHaveBeenCalled();
    });

    it('schema が返らなければ検証しない', async () => {
      const { impl } = makeFetch(() => json(200, { dataSourceId: 'ds', results: [], nextCursor: null }));
      const r = await fetchNotionDatabase({ token: TOKEN, databaseId: DB, kind: 'bank', fetchImpl: impl });
      expect(r.rowCount).toBe(0);
    });
  });

  describe('429 の再試行', () => {
    const okBody = { dataSourceId: 'ds', schema: BANK_SCHEMA, results: [], nextCursor: null };

    it('retryAfter 秒待って再試行する', async () => {
      const sleep = noSleep();
      const { impl, calls } = makeFetch((_b, _i, n) =>
        n < 3
          ? json(429, { error: { code: 'rate_limited', message: '混み合っています。' }, retryAfter: 2 })
          : json(200, okBody),
      );
      const r = await fetchNotionDatabase({ token: TOKEN, databaseId: DB, kind: 'bank', fetchImpl: impl, sleep });
      expect(r.rowCount).toBe(0);
      expect(calls).toHaveLength(3);
      expect(sleep.mock.calls).toEqual([[2000], [2000]]);
    });

    it('retryAfter は最大10秒、無ければ1秒', async () => {
      const sleep = noSleep();
      const { impl } = makeFetch((_b, _i, n) =>
        n === 1
          ? json(429, { error: { code: 'rate_limited', message: 'x' }, retryAfter: 99 })
          : n === 2
            ? json(429, { error: { code: 'rate_limited', message: 'x' } })
            : json(200, okBody),
      );
      await fetchNotionDatabase({ token: TOKEN, databaseId: DB, kind: 'bank', fetchImpl: impl, sleep });
      expect(sleep.mock.calls).toEqual([[10000], [1000]]);
    });

    it('3回再試行しても 429 なら rate_limited（計4回）', async () => {
      const sleep = noSleep();
      const { impl, calls } = makeFetch(() =>
        json(429, { error: { code: 'rate_limited', message: 'しばらくお待ちください。' }, retryAfter: 3 }),
      );
      const err = (await rejection(
        fetchNotionDatabase({ token: TOKEN, databaseId: DB, kind: 'bank', fetchImpl: impl, sleep }),
      )) as NotionError;
      expect(err.code).toBe('rate_limited');
      expect(err.status).toBe(429);
      expect(err.retryAfter).toBe(3);
      expect(err.message).toBe('しばらくお待ちください。');
      expect(calls).toHaveLength(4);
      expect(sleep).toHaveBeenCalledTimes(3);
    });

    it('2ページ目の 429 でも再試行して続きから取得する', async () => {
      const sleep = noSleep();
      let secondTries = 0;
      const { impl, calls } = makeFetch((body) => {
        if (body.dataSourceId === undefined) {
          return json(200, { dataSourceId: 'ds', schema: BANK_SCHEMA, results: [bankRow({ desc: 'a', date: '2026-11-01', out: 1 })], nextCursor: 'c' });
        }
        secondTries += 1;
        return secondTries === 1
          ? json(429, { error: { code: 'rate_limited', message: 'x' }, retryAfter: 1 })
          : json(200, { dataSourceId: 'ds', results: [bankRow({ desc: 'b', date: '2026-11-02', out: 1 })], nextCursor: null });
      });
      const r = await fetchNotionDatabase({ token: TOKEN, databaseId: DB, kind: 'bank', fetchImpl: impl, sleep });
      expect(r.rowCount).toBe(2);
      expect(calls.map((c) => c.body.startCursor)).toEqual([undefined, 'c', 'c']);
    });
  });

  describe('HTTP エラーの写像', () => {
    it.each([
      [400, 'invalid_request'],
      [401, 'unauthorized'],
      [403, 'forbidden'],
      [404, 'not_found'],
      [405, 'method_not_allowed'],
      [500, 'internal_error'],
      [502, 'upstream_error'],
    ] as const)('%i -> %s（サーバーの日本語メッセージをそのまま使う）', async (status, code) => {
      const { impl, calls } = makeFetch(() => json(status, { error: { code, message: `メッセージ${status}` } }));
      const err = (await rejection(
        fetchNotionDatabase({ token: TOKEN, databaseId: DB, kind: 'bank', fetchImpl: impl, sleep: noSleep() }),
      )) as NotionError;
      expect(err).toBeInstanceOf(NotionError);
      expect(err.code).toBe(code);
      expect(err.status).toBe(status);
      expect(err.message).toBe(`メッセージ${status}`);
      expect(calls).toHaveLength(1);
    });

    it('JSON でない本文はステータスから推定する', async () => {
      const { impl } = makeFetch(() => new Response('<html>Not Found</html>', { status: 404 }));
      const err = (await rejection(
        fetchNotionDatabase({ token: TOKEN, databaseId: DB, kind: 'bank', fetchImpl: impl }),
      )) as NotionError;
      expect(err.code).toBe('not_found');
      expect(err.message).toContain('/api/notion/query');
      expect(err.message).not.toContain('html');
    });

    it('未知のコードやステータス 503 は妥当なコードにする', async () => {
      const { impl } = makeFetch(() => json(503, { error: { code: 'weird', message: '停止中' } }));
      const err = (await rejection(
        fetchNotionDatabase({ token: TOKEN, databaseId: DB, kind: 'bank', fetchImpl: impl }),
      )) as NotionError;
      expect(err.code).toBe('internal_error');
      expect(err.message).toBe('停止中');
    });

    it('サーバーのメッセージにトークンが含まれていても伏せる', async () => {
      const { impl } = makeFetch(() => json(401, { error: { code: 'unauthorized', message: `トークン ${TOKEN} は無効です。` } }));
      const err = (await rejection(
        fetchNotionDatabase({ token: TOKEN, databaseId: DB, kind: 'bank', fetchImpl: impl }),
      )) as NotionError;
      expect(err.message).not.toContain(TOKEN);
      expect(err.message).toContain('無効です');
    });

    it('2ページ目以降のエラーも写像される', async () => {
      const { impl } = makeFetch((body) =>
        body.dataSourceId === undefined
          ? json(200, { dataSourceId: 'ds', schema: BANK_SCHEMA, results: [], nextCursor: 'c' })
          : json(502, { error: { code: 'upstream_error', message: 'Notion が応答しません。' } }),
      );
      const err = (await rejection(
        fetchNotionDatabase({ token: TOKEN, databaseId: DB, kind: 'bank', fetchImpl: impl }),
      )) as NotionError;
      expect(err.code).toBe('upstream_error');
    });
  });

  describe('ネットワーク・応答の異常', () => {
    it('fetch の失敗は network_error（日本語・トークンなし）', async () => {
      const impl = vi.fn(async () => {
        throw new TypeError(`Failed to fetch ${TOKEN}`);
      }) as unknown as typeof fetch;
      const err = (await rejection(
        fetchNotionDatabase({ token: TOKEN, databaseId: DB, kind: 'bank', fetchImpl: impl }),
      )) as NotionError;
      expect(err.code).toBe('network_error');
      expect(err.message).toContain('接続できませんでした');
      expect(err.message).not.toContain(TOKEN);
    });

    it('200 でも JSON が壊れていれば upstream_error', async () => {
      const { impl } = makeFetch(() => new Response('not json', { status: 200 }));
      const err = (await rejection(
        fetchNotionDatabase({ token: TOKEN, databaseId: DB, kind: 'bank', fetchImpl: impl }),
      )) as NotionError;
      expect(err.code).toBe('upstream_error');
    });

    it('形が違う応答は upstream_error', async () => {
      for (const body of [{}, { dataSourceId: 'x', results: 'no', nextCursor: null }, { dataSourceId: 'x', results: [{ id: 1 }], nextCursor: null }, [] ]) {
        const { impl } = makeFetch(() => json(200, body));
        const err = (await rejection(
          fetchNotionDatabase({ token: TOKEN, databaseId: DB, kind: 'bank', fetchImpl: impl }),
        )) as NotionError;
        expect(err.code).toBe('upstream_error');
      }
    });

    it('nextCursor が進まない応答で無限ループしない', async () => {
      const { impl, calls } = makeFetch(() =>
        json(200, { dataSourceId: 'ds', schema: BANK_SCHEMA, results: [], nextCursor: 'same' }),
      );
      const err = (await rejection(
        fetchNotionDatabase({ token: TOKEN, databaseId: DB, kind: 'bank', fetchImpl: impl }),
      )) as NotionError;
      expect(err.code).toBe('upstream_error');
      expect(calls.length).toBeLessThanOrEqual(3);
    });
  });

  describe('abort', () => {
    it('開始前に abort 済みなら fetch せず AbortError を伝播する', async () => {
      const ac = new AbortController();
      ac.abort();
      const { impl, calls } = makeFetch(() => json(200, {}));
      const e = await rejection(fetchNotionDatabase({ token: TOKEN, databaseId: DB, kind: 'bank', fetchImpl: impl, signal: ac.signal }));
      expect(e).not.toBeInstanceOf(NotionError);
      expect((e as Error).name).toBe('AbortError');
      expect(calls).toHaveLength(0);
    });

    it('取得途中の abort は NotionError にせずそのまま伝播する', async () => {
      const ac = new AbortController();
      const impl = vi.fn(async (_u: RequestInfo | URL, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        if (body.dataSourceId === undefined) {
          return json(200, { dataSourceId: 'ds', schema: BANK_SCHEMA, results: [], nextCursor: 'c' });
        }
        ac.abort();
        throw new DOMException('aborted', 'AbortError');
      }) as unknown as typeof fetch;
      const e = await rejection(fetchNotionDatabase({ token: TOKEN, databaseId: DB, kind: 'bank', fetchImpl: impl, signal: ac.signal }));
      expect(e).not.toBeInstanceOf(NotionError);
      expect((e as Error).name).toBe('AbortError');
    });

    it('signal を fetch に渡す', async () => {
      const ac = new AbortController();
      const { impl, calls } = makeFetch(() => json(200, { dataSourceId: 'ds', schema: BANK_SCHEMA, results: [], nextCursor: null }));
      await fetchNotionDatabase({ token: TOKEN, databaseId: DB, kind: 'bank', fetchImpl: impl, signal: ac.signal });
      expect(calls[0]?.init.signal).toBe(ac.signal);
    });

    it('再試行の待機中に abort すると中断する', async () => {
      const ac = new AbortController();
      const { impl, calls } = makeFetch(() => json(429, { error: { code: 'rate_limited', message: 'x' }, retryAfter: 5 }));
      const p = fetchNotionDatabase({ token: TOKEN, databaseId: DB, kind: 'bank', fetchImpl: impl, signal: ac.signal });
      setTimeout(() => ac.abort(), 10);
      const e = await rejection(p);
      expect((e as Error).name).toBe('AbortError');
      expect(calls).toHaveLength(1);
    });
  });

  describe('too_many_rows', () => {
    it('20000行を超えたら too_many_rows で止まる', async () => {
      const chunk = Array.from({ length: 10000 }, (_, i) => ({ id: `p${i}`, properties: {} }));
      let n = 0;
      const { impl, calls } = makeFetch(() => {
        n += 1;
        return json(200, { dataSourceId: 'ds', schema: BANK_SCHEMA, results: chunk, nextCursor: `c${n}` });
      });
      const progress = vi.fn();
      const err = (await rejection(
        fetchNotionDatabase({ token: TOKEN, databaseId: DB, kind: 'bank', fetchImpl: impl, onProgress: progress }),
      )) as NotionError;
      expect(err.code).toBe('too_many_rows');
      expect(err.message).toContain('20,000');
      expect(calls).toHaveLength(3);
    });

    it('ちょうど20000行は取り込める', async () => {
      const chunk = Array.from({ length: 10000 }, (_, i) => ({ id: `p${i}`, properties: {} }));
      const { impl } = makeFetch((body) =>
        body.startCursor === undefined
          ? json(200, { dataSourceId: 'ds', schema: BANK_SCHEMA, results: chunk, nextCursor: 'c' })
          : json(200, { dataSourceId: 'ds', results: chunk.map((c) => ({ ...c, id: `q${c.id}` })), nextCursor: null }),
      );
      const r = await fetchNotionDatabase({ token: TOKEN, databaseId: DB, kind: 'bank', fetchImpl: impl });
      expect(r.rowCount).toBe(20000);
    });
  });

  describe('トークンの扱い', () => {
    it('どのエラーのメッセージ・details にもトークンが含まれない', async () => {
      const scenarios: Handler[] = [
        () => json(401, { error: { code: 'unauthorized', message: 'トークンが無効です。' } }),
        () => json(200, { dataSourceId: 'ds', schema: {}, results: [], nextCursor: null }),
        () => new Response('x', { status: 500 }),
        () => {
          throw new Error(`boom ${TOKEN}`);
        },
      ];
      for (const h of scenarios) {
        const { impl } = makeFetch(h);
        const err = (await rejection(
          fetchNotionDatabase({ token: TOKEN, databaseId: DB, kind: 'bank', fetchImpl: impl }),
        )) as NotionError;
        expect(err.message).not.toContain(TOKEN);
        expect(JSON.stringify(err.details ?? [])).not.toContain(TOKEN);
        expect(JSON.stringify(err)).not.toContain(TOKEN);
      }
    });

    it('console にトークンを出さない', async () => {
      const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => undefined));
      const { impl } = makeFetch(() => json(401, { error: { code: 'unauthorized', message: 'x' } }));
      await rejection(fetchNotionDatabase({ token: TOKEN, databaseId: DB, kind: 'bank', fetchImpl: impl }));
      for (const s of spies) {
        expect(JSON.stringify(s.mock.calls)).not.toContain(TOKEN);
        s.mockRestore();
      }
    });
  });

  it('fetchImpl を省略するとグローバル fetch を使う', async () => {
    const spy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(json(200, { dataSourceId: 'ds', schema: BANK_SCHEMA, results: [], nextCursor: null }));
    try {
      const r = await fetchNotionDatabase({ token: TOKEN, databaseId: DB, kind: 'bank' });
      expect(r.rowCount).toBe(0);
      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy.mock.calls[0]?.[0]).toBe('/api/notion/query');
    } finally {
      spy.mockRestore();
    }
  });
});
