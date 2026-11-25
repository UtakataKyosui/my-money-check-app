import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { BalanceChart } from './BalanceChart';

describe('BalanceChart', () => {
  it('折れ線SVGを説明つきで描画する', () => {
    render(
      <BalanceChart
        points={[
          { date: '2026-10-01', balance: 215000 },
          { date: '2026-10-05', balance: 495000 },
          { date: '2026-11-01', balance: 338590 },
        ]}
      />,
    );
    const svg = screen.getByRole('img');
    expect(svg).toHaveAccessibleName(/2026\/10\/01.*215,000円.*2026\/11\/01.*338,590円/);
    expect(svg.querySelector('path.line')?.getAttribute('d')).toMatch(/^M[\d.]+,[\d.]+ L/);
    expect(svg.querySelectorAll('circle')).toHaveLength(3);
  });

  it('1点だけでもエラーにならない', () => {
    render(<BalanceChart points={[{ date: '2026-10-01', balance: 100 }]} />);
    expect(screen.getByRole('img')).toBeInTheDocument();
  });

  it('点が無いときは案内を出す', () => {
    render(<BalanceChart points={[]} />);
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });
});
