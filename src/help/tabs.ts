export type HelpTabId = 'csv' | 'notion-format' | 'notion-setup' | 'privacy';

export interface HelpTab {
  id: HelpTabId;
  label: string;
}

export const HELP_TABS: readonly HelpTab[] = [
  { id: 'csv', label: 'CSVの形式' },
  { id: 'notion-format', label: 'Notionのデータ形式' },
  { id: 'notion-setup', label: 'Notionの設定手順' },
  { id: 'privacy', label: '保存とプライバシー' },
];
