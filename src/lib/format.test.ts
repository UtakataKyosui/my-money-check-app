import { describe, expect, it } from 'vitest';
import { formatDate, formatMonth, formatSignedYen, formatYen } from './format';

describe('formatYen', () => {
  it('formats with thousands separators', () => {
    expect(formatYen(1234)).toBe('1,234円');
    expect(formatYen(1234567)).toBe('1,234,567円');
    expect(formatYen(999)).toBe('999円');
    expect(formatYen(1000)).toBe('1,000円');
  });
  it('handles zero', () => {
    expect(formatYen(0)).toBe('0円');
    expect(formatYen(-0)).toBe('0円');
  });
  it('handles negatives', () => {
    expect(formatYen(-1234)).toBe('-1,234円');
    expect(formatYen(-5)).toBe('-5円');
  });
  it('rounds non-integers', () => {
    expect(formatYen(1234.4)).toBe('1,234円');
    expect(formatYen(-0.2)).toBe('0円');
  });
});

describe('formatSignedYen', () => {
  it('adds + for positive', () => {
    expect(formatSignedYen(1234)).toBe('+1,234円');
  });
  it('uses U+2212 minus for negative', () => {
    expect(formatSignedYen(-1234)).toBe('−1,234円');
  });
  it('has no sign for zero', () => {
    expect(formatSignedYen(0)).toBe('0円');
  });
});

describe('formatMonth', () => {
  it('formats YYYY-MM', () => {
    expect(formatMonth('2026-11')).toBe('2026年11月');
  });
  it('drops leading zero of month', () => {
    expect(formatMonth('2026-01')).toBe('2026年1月');
  });
  it('returns invalid input as is', () => {
    expect(formatMonth('abc')).toBe('abc');
    expect(formatMonth('')).toBe('');
  });
});

describe('formatDate', () => {
  it('formats YYYY-MM-DD', () => {
    expect(formatDate('2026-11-01')).toBe('2026/11/01');
  });
  it('returns invalid input as is', () => {
    expect(formatDate('2026-11')).toBe('2026-11');
    expect(formatDate('')).toBe('');
  });
});
