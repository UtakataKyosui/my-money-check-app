import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { Transaction } from '../types';
import { PAGE_SIZE, TransactionTable } from './TransactionTable';

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
    render(<TransactionTable transactions={[tx(2), tx(1), tx(3)]} />);

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
      <TransactionTable
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
    render(<TransactionTable transactions={many} />);

    expect(screen.getAllByRole('row')).toHaveLength(PAGE_SIZE + 1);
    await user.click(screen.getByRole('button', { name: 'もっと見る（残り50件）' }));
    expect(screen.getAllByRole('row')).toHaveLength(PAGE_SIZE + 50 + 1);
    expect(screen.queryByRole('button', { name: /もっと見る/ })).not.toBeInTheDocument();
  });

  it('明細が空なら案内を出す', () => {
    render(<TransactionTable transactions={[]} />);
    expect(screen.getByText('条件に合う明細がありません。')).toBeInTheDocument();
  });
});
