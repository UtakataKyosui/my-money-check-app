import { useCallback, useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import type { HelpTabId } from './tabs';

/**
 * ヘルプの開閉とタブの状態。開いたときのフォーカス位置を覚えておき、閉じたらそこへ戻す
 * （その要素が無くなっていれば fallback へ）。
 */
export function useHelpDialog(fallbackFocus?: RefObject<HTMLElement | null>) {
  const [state, setState] = useState<{ open: boolean; tab: HelpTabId }>({ open: false, tab: 'csv' });
  const returnTo = useRef<HTMLElement | null>(null);
  const wasOpen = useRef(false);

  const openHelp = useCallback((tab: HelpTabId = 'csv') => {
    const active = document.activeElement;
    returnTo.current = active instanceof HTMLElement && active !== document.body ? active : null;
    setState({ open: true, tab });
  }, []);

  const closeHelp = useCallback(() => setState((prev) => (prev.open ? { ...prev, open: false } : prev)), []);
  const setTab = useCallback((tab: HelpTabId) => setState((prev) => ({ ...prev, tab })), []);

  useEffect(() => {
    if (wasOpen.current && !state.open) {
      const target = returnTo.current?.isConnected ? returnTo.current : (fallbackFocus?.current ?? null);
      target?.focus();
      returnTo.current = null;
    }
    wasOpen.current = state.open;
  }, [state.open, fallbackFocus]);

  return { open: state.open, tab: state.tab, openHelp, closeHelp, setTab };
}
