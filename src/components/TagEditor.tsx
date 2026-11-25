import { useEffect, useId, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import type { Tag } from '../types';
import { TagChip } from './TagChips';

/** 明細（取引・暫定支払い）の行ごとのタグ編集に必要な操作と状態 */
export interface RowTagActions {
  tags: Tag[];
  /** 明細キー → 手動で設定したタグ。キーがあれば「手動の設定あり」 */
  overrides: Record<string, string[]>;
  /** ids が null なら手動の設定を消してルールに戻す */
  onSetOverride: (key: string, ids: string[] | null) => void;
  /** 成功なら null、失敗なら日本語のエラーメッセージ */
  onAddRule: (keyword: string, tagId: string) => string | null;
}

interface Props {
  /** 編集パネルのDOM id（開閉ボタンの aria-controls から参照される） */
  id: string;
  /** 行を表す名前（摘要など）。読み上げ用 */
  title: string;
  actions: RowTagActions;
  /** 明細キー */
  itemKey: string;
  /** いま付いているタグ（手動の設定またはルールの結果） */
  currentIds: string[];
  /** 「この摘要をルールにする」で使うキーワード */
  ruleKeyword: string;
  onClose: () => void;
}

export function TagEditor({ id, title, actions, itemKey, currentIds, ruleKeyword, onClose }: Props) {
  const uid = useId();
  const { tags, overrides, onSetOverride, onAddRule } = actions;
  const overridden = Object.prototype.hasOwnProperty.call(overrides, itemKey);
  const [checked, setChecked] = useState<Set<string>>(() => new Set(currentIds));
  const [ruleError, setRuleError] = useState('');
  const [ruleStatus, setRuleStatus] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);

  // 開いたら編集UIの先頭へフォーカスを移す
  useEffect(() => {
    const first = rootRef.current?.querySelector<HTMLElement>('input, button');
    (first ?? rootRef.current)?.focus();
  }, []);

  const toggle = (tagId: string) => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(tagId)) next.delete(tagId);
      else next.add(tagId);
      return next;
    });
    setRuleError('');
    setRuleStatus('');
  };

  const selectedIds = tags.filter((t) => checked.has(t.id)).map((t) => t.id);
  const ruleTag = selectedIds.length === 1 ? tags.find((t) => t.id === selectedIds[0]) : undefined;

  const save = () => {
    onSetOverride(itemKey, selectedIds);
    onClose();
  };

  const reset = () => {
    onSetOverride(itemKey, null);
    onClose();
  };

  const makeRule = () => {
    if (!ruleTag) return;
    const error = onAddRule(ruleKeyword, ruleTag.id);
    if (error) {
      setRuleError(error);
      setRuleStatus('');
      return;
    }
    setRuleError('');
    setRuleStatus(
      `ルールを追加しました（摘要に「${ruleKeyword}」を含む明細に「${ruleTag.name}」）。` +
        (overridden ? 'この明細には手動の設定があるため、「ルールに戻す」で反映されます。' : ''),
    );
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      onClose();
    }
  };

  const hintId = `${uid}-hint`;
  const errorId = `${uid}-error`;

  return (
    <div
      ref={rootRef}
      id={id}
      className="tag-editor"
      role="group"
      aria-label={`「${title}」のタグを編集`}
      tabIndex={-1}
      onKeyDown={onKeyDown}
    >
      {tags.length === 0 ? (
        <p className="muted small">
          タグがまだありません。上の「タグとルール」でタグを作成すると、ここで選べます。
        </p>
      ) : (
        <fieldset>
          <legend>この明細に付けるタグ（複数選べます）</legend>
          <div className="checks">
            {tags.map((tag) => (
              <label key={tag.id} className="check">
                <input type="checkbox" checked={checked.has(tag.id)} onChange={() => toggle(tag.id)} />
                <TagChip tag={tag} />
              </label>
            ))}
          </div>
        </fieldset>
      )}
      <p className="muted small tag-editor-state">
        {overridden ? '手動で設定されています。' : 'いまはルールに従っています（手動の設定なし）。'}
        同じ日付・摘要・金額の明細には同じ設定が適用されます。
      </p>
      <div className="tag-editor-actions">
        <button type="button" className="btn btn-small" onClick={save} disabled={tags.length === 0}>
          タグを保存
        </button>
        <button type="button" className="btn btn-small btn-ghost" onClick={reset} disabled={!overridden}>
          ルールに戻す
        </button>
        <button type="button" className="btn btn-small btn-ghost" onClick={onClose}>
          閉じる
        </button>
      </div>
      {tags.length > 0 && (
        <div className="tag-editor-rule">
          <button
            type="button"
            className="btn btn-small btn-ghost"
            disabled={!ruleTag}
            aria-describedby={ruleError ? `${hintId} ${errorId}` : hintId}
            onClick={makeRule}
          >
            この摘要をルールにする
          </button>
          <p id={hintId} className="muted small field-hint">
            {ruleTag
              ? `摘要に「${ruleKeyword}」を含む明細すべてに「${ruleTag.name}」を付けるルールを追加します。`
              : 'ルールにするには、タグを1つだけ選んでください。'}
          </p>
          {ruleError && (
            <p id={errorId} className="field-error">
              {ruleError}
            </p>
          )}
          <p className="form-status" aria-live="polite">
            {ruleStatus}
          </p>
        </div>
      )}
    </div>
  );
}
