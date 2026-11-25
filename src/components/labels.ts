import type { ProvisionalKind, SourceKind } from '../types';

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
