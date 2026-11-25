import { useId, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import type { TagColor, TagStore } from '../types';
import {
  MAX_TAG_NAME_LENGTH,
  TAG_COLORS,
  addRule,
  addSuggestedTags,
  addTag,
  countRuleMatches,
  deleteTag,
  removeRule,
  renameTag,
  setTagColor,
} from '../lib/tags';
import { TAG_COLOR_LABELS, formatCount } from './labels';
import { TagChip } from './TagChips';

interface Props {
  store: TagStore;
  /** タグID → 読み込み中の明細（CSVの取引と暫定支払い）でそのタグが付いている件数 */
  counts: Record<string, number>;
  /** 読み込み中の明細の摘要（CSVの摘要と暫定支払いの支払先）。ルールのプレビューに使う */
  texts: string[];
  onChange: (next: TagStore) => void;
}

export function TagPanel({ store, counts, texts, onChange }: Props) {
  const uid = useId();
  const [name, setName] = useState('');
  const [color, setColor] = useState<TagColor | ''>('');
  const [nameError, setNameError] = useState('');
  const [status, setStatus] = useState('');

  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [renameError, setRenameError] = useState('');

  const [keyword, setKeyword] = useState('');
  const [ruleTagId, setRuleTagId] = useState('');
  const [ruleError, setRuleError] = useState('');

  const nameRef = useRef<HTMLInputElement>(null);
  const keywordRef = useRef<HTMLInputElement>(null);
  const renameRef = useRef<HTMLInputElement>(null);

  const { tags, rules } = store;
  const tagsById = new Map(tags.map((t) => [t.id, t]));
  const selectedRuleTag = tagsById.get(ruleTagId) ?? tags[0];
  const trimmedKeyword = keyword.trim();
  const matchCount = trimmedKeyword === '' ? null : countRuleMatches(keyword, texts);

  const ids = {
    name: `${uid}-name`,
    nameHint: `${uid}-name-hint`,
    nameError: `${uid}-name-error`,
    color: `${uid}-color`,
    keyword: `${uid}-keyword`,
    keywordError: `${uid}-keyword-error`,
    preview: `${uid}-preview`,
    ruleTag: `${uid}-rule-tag`,
    renameError: `${uid}-rename-error`,
  };

  const handleAddTag = (e: FormEvent) => {
    e.preventDefault();
    const result = addTag(store, name, color === '' ? undefined : color);
    if (!result.ok) {
      setNameError(result.error);
      setStatus('');
      nameRef.current?.focus();
      return;
    }
    onChange(result.store);
    setName('');
    setNameError('');
    setStatus(`タグ「${result.tag.name}」を追加しました。`);
    nameRef.current?.focus();
  };

  const handleSuggested = () => {
    const next = addSuggestedTags(store);
    const added = next.tags.length - store.tags.length;
    onChange(next);
    setNameError('');
    setStatus(added > 0 ? `おすすめのタグを${formatCount(added)}追加しました。` : 'おすすめのタグはすべて追加済みです。');
  };

  const startRename = (id: string, current: string) => {
    setRenamingId(id);
    setRenameValue(current);
    setRenameError('');
    setStatus('');
    // 入力欄が描画されてからフォーカスする
    requestAnimationFrame(() => renameRef.current?.focus());
  };

  const handleRename = (e: FormEvent) => {
    e.preventDefault();
    if (renamingId === null) return;
    const result = renameTag(store, renamingId, renameValue);
    if (!result.ok) {
      setRenameError(result.error);
      renameRef.current?.focus();
      return;
    }
    onChange(result.store);
    setStatus(`タグ名を「${renameValue.trim()}」に変更しました。`);
    setRenamingId(null);
    setRenameError('');
  };

  const handleDelete = (id: string) => {
    const tag = tagsById.get(id);
    if (!tag) return;
    const ok = window.confirm(
      `タグ「${tag.name}」を削除します。このタグを使うルールと、明細に手動で付けた設定からも外れます。元に戻せません。よろしいですか？`,
    );
    if (!ok) return;
    if (renamingId === id) setRenamingId(null);
    onChange(deleteTag(store, id));
    setStatus(`タグ「${tag.name}」を削除しました。`);
  };

  const handleAddRule = (e: FormEvent) => {
    e.preventDefault();
    if (!selectedRuleTag) {
      setRuleError('先にタグを作成してください。');
      return;
    }
    const result = addRule(store, keyword, selectedRuleTag.id);
    if (!result.ok) {
      setRuleError(result.error);
      setStatus('');
      keywordRef.current?.focus();
      return;
    }
    onChange(result.store);
    setStatus(`ルールを追加しました（摘要に「${result.rule.keyword}」を含む明細に「${selectedRuleTag.name}」）。`);
    setKeyword('');
    setRuleError('');
    keywordRef.current?.focus();
  };

  const handleRemoveRule = (ruleId: string) => {
    const rule = rules.find((r) => r.id === ruleId);
    onChange(removeRule(store, ruleId));
    if (rule) setStatus(`「${rule.keyword}」のルールを削除しました。`);
  };

  const describedBy = (...parts: (string | false | undefined)[]) => parts.filter(Boolean).join(' ') || undefined;

  return (
    <section className="panel tag-panel" aria-labelledby="tag-panel-title">
      <h2 id="tag-panel-title">タグとルール</h2>
      <p className="muted tag-intro">
        明細にタグ（例: 家賃、サブスク）を付けて、何の支出かを確認できます。タグは1つの明細に複数付けられます。
        摘要に決めた文字列が含まれる明細へ自動で付ける「ルール」と、明細ごとの手動の設定（ルールより優先）で付けます。
        タグ・ルール・手動の設定だけがこのブラウザのlocalStorageに保存され、CSVの明細（日付・摘要・金額など）そのものは保存されません。手動の設定は明細を識別するハッシュ値で保存します。ルールのキーワードは入力した文字列がそのまま保存されます。
      </p>
      <div className="form-status" aria-live="polite">
        {status}
      </div>

      {tags.length === 0 && (
        <div className="tag-empty">
          <h3>まずはタグを作りましょう</h3>
          <ol className="steps">
            <li>下の「タグ名」に名前（例: 家賃）を入れて「タグを追加」を押します。</li>
            <li>「自動タグ付けのルール」で、摘要に含まれる文字列とタグを結び付けます。</li>
            <li>明細や暫定支払いの「タグを編集」から、1件ずつ手動でも付けられます。</li>
          </ol>
          <button type="button" className="btn" onClick={handleSuggested}>
            おすすめのタグを追加
          </button>
          <p className="muted small field-hint">家賃・サブスク・光熱費など、よく使うタグをまとめて追加します。</p>
        </div>
      )}

      <form className="tag-form" onSubmit={handleAddTag} noValidate aria-labelledby={`${uid}-add-title`}>
        <h3 id={`${uid}-add-title`}>タグを作る</h3>
        <div className="tag-form-row">
          <div className="field tag-grow">
            <label htmlFor={ids.name}>タグ名</label>
            <input
              ref={nameRef}
              id={ids.name}
              type="text"
              value={name}
              placeholder="例: 家賃"
              autoComplete="off"
              aria-invalid={nameError ? true : undefined}
              aria-describedby={describedBy(ids.nameHint, nameError && ids.nameError)}
              onChange={(e) => {
                setName(e.target.value);
                setNameError('');
              }}
            />
          </div>
          <div className="field">
            <label htmlFor={ids.color}>色</label>
            <select id={ids.color} value={color} onChange={(e) => setColor(e.target.value as TagColor | '')}>
              <option value="">おまかせ</option>
              {TAG_COLORS.map((c) => (
                <option key={c} value={c}>
                  {TAG_COLOR_LABELS[c]}
                </option>
              ))}
            </select>
          </div>
          <div className="tag-form-submit">
            <button type="submit" className="btn">
              タグを追加
            </button>
          </div>
        </div>
        <p id={ids.nameHint} className="muted small field-hint">
          {MAX_TAG_NAME_LENGTH}文字まで。ほかのタグと同じ名前は使えません。
        </p>
        {nameError && (
          <p id={ids.nameError} className="field-error">
            {nameError}
          </p>
        )}
        {tags.length > 0 && (
          <p>
            <button type="button" className="btn btn-small btn-ghost" onClick={handleSuggested}>
              おすすめのタグを追加
            </button>
          </p>
        )}
      </form>

      <div className="tag-section">
        <h3>タグ一覧（{formatCount(tags.length)}）</h3>
        {tags.length === 0 ? (
          <p className="muted">まだタグはありません。</p>
        ) : (
          <>
            <p className="muted small">件数は、いま読み込んでいるCSVの取引と暫定支払いのうち、そのタグが付いているものです。</p>
            <ul className="tag-list">
              {tags.map((tag) => (
                <li key={tag.id}>
                  {renamingId === tag.id ? (
                    <form className="tag-rename" onSubmit={handleRename} noValidate>
                      <div className="field tag-grow">
                        <label htmlFor={`${uid}-rename-${tag.id}`} className="sr-only">
                          「{tag.name}」の新しい名前
                        </label>
                        <input
                          ref={renameRef}
                          id={`${uid}-rename-${tag.id}`}
                          type="text"
                          value={renameValue}
                          autoComplete="off"
                          aria-invalid={renameError ? true : undefined}
                          aria-describedby={renameError ? ids.renameError : undefined}
                          onChange={(e) => {
                            setRenameValue(e.target.value);
                            setRenameError('');
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Escape') setRenamingId(null);
                          }}
                        />
                        {renameError && (
                          <p id={ids.renameError} className="field-error">
                            {renameError}
                          </p>
                        )}
                      </div>
                      <button type="submit" className="btn btn-small">
                        名前を保存
                      </button>
                      <button type="button" className="btn btn-small btn-ghost" onClick={() => setRenamingId(null)}>
                        キャンセル
                      </button>
                    </form>
                  ) : (
                    <>
                      <span className="tag-list-name">
                        <TagChip tag={tag} />
                        <span className="muted small">{formatCount(counts[tag.id] ?? 0)}</span>
                      </span>
                      <span className="tag-list-actions">
                        <select
                          aria-label={`「${tag.name}」の色`}
                          value={tag.color}
                          onChange={(e) => onChange(setTagColor(store, tag.id, e.target.value as TagColor))}
                        >
                          {TAG_COLORS.map((c) => (
                            <option key={c} value={c}>
                              {TAG_COLOR_LABELS[c]}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          className="btn btn-small btn-ghost"
                          aria-label={`「${tag.name}」の名前を変更`}
                          onClick={() => startRename(tag.id, tag.name)}
                        >
                          名前を変更
                        </button>
                        <button
                          type="button"
                          className="btn btn-small btn-ghost"
                          aria-label={`「${tag.name}」を削除`}
                          onClick={() => handleDelete(tag.id)}
                        >
                          削除
                        </button>
                      </span>
                    </>
                  )}
                </li>
              ))}
            </ul>
          </>
        )}
      </div>

      <div className="tag-section">
        <form className="tag-form" onSubmit={handleAddRule} noValidate aria-labelledby={`${uid}-rule-title`}>
          <h3 id={`${uid}-rule-title`}>自動タグ付けのルール</h3>
          <p className="muted small">
            摘要に決めた文字列が含まれる明細（CSVの摘要・暫定支払いの支払先）に、自動でタグを付けます。
            全角・半角と大文字・小文字は区別しません。手動で設定した明細にはルールより手動の設定が優先されます。
          </p>
          {tags.length === 0 ? (
            <p className="muted">ルールを作るには、先にタグを作成してください。</p>
          ) : (
            <>
              <div className="tag-form-row">
                <div className="field tag-grow">
                  <label htmlFor={ids.keyword}>摘要に含む文字列</label>
                  <input
                    ref={keywordRef}
                    id={ids.keyword}
                    type="text"
                    value={keyword}
                    placeholder="例: 家賃"
                    autoComplete="off"
                    aria-invalid={ruleError ? true : undefined}
                    aria-describedby={describedBy(matchCount !== null && ids.preview, ruleError && ids.keywordError)}
                    onChange={(e) => {
                      setKeyword(e.target.value);
                      setRuleError('');
                    }}
                  />
                </div>
                <div className="field">
                  <label htmlFor={ids.ruleTag}>付けるタグ</label>
                  <select id={ids.ruleTag} value={selectedRuleTag?.id ?? ''} onChange={(e) => setRuleTagId(e.target.value)}>
                    {tags.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="tag-form-submit">
                  <button type="submit" className="btn">
                    ルールを追加
                  </button>
                </div>
              </div>
              <div id={ids.preview} className="muted small tag-preview" aria-live="polite">
                {matchCount !== null && selectedRuleTag
                  ? `摘要に「${trimmedKeyword}」を含む明細に「${selectedRuleTag.name}」を付けます。現在読み込んでいる明細（CSVの取引と暫定支払い ${formatCount(texts.length)}）のうち、${formatCount(matchCount)}が該当します。`
                  : ''}
              </div>
              {ruleError && (
                <p id={ids.keywordError} className="field-error">
                  {ruleError}
                </p>
              )}
            </>
          )}
        </form>

        <h4 className="tag-subtitle">登録済みのルール（{formatCount(rules.length)}）</h4>
        {rules.length === 0 ? (
          <p className="muted">まだルールはありません。</p>
        ) : (
          <ul className="tag-list tag-rules">
            {rules.map((rule) => {
              const tag = tagsById.get(rule.tagId);
              return (
                <li key={rule.id}>
                  <span className="tag-list-name">
                    <span>摘要に「{rule.keyword}」を含む →</span>
                    {tag && <TagChip tag={tag} />}
                  </span>
                  <span className="tag-list-actions">
                    <button
                      type="button"
                      className="btn btn-small btn-ghost"
                      aria-label={`「${rule.keyword}」のルールを削除`}
                      onClick={() => handleRemoveRule(rule.id)}
                    >
                      削除
                    </button>
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>

    </section>
  );
}
