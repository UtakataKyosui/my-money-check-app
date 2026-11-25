import { describe, expect, it } from 'vitest';
import { parseCsv } from './csv';

describe('parseCsv', () => {
  it('単純なCSVを行・列に分ける', () => {
    expect(parseCsv('a,b,c\n1,2,3\n')).toEqual([
      ['a', 'b', 'c'],
      ['1', '2', '3'],
    ]);
  });

  it('CRLF / LF / CR を行区切りとして扱う', () => {
    expect(parseCsv('a,b\r\n1,2\r\n')).toEqual([['a', 'b'], ['1', '2']]);
    expect(parseCsv('a,b\n1,2')).toEqual([['a', 'b'], ['1', '2']]);
    expect(parseCsv('a,b\r1,2\r')).toEqual([['a', 'b'], ['1', '2']]);
  });

  it('先頭のBOMを除去する', () => {
    expect(parseCsv('﻿年月日,残高\n1,2')).toEqual([['年月日', '残高'], ['1', '2']]);
  });

  it('空行を除去する', () => {
    expect(parseCsv('a,b\n\n1,2\r\n\r\n\n')).toEqual([['a', 'b'], ['1', '2']]);
    expect(parseCsv('')).toEqual([]);
    expect(parseCsv('\n\n')).toEqual([]);
  });

  it('空フィールドを保持する', () => {
    expect(parseCsv('a,,c\n,,\n')).toEqual([['a', '', 'c'], ['', '', '']]);
    expect(parseCsv('a,b,')).toEqual([['a', 'b', '']]);
  });

  it('引用符内のカンマ・改行・"" エスケープを扱う', () => {
    expect(parseCsv('"a,b","line1\nline2","say ""hi"""\n1,2,3')).toEqual([
      ['a,b', 'line1\nline2', 'say "hi"'],
      ['1', '2', '3'],
    ]);
    expect(parseCsv('"x\r\ny",z')).toEqual([['x\r\ny', 'z']]);
  });

  it('引用符で囲んだ空フィールドを保持する', () => {
    expect(parseCsv('"",a')).toEqual([['', 'a']]);
    expect(parseCsv('a,""')).toEqual([['a', '']]);
  });

  it('閉じられていない引用符は日本語メッセージで失敗する', () => {
    expect(() => parseCsv('a,"b\nc')).toThrow(/引用符が閉じられていません/);
  });

  it('引用符の位置が不正な場合は失敗する', () => {
    expect(() => parseCsv('ab"c,d')).toThrow(/引用符の位置が正しくない/);
    expect(() => parseCsv('"ab"c,d')).toThrow(/余分な文字/);
  });
});
