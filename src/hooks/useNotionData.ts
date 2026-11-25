import { useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchNotionDatabase } from '../lib/notion';
import type { ParsedFile } from '../types';

type Kind = 'bank' | 'card';

export interface NotionLoadRequest {
  token: string;
  /** 正規化済みのデータベースID。使わないときは null */
  bankDatabaseId: string | null;
  cardDatabaseId: string | null;
}

export interface NotionDbError {
  code?: string;
  message: string;
  /** schema_mismatch のときの、不足・型違いのプロパティの一覧 */
  details: string[];
}

export interface NotionDbStatus {
  kind: Kind;
  /** 取得を要求したデータベースID。要求していなければ null */
  databaseId: string | null;
  status: 'idle' | 'loading' | 'success' | 'error';
  /** 取得中に読み込んだ行数 */
  progressRows: number;
  /** 取得済みデータがあるときの値（再取得に失敗しても、前回の値が残る） */
  rowCount: number;
  transactionCount: number;
  warnings: string[];
  error: NotionDbError | null;
}

export interface UseNotionData {
  bank: NotionDbStatus;
  card: NotionDbStatus;
  /** 集計に使うデータ（銀行DB・カードDBの取得結果をまとめたもの） */
  files: ParsedFile[];
  /** 読み込みを1回でも要求したか */
  requested: boolean;
  /** 読み込む。同じDBを要求済みなら再取得する */
  load: (request: NotionLoadRequest) => void;
}

const NO_FILES: ParsedFile[] = [];

function toDbError(err: unknown): NotionDbError {
  if (err instanceof Error) {
    const extra = err as Error & { code?: unknown; details?: unknown };
    return {
      code: typeof extra.code === 'string' ? extra.code : undefined,
      message: err.message || 'Notionのデータを取得できませんでした。',
      details: Array.isArray(extra.details) ? extra.details.filter((d): d is string => typeof d === 'string') : [],
    };
  }
  return { message: 'Notionのデータを取得できませんでした。', details: [] };
}

/**
 * 1つのDBをTanStack Queryで取得する。キーは ['notion', kind, databaseId]（トークンは含めない）。
 * トークンは ref から読む。queryFn が受け取る signal により、アンマウントや再取得で取り消される。
 */
function useNotionDatabase(kind: Kind, databaseId: string | null, tokenRef: { current: string }) {
  const [progress, setProgress] = useState(0);
  const query = useQuery({
    queryKey: ['notion', kind, databaseId],
    enabled: databaseId !== null,
    queryFn: ({ signal }) => {
      setProgress(0);
      return fetchNotionDatabase({
        token: tokenRef.current,
        databaseId: databaseId as string,
        kind,
        signal,
        onProgress: (rows) => {
          if (!signal.aborted) setProgress(rows);
        },
      });
    },
  });

  const data = query.data;
  const status: NotionDbStatus = useMemo(() => {
    const files = data?.files ?? NO_FILES;
    const loading = databaseId !== null && query.isFetching;
    return {
      kind,
      databaseId,
      status:
        databaseId === null
          ? 'idle'
          : loading
            ? 'loading'
            : query.isError
              ? 'error'
              : query.isSuccess
                ? 'success'
                : 'idle',
      progressRows: progress,
      rowCount: data?.rowCount ?? 0,
      transactionCount: files.reduce((sum, f) => sum + f.transactions.length, 0),
      warnings: files.flatMap((f) => f.warnings),
      error: query.isError && !loading ? toDbError(query.error) : null,
    };
  }, [kind, databaseId, query.isFetching, query.isError, query.isSuccess, query.error, data, progress]);

  return { query, status, files: databaseId === null ? NO_FILES : (data?.files ?? NO_FILES) };
}

/**
 * Notion の銀行DB・カードDBを取得する。DBごとに useQuery を使い、読み込みの要求（load）で有効になる。
 * 取得結果は ParsedFile[]（CSVと同じ形）で返すので、集計はCSVと同じ経路で動く。
 */
export function useNotionData(): UseNotionData {
  const tokenRef = useRef('');
  const [requested, setRequested] = useState<{ bank: string | null; card: string | null } | null>(null);
  const bank = useNotionDatabase('bank', requested?.bank ?? null, tokenRef);
  const card = useNotionDatabase('card', requested?.card ?? null, tokenRef);

  const files = useMemo(() => [...bank.files, ...card.files], [bank.files, card.files]);

  const load = (request: NotionLoadRequest) => {
    tokenRef.current = request.token;
    // 同じDBを要求済みならキーが変わらないので、明示的に再取得する（前回の取得は取り消される）
    if (request.bankDatabaseId !== null && request.bankDatabaseId === requested?.bank) void bank.query.refetch();
    if (request.cardDatabaseId !== null && request.cardDatabaseId === requested?.card) void card.query.refetch();
    setRequested({ bank: request.bankDatabaseId, card: request.cardDatabaseId });
  };

  return { bank: bank.status, card: card.status, files, requested: requested !== null, load };
}
