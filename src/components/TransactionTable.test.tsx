import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { Tag, Transaction } from '../types';
import { transactionKey } from '../lib/tags';
import { PAGE_SIZE, TransactionTable } from './TransactionTable';
import type { RowTagActions } from './TagEditor';

const NO_TAGGING: RowTagActions = { tags: [], overrides: {}, onSetOverride: () => {}, onAddRule: () => null };

/** タグを使わない既存のテスト向けに、タグ関連の props を既定値で補う */
function Table(props: { transactions: Transaction[]; tagIds?: Map<string, string[]>; tagging?: RowTagActions }) {
  return <TransactionTable tagIds={new Map()} tagging={NO_TAGGING} {...props} />;
}

function tx(i: number, over: Partial<Transaction> = {}): Transaction {
  return {
    id: `f.csv:${i}`,
    source: 'card',
    date: `2026-11-${String((i % 28) + 1).padStart(2, '0')}`,
    month: '2026-11',
    description: `店${i}`,
    expense: i * 100,
    income: 0,
    fileName: 'f.csv',
    ...over,
  };
}

function descriptions(): string[] {
  const table = screen.getByRole('table');
  return within(table)
    .getAllByRole('row')
    .slice(1)
    .map((row) => within(row).getAllByRole('cell')[2]?.textContent ?? '');
}

describe('TransactionTable', () => {
  it('支出の見出しで昇降順を切り替えられる', async () => {
    const user = userEvent.setup();
    render(<Table transactions={[tx(2), tx(1), tx(3)]} />);

    await user.click(screen.getByRole('button', { name: /^支出/ }));
    expect(descriptions()).toEqual(['店3', '店2', '店1']);
    expect(screen.getByRole('columnheader', { name: /支出/ })).toHaveAttribute('aria-sort', 'descending');

    await user.click(screen.getByRole('button', { name: /^支出/ }));
    expect(descriptions()).toEqual(['店1', '店2', '店3']);
    expect(screen.getByRole('columnheader', { name: /支出/ })).toHaveAttribute('aria-sort', 'ascending');
  });

  it('日付の降順が初期状態で、見出しで昇順にできる', async () => {
    const user = userEvent.setup();
    render(
      <Table
        transactions={[tx(1, { date: '2026-11-05' }), tx(2, { date: '2026-11-20' }), tx(3, { date: '2026-11-10' })]}
      />,
    );
    expect(descriptions()).toEqual(['店2', '店3', '店1']);
    await user.click(screen.getByRole('button', { name: /^日付/ }));
    expect(descriptions()).toEqual(['店1', '店3', '店2']);
  });

  it('200件ずつ「もっと見る」で表示を増やす', async () => {
    const user = userEvent.setup();
    const many = Array.from({ length: PAGE_SIZE + 50 }, (_, i) => tx(i + 1));
    render(<Table transactions={many} />);

    expect(screen.getAllByRole('row')).toHaveLength(PAGE_SIZE + 1);
    await user.click(screen.getByRole('button', { name: 'もっと見る（残り50件）' }));
    expect(screen.getAllByRole('row')).toHaveLength(PAGE_SIZE + 50 + 1);
    expect(screen.queryByRole('button', { name: /もっと見る/ })).not.toBeInTheDocument();
  });

  it('明細が空なら案内を出す', () => {
    render(<Table transactions={[]} />);
    expect(screen.getByText('条件に合う明細がありません。')).toBeInTheDocument();
  });

  describe('タグ', () => {
    const rent: Tag = { id: 't-rent', name: '家賃', color: 'blue' };
    const sub: Tag = { id: 't-sub', name: 'サブスク', color: 'purple' };

    function setup(over: Partial<RowTagActions> = {}, tagIds = new Map([['f.csv:1', ['t-rent']]])) {
      const actions: RowTagActions = {
        tags: [rent, sub],
        overrides: {},
        onSetOverride: vi.fn(),
        onAddRule: vi.fn(() => null),
        ...over,
      };
      const transactions = [tx(1, { description: '振込 家賃' }), tx(2, { description: '動画配信' })];
      render(<Table transactions={transactions} tagIds={tagIds} tagging={actions} />);
      return { actions, transactions };
    }

    it('各行にタグのチップを名前つきで表示し、タグのない行は「タグなし」と出す', () => {
      setup();
      const rows = within(screen.getByRole('table')).getAllByRole('row').slice(1);
      const cells = rows.map((row) => within(row).getAllByRole('cell')[3]?.textContent ?? '');
      // 日付の降順なので 動画配信（店2）→ 振込 家賃（店1）の順
      expect(cells[0]).toContain('タグなし');
      expect(cells[1]).toContain('家賃');
    });

    it('「タグを編集」で行の下に編集UIが開き、保存で setOverride が呼ばれて閉じる', async () => {
      const user = userEvent.setup();
      const { actions, transactions } = setup();
      const open = screen.getByRole('button', { name: '振込 家賃のタグを編集' });
      expect(open).toHaveAttribute('aria-expanded', 'false');
      await user.click(open);
      expect(open).toHaveAttribute('aria-expanded', 'true');

      const editor = screen.getByRole('group', { name: '「振込 家賃」のタグを編集' });
      expect(within(editor).getByRole('checkbox', { name: '家賃' })).toBeChecked();
      expect(within(editor).getByRole('checkbox', { name: 'サブスク' })).not.toBeChecked();
      await user.click(within(editor).getByRole('checkbox', { name: 'サブスク' }));
      await user.click(within(editor).getByRole('button', { name: 'タグを保存' }));

      expect(actions.onSetOverride).toHaveBeenCalledWith(transactionKey(transactions[0]!), ['t-rent', 't-sub']);
      expect(screen.queryByRole('group', { name: /のタグを編集/ })).not.toBeInTheDocument();
    });

    it('手動の設定があるときだけ「ルールに戻す」が使え、null で上書きを消す', async () => {
      const user = userEvent.setup();
      const key = transactionKey(tx(1, { description: '振込 家賃' }));
      const { actions } = setup({ overrides: { [key]: ['t-rent'] } });
      await user.click(screen.getByRole('button', { name: '振込 家賃のタグを編集' }));
      await user.click(screen.getByRole('button', { name: 'ルールに戻す' }));
      expect(actions.onSetOverride).toHaveBeenCalledWith(key, null);
    });

    it('未設定なら「ルールに戻す」は押せない。Escapeで閉じる', async () => {
      const user = userEvent.setup();
      setup();
      await user.click(screen.getByRole('button', { name: '振込 家賃のタグを編集' }));
      expect(screen.getByRole('button', { name: 'ルールに戻す' })).toBeDisabled();
      await user.keyboard('{Escape}');
      expect(screen.queryByRole('group', { name: /のタグを編集/ })).not.toBeInTheDocument();
    });

    it('「この摘要をルールにする」はタグを1つ選んだときだけ使え、摘要をキーワードにする。エラーも表示する', async () => {
      const user = userEvent.setup();
      const onAddRule = vi.fn<RowTagActions['onAddRule']>(() => '同じキーワードのルールがすでにあります。');
      setup({ onAddRule });
      await user.click(screen.getByRole('button', { name: '振込 家賃のタグを編集' }));
      const editor = screen.getByRole('group', { name: '「振込 家賃」のタグを編集' });
      const ruleButton = within(editor).getByRole('button', { name: 'この摘要をルールにする' });

      // 家賃だけ選択中: 使える
      expect(ruleButton).toBeEnabled();
      // 2つ選ぶと使えない
      await user.click(within(editor).getByRole('checkbox', { name: 'サブスク' }));
      expect(ruleButton).toBeDisabled();
      await user.click(within(editor).getByRole('checkbox', { name: 'サブスク' }));

      await user.click(ruleButton);
      expect(onAddRule).toHaveBeenCalledWith('振込 家賃', 't-rent');
      expect(within(editor).getByText('同じキーワードのルールがすでにあります。')).toBeInTheDocument();
    });
  });
});
