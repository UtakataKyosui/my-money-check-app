import { QueryClient } from '@tanstack/react-query';

/**
 * アプリ用の QueryClient。金融データなので、ウィンドウのフォーカスや再接続での自動再取得はしない。
 * 取得結果は staleTime: Infinity で「再読み込みを押すまで」据え置き、使われなくなって5分で破棄する。
 */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
        staleTime: Infinity,
        gcTime: 5 * 60_000,
      },
    },
  });
}
