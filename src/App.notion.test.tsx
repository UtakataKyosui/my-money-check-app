import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import { createQueryClient } from './hooks/queryClient';
import { DATA_SOURCE_STORAGE_KEY } from './hooks/useDataSource';
import { NOTION_CONFIG_KEY, NOTION_SPECS, NOTION_TOKEN_KEY } from './lib/notion';

type User = ReturnType<typeof userEvent.setup>;

const TOKEN = 'secret_test_token_0123456789';
const BANK_HEX = '0123456789abcdef0123456789abcdef';
const CARD_HEX = 'fedcba9876543210fedcba9876543210';
const BANK_ID = '01234567-89ab-cdef-0123-456789abcdef';
const CARD_ID = 'fedcba98-7654-3210-fedc-ba9876543210';
const BANK_URL = `https://www.notion.so/workspace/${BANK_HEX}?v=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa`;
const CARD_URL = `https://www.notion.so/workspace/Card-${CARD_HEX}`;

/* ---- 中継関数（/api/notion/query）の契約どおりのレスポンスを返す fetch のモック ---- */

type Props = Record<string, unknown>;
interface Page {
  id: string;
  properties: Props;
}

const title = (s: string): Props => ({ id: 't', type: 'title', title: [{ type: 'text', plain_text: s }] });
const dateP = (s: string | null): Props => ({
  id: 'd',
  type: 'date',
  date: s === null ? null : { start: s, end: null, time_zone: null },
});
const numP = (n: number | null): Props => ({ id: 'n', type: 'number', number: n });
const richP = (s = ''): Props => ({ id: 'r', type: 'rich_text', rich_text: s ? [{ type: 'text', plain_text: s }] : [] });

let seq = 0;
const page = (properties: Props): Page => ({ id: `page-${++seq}`, properties });

const BANK_SCHEMA = {
  お取り扱い内容: 'title',
  年月日: 'date',
  お引出し: 'number',
  お預入れ: 'number',
  残高: 'number',
  メモ: 'rich_text',
  ラベル: 'rich_text',
};
const CARD_SCHEMA = {
  '利用店名・商品名': 'title',
  利用日: 'date',
  利用金額: 'number',
  '手数料/利息': 'number',
  支払総額: 'number',
  利用者: 'rich_text',
  支払方法: 'rich_text',
  支払い月: 'rich_text',
  今回支払金額: 'number',
};

function bankRow(desc: string, date: string | null, out: number | null, inn: number | null, balance: number | null): Page {
  return page({
    お取り扱い内容: title(desc),
    年月日: dateP(date),
    お引出し: numP(out),
    お預入れ: numP(inn),
    残高: numP(balance),
    メモ: richP(),
    ラベル: richP(),
  });
}

function cardRow(desc: string, date: string, usage: number, pay: number): Page {
  return page({
    '利用店名・商品名': title(desc),
    利用日: dateP(date),
    利用金額: numP(usage),
    '手数料/利息': numP(0),
    支払総額: numP(null),
    利用者: richP('本人'),
    支払方法: richP('1回'),
    支払い月: richP('2026-11'),
    今回支払金額: numP(pay),
  });
}

/** 銀行: 2ページ（3行）+ 日付のない行1つ（読み飛ばして警告）。収入280,000円・支出35,400円 */
const BANK_PAGES: Page[][] = [
  [bankRow('給与', '2026-11-05', null, 280000, 618590), bankRow('ガス料金', '2026-11-12', 5400, null, 613190)],
  [bankRow('ATM出金', '2026-11-20', 30000, null, 583190), bankRow('日付なしの行', null, 100, null, null)],
];
/** カード: 2026-11払いの2行。支出 8,240 + 15,000 = 23,240円（今回支払金額も同額） */
const CARD_PAGES: Page[][] = [[cardRow('スーパーマルエー', '2026-11-02', 8240, 8240), cardRow('鉄道会社 定期券', '2026-11-06', 15000, 15000)]];

interface RelayDb {
  schema: Record<string, string>;
  pages: Page[][];
  /** 指定すると、そのHTTPエラーを返す */
  error?: { status: number; code: string; message: string; retryAfter?: number };
  /** 2ページ目以降は、この Promise が解決するまで待つ */
  gate?: Promise<void>;
}

interface RelayCall {
  url: string;
  method: string | undefined;
  token: string | null;
  body: { databaseId: string; dataSourceId?: string; startCursor?: string };
  signal: AbortSignal | null | undefined;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function createRelay(dbs: Record<string, RelayDb>) {
  const calls: RelayCall[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    const body = JSON.parse(String(init?.body)) as RelayCall['body'];
    calls.push({ url: String(input), method: init?.method, token: headers.get('x-notion-token'), body, signal: init?.signal });
    const db = dbs[body.databaseId];
    if (!db) return json({ error: { code: 'not_found', message: 'データベースが見つかりません。' } }, 404);
    if (db.error) {
      return json(
        { error: { code: db.error.code, message: db.error.message }, ...(db.error.retryAfter ? { retryAfter: db.error.retryAfter } : {}) },
        db.error.status,
      );
    }
    const index = body.startCursor ? Number(body.startCursor.slice(1)) : 0;
    if (index > 0 && db.gate) await db.gate;
    return json({
      dataSourceId: `ds-${body.databaseId}`,
      ...(body.dataSourceId === undefined ? { schema: db.schema } : {}),
      results: db.pages[index] ?? [],
      nextCursor: index + 1 < db.pages.length ? `c${index + 1}` : null,
    });
  });
  vi.stubGlobal('fetch', fetchMock);
  return { calls, fetchMock };
}

const goodRelay = () =>
  createRelay({
    [BANK_ID]: { schema: BANK_SCHEMA, pages: BANK_PAGES },
    [CARD_ID]: { schema: CARD_SCHEMA, pages: CARD_PAGES },
  });

/* ---- 操作 ---- */

async function chooseNotion(user: User) {
  await user.click(screen.getByRole('radio', { name: 'Notionから取得' }));
}

async function fillNotion(user: User, input: { token?: string; bank?: string; card?: string }) {
  if (input.token) await user.type(screen.getByLabelText('Notionのトークン'), input.token);
  if (input.bank) {
    await user.click(screen.getByLabelText('銀行のデータベースのURLまたはID'));
    await user.paste(input.bank);
  }
  if (input.card) {
    await user.click(screen.getByLabelText('カードのデータベースのURLまたはID'));
    await user.paste(input.card);
  }
}

async function loadNotion(user: User) {
  await chooseNotion(user);
  await fillNotion(user, { token: TOKEN, bank: BANK_URL, card: CARD_URL });
  await user.click(screen.getByRole('button', { name: 'Notionから読み込む' }));
  await screen.findByRole('heading', { name: '明細' });
}

async function addProvisional(user: User, input: { month: string; label: string; amount: string }) {
  fireEvent.change(screen.getByLabelText('支払い月'), { target: { value: input.month } });
  await user.type(screen.getByLabelText('支払先・内容'), input.label);
  await user.type(screen.getByLabelText('金額（円）'), input.amount);
  await user.click(screen.getByRole('button', { name: '追加' }));
}

const statusList = () => screen.getByRole('list', { name: 'Notionの取得状況' });

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  localStorage.clear();
  sessionStorage.clear();
});

describe('データの取得元の切り替え', () => {
  it('既定はCSV。切り替えるとパネルが入れ替わり、選択がlocalStorageに保存される', async () => {
    const user = userEvent.setup();
    const { unmount } = render(<App />);

    const group = screen.getByRole('group', { name: 'データの取得元' });
    expect(within(group).getByRole('radio', { name: 'CSVを読み込む' })).toBeChecked();
    expect(within(group).getByRole('radio', { name: 'Notionから取得' })).not.toBeChecked();
    expect(screen.getByLabelText('CSVファイルを選択')).toBeInTheDocument();
    expect(screen.queryByLabelText('Notionのトークン')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'サンプルCSVを読み込む' })).toBeInTheDocument();

    await chooseNotion(user);
    expect(screen.getByRole('radio', { name: 'Notionから取得' })).toBeChecked();
    expect(screen.getByLabelText('Notionのトークン')).toBeInTheDocument();
    expect(screen.queryByLabelText('CSVファイルを選択')).not.toBeInTheDocument();
    // CSV向けの空状態（サンプルCSV）はNotionモードでは出さない
    expect(screen.queryByRole('button', { name: 'サンプルCSVを読み込む' })).not.toBeInTheDocument();
    expect(localStorage.getItem(DATA_SOURCE_STORAGE_KEY)).toBe('notion');

    // 再訪しても選択が残る
    unmount();
    render(<App />);
    expect(screen.getByRole('radio', { name: 'Notionから取得' })).toBeChecked();
    expect(screen.getByLabelText('Notionのトークン')).toBeInTheDocument();

    await user.click(screen.getByRole('radio', { name: 'CSVを読み込む' }));
    expect(localStorage.getItem(DATA_SOURCE_STORAGE_KEY)).toBe('csv');
  });

  it('保存値が不正・ストレージが使えなくてもCSVで起動し、切り替えられる', async () => {
    localStorage.setItem(DATA_SOURCE_STORAGE_KEY, 'unknown');
    const user = userEvent.setup();
    const { unmount } = render(<App />);
    expect(screen.getByRole('radio', { name: 'CSVを読み込む' })).toBeChecked();
    unmount();

    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    render(<App />);
    await chooseNotion(user);
    expect(screen.getByLabelText('Notionのトークン')).toBeInTheDocument();
  });

  it('CSVモードで読み込んだファイルは、Notionに切り替えても戻しても残る。集計は選んだ取得元のデータだけを使う', async () => {
    const user = userEvent.setup();
    goodRelay();
    render(<App />);
    await user.click(screen.getByRole('button', { name: 'サンプルCSVを読み込む' }));
    await screen.findByRole('heading', { name: '明細' });
    expect(screen.getByTestId('summary-count')).toHaveTextContent('20件');

    await chooseNotion(user);
    expect(screen.queryByRole('heading', { name: '明細' })).not.toBeInTheDocument();
    expect(screen.queryByTestId('summary-count')).not.toBeInTheDocument();

    await fillNotion(user, { token: TOKEN, bank: BANK_URL, card: CARD_URL });
    await user.click(screen.getByRole('button', { name: 'Notionから読み込む' }));
    await waitFor(() => expect(screen.getByTestId('summary-count')).toHaveTextContent('5件'));

    await user.click(screen.getByRole('radio', { name: 'CSVを読み込む' }));
    expect(screen.getByTestId('summary-count')).toHaveTextContent('20件');
    expect(screen.getByRole('button', { name: 'sample-bank.csvを削除' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'sample-card.csvを削除' })).toBeInTheDocument();

    // Notionに戻すと、再取得せずに取得済みのデータがそのまま使われる
    const fetchCount = vi.mocked(fetch).mock.calls.length;
    await user.click(screen.getByRole('radio', { name: 'Notionから取得' }));
    expect(screen.getByTestId('summary-count')).toHaveTextContent('5件');
    expect(vi.mocked(fetch).mock.calls).toHaveLength(fetchCount);
  });
});

describe('Notionパネル: 入力の検証', () => {
  it('何も入力せずに読み込むと、トークンとデータベースのエラーが出て、取得は始まらない', async () => {
    const user = userEvent.setup();
    const { fetchMock } = goodRelay();
    render(<App />);
    await chooseNotion(user);
    const token = screen.getByLabelText('Notionのトークン');
    expect(token).toHaveAttribute('type', 'password');
    expect(token).toHaveAttribute('autocomplete', 'off');

    await user.click(screen.getByRole('button', { name: 'Notionから読み込む' }));
    expect(screen.getByText('インテグレーションのトークンを入力してください。')).toBeInTheDocument();
    expect(token).toHaveAttribute('aria-invalid', 'true');
    expect(token).toHaveFocus();
    expect(screen.getByText(/銀行かカードのどちらか一方は/)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('URLまたはIDを解釈できない項目にだけ、項目ごとにエラーが出る。直すと消える', async () => {
    const user = userEvent.setup();
    const { fetchMock } = goodRelay();
    render(<App />);
    await chooseNotion(user);
    await fillNotion(user, { token: TOKEN, bank: 'not-a-notion-url', card: CARD_URL });
    await user.click(screen.getByRole('button', { name: 'Notionから読み込む' }));

    const bank = screen.getByLabelText('銀行のデータベースのURLまたはID');
    const card = screen.getByLabelText('カードのデータベースのURLまたはID');
    expect(bank).toHaveAttribute('aria-invalid', 'true');
    const errorId = bank.getAttribute('aria-describedby')?.split(' ').find((id) => document.getElementById(id)?.classList.contains('field-error'));
    expect(errorId).toBeDefined();
    expect(document.getElementById(errorId as string)).toHaveTextContent('データベースのURLまたはIDを解釈できません');
    expect(card).not.toHaveAttribute('aria-invalid');
    expect(fetchMock).not.toHaveBeenCalled();

    await user.clear(bank);
    await user.click(bank);
    await user.paste(BANK_HEX); // 32桁のIDだけでも可
    expect(bank).not.toHaveAttribute('aria-invalid');
    await user.click(screen.getByRole('button', { name: 'Notionから読み込む' }));
    await screen.findByRole('heading', { name: '明細' });
    expect(fetchMock).toHaveBeenCalled();
  });

  it('銀行かカードのどちらか片方だけでも読み込める', async () => {
    const user = userEvent.setup();
    const { calls } = goodRelay();
    render(<App />);
    await chooseNotion(user);
    await fillNotion(user, { token: TOKEN, card: CARD_URL });
    await user.click(screen.getByRole('button', { name: 'Notionから読み込む' }));
    await screen.findByRole('heading', { name: '明細' });
    expect(new Set(calls.map((c) => c.body.databaseId))).toEqual(new Set([CARD_ID]));
    expect(screen.getByTestId('summary-count')).toHaveTextContent('2件');
    expect(within(statusList()).queryByText('銀行のデータベース')).not.toBeInTheDocument();
  });
});

describe('Notionからの取得', () => {
  it('銀行DB・カードDBを読み込むと、概要・月別・明細・タグ別の支出に反映され、読み飛ばした行の警告が出る', async () => {
    const user = userEvent.setup();
    const { calls } = goodRelay();
    render(<App />);
    await loadNotion(user);

    expect(screen.getByTestId('summary-count')).toHaveTextContent('5件');
    expect(screen.getByTestId('summary-income')).toHaveTextContent('280,000円');
    expect(screen.getByTestId('summary-bank-expense')).toHaveTextContent('35,400円');
    expect(screen.getByTestId('summary-card-expense')).toHaveTextContent('23,240円');
    expect(screen.getByTestId('summary-expense')).toHaveTextContent('58,640円');
    expect(screen.getByRole('heading', { name: '月別サマリー' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '銀行の残高推移' })).toBeInTheDocument();
    const table = screen.getByRole('table', { name: /明細一覧/ });
    expect(within(table).getAllByRole('row')).toHaveLength(6); // 見出し + 5件
    expect(within(table).getByText('ガス料金')).toBeInTheDocument();
    expect(within(table).getByText('スーパーマルエー')).toBeInTheDocument();

    // 取得状況: 銀行は4行（日付のない行は読み飛ばし）、カードは2行
    const statuses = Array.from(statusList().children) as HTMLElement[];
    expect(statuses).toHaveLength(2);
    expect(statuses[0]).toHaveTextContent('銀行のデータベース');
    expect(statuses[0]).toHaveTextContent('4行を取得し、3件の明細として読み込みました。');
    expect(statuses[0]).toHaveTextContent('読み飛ばした行の警告 1件');
    expect(statuses[1]).toHaveTextContent('カードのデータベース');
    expect(statuses[1]).toHaveTextContent('2行を取得し、2件の明細として読み込みました。');
    expect(within(statuses[1]!).queryByText(/警告/)).not.toBeInTheDocument();
    await user.click(within(statuses[0]!).getByText(/読み飛ばした行の警告/));
    expect(within(statuses[0]!).getByText(/日付/, { selector: 'li' })).toBeInTheDocument();

    // 銀行は2ページ + カードは1ページ
    expect(calls).toHaveLength(3);

    // タグ別の支出にも反映される（ルールで自動タグ付け）
    await user.type(screen.getByLabelText('タグ名'), '光熱費');
    await user.click(screen.getByRole('button', { name: 'タグを追加' }));
    await user.type(screen.getByLabelText('摘要に含む文字列'), 'ガス');
    await user.selectOptions(screen.getByLabelText('付けるタグ'), '光熱費');
    await user.click(screen.getByRole('button', { name: 'ルールを追加' }));
    const breakdown = screen.getByTestId('tag-breakdown');
    expect(within(breakdown).getByRole('button', { name: /^光熱費/ })).toHaveTextContent('5,400円（1件・9.2%）');
    expect(within(breakdown).getByRole('button', { name: /^タグなし/ })).toHaveTextContent('53,240円（3件・90.8%）');
  });

  it('トークンは x-notion-token ヘッダーだけで送られ、URL・ボディ・queryKey には含まれない', async () => {
    const user = userEvent.setup();
    const { calls } = goodRelay();
    const queryClient = createQueryClient();
    render(<App queryClient={queryClient} />);
    await loadNotion(user);

    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) {
      expect(call.url).toBe('/api/notion/query');
      expect(call.method).toBe('POST');
      expect(call.token).toBe(TOKEN);
      expect(call.url).not.toContain(TOKEN);
      expect(JSON.stringify(call.body)).not.toContain(TOKEN);
      expect(call.body.databaseId).toMatch(new RegExp(`^(${BANK_ID}|${CARD_ID})$`));
    }
    const keys = queryClient
      .getQueryCache()
      .getAll()
      .map((q) => q.queryKey);
    expect(keys).toEqual(expect.arrayContaining([['notion', 'bank', BANK_ID], ['notion', 'card', CARD_ID]]));
    expect(JSON.stringify(keys)).not.toContain(TOKEN);
  });

  it('取得中は行数が出て、読み込みボタンは押せない。終わると「再読み込み」に変わり、押すと取得し直す', async () => {
    const user = userEvent.setup();
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { calls } = createRelay({ [BANK_ID]: { schema: BANK_SCHEMA, pages: BANK_PAGES, gate } });
    render(<App />);
    await chooseNotion(user);
    await fillNotion(user, { token: TOKEN, bank: BANK_URL });
    await user.click(screen.getByRole('button', { name: 'Notionから読み込む' }));

    const item = await within(statusList()).findByText(/取得中です/);
    await waitFor(() => expect(item).toHaveTextContent('2行を取得'));
    expect(screen.getByRole('button', { name: 'Notionから読み込む' })).toBeDisabled();

    release();
    await screen.findByRole('heading', { name: '明細' });
    expect(screen.getByRole('button', { name: '再読み込み' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Notionから読み込む' })).not.toBeInTheDocument();
    expect(calls).toHaveLength(2);

    await user.click(screen.getByRole('button', { name: '再読み込み' }));
    await waitFor(() => expect(calls).toHaveLength(4));
    await waitFor(() => expect(within(statusList()).getByText(/4行を取得し/)).toBeInTheDocument());
  });

  it('A→B→Aと読み込むと、キャッシュが残っていても、Aを取り直して最新の内容を表示する', async () => {
    const user = userEvent.setup();
    const BANK2_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
    const BANK2_URL = `https://www.notion.so/workspace/${BANK2_ID.replace(/-/g, '')}`;
    const dbs: Record<string, RelayDb> = {
      [BANK_ID]: { schema: BANK_SCHEMA, pages: BANK_PAGES },
      [BANK2_ID]: { schema: BANK_SCHEMA, pages: [[bankRow('別口座の給与', '2026-11-05', null, 111000, 1)]] },
    };
    const { calls } = createRelay(dbs);
    const bankField = () => screen.getByLabelText('銀行のデータベースのURLまたはID');
    const setBank = async (value: string) => {
      await user.clear(bankField());
      await user.click(bankField());
      await user.paste(value);
    };
    const bankCalls = (id: string) => calls.filter((c) => c.body.databaseId === id).length;

    render(<App />);
    await chooseNotion(user);
    await fillNotion(user, { token: TOKEN, bank: BANK_URL });
    await user.click(screen.getByRole('button', { name: 'Notionから読み込む' }));
    await screen.findByRole('heading', { name: '明細' });
    await waitFor(() => expect(screen.getByTestId('summary-income')).toHaveTextContent('280,000円'));
    expect(bankCalls(BANK_ID)).toBe(2); // 2ページ

    // B を読み込む（A のキャッシュは残る）
    await setBank(BANK2_URL);
    await user.click(screen.getByRole('button', { name: /読み込む|再読み込み/ }));
    await waitFor(() => expect(screen.getByTestId('summary-income')).toHaveTextContent('111,000円'));

    // その間に Notion 側で A の内容が変わった
    dbs[BANK_ID] = { schema: BANK_SCHEMA, pages: [[bankRow('給与', '2026-11-05', null, 290000, 1)]] };

    // A を読み込み直す: キャッシュから古い内容を出さず、取り直す
    await setBank(BANK_URL);
    await user.click(screen.getByRole('button', { name: /読み込む|再読み込み/ }));
    await waitFor(() => expect(screen.getByTestId('summary-income')).toHaveTextContent('290,000円'));
    expect(bankCalls(BANK_ID)).toBe(3); // 最初の2ページ + 取り直しの1ページ
  });

  it('自動では再取得しない（ウィンドウのフォーカス・再接続）', async () => {
    const user = userEvent.setup();
    const { fetchMock } = goodRelay();
    render(<App />);
    await loadNotion(user);
    const count = fetchMock.mock.calls.length;

    fireEvent.focus(window);
    window.dispatchEvent(new Event('online'));
    document.dispatchEvent(new Event('visibilitychange'));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(fetchMock.mock.calls).toHaveLength(count);
  });

  it('アンマウントすると、取得中のリクエストは signal で取り消される', async () => {
    const user = userEvent.setup();
    const gate = new Promise<void>(() => {});
    const { calls } = createRelay({ [BANK_ID]: { schema: BANK_SCHEMA, pages: BANK_PAGES, gate } });
    const { unmount } = render(<App />);
    await chooseNotion(user);
    await fillNotion(user, { token: TOKEN, bank: BANK_URL });
    await user.click(screen.getByRole('button', { name: 'Notionから読み込む' }));
    await waitFor(() => expect(calls).toHaveLength(2));
    const signal = calls[1]?.signal;
    expect(signal?.aborted).toBe(false);
    unmount();
    expect(signal?.aborted).toBe(true);
  });

  it('提供した QueryClient を使う（App が Provider を内包する）', async () => {
    const user = userEvent.setup();
    goodRelay();
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<App queryClient={queryClient} />);
    await loadNotion(user);
    const keys = queryClient
      .getQueryCache()
      .getAll()
      .map((q) => q.queryKey)
      .filter((key) => key[2] !== null);
    expect(keys).toHaveLength(2);
  });
});

describe('Notionの取得エラー', () => {
  it('形式が合わないと、不足・型違いのプロパティを箇条書きで表示する', async () => {
    const user = userEvent.setup();
    const { 年月日: _removed, ...rest } = BANK_SCHEMA;
    void _removed;
    createRelay({ [BANK_ID]: { schema: { ...rest, お引出し: 'rich_text' }, pages: BANK_PAGES } });
    render(<App />);
    await chooseNotion(user);
    await fillNotion(user, { token: TOKEN, bank: BANK_URL });
    await user.click(screen.getByRole('button', { name: 'Notionから読み込む' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('銀行のデータベース');
    expect(alert).toHaveTextContent('取得できませんでした');
    expect(alert).toHaveTextContent('形式が合っていません');
    const items = within(alert).getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent('『年月日』プロパティ（日付型）がありません。');
    expect(items[1]).toHaveTextContent('『お引出し』は数値型である必要がありますが');
    expect(screen.queryByRole('heading', { name: '明細' })).not.toBeInTheDocument();
  });

  it('トークンが無効なら、中継関数が返した日本語メッセージを表示する', async () => {
    const user = userEvent.setup();
    const message = 'Notionのトークンが無効です。インテグレーションのトークンを確認して入力し直してください。';
    createRelay({ [BANK_ID]: { schema: BANK_SCHEMA, pages: BANK_PAGES, error: { status: 401, code: 'unauthorized', message } } });
    render(<App />);
    await chooseNotion(user);
    await fillNotion(user, { token: TOKEN, bank: BANK_URL });
    await user.click(screen.getByRole('button', { name: 'Notionから読み込む' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(message);
    expect(screen.queryByRole('heading', { name: '明細' })).not.toBeInTheDocument();
    // 直して再読み込みできる
    expect(screen.getByRole('button', { name: '再読み込み' })).toBeEnabled();
  });

  it('DBごとに状態が出る: 片方が失敗しても、もう片方は読み込まれる', async () => {
    const user = userEvent.setup();
    createRelay({
      [BANK_ID]: {
        schema: BANK_SCHEMA,
        pages: BANK_PAGES,
        error: { status: 404, code: 'not_found', message: 'データベースが見つかりません。インテグレーションにデータベースを共有しているか確認してください。' },
      },
      [CARD_ID]: { schema: CARD_SCHEMA, pages: CARD_PAGES },
    });
    render(<App />);
    await chooseNotion(user);
    await fillNotion(user, { token: TOKEN, bank: BANK_URL, card: CARD_URL });
    await user.click(screen.getByRole('button', { name: 'Notionから読み込む' }));
    await screen.findByRole('heading', { name: '明細' });

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('銀行のデータベース');
    expect(alert).toHaveTextContent('データベースが見つかりません');
    expect(screen.getByTestId('summary-count')).toHaveTextContent('2件');
    expect(within(statusList()).getByText(/2行を取得し/)).toBeInTheDocument();
  });

  it('中継関数に接続できないときも、メッセージを表示する', async () => {
    const user = userEvent.setup();
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    render(<App />);
    await chooseNotion(user);
    await fillNotion(user, { token: TOKEN, bank: BANK_URL });
    await user.click(screen.getByRole('button', { name: 'Notionから読み込む' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('中継サーバーに接続できませんでした');
  });
});

describe('Notionに取得したデータの扱い', () => {
  it('暫定支払い（カード）は、カードDBの「支払い月」「今回支払金額」で上書きされる', async () => {
    const user = userEvent.setup();
    goodRelay();
    render(<App />);
    await addProvisional(user, { month: '2026-11', label: '楽天カード 11月分', amount: '40000' });
    await loadNotion(user);

    const table = screen.getByRole('region', { name: '暫定支払いの表' });
    const row = within(table).getByRole('row', { name: /楽天カード 11月分/ });
    expect(row).toHaveTextContent('CSVで置き換え済み');
    expect(row).toHaveTextContent('CSVの支払額: 23,240円（暫定: 40,000円、差額 −16,760円）');
    expect(screen.getByTestId('summary-provisional-total')).toHaveTextContent('23,240円');
  });

  it('取得したデータはストレージに保存されない', async () => {
    const user = userEvent.setup();
    goodRelay();
    render(<App />);
    await loadNotion(user);
    const dump = JSON.stringify([...Object.entries(localStorage), ...Object.entries(sessionStorage)]);
    expect(dump).not.toContain('ガス料金');
    expect(dump).not.toContain('スーパーマルエー');
  });
});

describe('トークンと設定の保存', () => {
  it('既定ではsessionStorageに保存（タブを閉じると消える）。「このブラウザに保存する」でlocalStorageへ移る', async () => {
    const user = userEvent.setup();
    goodRelay();
    render(<App />);
    await chooseNotion(user);
    await fillNotion(user, { token: TOKEN });

    const remember = screen.getByRole('checkbox', { name: 'このブラウザに保存する' });
    expect(remember).not.toBeChecked();
    expect(sessionStorage.getItem(NOTION_TOKEN_KEY)).toBe(TOKEN);
    expect(localStorage.getItem(NOTION_TOKEN_KEY)).toBeNull();

    await user.click(remember);
    expect(localStorage.getItem(NOTION_TOKEN_KEY)).toBe(TOKEN);
    expect(sessionStorage.getItem(NOTION_TOKEN_KEY)).toBeNull();
    expect(JSON.parse(localStorage.getItem(NOTION_CONFIG_KEY) ?? 'null')).toMatchObject({ rememberToken: true });

    await user.click(remember);
    expect(sessionStorage.getItem(NOTION_TOKEN_KEY)).toBe(TOKEN);
    expect(localStorage.getItem(NOTION_TOKEN_KEY)).toBeNull();
  });

  it('設定（URL/ID・保存オプション）とトークンは、再訪時に復元される。「トークンを削除」で消える', async () => {
    const user = userEvent.setup();
    goodRelay();
    const { unmount } = render(<App />);
    await chooseNotion(user);
    await fillNotion(user, { token: TOKEN, bank: BANK_URL, card: CARD_URL });
    await user.click(screen.getByRole('checkbox', { name: 'このブラウザに保存する' }));
    expect(JSON.parse(localStorage.getItem(NOTION_CONFIG_KEY) ?? 'null')).toEqual({
      bankDatabase: BANK_URL,
      cardDatabase: CARD_URL,
      rememberToken: true,
    });
    unmount();

    render(<App />);
    expect(screen.getByLabelText('Notionのトークン')).toHaveValue(TOKEN);
    expect(screen.getByLabelText('銀行のデータベースのURLまたはID')).toHaveValue(BANK_URL);
    expect(screen.getByLabelText('カードのデータベースのURLまたはID')).toHaveValue(CARD_URL);
    expect(screen.getByRole('checkbox', { name: 'このブラウザに保存する' })).toBeChecked();

    await user.click(screen.getByRole('button', { name: 'トークンを削除' }));
    expect(screen.getByLabelText('Notionのトークン')).toHaveValue('');
    expect(screen.getByText('トークンを削除しました。')).toBeInTheDocument();
    expect(localStorage.getItem(NOTION_TOKEN_KEY)).toBeNull();
    expect(sessionStorage.getItem(NOTION_TOKEN_KEY)).toBeNull();
    // DBの設定は残る
    expect(screen.getByLabelText('銀行のデータベースのURLまたはID')).toHaveValue(BANK_URL);
  });
});

describe('ヘルプからの案内', () => {
  it('ヘッダーの「ヘルプ」で開き、Escで閉じて、ボタンにフォーカスが戻る', async () => {
    const user = userEvent.setup();
    render(<App />);
    const opener = screen.getByRole('button', { name: 'ヘルプ' });
    await user.click(opener);
    expect(screen.getByRole('dialog', { name: 'ヘルプ' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'CSVの形式' })).toHaveAttribute('aria-selected', 'true');
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });

  it('CSVのパネルから「CSVの形式」を開ける', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: 'CSVの形式' }));
    expect(screen.getByRole('tab', { name: 'CSVの形式' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel')).toHaveTextContent('お取り扱い内容');
  });

  it('Notionのパネルから、データ形式・設定手順・プライバシーのタブを直接開ける。表は NOTION_SPECS から作られる', async () => {
    const user = userEvent.setup();
    render(<App />);
    await chooseNotion(user);

    const link = screen.getByRole('button', { name: 'データ形式' });
    await user.click(link);
    const dialog = screen.getByRole('dialog', { name: 'ヘルプ' });
    expect(within(dialog).getByRole('tab', { name: 'Notionのデータ形式' })).toHaveAttribute('aria-selected', 'true');
    for (const spec of NOTION_SPECS) {
      const table = within(dialog).getByRole('table', { name: `${spec.title}のプロパティ一覧` });
      for (const property of spec.properties) {
        expect(table).toHaveTextContent(property.name ?? spec.recommendedTitleName);
      }
    }
    await user.click(within(dialog).getByRole('button', { name: '閉じる' }));
    expect(link).toHaveFocus();

    await user.click(screen.getByRole('button', { name: '設定手順' }));
    expect(screen.getByRole('tab', { name: 'Notionの設定手順' })).toHaveAttribute('aria-selected', 'true');
    await user.keyboard('{Escape}');

    await user.click(screen.getByRole('button', { name: '保存とプライバシー' }));
    expect(screen.getByRole('tab', { name: '保存とプライバシー' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel')).toHaveTextContent('/api/notion/query');
  });
});
