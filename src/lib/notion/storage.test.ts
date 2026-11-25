import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  NOTION_CONFIG_KEY,
  NOTION_TOKEN_KEY,
  clearNotionToken,
  loadNotionConfig,
  loadNotionToken,
  saveNotionConfig,
  saveNotionToken,
} from './storage';

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  };
}

const throwing = () => {
  throw new Error('denied');
};

describe('NotionConfig の保存', () => {
  it('キーは my-money-check:notion:v1', () => {
    expect(NOTION_CONFIG_KEY).toBe('my-money-check:notion:v1');
  });

  it('保存して読み戻せる（URL/ID はそのまま）', () => {
    const s = memoryStorage();
    const config = {
      bankDatabase: ' https://www.notion.so/ws/Bank-0123456789abcdef0123456789abcdef?v=x ',
      cardDatabase: '0123456789abcdef0123456789abcdef',
      rememberToken: true,
    };
    saveNotionConfig(config, s);
    expect(JSON.parse(s.data.get(NOTION_CONFIG_KEY) as string)).toEqual(config);
    expect(loadNotionConfig(s)).toEqual(config);
  });

  it('何も無ければ既定値', () => {
    expect(loadNotionConfig(memoryStorage())).toEqual({ bankDatabase: '', cardDatabase: '', rememberToken: false });
  });

  it('壊れた JSON・不正な形は既定値、不正なフィールドだけ無視する', () => {
    const def = { bankDatabase: '', cardDatabase: '', rememberToken: false };
    for (const raw of ['{broken', 'null', '[]', '"x"', '123']) {
      expect(loadNotionConfig(memoryStorage({ [NOTION_CONFIG_KEY]: raw }))).toEqual(def);
    }
    expect(
      loadNotionConfig(
        memoryStorage({ [NOTION_CONFIG_KEY]: JSON.stringify({ bankDatabase: 5, cardDatabase: 'c', rememberToken: 'yes' }) }),
      ),
    ).toEqual({ bankDatabase: '', cardDatabase: 'c', rememberToken: false });
  });

  it('余分なフィールド（トークンなど）は保存しない', () => {
    const s = memoryStorage();
    saveNotionConfig({ bankDatabase: 'a', cardDatabase: 'b', rememberToken: false, token: 'secret' } as never, s);
    expect(s.data.get(NOTION_CONFIG_KEY)).not.toContain('secret');
  });

  it('getItem / setItem が例外を投げても落ちない', () => {
    expect(loadNotionConfig({ getItem: throwing })).toEqual({ bankDatabase: '', cardDatabase: '', rememberToken: false });
    expect(() => saveNotionConfig({ bankDatabase: '', cardDatabase: '', rememberToken: false }, { setItem: throwing })).not.toThrow();
  });

  describe('既定のストレージ（localStorage）', () => {
    beforeEach(() => localStorage.clear());
    afterEach(() => vi.restoreAllMocks());

    it('省略すると localStorage を使う', () => {
      saveNotionConfig({ bankDatabase: 'x', cardDatabase: 'y', rememberToken: true });
      expect(localStorage.getItem(NOTION_CONFIG_KEY)).not.toBeNull();
      expect(loadNotionConfig()).toEqual({ bankDatabase: 'x', cardDatabase: 'y', rememberToken: true });
    });

    it('localStorage へのアクセス自体が例外でも落ちない', () => {
      vi.spyOn(globalThis, 'localStorage', 'get').mockImplementation(throwing);
      expect(loadNotionConfig()).toEqual({ bankDatabase: '', cardDatabase: '', rememberToken: false });
      expect(() => saveNotionConfig({ bankDatabase: 'a', cardDatabase: 'b', rememberToken: false })).not.toThrow();
    });
  });
});

describe('トークンの保存', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  afterEach(() => vi.restoreAllMocks());

  it('キーは my-money-check:notion-token:v1', () => {
    expect(NOTION_TOKEN_KEY).toBe('my-money-check:notion-token:v1');
  });

  it('何も無ければ空文字', () => {
    expect(loadNotionToken()).toBe('');
  });

  it('remember=false は sessionStorage のみ（localStorage からは消す）', () => {
    localStorage.setItem(NOTION_TOKEN_KEY, 'old');
    saveNotionToken('tok1', false);
    expect(sessionStorage.getItem(NOTION_TOKEN_KEY)).toBe('tok1');
    expect(localStorage.getItem(NOTION_TOKEN_KEY)).toBeNull();
    expect(loadNotionToken()).toBe('tok1');
  });

  it('remember=true は localStorage のみ（sessionStorage からは消す）', () => {
    sessionStorage.setItem(NOTION_TOKEN_KEY, 'old');
    saveNotionToken('tok2', true);
    expect(localStorage.getItem(NOTION_TOKEN_KEY)).toBe('tok2');
    expect(sessionStorage.getItem(NOTION_TOKEN_KEY)).toBeNull();
    expect(loadNotionToken()).toBe('tok2');
  });

  it('読み出しは sessionStorage を優先し、無ければ localStorage', () => {
    localStorage.setItem(NOTION_TOKEN_KEY, 'local');
    expect(loadNotionToken()).toBe('local');
    sessionStorage.setItem(NOTION_TOKEN_KEY, 'session');
    expect(loadNotionToken()).toBe('session');
  });

  it('空文字は両方から消す', () => {
    localStorage.setItem(NOTION_TOKEN_KEY, 'a');
    sessionStorage.setItem(NOTION_TOKEN_KEY, 'b');
    saveNotionToken('', true);
    expect(localStorage.getItem(NOTION_TOKEN_KEY)).toBeNull();
    expect(sessionStorage.getItem(NOTION_TOKEN_KEY)).toBeNull();
    expect(loadNotionToken()).toBe('');
  });

  it('前後の空白は除いて保存する。空白だけは消去扱い', () => {
    saveNotionToken('  tok  ', false);
    expect(loadNotionToken()).toBe('tok');
    saveNotionToken('   ', false);
    expect(loadNotionToken()).toBe('');
  });

  it('clearNotionToken は両方から消す', () => {
    localStorage.setItem(NOTION_TOKEN_KEY, 'a');
    sessionStorage.setItem(NOTION_TOKEN_KEY, 'b');
    clearNotionToken();
    expect(loadNotionToken()).toBe('');
    expect(localStorage.getItem(NOTION_TOKEN_KEY)).toBeNull();
    expect(sessionStorage.getItem(NOTION_TOKEN_KEY)).toBeNull();
  });

  it('トークンは設定（notion:v1）には混ざらない', () => {
    saveNotionToken('tok', true);
    saveNotionConfig({ bankDatabase: '', cardDatabase: '', rememberToken: true });
    expect(localStorage.getItem(NOTION_CONFIG_KEY)).not.toContain('tok');
  });

  it('localStorage へのアクセス自体が例外でも落ちない（sessionStorage は使える）', () => {
    vi.spyOn(globalThis, 'localStorage', 'get').mockImplementation(throwing);
    expect(() => saveNotionToken('t', true)).not.toThrow();
    expect(() => saveNotionToken('t', false)).not.toThrow();
    expect(loadNotionToken()).toBe('t');
    expect(() => clearNotionToken()).not.toThrow();
  });

  it('sessionStorage へのアクセス自体が例外でも落ちない（localStorage は使える）', () => {
    vi.spyOn(globalThis, 'sessionStorage', 'get').mockImplementation(throwing);
    expect(() => saveNotionToken('t', false)).not.toThrow();
    saveNotionToken('t2', true);
    expect(loadNotionToken()).toBe('t2');
    expect(() => clearNotionToken()).not.toThrow();
  });

  it('両方とも例外でも落ちない', () => {
    vi.spyOn(globalThis, 'localStorage', 'get').mockImplementation(throwing);
    vi.spyOn(globalThis, 'sessionStorage', 'get').mockImplementation(throwing);
    expect(() => saveNotionToken('t', true)).not.toThrow();
    expect(() => saveNotionToken('', false)).not.toThrow();
    expect(() => clearNotionToken()).not.toThrow();
    expect(loadNotionToken()).toBe('');
  });

  it('setItem / getItem / removeItem が例外を投げるストレージでも落ちない', () => {
    const bad = { getItem: throwing, setItem: throwing, removeItem: throwing };
    vi.spyOn(globalThis, 'localStorage', 'get').mockReturnValue(bad as unknown as Storage);
    vi.spyOn(globalThis, 'sessionStorage', 'get').mockReturnValue(bad as unknown as Storage);
    expect(() => saveNotionToken('t', true)).not.toThrow();
    expect(() => saveNotionToken('t', false)).not.toThrow();
    expect(() => clearNotionToken()).not.toThrow();
    expect(loadNotionToken()).toBe('');
  });

  it('保存先に書けなくても、もう一方からは消す（remember 切替の取り残し防止）', () => {
    sessionStorage.setItem(NOTION_TOKEN_KEY, 'old');
    const bad = { getItem: throwing, setItem: throwing, removeItem: throwing };
    vi.spyOn(globalThis, 'localStorage', 'get').mockReturnValue(bad as unknown as Storage);
    saveNotionToken('new', true);
    expect(sessionStorage.getItem(NOTION_TOKEN_KEY)).toBeNull();
  });
});
