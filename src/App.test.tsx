import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import { PROVISIONAL_STORAGE_KEY } from './lib/provisional';
import { TAGS_STORAGE_KEY } from './lib/tags';
import { SAMPLE_BANK_CSV } from './sampleData';

const BAD_CSV = '不明,見出し\r\n1,2\r\n';

function csvFile(name: string, content: string): File {
  return new File([content], name, { type: 'text/csv' });
}

async function loadSample(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'サンプルCSVを読み込む' }));
  await screen.findByRole('heading', { name: '明細' });
}

type User = ReturnType<typeof userEvent.setup>;

interface ProvisionalInput {
  month: string;
  label: string;
  amount: string;
  kind?: 'カード' | '銀行' | 'その他';
  state?: '確定' | '見込み';
  note?: string;
  /** 「CSVがあっても暫定値を使う（置き換えない）」をオンにする */
  pinned?: boolean;
}

/** 暫定支払いフォームを入力して「追加」を押す */
async function addProvisional(user: User, input: ProvisionalInput) {
  fireEvent.change(screen.getByLabelText('支払い月'), { target: { value: input.month } });
  await user.type(screen.getByLabelText('支払先・内容'), input.label);
  await user.type(screen.getByLabelText('金額（円）'), input.amount);
  if (input.kind) await user.click(screen.getByRole('radio', { name: input.kind }));
  if (input.state) await user.click(screen.getByRole('radio', { name: input.state }));
  if (input.note) await user.type(screen.getByLabelText('メモ（任意）'), input.note);
  if (input.pinned) await user.click(screen.getByRole('checkbox', { name: /CSVがあっても暫定値を使う/ }));
  await user.click(screen.getByRole('button', { name: '追加' }));
}

function provisionalTable() {
  return screen.getByRole('region', { name: '暫定支払いの表' });
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('App', () => {
  it('初期表示は空状態で、サンプルCSVの読み込みボタンがある', () => {
    render(<App />);
    expect(screen.getByRole('heading', { name: 'まずはCSVを読み込みましょう' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'サンプルCSVを読み込む' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '明細' })).not.toBeInTheDocument();
  });

  it('サンプルを読み込むと概要と明細が表示される', async () => {
    const user = userEvent.setup();
    render(<App />);
    await loadSample(user);

    expect(screen.getByTestId('summary-count')).toHaveTextContent('20件');
    expect(screen.getByTestId('summary-income')).toHaveTextContent('560,000円');
    expect(screen.getByTestId('summary-bank-expense')).toHaveTextContent('329,240円');
    expect(screen.getByTestId('summary-card-expense')).toHaveTextContent('66,510円');
    expect(screen.getAllByText(/参考値/, { selector: 'dt' })).toHaveLength(2);
    expect(screen.getByRole('note')).toHaveTextContent('二重');
    expect(screen.getByRole('heading', { name: '銀行の残高推移' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '月別サマリー' })).toBeInTheDocument();

    const table = screen.getByRole('table', { name: /明細一覧/ });
    expect(within(table).getAllByRole('row')).toHaveLength(21); // 見出し + 20件
    expect(screen.getByTestId('tx-count')).toHaveTextContent('全20件中 20件を表示');
    expect(screen.getByRole('button', { name: 'sample-bank.csvを削除' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'sample-card.csvを削除' })).toBeInTheDocument();
  });

  it('CSVファイルを入稿すると表示される（同名は置換）', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.upload(screen.getByLabelText('CSVファイルを選択'), csvFile('bank.csv', SAMPLE_BANK_CSV));
    await screen.findByRole('heading', { name: '明細' });
    expect(screen.getByTestId('summary-count')).toHaveTextContent('10件');
    expect(screen.getByRole('status')).toHaveTextContent('銀行の明細として10件を読み込みました');
    expect(screen.queryByRole('heading', { name: '銀行の残高推移' })).toBeInTheDocument();

    // 同名を入れ直す: 件数は増えず、置換の旨が出る
    await user.upload(screen.getByLabelText('CSVファイルを選択'), csvFile('bank.csv', SAMPLE_BANK_CSV));
    await screen.findByText(/置き換えました/);
    expect(screen.getByTestId('summary-count')).toHaveTextContent('10件');
    expect(screen.getAllByRole('button', { name: /を削除$/ })).toHaveLength(1);
  });

  it('キーワードで絞り込むと件数が減る', async () => {
    const user = userEvent.setup();
    render(<App />);
    await loadSample(user);

    await user.type(screen.getByRole('searchbox', { name: /キーワード/ }), '家賃');
    expect(screen.getByTestId('summary-count')).toHaveTextContent('2件');
    expect(screen.getByTestId('tx-count')).toHaveTextContent('全2件中 2件を表示');
  });

  it('月とソースで絞り込める', async () => {
    const user = userEvent.setup();
    render(<App />);
    await loadSample(user);

    await user.click(screen.getByRole('checkbox', { name: '2026年11月' }));
    expect(screen.getByTestId('summary-count')).toHaveTextContent('10件');

    await user.click(screen.getByRole('checkbox', { name: 'カード' }));
    expect(screen.getByTestId('summary-count')).toHaveTextContent('5件');
    // 最後の1つは外せない
    expect(screen.getByRole('checkbox', { name: '銀行' })).toBeChecked();
    await user.click(screen.getByRole('checkbox', { name: '銀行' }));
    expect(screen.getByRole('checkbox', { name: '銀行' })).toBeChecked();
  });

  it('不正なCSVはエラーを表示し、データは追加されない', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.upload(screen.getByLabelText('CSVファイルを選択'), csvFile('broken.csv', BAD_CSV));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('broken.csv');
    expect(alert).toHaveTextContent('読み込めませんでした');
    expect(screen.getByRole('heading', { name: 'まずはCSVを読み込みましょう' })).toBeInTheDocument();

    await user.click(within(alert).getByRole('button', { name: /閉じる/ }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('個別削除とすべて消去で空状態に戻る', async () => {
    const user = userEvent.setup();
    render(<App />);
    await loadSample(user);

    await user.click(screen.getByRole('button', { name: 'sample-card.csvを削除' }));
    expect(screen.getByTestId('summary-count')).toHaveTextContent('10件');
    expect(screen.getByTestId('summary-card-expense')).toHaveTextContent('0円');

    await user.click(screen.getByRole('button', { name: 'sample-bank.csvを削除' }));
    expect(screen.getByRole('heading', { name: 'まずはCSVを読み込みましょう' })).toBeInTheDocument();

    await loadSample(user);
    await user.click(screen.getByRole('button', { name: 'すべて消去' }));
    expect(screen.getByRole('heading', { name: 'まずはCSVを読み込みましょう' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /を削除$/ })).not.toBeInTheDocument();
  });
  describe('読み込み中の消去・削除', () => {
    /** arrayBuffer の完了を手動で制御できるファイル */
    function slowFile(name: string, content: string) {
      const file = csvFile(name, content);
      let release: () => void = () => {};
      const gate = new Promise<void>((resolve) => (release = resolve));
      const bytes = new TextEncoder().encode(content);
      file.arrayBuffer = async () => {
        await gate;
        return bytes.buffer;
      };
      return { file, release: () => act(async () => { release(); await gate; }) };
    }

    it('読み込み中に「すべて消去」しても、完了後にデータが復活しない', async () => {
      const user = userEvent.setup();
      render(<App />);
      await loadSample(user);

      const slow = slowFile('slow.csv', SAMPLE_BANK_CSV);
      await user.upload(screen.getByLabelText('CSVファイルを選択'), slow.file);
      await user.click(screen.getByRole('button', { name: 'すべて消去' }));
      await slow.release();

      expect(screen.getByRole('heading', { name: 'まずはCSVを読み込みましょう' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /を削除$/ })).not.toBeInTheDocument();
    });

    it('置換の読み込み中に削除しても、削除したファイルが復活しない', async () => {
      const user = userEvent.setup();
      render(<App />);
      await user.upload(screen.getByLabelText('CSVファイルを選択'), csvFile('bank.csv', SAMPLE_BANK_CSV));
      await screen.findByRole('heading', { name: '明細' });

      const slow = slowFile('bank.csv', SAMPLE_BANK_CSV);
      await user.upload(screen.getByLabelText('CSVファイルを選択'), slow.file);
      await user.click(screen.getByRole('button', { name: 'bank.csvを削除' }));
      await slow.release();

      expect(screen.getByRole('heading', { name: 'まずはCSVを読み込みましょう' })).toBeInTheDocument();
    });
  });
});

describe('暫定支払い（手入力）', () => {
  it('パネルの見出しと説明、保存に関する注意が表示される', () => {
    render(<App />);
    expect(screen.getByRole('heading', { name: '暫定支払い（手入力）' })).toBeInTheDocument();
    expect(screen.getByText(/楽天カードの今月の請求額/)).toBeInTheDocument();
    expect(
      screen.getByText(/同じ支払いのCSV（カードは同じ支払い月のCSV、銀行はその月の取引を含むCSV）を読み込むと、CSVのデータが暫定値を置き換えます。カードは支払い月の暫定支払いとしてCSVの支払額で上書きされ、銀行は暫定値が集計から外れます。CSVを削除すると元に戻ります。/),
    ).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'CSVがあっても暫定値を使う（置き換えない）' })).not.toBeChecked();
    expect(screen.getByText(/localStorageに保存されます（CSVの内容は保存されません）/)).toBeInTheDocument();
    expect(screen.getByText('まだ暫定支払いは登録されていません。')).toBeInTheDocument();
    // 種別の既定はカード、状態の既定は確定
    expect(screen.getByRole('radio', { name: 'カード' })).toBeChecked();
    expect(screen.getByRole('radio', { name: '確定' })).toBeChecked();
    // 支払い月の既定は今月
    const now = new Date();
    const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    expect(screen.getByLabelText('支払い月')).toHaveValue(thisMonth);
  });

  it('追加すると一覧と概要に反映され、フォームはクリアされる', async () => {
    const user = userEvent.setup();
    render(<App />);

    await addProvisional(user, { month: '2026-11', label: '楽天カード 11月分', amount: '48,500', note: '12/27引落' });

    const row = within(provisionalTable()).getByRole('row', { name: /楽天カード 11月分/ });
    expect(row).toHaveTextContent('2026年11月');
    expect(row).toHaveTextContent('カード');
    expect(row).toHaveTextContent('48,500円');
    expect(row).toHaveTextContent('確定');
    expect(row).toHaveTextContent('12/27引落');

    expect(screen.getByTestId('summary-provisional-total')).toHaveTextContent('48,500円');
    expect(screen.getByTestId('summary-provisional-confirmed')).toHaveTextContent('48,500円');
    expect(screen.getByTestId('summary-provisional-estimated')).toHaveTextContent('0円');
    // 暫定支払いは支出合計・収支に含まれ、銀行／カードの支出の内訳には混ぜない
    expect(screen.getByTestId('summary-expense').textContent).toBe('48,500円');
    expect(screen.getByTestId('summary-net').textContent).toBe('−48,500円');
    expect(screen.getByTestId('summary-bank-expense').textContent).toBe('0円');
    expect(screen.getByTestId('summary-card-expense').textContent).toBe('0円');

    // フォームはクリアされる（月は既定の今月に戻る）
    expect(screen.getByLabelText('支払先・内容')).toHaveValue('');
    expect(screen.getByLabelText('金額（円）')).toHaveValue('');
    expect(screen.getByLabelText('メモ（任意）')).toHaveValue('');
    expect(screen.getByRole('radio', { name: 'カード' })).toBeChecked();

    // 全角・円付きの金額、見込み、別種別
    await addProvisional(user, {
      month: '2026-12',
      label: '電気代',
      amount: '１２，３４５円',
      kind: 'その他',
      state: '見込み',
    });
    expect(screen.getByTestId('summary-provisional-total')).toHaveTextContent('60,845円');
    expect(screen.getByTestId('summary-provisional-confirmed')).toHaveTextContent('48,500円');
    expect(screen.getByTestId('summary-provisional-estimated')).toHaveTextContent('12,345円');
    expect(within(provisionalTable()).getByRole('row', { name: /電気代/ })).toHaveTextContent('見込み');
  });

  it('不正な入力では項目ごとにエラーが表示され、追加されない', async () => {
    const user = userEvent.setup();
    render(<App />);

    fireEvent.change(screen.getByLabelText('支払い月'), { target: { value: '' } });
    await user.type(screen.getByLabelText('金額（円）'), '0');
    await user.click(screen.getByRole('button', { name: '追加' }));

    const month = screen.getByLabelText('支払い月');
    const label = screen.getByLabelText('支払先・内容');
    const amount = screen.getByLabelText('金額（円）');
    for (const input of [month, label, amount]) {
      expect(input).toHaveAttribute('aria-invalid', 'true');
    }
    expect(screen.getByText('支払先・内容を入力してください。')).toBeInTheDocument();
    expect(label).toHaveAccessibleDescription('支払先・内容を入力してください。');
    expect(amount).toHaveAccessibleDescription(/1円以上の整数/);
    expect(month).toHaveAccessibleDescription(/年と月/);
    expect(month).toHaveFocus();
    expect(screen.getByText('まだ暫定支払いは登録されていません。')).toBeInTheDocument();
  });

  it('入力し直して追加するとエラーは消える', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole('button', { name: '追加' }));
    expect(screen.getByLabelText('支払先・内容')).toHaveAttribute('aria-invalid', 'true');

    await addProvisional(user, { month: '2026-11', label: '家賃', amount: '80000', kind: '銀行' });
    expect(screen.queryByText('支払先・内容を入力してください。')).not.toBeInTheDocument();
    expect(screen.getByLabelText('支払先・内容')).not.toHaveAttribute('aria-invalid');
    expect(within(provisionalTable()).getByRole('row', { name: /家賃/ })).toHaveTextContent('銀行');
  });

  it('編集して保存・キャンセルできる', async () => {
    const user = userEvent.setup();
    render(<App />);
    await addProvisional(user, { month: '2026-11', label: '楽天カード', amount: '10000' });

    await user.click(screen.getByRole('button', { name: '楽天カードを編集' }));
    expect(screen.getByLabelText('支払先・内容')).toHaveValue('楽天カード');
    expect(screen.getByLabelText('金額（円）')).toHaveValue('10000');
    expect(screen.getByLabelText('支払い月')).toHaveValue('2026-11');
    expect(screen.getByRole('button', { name: '保存' })).toBeInTheDocument();

    // キャンセルすると変更されず、追加フォームに戻る
    await user.type(screen.getByLabelText('金額（円）'), '9');
    await user.click(screen.getByRole('button', { name: 'キャンセル' }));
    expect(screen.getByRole('button', { name: '追加' })).toBeInTheDocument();
    expect(screen.getByLabelText('金額（円）')).toHaveValue('');
    expect(screen.getByTestId('summary-provisional-total')).toHaveTextContent('10,000円');

    // 編集して保存する
    await user.click(screen.getByRole('button', { name: '楽天カードを編集' }));
    await user.clear(screen.getByLabelText('金額（円）'));
    await user.type(screen.getByLabelText('金額（円）'), '25,000');
    await user.click(screen.getByRole('radio', { name: '見込み' }));
    await user.click(screen.getByRole('button', { name: '保存' }));

    expect(within(provisionalTable()).getAllByRole('row')).toHaveLength(2); // 見出し + 1件（増えない）
    expect(within(provisionalTable()).getByRole('row', { name: /楽天カード/ })).toHaveTextContent('25,000円');
    expect(screen.getByTestId('summary-provisional-total')).toHaveTextContent('25,000円');
    expect(screen.getByTestId('summary-provisional-confirmed')).toHaveTextContent('0円');
    expect(screen.getByTestId('summary-provisional-estimated')).toHaveTextContent('25,000円');
    expect(screen.getByRole('button', { name: '追加' })).toBeInTheDocument();
  });

  it('編集中に不正な値にするとエラーが出て、保存されない', async () => {
    const user = userEvent.setup();
    render(<App />);
    await addProvisional(user, { month: '2026-11', label: '楽天カード', amount: '10000' });

    await user.click(screen.getByRole('button', { name: '楽天カードを編集' }));
    await user.clear(screen.getByLabelText('金額（円）'));
    await user.click(screen.getByRole('button', { name: '保存' }));
    expect(screen.getByLabelText('金額（円）')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('金額（円）')).toHaveFocus();
    expect(screen.getByTestId('summary-provisional-total')).toHaveTextContent('10,000円');
  });

  it('個別に削除できる（編集中の項目を削除するとフォームも戻る）', async () => {
    const user = userEvent.setup();
    render(<App />);
    await addProvisional(user, { month: '2026-11', label: '楽天カード', amount: '10000' });
    await addProvisional(user, { month: '2026-11', label: '携帯料金', amount: '5000' });
    expect(screen.getByTestId('summary-provisional-total')).toHaveTextContent('15,000円');

    await user.click(screen.getByRole('button', { name: '楽天カードを編集' }));
    await user.click(screen.getByRole('button', { name: '楽天カードを削除' }));

    expect(within(provisionalTable()).queryByRole('row', { name: /楽天カード/ })).not.toBeInTheDocument();
    expect(screen.getByTestId('summary-provisional-total')).toHaveTextContent('5,000円');
    expect(screen.getByRole('button', { name: '追加' })).toBeInTheDocument();
    expect(screen.getByLabelText('支払先・内容')).toHaveValue('');
  });

  it('「暫定支払いをすべて削除」は確認ダイアログでキャンセルできる', async () => {
    const user = userEvent.setup();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<App />);
    await addProvisional(user, { month: '2026-11', label: '楽天カード', amount: '10000' });
    await addProvisional(user, { month: '2026-12', label: '携帯料金', amount: '5000' });

    await user.click(screen.getByRole('button', { name: '暫定支払いをすべて削除' }));
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(within(provisionalTable()).getAllByRole('row')).toHaveLength(3);

    confirm.mockReturnValue(true);
    await user.click(screen.getByRole('button', { name: '暫定支払いをすべて削除' }));
    expect(screen.getByText('まだ暫定支払いは登録されていません。')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '暫定支払いをすべて削除' })).not.toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem(PROVISIONAL_STORAGE_KEY) ?? 'null')).toEqual([]);
  });

  it('CSVが無くても使え、空状態の説明と月別サマリーが併存する', async () => {
    const user = userEvent.setup();
    render(<App />);
    expect(screen.queryByRole('heading', { name: '月別サマリー' })).not.toBeInTheDocument();

    await addProvisional(user, { month: '2026-11', label: '楽天カード 11月分', amount: '48500' });
    await addProvisional(user, { month: '2026-11', label: '水道代', amount: '3000', state: '見込み' });

    expect(screen.getByRole('heading', { name: 'まずはCSVを読み込みましょう' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '月別サマリー' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '明細' })).not.toBeInTheDocument();

    const summary = screen.getByRole('region', { name: '月別サマリーの表' });
    expect(within(summary).getByRole('columnheader', { name: /暫定支払い/ })).toBeInTheDocument();
    const row = within(summary).getByRole('row', { name: /2026年11月/ });
    expect(row).toHaveTextContent('51,500円');
    expect(row).toHaveTextContent('確定 48,500円 / 見込み 3,000円');
  });

  it('月別サマリーは暫定のみの月も行になり、銀行／カードの列はCSV由来のまま、支出・収支には暫定を含む', async () => {
    const user = userEvent.setup();
    render(<App />);
    await loadSample(user);
    expect(screen.getByTestId('summary-expense').textContent).toBe('395,750円');

    await addProvisional(user, { month: '2027-02', label: '自動車税', amount: '30500', kind: 'その他' });

    const summary = screen.getByRole('region', { name: '月別サマリーの表' });
    const row = within(summary).getByRole('row', { name: /2027年2月/ });
    // 収入 / 支出 / 収支 / 銀行の支出 / カードの支出 / 件数 / 暫定支払い
    const cells = within(row).getAllByRole('cell').map((c) => c.textContent);
    expect(cells.slice(0, 6)).toEqual(['0円', '30,500円', '−30,500円', '0円', '0円', '0']);
    expect(cells[6]).toContain('30,500円');
    expect(screen.getByTestId('summary-expense').textContent).toBe('426,250円');
    expect(screen.getByTestId('summary-provisional-total')).toHaveTextContent('30,500円');
  });

  it('「すべて消去」はCSVだけを消し、暫定支払いは残る', async () => {
    const user = userEvent.setup();
    render(<App />);
    await loadSample(user);
    await addProvisional(user, { month: '2026-11', label: '楽天カード', amount: '10000' });

    await user.click(screen.getByRole('button', { name: 'すべて消去' }));
    expect(screen.getByRole('heading', { name: 'まずはCSVを読み込みましょう' })).toBeInTheDocument();
    expect(within(provisionalTable()).getByRole('row', { name: /楽天カード/ })).toBeInTheDocument();
    expect(screen.getByTestId('summary-provisional-total')).toHaveTextContent('10,000円');
  });

  it('localStorageに保存され、再マウントで復元される（CSVは保存されない）', async () => {
    const user = userEvent.setup();
    const first = render(<App />);
    await loadSample(user);
    await addProvisional(user, { month: '2026-11', label: '楽天カード', amount: '48500', note: 'メモ' });

    const saved = JSON.parse(localStorage.getItem(PROVISIONAL_STORAGE_KEY) ?? 'null');
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ month: '2026-11', label: '楽天カード', amount: 48500, kind: 'card', confirmed: true, note: 'メモ' });
    expect(JSON.stringify(Object.entries(localStorage))).not.toContain('sample-bank.csv');

    first.unmount();
    render(<App />);
    expect(within(provisionalTable()).getByRole('row', { name: /楽天カード/ })).toHaveTextContent('48,500円');
    expect(screen.getByTestId('summary-provisional-total')).toHaveTextContent('48,500円');
    // CSVは復元されない
    expect(screen.getByRole('heading', { name: 'まずはCSVを読み込みましょう' })).toBeInTheDocument();

    // 編集・削除も保存に反映される
    await user.click(screen.getByRole('button', { name: '楽天カードを削除' }));
    expect(JSON.parse(localStorage.getItem(PROVISIONAL_STORAGE_KEY) ?? 'null')).toEqual([]);
  });

  it('月フィルタに暫定のみの月が出て、選ぶと暫定の合計も絞り込まれる', async () => {
    const user = userEvent.setup();
    render(<App />);
    await loadSample(user);
    expect(screen.queryByRole('checkbox', { name: '2027年1月' })).not.toBeInTheDocument();

    await addProvisional(user, { month: '2027-01', label: '固定資産税', amount: '60000', kind: 'その他' });
    // サンプルのカードCSVと同じ月のカード種別は置き換わるため、置き換えられない「その他」で入力する
    await addProvisional(user, { month: '2026-11', label: '楽天カード', amount: '10000', kind: 'その他' });
    expect(screen.getByTestId('summary-provisional-total')).toHaveTextContent('70,000円');

    await user.click(screen.getByRole('checkbox', { name: '2027年1月' }));
    expect(screen.getByTestId('summary-provisional-total')).toHaveTextContent('60,000円');
    expect(screen.getByTestId('summary-count')).toHaveTextContent('0件');
    // 一覧には登録済みのものがすべて残る
    expect(within(provisionalTable()).getAllByRole('row')).toHaveLength(3);

    // その月の暫定支払いを消すと、選択肢と選択が消える
    await user.click(screen.getByRole('button', { name: '固定資産税を削除' }));
    expect(screen.queryByRole('checkbox', { name: '2027年1月' })).not.toBeInTheDocument();
    expect(screen.getByTestId('summary-provisional-total')).toHaveTextContent('10,000円');
  });

  it('キーワードでも暫定支払いが絞り込まれる', async () => {
    const user = userEvent.setup();
    render(<App />);
    await addProvisional(user, { month: '2026-11', label: '楽天カード', amount: '10000' });
    await addProvisional(user, { month: '2026-11', label: '携帯料金', amount: '5000' });

    await user.type(screen.getByRole('searchbox', { name: /キーワード/ }), '携帯');
    expect(screen.getByTestId('summary-provisional-total')).toHaveTextContent('5,000円');
  });
});

/** 10月に利用し、11月に支払うカードCSV。分割払いがあり、支払総額の合計（52,000円）と11月支払金額の合計（50,000円）が異なる。 */
const OCT_USAGE_CARD_CSV = [
  '"利用日","利用店名・商品名","利用者","支払方法","利用金額","手数料/利息","支払総額","11月支払金額","当月請求額","12月繰越残高","新規サイン"',
  '"2026/10/03","スーパーマルエー","本人","1回","20,000","0","20,000","20,000","20,000","0",""',
  '"2026/10/20","家電量販店","本人","分割3回","32,000","0","32,000","30,000","30,000","2,000",""',
  '',
].join('\r\n');

describe('CSVによる暫定支払いの置き換え', () => {
  const SUPERSEDED_NOTE = 'summary-provisional-superseded';
  const OVERRIDE_NOTE = 'summary-provisional-csv-override';

  it('同じ支払い月のカードCSVを読み込むと暫定値がCSVの支払額で上書きされ、CSVを削除すると暫定値に戻る', async () => {
    const user = userEvent.setup();
    render(<App />);
    await addProvisional(user, { month: '2026-11', label: '楽天カード 11月分', amount: '48500' });
    expect(screen.getByTestId('summary-provisional-total')).toHaveTextContent('48,500円');
    expect(screen.queryByTestId(SUPERSEDED_NOTE)).not.toBeInTheDocument();
    expect(screen.queryByTestId(OVERRIDE_NOTE)).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '登録済み 1件' })).toBeInTheDocument();

    await loadSample(user); // 11月支払金額の合計は 66,510円

    // 一覧には残り、置き換え済みであることと、集計に使われるCSVの金額・差額が分かる
    const row = within(provisionalTable()).getByRole('row', { name: /楽天カード 11月分/ });
    expect(row).toHaveTextContent('CSVで置き換え済み');
    expect(row).toHaveTextContent('sample-card.csv');
    expect(row).toHaveTextContent('暫定値は集計対象外（CSVの支払額 66,510円を集計）');
    expect(row).toHaveTextContent('CSVの支払額: 66,510円（暫定: 48,500円、差額 +18,010円）');
    expect(row).toHaveTextContent('48,500円');
    expect(screen.getByRole('heading', { name: '登録済み 1件（うちCSVで置き換え済み 1件）' })).toBeInTheDocument();

    // 集計にはCSVの支払額が（確定として）入る。置き換えただけでは件数は減らない
    expect(screen.getByTestId('summary-provisional-total')).toHaveTextContent('66,510円');
    expect(screen.getByTestId('summary-provisional-confirmed')).toHaveTextContent('66,510円');
    expect(screen.getByTestId(OVERRIDE_NOTE)).toHaveTextContent('CSVの支払額で上書き 1件（合計 66,510円）');
    expect(screen.queryByTestId(SUPERSEDED_NOTE)).not.toBeInTheDocument();
    const monthly = screen.getByRole('region', { name: '月別サマリーの表' });
    const nov = within(monthly).getByRole('row', { name: /2026年11月/ });
    expect(nov).toHaveTextContent('66,510円');
    expect(nov).not.toHaveTextContent('48,500円');
    expect(nov).toHaveTextContent('CSV確定 66,510円');

    // CSVを削除すると暫定値に戻る
    await user.click(screen.getByRole('button', { name: 'sample-card.csvを削除' }));
    expect(screen.getByTestId('summary-provisional-total')).toHaveTextContent('48,500円');
    expect(screen.queryByTestId(SUPERSEDED_NOTE)).not.toBeInTheDocument();
    expect(screen.queryByTestId(OVERRIDE_NOTE)).not.toBeInTheDocument();
    const restored = within(provisionalTable()).getByRole('row', { name: /楽天カード 11月分/ });
    expect(restored).not.toHaveTextContent('CSVで置き換え済み');
    expect(restored).not.toHaveTextContent('差額');
    expect(screen.getByRole('heading', { name: '登録済み 1件' })).toBeInTheDocument();
    // 入力データ自体は消えていない（CSV由来の金額は保存されない）
    const saved = JSON.parse(localStorage.getItem(PROVISIONAL_STORAGE_KEY) ?? 'null');
    expect(saved).toHaveLength(1);
    expect(saved[0].amount).toBe(48500);
    expect(saved[0]).not.toHaveProperty('fromCsv');
  });

  it('暫定値とCSVの支払額が同じなら「差額なし」と表示する', async () => {
    const user = userEvent.setup();
    render(<App />);
    await addProvisional(user, { month: '2026-11', label: '楽天カード 11月分', amount: '66510' });
    await loadSample(user);
    const row = within(provisionalTable()).getByRole('row', { name: /楽天カード 11月分/ });
    expect(row).toHaveTextContent('CSVの支払額: 66,510円（暫定: 66,510円、差額なし）');
  });

  it('CSVの支払額が暫定値より小さければ差額はマイナスで表示する', async () => {
    const user = userEvent.setup();
    render(<App />);
    await addProvisional(user, { month: '2026-11', label: '楽天カード 11月分', amount: '70000' });
    await loadSample(user);
    const row = within(provisionalTable()).getByRole('row', { name: /楽天カード 11月分/ });
    expect(row).toHaveTextContent('差額 −3,490円');
  });

  it('利用月と支払い月が違うカードCSV（10月利用・11月支払金額）でも、11月の支払いが月別サマリーと月フィルタに残る', async () => {
    const user = userEvent.setup();
    render(<App />);
    await addProvisional(user, { month: '2026-11', label: '楽天カード 11月分', amount: '48500' });
    await user.upload(screen.getByLabelText('CSVファイルを選択'), csvFile('card-oct.csv', OCT_USAGE_CARD_CSV));
    await screen.findByRole('heading', { name: '明細' });

    const monthly = screen.getByRole('region', { name: '月別サマリーの表' });
    const nov = within(monthly).getByRole('row', { name: /2026年11月/ });
    expect(nov).toHaveTextContent('50,000円');
    expect(nov).toHaveTextContent('CSV確定 50,000円');
    expect(within(monthly).getByRole('row', { name: /2026年10月/ })).toBeInTheDocument();
    expect(screen.getByTestId('summary-provisional-total')).toHaveTextContent('50,000円');
    expect(screen.getByRole('checkbox', { name: '2026年11月' })).toBeInTheDocument();

    // 11月だけに絞り込んでも支払いが残る
    await user.click(screen.getByRole('checkbox', { name: '2026年11月' }));
    expect(screen.getByTestId('summary-provisional-total')).toHaveTextContent('50,000円');
    expect(within(screen.getByRole('region', { name: '月別サマリーの表' })).getByRole('row', { name: /2026年11月/ })).toHaveTextContent('50,000円');

    // 一覧には差額が出る
    const row = within(provisionalTable()).getByRole('row', { name: /楽天カード 11月分/ });
    expect(row).toHaveTextContent('CSVの支払額: 50,000円（暫定: 48,500円、差額 +1,500円）');
    expect(row).toHaveTextContent('暫定値は集計対象外（CSVの支払額 50,000円を集計）');
  });

  it('置き換わった月も月フィルタの候補・月別サマリーに残り、他の月の暫定値は影響を受けない', async () => {
    const user = userEvent.setup();
    render(<App />);
    await addProvisional(user, { month: '2027-03', label: '先の支払い', amount: '1000' });
    await addProvisional(user, { month: '2026-11', label: '楽天カード', amount: '2000' });
    await loadSample(user);

    // 先の支払い 1,000円 + 11月はCSVの支払額 66,510円
    expect(screen.getByTestId('summary-provisional-total')).toHaveTextContent('67,510円');
    expect(screen.getByTestId(OVERRIDE_NOTE)).toHaveTextContent('CSVの支払額で上書き 1件');
    const monthly = screen.getByRole('region', { name: '月別サマリーの表' });
    expect(within(monthly).getByRole('row', { name: /2027年3月/ })).toHaveTextContent('1,000円');
    expect(within(monthly).getByRole('row', { name: /2026年11月/ })).toHaveTextContent('CSV確定 66,510円');
    expect(screen.getByRole('checkbox', { name: '2026年11月' })).toBeInTheDocument();

    // 月フィルタで2027年3月だけにすると、11月の上書き分は外れる
    await user.click(screen.getByRole('checkbox', { name: '2027年3月' }));
    expect(screen.getByTestId('summary-provisional-total')).toHaveTextContent('1,000円');
    expect(screen.queryByTestId(OVERRIDE_NOTE)).not.toBeInTheDocument();
  });

  it('種別「その他」は置き換わらない', async () => {
    const user = userEvent.setup();
    render(<App />);
    await addProvisional(user, { month: '2026-11', label: '自動車税', amount: '30500', kind: 'その他' });
    await loadSample(user);

    expect(screen.getByTestId('summary-provisional-total')).toHaveTextContent('30,500円');
    expect(screen.queryByTestId(SUPERSEDED_NOTE)).not.toBeInTheDocument();
    expect(within(provisionalTable()).getByRole('row', { name: /自動車税/ })).not.toHaveTextContent('CSVで置き換え済み');
  });

  it('「CSVがあっても暫定値を使う」を付けると置き換わらず、バッジが出る。編集で切り替えられる', async () => {
    const user = userEvent.setup();
    render(<App />);
    await addProvisional(user, { month: '2026-11', label: '楽天カード', amount: '48500', pinned: true });
    await loadSample(user);

    expect(screen.getByTestId('summary-provisional-total')).toHaveTextContent('48,500円');
    expect(screen.queryByTestId(SUPERSEDED_NOTE)).not.toBeInTheDocument();
    const row = within(provisionalTable()).getByRole('row', { name: /楽天カード/ });
    expect(row).toHaveTextContent('暫定値を固定');
    expect(row).not.toHaveTextContent('CSVで置き換え済み');
    expect(JSON.parse(localStorage.getItem(PROVISIONAL_STORAGE_KEY) ?? 'null')[0].pinned).toBe(true);

    // 編集で固定を外すと置き換わる
    await user.click(screen.getByRole('button', { name: '楽天カードを編集' }));
    const checkbox = screen.getByRole('checkbox', { name: /CSVがあっても暫定値を使う/ });
    expect(checkbox).toBeChecked();
    await user.click(checkbox);
    await user.click(screen.getByRole('button', { name: '保存' }));
    expect(screen.getByTestId('summary-provisional-total')).toHaveTextContent('0円');
    const replaced = within(provisionalTable()).getByRole('row', { name: /楽天カード/ });
    expect(replaced).toHaveTextContent('CSVで置き換え済み');
    expect(replaced).not.toHaveTextContent('暫定値を固定');

    // 編集でもう一度固定すると集計に戻る
    await user.click(screen.getByRole('button', { name: '楽天カードを編集' }));
    await user.click(screen.getByRole('checkbox', { name: /CSVがあっても暫定値を使う/ }));
    await user.click(screen.getByRole('button', { name: '保存' }));
    expect(screen.getByTestId('summary-provisional-total')).toHaveTextContent('48,500円');
  });

  it('銀行種別は、その月の取引を含む銀行CSVで置き換わる（取引の無い月は置き換わらない）', async () => {
    const user = userEvent.setup();
    render(<App />);
    await addProvisional(user, { month: '2026-11', label: '家賃', amount: '85000', kind: '銀行' });
    await addProvisional(user, { month: '2026-12', label: '12月の家賃', amount: '85000', kind: '銀行' });
    expect(screen.getByTestId('summary-provisional-total')).toHaveTextContent('170,000円');

    await user.upload(screen.getByLabelText('CSVファイルを選択'), csvFile('bank.csv', SAMPLE_BANK_CSV));
    await screen.findByRole('heading', { name: '明細' });

    const replaced = within(provisionalTable()).getByRole('row', { name: /^2026年11月 家賃/ });
    expect(replaced).toHaveTextContent('CSVで置き換え済み');
    expect(replaced).toHaveTextContent('bank.csv');
    // 銀行はその月の取引がCSVに実在するので、CSVの支払額での上書きは行わない
    expect(replaced).toHaveTextContent('集計対象外');
    expect(replaced).not.toHaveTextContent('CSVの支払額');
    expect(within(provisionalTable()).getByRole('row', { name: /12月の家賃/ })).not.toHaveTextContent('CSVで置き換え済み');
    expect(screen.getByTestId('summary-provisional-total')).toHaveTextContent('85,000円');
    expect(screen.getByTestId(SUPERSEDED_NOTE)).toHaveTextContent('CSVで置き換え済み 1件（集計に含まれません）');

    // 銀行CSVはカード種別の暫定値には影響しない
    await addProvisional(user, { month: '2026-11', label: 'カード請求', amount: '1000' });
    expect(screen.getByTestId('summary-provisional-total')).toHaveTextContent('86,000円');
  });
});

describe('暫定支払いの支出合計・収支への反映', () => {
  const text = (id: string) => screen.getByTestId(id).textContent;
  const monthRow = (label: RegExp) =>
    within(within(screen.getByRole('region', { name: '月別サマリーの表' })).getByRole('row', { name: label }))
      .getAllByRole('cell')
      .map((c) => c.textContent ?? '');

  it('CSVが無く暫定だけのとき、支出合計＝暫定合計（確定＋見込み）、収支＝−暫定合計', async () => {
    const user = userEvent.setup();
    render(<App />);
    await addProvisional(user, { month: '2026-11', label: '楽天カード 11月分', amount: '48500' });
    await addProvisional(user, { month: '2026-12', label: '水道代', amount: '3000', state: '見込み' });

    expect(text('summary-income')).toBe('0円');
    expect(text('summary-expense')).toBe('51,500円');
    expect(text('summary-net')).toBe('−51,500円');
    expect(text('summary-bank-expense')).toBe('0円');
    expect(text('summary-card-expense')).toBe('0円');
    expect(text('summary-provisional-expense')).toBe('51,500円');
    expect(text('summary-provisional-total')).toBe('51,500円');
    expect(screen.getByRole('heading', { name: /暫定支払い（手入力・支出合計に含まれます）/ })).toBeInTheDocument();
  });

  it('CSVと暫定があるとき、支出合計＝銀行＋カード＋暫定、収支＝収入−支出合計（見込みも含む）', async () => {
    const user = userEvent.setup();
    render(<App />);
    await loadSample(user);
    // サンプル: 収入 560,000 / 銀行 329,240 / カード 66,510
    expect(text('summary-expense')).toBe('395,750円');
    expect(text('summary-net')).toBe('+164,250円');

    await addProvisional(user, { month: '2026-11', label: '保険料', amount: '100000', kind: 'その他' });
    expect(text('summary-income')).toBe('560,000円');
    expect(text('summary-bank-expense')).toBe('329,240円');
    expect(text('summary-card-expense')).toBe('66,510円');
    expect(text('summary-provisional-expense')).toBe('100,000円');
    expect(text('summary-expense')).toBe('495,750円');
    expect(text('summary-net')).toBe('+64,250円');
    expect(text('summary-count')).toBe('20件');

    // 見込みも支出に含まれ、支出が収入を上回れば収支はマイナスになる
    await addProvisional(user, { month: '2026-12', label: '旅行', amount: '80000', kind: 'その他', state: '見込み' });
    expect(text('summary-provisional-expense')).toBe('180,000円');
    expect(text('summary-expense')).toBe('575,750円');
    expect(text('summary-net')).toBe('−15,750円');
  });

  it('CSVで置き換えられたカードの暫定は、CSVの支払額で表示されるが、支出合計には二重に加算されない', async () => {
    const user = userEvent.setup();
    render(<App />);
    await addProvisional(user, { month: '2026-11', label: '楽天カード 11月分', amount: '48500' });
    expect(text('summary-expense')).toBe('48,500円');
    expect(text('summary-provisional-expense')).toBe('48,500円');

    await loadSample(user); // 11月支払金額の合計は 66,510円
    // 暫定の枠にはCSVの支払額が表示されるが、その元の利用明細は「カードの支出」に入っているため加算しない
    expect(text('summary-provisional-total')).toBe('66,510円');
    expect(text('summary-provisional-expense')).toBe('0円');
    // 銀行 329,240 + カード 66,510（暫定は加算しない）
    expect(text('summary-expense')).toBe('395,750円');
    expect(text('summary-net')).toBe('+164,250円');

    await user.click(screen.getByRole('button', { name: 'sample-card.csvを削除' }));
    // 暫定値に戻る: 銀行 329,240 + 暫定 48,500
    expect(text('summary-expense')).toBe('377,740円');
    expect(text('summary-provisional-expense')).toBe('48,500円');
  });

  it('銀行CSVで置き換えられた暫定は支出に含まれない', async () => {
    const user = userEvent.setup();
    render(<App />);
    await addProvisional(user, { month: '2026-11', label: '家賃', amount: '85000', kind: '銀行' });
    await addProvisional(user, { month: '2026-12', label: '12月の家賃', amount: '85000', kind: '銀行' });
    expect(text('summary-expense')).toBe('170,000円');

    await user.upload(screen.getByLabelText('CSVファイルを選択'), csvFile('bank.csv', SAMPLE_BANK_CSV));
    await screen.findByRole('heading', { name: '明細' });

    // 銀行 329,240 + 置き換えられなかった12月分 85,000（11月分は含まれない）
    expect(text('summary-bank-expense')).toBe('329,240円');
    expect(text('summary-provisional-expense')).toBe('85,000円');
    expect(text('summary-expense')).toBe('414,240円');
    expect(text('summary-net')).toBe('+145,760円');
  });

  it('月別サマリー: CSVと暫定が同じ月にあれば合算され、銀行／カードの列はCSV由来のまま', async () => {
    const user = userEvent.setup();
    render(<App />);
    await loadSample(user);
    // 11月: 収入 280,000 / 銀行 172,830 / カード(利用月) 35,310 / 件数 10
    await addProvisional(user, { month: '2026-11', label: '保険料', amount: '10000', kind: 'その他' });

    const cells = monthRow(/2026年11月/);
    expect(cells.slice(0, 6)).toEqual(['280,000円', '218,140円', '+61,860円', '172,830円', '35,310円', '10']);
    expect(cells[6]).toContain('10,000円');
    // 暫定のない10月は変わらない
    expect(monthRow(/2026年10月/).slice(0, 3)).toEqual(['280,000円', '187,610円', '+92,390円']);
  });

  it('月フィルタ・キーワードで、暫定の含まれ方が変わる', async () => {
    const user = userEvent.setup();
    render(<App />);
    await loadSample(user);
    await addProvisional(user, { month: '2027-01', label: '固定資産税', amount: '60000', kind: 'その他' });
    await addProvisional(user, { month: '2026-11', label: '保険料', amount: '10000', kind: 'その他' });
    expect(text('summary-expense')).toBe('465,750円');

    // 月: 2027年1月だけ → CSVなし、暫定 60,000 のみ
    await user.click(screen.getByRole('checkbox', { name: '2027年1月' }));
    expect(text('summary-expense')).toBe('60,000円');
    expect(text('summary-net')).toBe('−60,000円');
    await user.click(screen.getByRole('checkbox', { name: '2027年1月' }));

    // 月: 2026年11月だけ → 11月のCSV支出 208,140 + 暫定 10,000
    await user.click(screen.getByRole('checkbox', { name: '2026年11月' }));
    expect(text('summary-expense')).toBe('218,140円');
    expect(text('summary-net')).toBe('+61,860円');
    await user.click(screen.getByRole('checkbox', { name: '2026年11月' }));

    // キーワード: 摘要に一致した暫定支払いだけが含まれる
    await user.type(screen.getByRole('searchbox', { name: /キーワード/ }), '固定資産税');
    expect(text('summary-count')).toBe('0件');
    expect(text('summary-expense')).toBe('60,000円');
    expect(text('summary-provisional-expense')).toBe('60,000円');
    await user.clear(screen.getByRole('searchbox', { name: /キーワード/ }));
    await user.type(screen.getByRole('searchbox', { name: /キーワード/ }), 'ガス料金');
    expect(text('summary-expense')).toBe('5,400円');
    expect(text('summary-provisional-expense')).toBe('0円');
  });
});

describe('タグ付け', () => {
  /** 「タグを作る」フォームでタグを追加する */
  async function addTagByForm(user: User, name: string) {
    await user.type(screen.getByLabelText('タグ名'), name);
    await user.click(screen.getByRole('button', { name: 'タグを追加' }));
  }

  /** 「自動タグ付けのルール」フォームでルールを追加する */
  async function addRuleByForm(user: User, keyword: string, tagName: string) {
    await user.type(screen.getByLabelText('摘要に含む文字列'), keyword);
    await user.selectOptions(screen.getByLabelText('付けるタグ'), tagName);
    await user.click(screen.getByRole('button', { name: 'ルールを追加' }));
  }

  /** 明細の表のうち、摘要が一致する行（日付などの絞り込みに使う文字列を含むもの） */
  function txRows(description: string, containing = ''): HTMLElement[] {
    const table = screen.getByRole('table', { name: /明細一覧/ });
    return within(table)
      .getAllByRole('row')
      .filter((row) => {
        const cells = within(row).queryAllByRole('cell');
        return cells[2]?.textContent === description && (row.textContent ?? '').includes(containing);
      });
  }

  /** 明細の行の「タグ」列の文字列（チップの名前、またはタグなし） */
  function tagCellText(description: string, containing = ''): string {
    const [row] = txRows(description, containing);
    if (!row) throw new Error(`行が見つかりません: ${description}`);
    return within(row).getAllByRole('cell')[3]?.textContent ?? '';
  }

  const rowTagButton = (description: string) =>
    screen.getByRole('button', { name: `${description}のタグを編集` });
  const breakdown = () => screen.getByTestId('tag-breakdown');
  const breakdownRow = (name: RegExp | string) => within(breakdown()).getByRole('button', { name });

  it('CSVが無くても「タグとルール」が表示され、保存範囲の説明とおすすめタグの案内が出る', () => {
    render(<App />);
    expect(screen.getByRole('heading', { name: 'タグとルール' })).toBeInTheDocument();
    expect(
      screen.getByText(/タグ・ルール・手動の設定だけがこのブラウザのlocalStorageに保存され、CSVの明細（日付・摘要・金額など）そのものは保存されません/),
    ).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'まずはタグを作りましょう' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'おすすめのタグを追加' })).toBeInTheDocument();
    expect(screen.getByText('まだルールはありません。')).toBeInTheDocument();
    // タグが無い間は、ルールを作れない旨を出す
    expect(screen.getByText(/先にタグを作成してください/)).toBeInTheDocument();
  });

  it('タグを作成できる（CSVなしでも）。色の変更・名前の変更・一覧の件数も反映される', async () => {
    const user = userEvent.setup();
    render(<App />);
    await addTagByForm(user, '家賃');

    expect(screen.getByRole('heading', { name: 'タグ一覧（1件）' })).toBeInTheDocument();
    const list = screen.getAllByRole('list').find((l) => l.className.includes('tag-list'));
    expect(list).toHaveTextContent('家賃');
    expect(list).toHaveTextContent('0件');
    expect(screen.queryByRole('heading', { name: 'まずはタグを作りましょう' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('タグ名')).toHaveValue('');

    await user.selectOptions(screen.getByLabelText('「家賃」の色'), 'オレンジ');
    expect(JSON.parse(localStorage.getItem(TAGS_STORAGE_KEY) ?? 'null').tags[0]).toMatchObject({ name: '家賃', color: 'orange' });

    await user.click(screen.getByRole('button', { name: '「家賃」の名前を変更' }));
    const input = screen.getByLabelText('「家賃」の新しい名前');
    await user.clear(input);
    await user.type(input, '住居費');
    await user.click(screen.getByRole('button', { name: '名前を保存' }));
    expect(screen.getByRole('button', { name: '「住居費」を削除' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '「家賃」を削除' })).not.toBeInTheDocument();
  });

  it('空の名前と重複した名前はエラーを表示する（aria-invalid / aria-describedby）', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole('button', { name: 'タグを追加' }));
    const input = screen.getByLabelText('タグ名');
    expect(screen.getByText('タグ名を入力してください。')).toBeInTheDocument();
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input.getAttribute('aria-describedby')).toContain(screen.getByText('タグ名を入力してください。').id);
    expect(input).toHaveFocus();

    await addTagByForm(user, '家賃');
    await addTagByForm(user, '家賃');
    expect(screen.getByText('同じ名前のタグがすでにあります。')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'タグ一覧（1件）' })).toBeInTheDocument();

    // 入力し直すとエラーは消える
    await user.type(screen.getByLabelText('タグ名'), 'x');
    expect(screen.queryByText('同じ名前のタグがすでにあります。')).not.toBeInTheDocument();
    expect(screen.getByLabelText('タグ名')).not.toHaveAttribute('aria-invalid');
  });

  it('名前の変更で重複・空はエラーになる。ルールの空のキーワードもエラーになる', async () => {
    const user = userEvent.setup();
    render(<App />);
    await addTagByForm(user, '家賃');
    await addTagByForm(user, '食費');

    await user.click(screen.getByRole('button', { name: '「食費」の名前を変更' }));
    const input = screen.getByLabelText('「食費」の新しい名前');
    await user.clear(input);
    await user.type(input, '家賃');
    await user.click(screen.getByRole('button', { name: '名前を保存' }));
    expect(screen.getByText('同じ名前のタグがすでにあります。')).toBeInTheDocument();
    expect(input).toHaveAttribute('aria-invalid', 'true');
    await user.click(screen.getByRole('button', { name: 'キャンセル' }));

    await user.click(screen.getByRole('button', { name: 'ルールを追加' }));
    expect(screen.getByText('キーワードを入力してください。')).toBeInTheDocument();
    expect(screen.getByLabelText('摘要に含む文字列')).toHaveAttribute('aria-invalid', 'true');
  });

  it('おすすめのタグをまとめて追加できる（2回目は追加済みと案内）', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: 'おすすめのタグを追加' }));
    expect(screen.getByRole('heading', { name: 'タグ一覧（9件）' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '「サブスク」を削除' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'おすすめのタグを追加' }));
    expect(screen.getByText('おすすめのタグはすべて追加済みです。')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'タグ一覧（9件）' })).toBeInTheDocument();
  });

  it('ルールを追加すると、該当件数のプレビューが出て、サンプルの該当する明細に自動でタグが付く', async () => {
    const user = userEvent.setup();
    render(<App />);
    await loadSample(user);
    await addTagByForm(user, '家賃');

    await user.type(screen.getByLabelText('摘要に含む文字列'), '家賃');
    expect(screen.getByText(/現在読み込んでいる明細（CSVの取引と暫定支払い 20件）のうち、2件が該当します/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'ルールを追加' }));

    expect(screen.getByText('摘要に「家賃」を含む →')).toBeInTheDocument();
    expect(txRows('振込 家賃')).toHaveLength(2);
    for (const row of txRows('振込 家賃')) expect(within(row).getAllByRole('cell')[3]).toHaveTextContent('家賃');
    expect(tagCellText('給与', '2026/10/05')).toBe('タグなしタグを編集');
    // タグ一覧の件数は、読み込み中の明細にタグが付いている件数
    expect(screen.getAllByRole('list').find((l) => l.className.includes('tag-list'))).toHaveTextContent('2件');
    // 同じキーワードの重複ルールはエラー
    await user.type(screen.getByLabelText('摘要に含む文字列'), '家賃');
    await user.click(screen.getByRole('button', { name: 'ルールを追加' }));
    expect(screen.getByText('同じキーワードのルールがすでにあります。')).toBeInTheDocument();
  });

  it('明細ごとに手動でタグを付け外しでき、「ルールに戻す」でルールの結果に戻る', async () => {
    const user = userEvent.setup();
    render(<App />);
    await loadSample(user);
    await addTagByForm(user, '家賃');
    await addTagByForm(user, 'サブスク');
    await addRuleByForm(user, '家賃', '家賃');

    // 手動で付ける: ルールに当たらない明細にタグを付ける
    expect(tagCellText('動画配信サービス')).not.toContain('サブスク');
    await user.click(rowTagButton('動画配信サービス'));
    const editor = screen.getByRole('group', { name: '「動画配信サービス」のタグを編集' });
    expect(within(editor).getByRole('button', { name: 'ルールに戻す' })).toBeDisabled();
    await user.click(within(editor).getByRole('checkbox', { name: 'サブスク' }));
    await user.click(within(editor).getByRole('button', { name: 'タグを保存' }));
    expect(screen.queryByRole('group', { name: /のタグを編集/ })).not.toBeInTheDocument();
    expect(tagCellText('動画配信サービス')).toContain('サブスク');

    // 手動で外す: ルールで付いたタグを、1件だけ外す（もう1件は付いたまま）
    await user.click(screen.getAllByRole('button', { name: '振込 家賃のタグを編集' })[0]!);
    const rentEditor = screen.getByRole('group', { name: '「振込 家賃」のタグを編集' });
    expect(within(rentEditor).getByRole('checkbox', { name: '家賃' })).toBeChecked();
    await user.click(within(rentEditor).getByRole('checkbox', { name: '家賃' }));
    await user.click(within(rentEditor).getByRole('button', { name: 'タグを保存' }));
    // 同じ日付・摘要・金額の明細には同じ設定が適用される。日付が違う2件のうち、先頭（11/01）だけが外れる
    expect(tagCellText('振込 家賃', '2026/11/01')).not.toContain('家賃');
    expect(tagCellText('振込 家賃', '2026/10/01')).toContain('家賃');

    // ルールに戻す
    await user.click(screen.getAllByRole('button', { name: '振込 家賃のタグを編集' })[0]!);
    await user.click(screen.getByRole('button', { name: 'ルールに戻す' }));
    expect(tagCellText('振込 家賃', '2026/11/01')).toContain('家賃');
    expect(JSON.parse(localStorage.getItem(TAGS_STORAGE_KEY) ?? 'null').overrides).not.toHaveProperty(
      'bank|2026-11-01|振込 家賃|85000|0',
    );
  });

  it('編集UIはキーボードで開閉でき、開いている行が分かる', async () => {
    const user = userEvent.setup();
    render(<App />);
    await loadSample(user);
    await addTagByForm(user, '食費');

    const button = rowTagButton('電気料金');
    button.focus();
    await user.keyboard('{Enter}');
    expect(button).toHaveAttribute('aria-expanded', 'true');
    expect(button).toHaveAttribute('aria-controls');
    expect(button.closest('tr')).toHaveClass('is-editing');
    // 開いたら編集UIの先頭の入力にフォーカスが移る
    const editor = screen.getByRole('group', { name: '「電気料金」のタグを編集' });
    expect(within(editor).getByRole('checkbox', { name: '食費' })).toHaveFocus();

    await user.keyboard('{Escape}');
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(button.closest('tr')).not.toHaveClass('is-editing');
    await vi.waitFor(() => expect(button).toHaveFocus());
  });

  it('「この摘要をルールにする」で、その行の摘要をキーワードにしたルールが追加される', async () => {
    const user = userEvent.setup();
    render(<App />);
    await loadSample(user);
    await addTagByForm(user, '光熱費');

    await user.click(rowTagButton('電気料金'));
    const editor = screen.getByRole('group', { name: '「電気料金」のタグを編集' });
    const ruleButton = within(editor).getByRole('button', { name: 'この摘要をルールにする' });
    expect(ruleButton).toBeDisabled(); // タグを1つ選ぶまでは使えない
    await user.click(within(editor).getByRole('checkbox', { name: '光熱費' }));
    await user.click(ruleButton);

    expect(within(editor).getByText(/ルールを追加しました（摘要に「電気料金」を含む明細に「光熱費」）/)).toBeInTheDocument();
    expect(screen.getByText('摘要に「電気料金」を含む →')).toBeInTheDocument();
    // 手動の設定は保存していないが、ルールで自動的にタグが付く
    expect(tagCellText('電気料金')).toContain('光熱費');

    // もう一度押すと重複エラー
    await user.click(ruleButton);
    expect(within(editor).getByText('同じキーワードのルールがすでにあります。')).toBeInTheDocument();
  });

  it('暫定支払いにもタグのチップと編集UIがあり、ルールと手動で付けられる', async () => {
    const user = userEvent.setup();
    render(<App />);
    await addTagByForm(user, '保険');
    await addTagByForm(user, 'サブスク');
    await addRuleByForm(user, '保険', '保険');

    await addProvisional(user, { month: '2026-12', label: '自動車保険', amount: '30000', kind: 'その他' });
    await addProvisional(user, { month: '2026-12', label: '動画サービス年額', amount: '12000', kind: 'その他' });
    const insurance = within(provisionalTable()).getByRole('row', { name: /自動車保険/ });
    expect(within(insurance).getAllByRole('cell')[1]).toHaveTextContent('保険');
    const video = within(provisionalTable()).getByRole('row', { name: /動画サービス年額/ });
    expect(within(video).getAllByRole('cell')[1]).toHaveTextContent('タグなし');

    await user.click(screen.getByRole('button', { name: '動画サービス年額のタグを編集' }));
    const editor = screen.getByRole('group', { name: '「動画サービス年額」のタグを編集' });
    await user.click(within(editor).getByRole('checkbox', { name: 'サブスク' }));
    await user.click(within(editor).getByRole('button', { name: 'タグを保存' }));
    expect(within(provisionalTable()).getByRole('row', { name: /動画サービス年額/ })).toHaveTextContent('サブスク');

    // 保存されたキーは prov:<id>
    const overrides = JSON.parse(localStorage.getItem(TAGS_STORAGE_KEY) ?? 'null').overrides as Record<string, string[]>;
    expect(Object.keys(overrides)).toHaveLength(1);
    expect(Object.keys(overrides)[0]).toMatch(/^prov:/);
  });

  it('タグで絞り込める（複数選択・タグなし）。概要・明細の件数が変わり、リセットで戻る', async () => {
    const user = userEvent.setup();
    render(<App />);
    await loadSample(user);
    await addTagByForm(user, '家賃');
    await addTagByForm(user, '食費');
    await addRuleByForm(user, '家賃', '家賃');
    await addRuleByForm(user, 'スーパー', '食費');

    const filter = screen.getByRole('group', { name: /^タグ（未選択なら全て/ });
    await user.click(within(filter).getByRole('checkbox', { name: '家賃' }));
    expect(screen.getByTestId('summary-count')).toHaveTextContent('2件');
    expect(screen.getByTestId('tx-count')).toHaveTextContent('全2件中 2件を表示');
    expect(screen.getByTestId('summary-bank-expense')).toHaveTextContent('170,000円');
    expect(screen.getByTestId('summary-card-expense')).toHaveTextContent('0円');

    // 複数選ぶと、どれかが付いた明細
    await user.click(within(filter).getByRole('checkbox', { name: '食費' }));
    expect(screen.getByTestId('tx-count')).toHaveTextContent('全5件中 5件を表示');

    // タグなし
    await user.click(within(filter).getByRole('checkbox', { name: '家賃' }));
    await user.click(within(filter).getByRole('checkbox', { name: '食費' }));
    await user.click(within(filter).getByRole('checkbox', { name: 'タグなし' }));
    expect(screen.getByTestId('tx-count')).toHaveTextContent('全15件中 15件を表示');
    expect(screen.getByTestId('summary-count')).toHaveTextContent('15件');

    await user.click(within(filter).getByRole('checkbox', { name: '家賃' }));
    expect(screen.getByTestId('tx-count')).toHaveTextContent('全17件中 17件を表示');

    // 条件をリセットでタグの選択も外れる
    await user.click(screen.getByRole('button', { name: '条件をリセット' }));
    expect(within(filter).getByRole('checkbox', { name: 'タグなし' })).not.toBeChecked();
    expect(within(filter).getByRole('checkbox', { name: '家賃' })).not.toBeChecked();
    expect(screen.getByTestId('tx-count')).toHaveTextContent('全20件中 20件を表示');
  });

  it('タグの絞り込みは暫定支払いにも適用され、残高推移にも反映される', async () => {
    const user = userEvent.setup();
    render(<App />);
    await loadSample(user);
    await addTagByForm(user, '家賃');
    await addRuleByForm(user, '家賃', '家賃');
    await addProvisional(user, { month: '2027-01', label: '来年の家賃の前払い', amount: '85000', kind: 'その他' });
    await addProvisional(user, { month: '2027-01', label: '固定資産税', amount: '60000', kind: 'その他' });
    expect(screen.getByTestId('summary-provisional-total')).toHaveTextContent('145,000円');

    const filter = screen.getByRole('group', { name: /^タグ（未選択なら全て/ });
    await user.click(within(filter).getByRole('checkbox', { name: '家賃' }));
    expect(screen.getByTestId('summary-provisional-total')).toHaveTextContent('85,000円');
    expect(screen.getByTestId('summary-count')).toHaveTextContent('2件');
    // 銀行の残高推移も、絞り込み後の取引だけになる（家賃の2件。最後は 11/01 の 338,590円）
    expect(screen.getByRole('img', { name: /銀行の残高推移/ })).toHaveAccessibleName(/2026\/11\/01は338,590円。$/);

    await user.click(within(filter).getByRole('checkbox', { name: '家賃' }));
    await user.click(within(filter).getByRole('checkbox', { name: 'タグなし' }));
    expect(screen.getByTestId('summary-provisional-total')).toHaveTextContent('60,000円');
  });

  it('タグ別の支出: タグごとの金額・件数・割合・「タグなし」を表示し、CSVで上書きされた暫定支払いは含めない', async () => {
    const user = userEvent.setup();
    render(<App />);
    await loadSample(user);
    await addTagByForm(user, '家賃');
    await addTagByForm(user, '食費');
    await addTagByForm(user, 'カード請求');
    await addRuleByForm(user, '家賃', '家賃');
    await addRuleByForm(user, 'スーパー', '食費');
    await addRuleByForm(user, 'ワイジェイ', 'カード請求');
    // 11月分はサンプルのカードCSV（66,510円）で上書きされる。12月分は暫定のまま集計される
    await addProvisional(user, { month: '2026-11', label: 'ワイジェイカード 11月分', amount: '48500' });
    await addProvisional(user, { month: '2026-12', label: 'ワイジェイカード 12月分', amount: '1000' });
    await addProvisional(user, { month: '2026-12', label: '来月の家賃', amount: '50000', kind: 'その他' });

    // 支出合計 = CSV 395,750円 + 暫定の 12月分 1,000円 + 50,000円（上書き分は加算しない）
    expect(screen.getByTestId('summary-expense')).toHaveTextContent('446,750円');

    expect(breakdownRow(/^家賃/)).toHaveTextContent('220,000円（3件・49.2%）');
    expect(breakdownRow(/^食費/)).toHaveTextContent('23,010円（3件・5.2%）');
    expect(breakdownRow(/^カード請求/)).toHaveTextContent('1,000円（1件・0.2%）');
    // 残り: 446,750 - 220,000 - 23,010 - 1,000 = 202,740円、18件 - 5件 = 13件
    expect(breakdownRow(/^タグなし/)).toHaveTextContent('202,740円（13件・45.4%）');
    expect(screen.getByText(/複数のタグが付いた明細は各タグに全額を計上するため、タグ別の合計が支出合計を超えることがあります/)).toBeInTheDocument();
    // 合計の大きい順（家賃 > 食費 > カード請求）、タグなしは最後
    expect(within(breakdown()).getAllByRole('button').map((b) => b.textContent?.slice(0, 4))).toEqual([
      '家賃22',
      '食費23',
      'カード請',
      'タグなし',
    ]);
  });

  it('複数のタグが付いた明細は各タグに全額を計上する', async () => {
    const user = userEvent.setup();
    render(<App />);
    await loadSample(user);
    await addTagByForm(user, '固定費');
    await addTagByForm(user, '家賃');
    await addRuleByForm(user, '家賃', '家賃');
    await addRuleByForm(user, '家賃', '固定費');

    expect(breakdownRow(/^家賃/)).toHaveTextContent('170,000円（2件');
    expect(breakdownRow(/^固定費/)).toHaveTextContent('170,000円（2件');
    expect(tagCellText('振込 家賃', '2026/11/01')).toContain('家賃');
    expect(tagCellText('振込 家賃', '2026/11/01')).toContain('固定費');
  });

  it('タグ別の支出の行を押すと、そのタグで絞り込み、もう一度押すと解除する', async () => {
    const user = userEvent.setup();
    render(<App />);
    await loadSample(user);
    await addTagByForm(user, '食費');
    await addRuleByForm(user, 'スーパー', '食費');

    await user.click(breakdownRow(/^食費/));
    expect(breakdownRow(/^食費/)).toHaveAttribute('aria-pressed', 'true');
    const filter = screen.getByRole('group', { name: /^タグ（未選択なら全て/ });
    expect(within(filter).getByRole('checkbox', { name: '食費' })).toBeChecked();
    expect(screen.getByTestId('tx-count')).toHaveTextContent('全3件中 3件を表示');
    // 絞り込み後の概要・集計に反映される
    expect(screen.getByTestId('summary-card-expense')).toHaveTextContent('23,010円');

    await user.click(breakdownRow(/^食費/));
    expect(within(filter).getByRole('checkbox', { name: '食費' })).not.toBeChecked();
    expect(screen.getByTestId('tx-count')).toHaveTextContent('全20件中 20件を表示');
  });

  it('タグがまだ無いときは、タグ別の支出に作成の案内を出す', async () => {
    const user = userEvent.setup();
    render(<App />);
    await loadSample(user);
    expect(screen.getByRole('heading', { name: 'タグ別の支出' })).toBeInTheDocument();
    expect(screen.getByText(/タグがまだありません。「タグとルール」でタグを作ると/)).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: /^タグ（未選択なら全て/ })).not.toBeInTheDocument();
  });

  describe('タグの削除', () => {
    it('確認でキャンセルすると削除されない', async () => {
      const user = userEvent.setup();
      const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
      render(<App />);
      await addTagByForm(user, '家賃');
      await user.click(screen.getByRole('button', { name: '「家賃」を削除' }));
      expect(confirm).toHaveBeenCalledTimes(1);
      expect(screen.getByRole('button', { name: '「家賃」を削除' })).toBeInTheDocument();
    });

    it('削除すると、ルール・手動の設定・絞り込みの選択からも外れる', async () => {
      const user = userEvent.setup();
      vi.spyOn(window, 'confirm').mockReturnValue(true);
      render(<App />);
      await loadSample(user);
      await addTagByForm(user, '家賃');
      await addTagByForm(user, '食費');
      await addRuleByForm(user, '家賃', '家賃');
      // 手動で食費も付ける
      await user.click(rowTagButton('電気料金'));
      const editor = screen.getByRole('group', { name: '「電気料金」のタグを編集' });
      await user.click(within(editor).getByRole('checkbox', { name: '食費' }));
      await user.click(within(editor).getByRole('button', { name: 'タグを保存' }));
      expect(tagCellText('電気料金')).toContain('食費');
      // 家賃で絞り込み中
      const filter = screen.getByRole('group', { name: /^タグ（未選択なら全て/ });
      await user.click(within(filter).getByRole('checkbox', { name: '家賃' }));
      expect(screen.getByTestId('tx-count')).toHaveTextContent('全2件中 2件を表示');

      await user.click(screen.getByRole('button', { name: '「家賃」を削除' }));
      // ルールが消える
      expect(screen.getByText('まだルールはありません。')).toBeInTheDocument();
      // 選択中のタグが削除されたので、絞り込みも外れて全件に戻る
      expect(screen.getByTestId('tx-count')).toHaveTextContent('全20件中 20件を表示');
      expect(within(filter).queryByRole('checkbox', { name: '家賃' })).not.toBeInTheDocument();
      expect(within(filter).getByRole('checkbox', { name: 'タグなし' })).not.toBeChecked();
      expect(tagCellText('振込 家賃', '2026/11/01')).not.toContain('家賃');
      // 手動で付けた食費は残る
      expect(tagCellText('電気料金')).toContain('食費');
      const saved = JSON.parse(localStorage.getItem(TAGS_STORAGE_KEY) ?? 'null');
      expect(saved.tags.map((t: { name: string }) => t.name)).toEqual(['食費']);
      expect(saved.rules).toEqual([]);
    });
  });

  it('localStorageに保存され、再マウントで復元される（CSVは復元されない）', async () => {
    const user = userEvent.setup();
    const first = render(<App />);
    await loadSample(user);
    await addTagByForm(user, '家賃');
    await addTagByForm(user, 'サブスク');
    await addRuleByForm(user, '家賃', '家賃');
    await user.click(rowTagButton('動画配信サービス'));
    const editor = screen.getByRole('group', { name: '「動画配信サービス」のタグを編集' });
    await user.click(within(editor).getByRole('checkbox', { name: 'サブスク' }));
    await user.click(within(editor).getByRole('button', { name: 'タグを保存' }));

    const saved = JSON.parse(localStorage.getItem(TAGS_STORAGE_KEY) ?? 'null');
    expect(saved.tags.map((t: { name: string }) => t.name)).toEqual(['家賃', 'サブスク']);
    expect(saved.rules).toHaveLength(1);
    expect(saved.rules[0]).toMatchObject({ keyword: '家賃' });
    expect(Object.keys(saved.overrides)).toHaveLength(1);
    const dump = JSON.stringify(Object.entries(localStorage));
    expect(dump).not.toContain('sample-bank.csv');
    expect(dump).not.toContain('sample-card.csv');

    first.unmount();
    render(<App />);
    expect(screen.getByRole('heading', { name: 'タグ一覧（2件）' })).toBeInTheDocument();
    expect(screen.getByText('摘要に「家賃」を含む →')).toBeInTheDocument();
    // CSVは復元されない
    expect(screen.getByRole('heading', { name: 'まずはCSVを読み込みましょう' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '明細' })).not.toBeInTheDocument();

    // 同じCSVを読み込み直すと、保存されたルールと手動の設定で同じタグが付く
    await loadSample(user);
    expect(tagCellText('振込 家賃', '2026/10/01')).toContain('家賃');
    expect(tagCellText('動画配信サービス')).toContain('サブスク');
  });

  it('壊れた保存データでも空の状態で起動する', () => {
    localStorage.setItem(TAGS_STORAGE_KEY, '{broken');
    render(<App />);
    expect(screen.getByRole('heading', { name: 'まずはタグを作りましょう' })).toBeInTheDocument();
  });
});

