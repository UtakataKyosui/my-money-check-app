import { useId, useLayoutEffect, useRef } from 'react';
import type { KeyboardEvent, MouseEvent, SyntheticEvent } from 'react';
import { CsvHelp, NotionFormatHelp, NotionSetupHelp, PrivacyHelp } from './HelpPanels';
import { HELP_TABS } from './tabs';
import type { HelpTabId } from './tabs';

interface Props {
  open: boolean;
  tab: HelpTabId;
  onTabChange: (tab: HelpTabId) => void;
  onClose: () => void;
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * アプリ内ヘルプのモーダル。`<dialog>` を使い、showModal が無い環境（jsdom など）では open 属性で開く。
 * Esc・背景クリック・「閉じる」で閉じる。Tab キーはダイアログ内で循環させる。
 * 閉じたあとのフォーカスは呼び出し側（useHelpDialog）が元の要素へ戻す。
 */
export function HelpDialog({ open, tab, onTabChange, onClose }: Props) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const tabRefs = useRef(new Map<HelpTabId, HTMLButtonElement>());
  const tabId = (id: HelpTabId) => `${titleId}-tab-${id}`;
  const panelId = (id: HelpTabId) => `${titleId}-panel-${id}`;

  useLayoutEffect(() => {
    if (!open) return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (typeof dialog.showModal === 'function') {
      try {
        if (!dialog.open) dialog.showModal();
      } catch {
        dialog.setAttribute('open', '');
      }
    } else {
      dialog.setAttribute('open', '');
    }
    // 開いたら、いま選ばれているタブへフォーカスする
    tabRefs.current.get(tab)?.focus();
    // 開いている間は背景をスクロールさせない
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
    // 開いた瞬間だけ実行する（タブ切り替えでフォーカスを奪わない）
  }, [open]);

  // 開いていない間は DOM に置かない
  if (!open) return null;

  const handleKeyDown = (e: KeyboardEvent<HTMLDialogElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onClose();
      return;
    }
    if (e.key !== 'Tab') return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    const items = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE));
    const first = items[0];
    const last = items[items.length - 1];
    if (!first || !last) {
      e.preventDefault();
      return;
    }
    const active = document.activeElement;
    if (!dialog.contains(active)) {
      e.preventDefault();
      first.focus();
    } else if (e.shiftKey && active === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  };

  const handleTabKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const index = HELP_TABS.findIndex((t) => t.id === tab);
    let next = index;
    if (e.key === 'ArrowRight') next = (index + 1) % HELP_TABS.length;
    else if (e.key === 'ArrowLeft') next = (index - 1 + HELP_TABS.length) % HELP_TABS.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = HELP_TABS.length - 1;
    else return;
    e.preventDefault();
    const target = HELP_TABS[next];
    if (!target) return;
    onTabChange(target.id);
    tabRefs.current.get(target.id)?.focus();
  };

  // 背景（ダイアログ要素そのもの）を押したら閉じる
  const handleBackdropClick = (e: MouseEvent<HTMLDialogElement>) => {
    if (e.target === e.currentTarget) onClose();
  };

  const handleCancel = (e: SyntheticEvent<HTMLDialogElement>) => {
    e.preventDefault();
    onClose();
  };

  return (
    <dialog
      ref={dialogRef}
      className="help-dialog"
      aria-labelledby={titleId}
      aria-modal="true"
      onKeyDown={handleKeyDown}
      onCancel={handleCancel}
      onClick={handleBackdropClick}
    >
      <div className="help-inner">
        <div className="help-head">
          <h2 id={titleId}>ヘルプ</h2>
          <button type="button" className="btn btn-small btn-ghost" onClick={onClose}>
            閉じる
          </button>
        </div>

        <div className="help-tabs" role="tablist" aria-label="ヘルプの項目" onKeyDown={handleTabKeyDown}>
          {HELP_TABS.map((t) => (
            <button
              key={t.id}
              ref={(el) => {
                if (el) tabRefs.current.set(t.id, el);
                else tabRefs.current.delete(t.id);
              }}
              id={tabId(t.id)}
              type="button"
              role="tab"
              className="help-tab"
              aria-selected={t.id === tab}
              aria-controls={t.id === tab ? panelId(t.id) : undefined}
              tabIndex={t.id === tab ? 0 : -1}
              onClick={() => onTabChange(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div
          className="help-panel"
          role="tabpanel"
          id={panelId(tab)}
          aria-labelledby={tabId(tab)}
          tabIndex={0}
        >
          {tab === 'csv' && <CsvHelp />}
          {tab === 'notion-format' && <NotionFormatHelp onNavigate={onTabChange} />}
          {tab === 'notion-setup' && <NotionSetupHelp onNavigate={onTabChange} />}
          {tab === 'privacy' && <PrivacyHelp />}
        </div>
      </div>
    </dialog>
  );
}
