import type { ProvisionalKind, SourceKind, TagColor } from '../types';

export function sourceLabel(source: SourceKind): string {
  return source === 'bank' ? '銀行' : 'カード';
}

export function formatCount(n: number): string {
  return `${n.toLocaleString('ja-JP')}件`;
}

export function provisionalKindLabel(kind: ProvisionalKind): string {
  if (kind === 'card') return 'カード';
  if (kind === 'bank') return '銀行';
  return 'その他';
}

export const TAG_COLOR_LABELS: Record<TagColor, string> = {
  blue: '青',
  green: '緑',
  orange: 'オレンジ',
  red: '赤',
  purple: '紫',
  teal: '青緑',
  pink: 'ピンク',
  gray: 'グレー',
};
