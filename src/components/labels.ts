import type { SourceKind } from '../types';

export function sourceLabel(source: SourceKind): string {
  return source === 'bank' ? '銀行' : 'カード';
}

export function formatCount(n: number): string {
  return `${n.toLocaleString('ja-JP')}件`;
}
