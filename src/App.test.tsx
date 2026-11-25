import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import App from './App';
import { SAMPLE_BANK_CSV } from './sampleData';

const BAD_CSV = '不明,見出し\r\n1,2\r\n';

function csvFile(name: string, content: string): File {
  return new File([content], name, { type: 'text/csv' });
}

async function loadSample(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'サンプルCSVを読み込む' }));
  await screen.findByRole('heading', { name: '明細' });
}

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
