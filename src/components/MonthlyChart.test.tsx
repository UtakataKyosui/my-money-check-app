import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { MonthlyDisplayRow } from '../lib/provisional';
import { MonthlyChart } from './MonthlyChart';

function row(over: Partial<MonthlyDisplayRow> = {}): MonthlyDisplayRow {
  const base: MonthlyDisplayRow = {
    month: '2026-11',
    income: 0,
    expense: 0,
    net: 0,
    bankExpense: 0,
    cardExpense: 0,
    count: 0,
    provisional: 0,
    provisionalConfirmed: 0,
    provisionalEstimated: 0,
    provisionalCount: 0,
    provisionalFromCsv: 0,
    totalExpense: 0,
    totalNet: 0,
    ...over,
  };
  return base;
}

function widths(container: HTMLElement, selector: string): string[] {
  return [...container.querySelectorAll<HTMLElement>(selector)].map((el) => el.style.width);
}

describe('MonthlyChart の暫定支払いセグメント', () => {
  it('加算される暫定支払いは、CSVの支出に積んだ割合で描く', () => {
    const { container } = render(
      <MonthlyChart rows={[row({ expense: 10_000, provisional: 30_000, totalExpense: 40_000 })]} />,
    );
    expect(widths(container, '.bar-expense')).toEqual(['25%']);
    expect(widths(container, '.bar-provisional')).toEqual(['75%']);
  });

  it('CSVの支払額で上書きした分は、セグメントにも凡例にも出さない（支出合計に加算されないため）', () => {
    // CSV支出 10,000円、暫定 50,000円はすべてCSVで上書き済み → totalExpense は 10,000円
    const { container, queryByText } = render(
      <MonthlyChart
        rows={[row({ expense: 10_000, provisional: 50_000, provisionalFromCsv: 50_000, totalExpense: 10_000 })]}
      />,
    );
    expect(widths(container, '.bar-expense')).toEqual(['100%']);
    expect(container.querySelectorAll('.bar-provisional')).toHaveLength(0);
    expect(queryByText(/暫定支払い（手入力・支出に含む）/)).toBeNull();
  });

  it('上書き分だけの月（支出合計0円）で、幅が NaN/Infinity にならずセグメントを出さない', () => {
    const { container } = render(
      <MonthlyChart rows={[row({ provisional: 11_350, provisionalFromCsv: 11_350, totalExpense: 0 })]} />,
    );
    expect(container.querySelectorAll('.bar-provisional')).toHaveLength(0);
    expect(container.innerHTML).not.toMatch(/Infinity|NaN/);
  });

  it('一部だけ上書きされた月は、加算分だけを積む', () => {
    const { container } = render(
      <MonthlyChart
        rows={[row({ expense: 100, provisional: 150, provisionalFromCsv: 100, totalExpense: 150 })]}
      />,
    );
    expect(widths(container, '.bar-provisional')).toHaveLength(1);
    expect(parseFloat(widths(container, '.bar-provisional')[0] as string)).toBeCloseTo((50 / 150) * 100);
  });
});
