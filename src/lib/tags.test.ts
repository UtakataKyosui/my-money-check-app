import { describe, expect, it } from 'vitest';
import type { Tag, TagColor, TagStore, Transaction } from '../types';
import {
  MAX_TAG_NAME_LENGTH,
  SUGGESTED_TAGS,
  TAGS_STORAGE_KEY,
  TAG_COLORS,
  UNTAGGED,
  addRule,
  addSuggestedTags,
  addTag,
  countRuleMatches,
  createTagId,
  deleteTag,
  emptyTagStore,
  loadTagStore,
  matchesTagFilter,
  provisionalKey,
  removeRule,
  renameTag,
  saveTagStore,
  setOverride,
  setTagColor,
  summarizeByTag,
  tagIdsFor,
  transactionKey,
} from './tags';

function tag(id: string, name: string, color: TagColor = 'blue'): Tag {
  return { id, name, color };
}

function makeStore(partial: Partial<TagStore> = {}): TagStore {
  return { ...emptyTagStore(), ...partial };
}

/** 成功を期待して値を取り出す。 */
function must<T extends { ok: boolean }>(r: T): Extract<T, { ok: true }> {
  if (!r.ok) throw new Error(`expected ok: ${JSON.stringify(r)}`);
  return r as Extract<T, { ok: true }>;
}

function errorOf(r: { ok: boolean; error?: string }): string {
  if (r.ok) throw new Error('expected failure');
  return r.error ?? '';
}

function addNamed(store: TagStore, name: string, color?: TagColor) {
  return must(addTag(store, name, color));
}

describe('定数・ID', () => {
  it('TAG_COLORS は8色で UNTAGGED は予約ID', () => {
    expect(TAG_COLORS).toEqual(['blue', 'green', 'orange', 'red', 'purple', 'teal', 'pink', 'gray']);
    expect(UNTAGGED).toBe('__untagged__');
    expect(TAGS_STORAGE_KEY).toBe('my-money-check:tags:v1');
    expect(MAX_TAG_NAME_LENGTH).toBe(20);
  });

  it('emptyTagStore は毎回新しい空のストアを返す', () => {
    const a = emptyTagStore();
    expect(a).toEqual({ tags: [], rules: [], overrides: {} });
    a.tags.push(tag('x', 'x'));
    expect(emptyTagStore().tags).toEqual([]);
  });

  it('createTagId は空でなく、重複せず、UNTAGGED と衝突しない', () => {
    const ids = new Set(Array.from({ length: 200 }, () => createTagId()));
    expect(ids.size).toBe(200);
    for (const id of ids) {
      expect(id).not.toBe('');
      expect(id).not.toBe(UNTAGGED);
    }
  });

  it('createTagId は randomUUID が無い・例外を投げる環境でもフォールバックする', () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
    try {
      Object.defineProperty(globalThis, 'crypto', { value: {}, configurable: true });
      expect(createTagId()).toMatch(/^t-/);
      Object.defineProperty(globalThis, 'crypto', {
        value: {
          randomUUID: () => {
            throw new Error('insecure');
          },
        },
        configurable: true,
      });
      expect(createTagId()).toMatch(/^t-/);
    } finally {
      if (original) Object.defineProperty(globalThis, 'crypto', original);
    }
  });
});

describe('キー', () => {
  const tx: Transaction = {
    id: 'a.csv:3',
    source: 'bank',
    date: '2026-11-05',
    month: '2026-11',
    description: 'ｱﾏｿﾞﾝ',
    expense: 1200,
    income: 0,
    fileName: 'a.csv',
  };

  it('transactionKey は `tx:` つきのハッシュで、日付・摘要・金額を読める形で含まない', () => {
    const key = transactionKey(tx);
    expect(key).toMatch(/^tx:[0-9a-z]+$/);
    expect(key).not.toContain('2026');
    expect(key).not.toContain('ｱﾏｿﾞﾝ');
    expect(key).not.toContain('1200');
  });

  it('transactionKey は同じ入力なら常に同じ値になる（保存したキーが再読み込み後も一致する）', () => {
    expect(transactionKey(tx)).toBe(transactionKey({ ...tx }));
    expect(transactionKey(tx)).toBe('tx:' + transactionKey(tx).slice(3));
  });

  it('多数の異なる明細でキーが衝突しない', () => {
    const keys = new Set<string>();
    for (let amount = 0; amount < 5000; amount++) {
      keys.add(transactionKey({ ...tx, expense: amount, description: `店${amount % 37}` }));
    }
    expect(keys.size).toBe(5000);
  });

  it('同一の行は ID やファイル名が違っても同じキーになる', () => {
    expect(transactionKey({ ...tx, id: 'b.csv:9', fileName: 'b.csv', balance: 5 })).toBe(
      transactionKey(tx),
    );
  });

  it('金額や日付が違えば別のキーになる', () => {
    expect(transactionKey({ ...tx, expense: 1201 })).not.toBe(transactionKey(tx));
    expect(transactionKey({ ...tx, source: 'card' })).not.toBe(transactionKey(tx));
  });

  it('手動の上書きを保存しても、localStorageの文字列に日付・摘要・金額が含まれない', () => {
    let raw = '';
    let store = emptyTagStore();
    const added = addTag(store, '家賃');
    if (!added.ok) throw new Error('addTag failed');
    store = setOverride(added.store, transactionKey(tx), [added.tag.id]);
    saveTagStore(store, { setItem: (_k, v) => void (raw = v) });
    expect(raw).toContain(transactionKey(tx));
    expect(raw).not.toContain('ｱﾏｿﾞﾝ');
    expect(raw).not.toContain('2026-11-05');
    expect(raw).not.toContain('1200');
  });

  it('provisionalKey は prov:<id>', () => {
    expect(provisionalKey({ id: 'abc' })).toBe('prov:abc');
  });
});

describe('addTag', () => {
  it('名前を trim して追加する', () => {
    const r = addNamed(emptyTagStore(), '  家賃 ', 'red');
    expect(r.tag.name).toBe('家賃');
    expect(r.tag.color).toBe('red');
    expect(r.tag.id).not.toBe(UNTAGGED);
    expect(r.store.tags).toEqual([r.tag]);
  });

  it('元のストアは変更しない', () => {
    const s = emptyTagStore();
    addNamed(s, '家賃');
    expect(s.tags).toEqual([]);
  });

  it('空・空白のみは不可', () => {
    expect(errorOf(addTag(emptyTagStore(), ''))).toContain('入力');
    expect(errorOf(addTag(emptyTagStore(), ' 　 '))).toContain('入力');
  });

  it('20文字は可・21文字は不可', () => {
    expect(addTag(emptyTagStore(), 'あ'.repeat(MAX_TAG_NAME_LENGTH)).ok).toBe(true);
    expect(errorOf(addTag(emptyTagStore(), 'あ'.repeat(MAX_TAG_NAME_LENGTH + 1)))).toContain('20');
  });

  it('サロゲートペアは1文字として数える', () => {
    expect(addTag(emptyTagStore(), '😀'.repeat(MAX_TAG_NAME_LENGTH)).ok).toBe(true);
  });

  it('同名は不可（全角半角・大文字小文字を区別しない）', () => {
    const s = addNamed(emptyTagStore(), 'Netflix').store;
    expect(errorOf(addTag(s, 'netflix'))).toContain('同じ名前');
    expect(errorOf(addTag(s, 'ＮＥＴＦＬＩＸ'))).toContain('同じ名前');
    expect(errorOf(addTag(s, ' Netflix '))).toContain('同じ名前');
    const k = addNamed(emptyTagStore(), 'ｻﾌﾞｽｸ').store;
    expect(errorOf(addTag(k, 'サブスク'))).toContain('同じ名前');
  });

  it('color 省略時は使用数が最も少ない色を TAG_COLORS の順に選ぶ', () => {
    let s = emptyTagStore();
    const picked: TagColor[] = [];
    for (let i = 0; i < TAG_COLORS.length; i++) {
      const r = addNamed(s, `t${i}`);
      picked.push(r.tag.color);
      s = r.store;
    }
    expect(picked).toEqual([...TAG_COLORS]);
    // 全色が1回ずつ使われた後は先頭の色に戻る
    expect(addNamed(s, 'next').tag.color).toBe('blue');
  });

  it('color 省略時、使われていない色を優先する', () => {
    const s = makeStore({ tags: [tag('1', 'a', 'blue'), tag('2', 'b', 'green')] });
    expect(addNamed(s, 'c').tag.color).toBe('orange');
    const t = makeStore({ tags: [tag('1', 'a', 'blue'), tag('2', 'b', 'blue'), tag('3', 'c', 'green')] });
    expect(addNamed(t, 'd').tag.color).toBe('orange');
  });
});

describe('renameTag / setTagColor', () => {
  const base = (() => {
    let s = emptyTagStore();
    s = addNamed(s, '家賃', 'blue').store;
    s = addNamed(s, '食費', 'green').store;
    return s;
  })();
  const [rent, food] = base.tags as [Tag, Tag];

  it('名前を変更できる（trim される）', () => {
    const r = must(renameTag(base, rent.id, '  住居費 '));
    expect(r.store.tags.map((t) => t.name)).toEqual(['住居費', '食費']);
    expect(base.tags[0]?.name).toBe('家賃');
  });

  it('自分自身との重複（大文字小文字・全半角の違い）は許可', () => {
    const s = addNamed(emptyTagStore(), 'Rent').store;
    const id = s.tags[0]!.id;
    expect(must(renameTag(s, id, 'ＲＥＮＴ')).store.tags[0]?.name).toBe('ＲＥＮＴ');
    expect(renameTag(base, rent.id, '家賃').ok).toBe(true);
  });

  it('他のタグとの重複・空・長すぎは不可', () => {
    expect(errorOf(renameTag(base, rent.id, ' 食費 '))).toContain('同じ名前');
    expect(errorOf(renameTag(base, rent.id, ''))).toContain('入力');
    expect(errorOf(renameTag(base, rent.id, 'あ'.repeat(21)))).toContain('20');
  });

  it('存在しないタグは不可', () => {
    expect(errorOf(renameTag(base, 'nope', '新しい'))).toContain('見つかりません');
  });

  it('setTagColor は色だけを変え、他のタグは変えない', () => {
    const s = setTagColor(base, food.id, 'pink');
    expect(s.tags.map((t) => t.color)).toEqual(['blue', 'pink']);
    expect(base.tags[1]?.color).toBe('green');
    expect(setTagColor(base, 'nope', 'red')).toEqual(base);
  });
});

describe('addRule / removeRule', () => {
  const s0 = (() => {
    let s = emptyTagStore();
    s = addNamed(s, '家賃').store;
    s = addNamed(s, 'サブスク').store;
    return s;
  })();
  const [rent, sub] = s0.tags as [Tag, Tag];

  it('keyword を trim して追加する', () => {
    const r = must(addRule(s0, '  ネットフリックス ', sub.id));
    expect(r.rule.keyword).toBe('ネットフリックス');
    expect(r.rule.tagId).toBe(sub.id);
    expect(r.store.rules).toEqual([r.rule]);
    expect(s0.rules).toEqual([]);
  });

  it('空は不可', () => {
    expect(errorOf(addRule(s0, '   ', rent.id))).toContain('キーワード');
    expect(errorOf(addRule(s0, '', rent.id))).toContain('キーワード');
  });

  it('50文字は可・51文字は不可', () => {
    expect(addRule(s0, 'a'.repeat(50), rent.id).ok).toBe(true);
    expect(errorOf(addRule(s0, 'a'.repeat(51), rent.id))).toContain('50');
  });

  it('存在しないタグは不可', () => {
    expect(errorOf(addRule(s0, 'x', 'nope'))).toContain('タグ');
    expect(errorOf(addRule(s0, 'x', UNTAGGED))).toContain('タグ');
  });

  it('(正規化した keyword, tagId) の重複は不可。別タグなら可', () => {
    const s1 = must(addRule(s0, 'Netflix', sub.id)).store;
    expect(errorOf(addRule(s1, 'netflix', sub.id))).toContain('同じ');
    expect(errorOf(addRule(s1, 'ＮＥＴＦＬＩＸ ', sub.id))).toContain('同じ');
    expect(addRule(s1, 'Netflix', rent.id).ok).toBe(true);
  });

  it('removeRule は指定のルールだけ消す', () => {
    const a = must(addRule(s0, 'a', rent.id));
    const b = must(addRule(a.store, 'b', sub.id));
    const s = removeRule(b.store, a.rule.id);
    expect(s.rules).toEqual([b.rule]);
    expect(removeRule(s, 'nope')).toEqual(s);
  });
});

describe('tagIdsFor', () => {
  let store = emptyTagStore();
  const rent = addNamed(store, '家賃');
  store = rent.store;
  const sub = addNamed(store, 'サブスク');
  store = sub.store;
  const food = addNamed(store, '食費');
  store = food.store;
  store = must(addRule(store, 'Netflix', sub.tag.id)).store;
  store = must(addRule(store, 'ネット', sub.tag.id)).store;
  store = must(addRule(store, 'ｱﾏｿﾞﾝ', food.tag.id)).store;
  store = must(addRule(store, 'アマゾン', rent.tag.id)).store;

  it('ルールに一致したタグを返す（NFKC・大文字小文字を区別しない）', () => {
    expect(tagIdsFor(store, 'k', 'NETFLIX.COM')).toEqual([sub.tag.id]);
    expect(tagIdsFor(store, 'k', 'ＮｅｔＦｌｉｘ')).toEqual([sub.tag.id]);
    expect(tagIdsFor(store, 'k', 'ネットフリックス')).toEqual([sub.tag.id]);
  });

  it('半角カナと全角カナを同一視し、結果は store.tags の並び順で重複なし', () => {
    // ｱﾏｿﾞﾝ(→食費) と アマゾン(→家賃) の両方に一致 → tags 順: 家賃, 食費
    expect(tagIdsFor(store, 'k', 'アマゾン')).toEqual([rent.tag.id, food.tag.id]);
    expect(tagIdsFor(store, 'k', 'ｱﾏｿﾞﾝ')).toEqual([rent.tag.id, food.tag.id]);
    // 同じタグへの複数ルールに一致しても1回だけ
    expect(tagIdsFor(store, 'k', 'ネットフリックス Netflix')).toEqual([sub.tag.id]);
  });

  it('どれにも一致しなければ空', () => {
    expect(tagIdsFor(store, 'k', 'セブンイレブン')).toEqual([]);
  });

  it('空白だけのキーワードを持つ（壊れた）ルールは何にも一致しない', () => {
    const s = makeStore({
      tags: [tag('a', 'A')],
      rules: [{ id: 'r', keyword: '  ', tagId: 'a' }],
    });
    expect(tagIdsFor(s, 'k', 'anything')).toEqual([]);
  });

  it('keyword の前後の空白は無視する', () => {
    const s = makeStore({
      tags: [tag('a', 'A')],
      rules: [{ id: 'r', keyword: ' abc ', tagId: 'a' }],
    });
    expect(tagIdsFor(s, 'k', 'xabcx')).toEqual(['a']);
  });

  it('override があればルールより優先する', () => {
    const s = setOverride(store, 'k', [food.tag.id]);
    expect(tagIdsFor(s, 'k', 'NETFLIX')).toEqual([food.tag.id]);
    expect(tagIdsFor(s, 'other', 'NETFLIX')).toEqual([sub.tag.id]);
  });

  it('空配列の override は「タグなし」の明示（ルールに一致しても付かない）', () => {
    const s = setOverride(store, 'k', []);
    expect(tagIdsFor(s, 'k', 'NETFLIX')).toEqual([]);
  });

  it('override 内の存在しないタグIDは除き、tags の順に並べる', () => {
    const s: TagStore = {
      ...store,
      overrides: { k: ['ghost', food.tag.id, rent.tag.id, food.tag.id] },
    };
    expect(tagIdsFor(s, 'k', '')).toEqual([rent.tag.id, food.tag.id]);
  });

  it('Object.prototype のキー名でも override と誤認しない', () => {
    expect(tagIdsFor(store, 'constructor', 'Netflix')).toEqual([sub.tag.id]);
    expect(tagIdsFor(store, '__proto__', 'Netflix')).toEqual([sub.tag.id]);
  });
});

describe('deleteTag', () => {
  it('タグ・ルール・override のタグIDを取り除き、空になった override は空配列で残す', () => {
    let s = emptyTagStore();
    const a = addNamed(s, 'A');
    s = a.store;
    const b = addNamed(s, 'B');
    s = b.store;
    s = must(addRule(s, 'x', a.tag.id)).store;
    s = must(addRule(s, 'y', b.tag.id)).store;
    s = setOverride(s, 'k1', [a.tag.id]);
    s = setOverride(s, 'k2', [a.tag.id, b.tag.id]);
    s = setOverride(s, 'k3', [b.tag.id]);

    const d = deleteTag(s, a.tag.id);
    expect(d.tags).toEqual([b.tag]);
    expect(d.rules.map((r) => r.keyword)).toEqual(['y']);
    expect(d.overrides).toEqual({ k1: [], k2: [b.tag.id], k3: [b.tag.id] });
    // 空配列の override は「タグなし」の明示としてルールに戻らない
    expect(tagIdsFor(d, 'k1', 'x')).toEqual([]);
    // 元は変更しない
    expect(s.tags).toHaveLength(2);
    expect(s.overrides.k1).toEqual([a.tag.id]);
  });

  it('存在しないIDでも壊れない', () => {
    const s = addNamed(emptyTagStore(), 'A').store;
    expect(deleteTag(s, 'nope')).toEqual(s);
  });
});

describe('setOverride', () => {
  const s0 = makeStore({ tags: [tag('a', 'A'), tag('b', 'B')] });

  it('存在するタグだけに絞り、重複を除く', () => {
    const s = setOverride(s0, 'k', ['b', 'ghost', 'a', 'b']);
    expect(s.overrides.k).toEqual(['b', 'a']);
  });

  it('null で削除（ルールに戻る）', () => {
    const s1 = setOverride(s0, 'k', ['a']);
    const s2 = setOverride(s1, 'k', null);
    expect('k' in s2.overrides).toBe(false);
    expect(s1.overrides.k).toEqual(['a']);
    expect(setOverride(s0, 'none', null)).toBe(s0);
  });

  it('空配列は残す', () => {
    expect(setOverride(s0, 'k', []).overrides).toEqual({ k: [] });
  });

  it('他のキーは変えない', () => {
    const s = setOverride(setOverride(s0, 'k1', ['a']), 'k2', ['b']);
    expect(s.overrides).toEqual({ k1: ['a'], k2: ['b'] });
  });
});

describe('countRuleMatches', () => {
  const texts = ['NETFLIX.COM', 'ネットフリックス', 'ＮＥＴＦＬＩＸ 11月', 'セブン'];

  it('NFKC・大文字小文字を区別せず部分一致を数える', () => {
    expect(countRuleMatches('netflix', texts)).toBe(2);
    expect(countRuleMatches(' ネット ', texts)).toBe(1);
  });

  it('keyword が空・空白なら 0', () => {
    expect(countRuleMatches('', texts)).toBe(0);
    expect(countRuleMatches('  ', texts)).toBe(0);
  });

  it('texts が空なら 0', () => {
    expect(countRuleMatches('a', [])).toBe(0);
  });

  it('tagIdsFor と同じ結果になる', () => {
    const store = makeStore({
      tags: [tag('a', 'A')],
      rules: [{ id: 'r', keyword: 'ｎｅｔ', tagId: 'a' }],
    });
    const viaTagIds = texts.filter((t) => tagIdsFor(store, 'k', t).length > 0).length;
    expect(countRuleMatches('ｎｅｔ', texts)).toBe(viaTagIds);
  });
});

describe('summarizeByTag', () => {
  const store = makeStore({
    tags: [tag('rent', '家賃'), tag('sub', 'サブスク'), tag('food', '食費'), tag('unused', '未使用')],
    rules: [
      { id: 'r1', keyword: '家賃', tagId: 'rent' },
      { id: 'r2', keyword: 'netflix', tagId: 'sub' },
      { id: 'r3', keyword: 'spotify', tagId: 'sub' },
      { id: 'r4', keyword: 'コンビニ', tagId: 'food' },
    ],
  });

  it('各タグに全額を計上し、total 降順・タグなしは最後', () => {
    const rows = summarizeByTag(
      [
        { key: '1', text: '家賃 11月', amount: 80000 },
        { key: '2', text: 'NETFLIX', amount: 1490 },
        { key: '3', text: 'Spotify', amount: 980 },
        { key: '4', text: 'コンビニ', amount: 500 },
        { key: '5', text: '謎の支払い', amount: 99999 },
      ],
      store,
    );
    expect(rows).toEqual([
      { tagId: 'rent', total: 80000, count: 1 },
      { tagId: 'sub', total: 2470, count: 2 },
      { tagId: 'food', total: 500, count: 1 },
      { tagId: null, total: 99999, count: 1 },
    ]);
  });

  it('複数タグの明細は各タグに全額を重複計上する', () => {
    const s = setOverride(store, 'multi', ['sub', 'food']);
    const rows = summarizeByTag([{ key: 'multi', text: '何か', amount: 1000 }], s);
    expect(rows).toEqual([
      { tagId: 'sub', total: 1000, count: 1 },
      { tagId: 'food', total: 1000, count: 1 },
    ]);
  });

  it('同額は store.tags の順', () => {
    const rows = summarizeByTag(
      [
        { key: '1', text: 'コンビニ', amount: 1000 },
        { key: '2', text: 'netflix', amount: 1000 },
        { key: '3', text: '家賃', amount: 1000 },
      ],
      store,
    );
    expect(rows.map((r) => r.tagId)).toEqual(['rent', 'sub', 'food']);
  });

  it('override の空配列はタグなしに計上する', () => {
    const s = setOverride(store, 'k', []);
    const rows = summarizeByTag([{ key: 'k', text: 'netflix', amount: 300 }], s);
    expect(rows).toEqual([{ tagId: null, total: 300, count: 1 }]);
  });

  it('amount <= 0（と非有限）は対象外、該当が無いタグは出さない', () => {
    const rows = summarizeByTag(
      [
        { key: '1', text: '家賃', amount: 0 },
        { key: '2', text: '家賃', amount: -5000 },
        { key: '3', text: '家賃', amount: Number.NaN },
        { key: '4', text: 'netflix', amount: 100 },
      ],
      store,
    );
    expect(rows).toEqual([{ tagId: 'sub', total: 100, count: 1 }]);
  });

  it('タグなしが無ければ null 行は出さない。入力が空なら空配列', () => {
    expect(summarizeByTag([{ key: '1', text: '家賃', amount: 1 }], store).some((r) => r.tagId === null)).toBe(
      false,
    );
    expect(summarizeByTag([], store)).toEqual([]);
  });

  it('タグが1つも無いときは全部タグなし', () => {
    expect(summarizeByTag([{ key: '1', text: 'x', amount: 10 }], emptyTagStore())).toEqual([
      { tagId: null, total: 10, count: 1 },
    ]);
  });

  it('入力を変更しない', () => {
    const items = [{ key: '1', text: '家賃', amount: 10 }];
    const copy = structuredClone(items);
    summarizeByTag(items, store);
    expect(items).toEqual(copy);
  });
});

describe('matchesTagFilter', () => {
  it('selected が空なら常に true', () => {
    expect(matchesTagFilter([], [])).toBe(true);
    expect(matchesTagFilter(['a'], [])).toBe(true);
  });

  it('UNTAGGED はタグなしの明細にだけ一致する', () => {
    expect(matchesTagFilter([], [UNTAGGED])).toBe(true);
    expect(matchesTagFilter(['a'], [UNTAGGED])).toBe(false);
  });

  it('共通のタグがあれば true、無ければ false', () => {
    expect(matchesTagFilter(['a', 'b'], ['b', 'c'])).toBe(true);
    expect(matchesTagFilter(['a'], ['b'])).toBe(false);
    expect(matchesTagFilter([], ['b'])).toBe(false);
  });

  it('UNTAGGED とタグの併用は OR', () => {
    expect(matchesTagFilter([], [UNTAGGED, 'a'])).toBe(true);
    expect(matchesTagFilter(['a'], [UNTAGGED, 'a'])).toBe(true);
    expect(matchesTagFilter(['b'], [UNTAGGED, 'a'])).toBe(false);
  });
});

describe('loadTagStore / saveTagStore', () => {
  function memoryStorage(initial?: string) {
    const data = new Map<string, string>();
    if (initial !== undefined) data.set(TAGS_STORAGE_KEY, initial);
    return {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => void data.set(k, v),
      data,
    };
  }

  it('保存したものをそのまま読み戻せる', () => {
    let s = emptyTagStore();
    const a = addNamed(s, '家賃', 'red');
    s = a.store;
    s = must(addRule(s, '家賃', a.tag.id)).store;
    s = setOverride(s, 'bank|2026-11-01|x|1|0', [a.tag.id]);
    s = setOverride(s, 'prov:1', []);
    const st = memoryStorage();
    saveTagStore(s, st);
    expect(st.data.has(TAGS_STORAGE_KEY)).toBe(true);
    expect(loadTagStore(st)).toEqual(s);
  });

  it('何も保存されていなければ空ストア', () => {
    expect(loadTagStore(memoryStorage())).toEqual(emptyTagStore());
  });

  it('storage が無い（localStorage 未定義）場合も空ストア', () => {
    expect(loadTagStore()).toEqual(expect.objectContaining({ tags: expect.any(Array) }));
  });

  it('getItem が例外を投げても空ストア', () => {
    const bad = {
      getItem: () => {
        throw new Error('SecurityError');
      },
    };
    expect(loadTagStore(bad)).toEqual(emptyTagStore());
  });

  it('setItem が例外を投げても握りつぶす', () => {
    const bad = {
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
    };
    expect(() => saveTagStore(emptyTagStore(), bad)).not.toThrow();
  });

  it('壊れたJSON・形の違うデータは空ストア', () => {
    for (const text of ['{oops', '', 'null', '123', '"str"', '[]', '[1,2]', 'true']) {
      expect(loadTagStore(memoryStorage(text))).toEqual(emptyTagStore());
    }
  });

  it('tags / rules / overrides の型が違えばそれぞれ空として扱う', () => {
    const text = JSON.stringify({ tags: 'x', rules: {}, overrides: [] });
    expect(loadTagStore(memoryStorage(text))).toEqual(emptyTagStore());
  });

  it('不正なタグは捨てる（id・名前・色・重複・UNTAGGED）', () => {
    const text = JSON.stringify({
      tags: [
        { id: 'ok', name: ' 家賃 ', color: 'blue' },
        { id: 'ok', name: '重複ID', color: 'red' },
        { id: 'dupname', name: '家賃', color: 'red' },
        { id: '', name: 'idなし', color: 'red' },
        { id: UNTAGGED, name: '予約', color: 'red' },
        { id: 'noname', name: '   ', color: 'red' },
        { id: 'badcolor', name: '色違い', color: 'magenta' },
        { id: 5, name: '数値ID', color: 'red' },
        { id: 'nocolor', name: '色なし' },
        null,
        'str',
        [],
        { id: 'good2', name: '食費', color: 'green' },
      ],
      rules: [],
      overrides: {},
    });
    const s = loadTagStore(memoryStorage(text));
    expect(s.tags).toEqual([
      { id: 'ok', name: '家賃', color: 'blue' },
      { id: 'good2', name: '食費', color: 'green' },
    ]);
  });

  it('不正なルール・参照切れのルールを捨てる', () => {
    const text = JSON.stringify({
      tags: [{ id: 'a', name: 'A', color: 'blue' }],
      rules: [
        { id: 'r1', keyword: ' netflix ', tagId: 'a' },
        { id: 'r1', keyword: 'dupid', tagId: 'a' },
        { id: 'r2', keyword: 'NETFLIX', tagId: 'a' },
        { id: 'r3', keyword: 'x', tagId: 'ghost' },
        { id: 'r4', keyword: '   ', tagId: 'a' },
        { id: 'r5', keyword: 5, tagId: 'a' },
        { id: '', keyword: 'y', tagId: 'a' },
        { keyword: 'z', tagId: 'a' },
        { id: 'r6', keyword: 'w' },
        42,
      ],
      overrides: {},
    });
    const s = loadTagStore(memoryStorage(text));
    expect(s.rules).toEqual([{ id: 'r1', keyword: 'netflix', tagId: 'a' }]);
  });

  it('overrides: 参照切れのタグIDや非文字列を除き、空配列は残し、配列でない値は捨てる', () => {
    const text = JSON.stringify({
      tags: [
        { id: 'a', name: 'A', color: 'blue' },
        { id: 'b', name: 'B', color: 'green' },
      ],
      rules: [],
      overrides: {
        k1: ['a', 'ghost', 5, null, 'a', 'b'],
        k2: ['ghost'],
        k3: [],
        k4: 'a',
        k5: { a: 1 },
        k6: null,
      },
    });
    const s = loadTagStore(memoryStorage(text));
    expect(s.overrides).toEqual({ k1: ['a', 'b'], k2: [], k3: [] });
  });

  it('"__proto__" のキーでもプロトタイプを汚さない', () => {
    const text =
      '{"tags":[{"id":"a","name":"A","color":"blue"}],"rules":[],"overrides":{"__proto__":["a"],"k":["a"]}}';
    const s = loadTagStore(memoryStorage(text));
    expect(Object.getPrototypeOf(s.overrides)).toBe(Object.prototype);
    expect(s.overrides.k).toEqual(['a']);
    expect(({} as Record<string, unknown>).length).toBeUndefined();
  });

  it('余計なフィールドは落とす', () => {
    const text = JSON.stringify({
      version: 9,
      tags: [{ id: 'a', name: 'A', color: 'blue', extra: 1 }],
      rules: [],
      overrides: {},
    });
    expect(loadTagStore(memoryStorage(text))).toEqual({
      tags: [{ id: 'a', name: 'A', color: 'blue' }],
      rules: [],
      overrides: {},
    });
  });

  it('既定の storage（localStorage）で保存・読み込みできる', () => {
    const ls = globalThis.localStorage;
    if (!ls) return;
    ls.removeItem(TAGS_STORAGE_KEY);
    const s = addNamed(emptyTagStore(), '家賃').store;
    saveTagStore(s);
    expect(loadTagStore()).toEqual(s);
    ls.removeItem(TAGS_STORAGE_KEY);
  });
});

describe('SUGGESTED_TAGS / addSuggestedTags', () => {
  it('おすすめタグは9個で、名前の重複が無く、色が有効', () => {
    expect(SUGGESTED_TAGS.map((t) => t.name)).toEqual([
      '家賃',
      'サブスク',
      '光熱費',
      '通信費',
      '食費',
      '交通費',
      '日用品',
      '保険',
      'その他',
    ]);
    expect(new Set(SUGGESTED_TAGS.map((t) => t.name)).size).toBe(SUGGESTED_TAGS.length);
    for (const t of SUGGESTED_TAGS) expect(TAG_COLORS).toContain(t.color);
    expect(new Set(SUGGESTED_TAGS.map((t) => t.color)).size).toBeGreaterThanOrEqual(6);
  });

  it('空のストアにはすべて追加し、ID は一意', () => {
    const s = addSuggestedTags(emptyTagStore());
    expect(s.tags.map((t) => t.name)).toEqual(SUGGESTED_TAGS.map((t) => t.name));
    expect(new Set(s.tags.map((t) => t.id)).size).toBe(s.tags.length);
    expect(s.tags.every((t) => t.id !== UNTAGGED)).toBe(true);
  });

  it('登録済みの名前（正規化して一致）は追加せず、既存のタグはそのまま', () => {
    const existing = addNamed(emptyTagStore(), ' 家賃 ', 'red');
    const s = addSuggestedTags(existing.store);
    expect(s.tags[0]).toEqual(existing.tag);
    expect(s.tags.filter((t) => t.name.trim() === '家賃')).toHaveLength(1);
    expect(s.tags).toHaveLength(SUGGESTED_TAGS.length);
  });

  it('2回呼んでも増えない（同じストアを返す）', () => {
    const once = addSuggestedTags(emptyTagStore());
    expect(addSuggestedTags(once)).toBe(once);
  });

  it('ルールや override は保つ', () => {
    const base = makeStore({ overrides: { k: [] } });
    expect(addSuggestedTags(base).overrides).toEqual({ k: [] });
  });
});
