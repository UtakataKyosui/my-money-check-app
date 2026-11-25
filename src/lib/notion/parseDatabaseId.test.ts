import { describe, expect, it } from 'vitest';
import { parseDatabaseId } from './parseDatabaseId';

const HEX = '0123456789abcdef0123456789abcdef';
const UUID = '01234567-89ab-cdef-0123-456789abcdef';
const VIEW = 'fedcba9876543210fedcba9876543210';

describe('parseDatabaseId', () => {
  it('32桁hexをハイフン付きUUIDにする', () => {
    expect(parseDatabaseId(HEX)).toBe(UUID);
  });

  it('大文字は小文字にする', () => {
    expect(parseDatabaseId(HEX.toUpperCase())).toBe(UUID);
    expect(parseDatabaseId(UUID.toUpperCase())).toBe(UUID);
  });

  it('ハイフン付きUUIDはそのまま（小文字）', () => {
    expect(parseDatabaseId(UUID)).toBe(UUID);
  });

  it('前後の空白・改行を無視する', () => {
    expect(parseDatabaseId(`  ${HEX}\n`)).toBe(UUID);
    expect(parseDatabaseId(`\t https://www.notion.so/${HEX} `)).toBe(UUID);
  });

  it('ワークスペース名・タイトル付きのURL', () => {
    expect(parseDatabaseId(`https://www.notion.so/myws/Bank-Statements-${HEX}?v=${VIEW}`)).toBe(UUID);
  });

  it('?v= はビューIDなので無視する', () => {
    expect(parseDatabaseId(`https://www.notion.so/${HEX}?v=${VIEW}`)).toBe(UUID);
    expect(parseDatabaseId(`https://www.notion.so/${HEX}?v=${VIEW}&pvs=4`)).toBe(UUID);
  });

  it('パスにIDが無く ?v= だけなら null', () => {
    expect(parseDatabaseId(`https://www.notion.so/myws?v=${VIEW}`)).toBeNull();
  });

  it('日本語タイトルのURL（パーセントエンコード）', () => {
    expect(
      parseDatabaseId(`https://www.notion.so/ws/${encodeURIComponent('銀行の明細')}-${HEX}?v=${VIEW}`),
    ).toBe(UUID);
  });

  it('ハイフン付きUUIDを含むURL、末尾スラッシュ、フラグメント', () => {
    expect(parseDatabaseId(`https://www.notion.so/ws/${UUID}`)).toBe(UUID);
    expect(parseDatabaseId(`https://www.notion.so/${HEX}/`)).toBe(UUID);
    expect(parseDatabaseId(`https://www.notion.so/${HEX}#section`)).toBe(UUID);
  });

  it('スキーム無し・notion.site にも対応する', () => {
    expect(parseDatabaseId(`notion.so/${HEX}`)).toBe(UUID);
    expect(parseDatabaseId(`www.notion.so/ws/T-${HEX}`)).toBe(UUID);
    expect(parseDatabaseId(`https://my-team.notion.site/T-${HEX}?v=${VIEW}`)).toBe(UUID);
  });

  it.each([
    '',
    '   ',
    'hello',
    HEX.slice(0, 31),
    `${HEX}0`,
    `${HEX.slice(0, 31)}g`,
    'https://example.com/' + HEX,
    'https://www.notion.so/',
    'https://www.notion.so/ws/Title-without-id',
    `https://www.notion.so/${HEX.slice(0, 30)}`,
  ])('解釈できない: %s -> null', (input) => {
    expect(parseDatabaseId(input)).toBeNull();
  });

  it('文字列以外は null', () => {
    expect(parseDatabaseId(undefined as unknown as string)).toBeNull();
  });
});
