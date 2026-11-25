import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { NOTION_SPECS } from '../lib/notion';
import { HelpDialog, useHelpDialog } from '.';

function Harness() {
  const help = useHelpDialog();
  return (
    <div>
      <button type="button" onClick={() => help.openHelp('csv')}>
        ヘルプ
      </button>
      <button type="button" onClick={() => help.openHelp('notion-format')}>
        形式を見る
      </button>
      <HelpDialog open={help.open} tab={help.tab} onTabChange={help.setTab} onClose={help.closeHelp} />
    </div>
  );
}

describe('HelpDialog', () => {
  it('開くとダイアログが表示され、見出しでラベル付けされ、「閉じる」で閉じて元のボタンにフォーカスが戻る', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    const opener = screen.getByRole('button', { name: 'ヘルプ' });
    await user.click(opener);
    const dialog = screen.getByRole('dialog', { name: 'ヘルプ' });
    expect(dialog).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'CSVの形式' })).toHaveFocus();

    await user.click(within(dialog).getByRole('button', { name: '閉じる' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });

  it('Escキーで閉じて、元のボタンにフォーカスが戻る', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const opener = screen.getByRole('button', { name: '形式を見る' });
    await user.click(opener);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });

  it('タブが4つあり、選んだタブの内容に切り替わる（矢印キーでも移動できる）', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: 'ヘルプ' }));

    const tabs = within(screen.getByRole('tablist', { name: 'ヘルプの項目' })).getAllByRole('tab');
    expect(tabs.map((t) => t.textContent)).toEqual(['CSVの形式', 'Notionのデータ形式', 'Notionの設定手順', '保存とプライバシー']);
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel')).toHaveAccessibleName('CSVの形式');
    expect(screen.getByText(/UTF-8 と Shift_JIS に対応しています/)).toBeInTheDocument();
    expect(screen.getByText('11月支払金額', { exact: false })).toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: 'Notionの設定手順' }));
    expect(screen.getByRole('tabpanel')).toHaveAccessibleName('Notionの設定手順');
    expect(screen.getByText(/コンテンツを読み取る/)).toBeInTheDocument();
    expect(screen.getByText('データベースをインテグレーションに共有する。')).toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: '保存とプライバシー' }));
    expect(screen.getByText(/サーバーに保存せず、ログにも出さない/)).toBeInTheDocument();
    expect(screen.getByText(/sessionStorage/)).toBeInTheDocument();

    // 矢印キー: 右で先頭に戻り、Home/End で端へ
    screen.getByRole('tab', { name: '保存とプライバシー' }).focus();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'CSVの形式' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'CSVの形式' })).toHaveFocus();
    await user.keyboard('{End}');
    expect(screen.getByRole('tab', { name: '保存とプライバシー' })).toHaveAttribute('aria-selected', 'true');
  });

  it('Notionのデータ形式のタブは NOTION_SPECS から表を作る（全プロパティ・必須/任意・型・例）', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: '形式を見る' }));
    expect(screen.getByRole('tab', { name: 'Notionのデータ形式' })).toHaveAttribute('aria-selected', 'true');

    for (const spec of NOTION_SPECS) {
      const table = screen.getByRole('table', { name: `${spec.title}のプロパティ一覧` });
      const rows = within(table).getAllByRole('row');
      expect(rows).toHaveLength(spec.properties.length + 1);
      for (const [i, property] of spec.properties.entries()) {
        const row = rows[i + 1] as HTMLElement;
        const header = within(row).getByRole('rowheader');
        if (property.name === null) {
          expect(header).toHaveTextContent('名前は自由');
          expect(header).toHaveTextContent(`推奨名: ${spec.recommendedTitleName}`);
        } else {
          expect(header).toHaveTextContent(property.name);
        }
        const cells = within(row).getAllByRole('cell');
        expect(cells[1]).toHaveTextContent(property.required ? '必須' : '任意');
        for (const type of property.types) expect(cells[2]).toHaveTextContent(type);
        expect(cells[5]).toHaveTextContent(property.example);
      }
    }
  });

  it('本文中のリンクから別のタブへ移れる', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: '形式を見る' }));
    await user.click(screen.getByRole('button', { name: 'Notionの設定手順' }));
    expect(screen.getByRole('tab', { name: 'Notionの設定手順' })).toHaveAttribute('aria-selected', 'true');
  });

  it('Tabキーはダイアログの中で循環する', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: 'ヘルプ' }));
    const dialog = screen.getByRole('dialog');
    const close = within(dialog).getByRole('button', { name: '閉じる' });
    close.focus();
    await user.tab({ shift: true });
    // 先頭の「閉じる」から戻ると、ダイアログの最後のフォーカス可能な要素に移る（ダイアログの外には出ない）
    expect(dialog).toContainElement(document.activeElement as HTMLElement);
    await user.tab();
    expect(close).toHaveFocus();
  });
});
