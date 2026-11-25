import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import { PROVISIONAL_STORAGE_KEY } from './lib/provisional';
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
      screen.getByText(/同じ支払いのCSV（カードは同じ支払い月のCSV、銀行はその月の取引を含むCSV）を読み込むと、CSVのデータが暫定値を置き換えます。置き換えられた暫定値は集計から外れ、CSVを削除すると元に戻ります。/),
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
    // 既存の数値には混ぜない
    expect(screen.getByTestId('summary-expense')).toHaveTextContent('0円');
    expect(screen.getByTestId('summary-card-expense')).toHaveTextContent('0円');

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

  it('月別サマリーは暫定のみの月も行になり、CSVの列の意味は変わらない', async () => {
    const user = userEvent.setup();
    render(<App />);
    await loadSample(user);
    const expenseBefore = screen.getByTestId('summary-expense').textContent;

    await addProvisional(user, { month: '2027-02', label: '自動車税', amount: '30500', kind: 'その他' });

    const summary = screen.getByRole('region', { name: '月別サマリーの表' });
    const row = within(summary).getByRole('row', { name: /2027年2月/ });
    expect(row).toHaveTextContent('30,500円');
    expect(screen.getByTestId('summary-expense').textContent).toBe(expenseBefore);
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

describe('CSVによる暫定支払いの置き換え', () => {
  const SUPERSEDED_NOTE = 'summary-provisional-superseded';

  it('同じ支払い月のカードCSVを読み込むと暫定値が置き換わって集計から外れ、CSVを削除すると戻る', async () => {
    const user = userEvent.setup();
    render(<App />);
    await addProvisional(user, { month: '2026-11', label: '楽天カード 11月分', amount: '48500' });
    expect(screen.getByTestId('summary-provisional-total')).toHaveTextContent('48,500円');
    expect(screen.queryByTestId(SUPERSEDED_NOTE)).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '登録済み 1件' })).toBeInTheDocument();

    await loadSample(user);

    // 一覧には残り、置き換え済みであることが文言で分かる
    const row = within(provisionalTable()).getByRole('row', { name: /楽天カード 11月分/ });
    expect(row).toHaveTextContent('CSVで置き換え済み');
    expect(row).toHaveTextContent('sample-card.csv');
    expect(row).toHaveTextContent('集計対象外');
    expect(row).toHaveTextContent('48,500円');
    expect(screen.getByRole('heading', { name: '登録済み 1件（うちCSVで置き換え済み 1件）' })).toBeInTheDocument();

    // 集計からは外れる
    expect(screen.getByTestId('summary-provisional-total')).toHaveTextContent('0円');
    expect(screen.getByTestId('summary-provisional-confirmed')).toHaveTextContent('0円');
    expect(screen.getByTestId(SUPERSEDED_NOTE)).toHaveTextContent('CSVで置き換え済み 1件（集計に含まれません）');
    const monthly = screen.getByRole('region', { name: '月別サマリーの表' });
    expect(within(monthly).getByRole('row', { name: /2026年11月/ })).not.toHaveTextContent('48,500円');

    // CSVを削除すると暫定値が集計に戻る
    await user.click(screen.getByRole('button', { name: 'sample-card.csvを削除' }));
    expect(screen.getByTestId('summary-provisional-total')).toHaveTextContent('48,500円');
    expect(screen.queryByTestId(SUPERSEDED_NOTE)).not.toBeInTheDocument();
    const restored = within(provisionalTable()).getByRole('row', { name: /楽天カード 11月分/ });
    expect(restored).not.toHaveTextContent('CSVで置き換え済み');
    expect(screen.getByRole('heading', { name: '登録済み 1件' })).toBeInTheDocument();
    // 入力データ自体は消えていない
    expect(JSON.parse(localStorage.getItem(PROVISIONAL_STORAGE_KEY) ?? 'null')).toHaveLength(1);
  });

  it('置き換わった月は月フィルタの候補・月別サマリーの暫定列にも出ない', async () => {
    const user = userEvent.setup();
    render(<App />);
    await addProvisional(user, { month: '2027-03', label: '先の支払い', amount: '1000' });
    await addProvisional(user, { month: '2026-11', label: '楽天カード', amount: '2000' });
    await loadSample(user);

    expect(screen.getByTestId('summary-provisional-total')).toHaveTextContent('1,000円');
    expect(screen.getByTestId(SUPERSEDED_NOTE)).toHaveTextContent('CSVで置き換え済み 1件');
    const monthly = screen.getByRole('region', { name: '月別サマリーの表' });
    expect(within(monthly).getByRole('row', { name: /2027年3月/ })).toHaveTextContent('1,000円');
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
    expect(within(provisionalTable()).getByRole('row', { name: /12月の家賃/ })).not.toHaveTextContent('CSVで置き換え済み');
    expect(screen.getByTestId('summary-provisional-total')).toHaveTextContent('85,000円');
    expect(screen.getByTestId(SUPERSEDED_NOTE)).toHaveTextContent('CSVで置き換え済み 1件（集計に含まれません）');

    // 銀行CSVはカード種別の暫定値には影響しない
    await addProvisional(user, { month: '2026-11', label: 'カード請求', amount: '1000' });
    expect(screen.getByTestId('summary-provisional-total')).toHaveTextContent('86,000円');
  });
});
