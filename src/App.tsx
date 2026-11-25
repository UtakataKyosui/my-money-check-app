import { useMemo, useRef, useState } from 'react';
import type { Filters, ParsedFile } from './types';
import { decodeCsv, parseCsvText } from './lib/parseFile';
import {
  applyFilters,
  dailyBalance,
  groupByDescription,
  listMonths,
  mergeTransactions,
  summarizeByMonth,
  totals,
} from './lib/aggregate';
import { SAMPLE_BANK_CSV, SAMPLE_BANK_FILE_NAME, SAMPLE_CARD_CSV, SAMPLE_CARD_FILE_NAME } from './sampleData';
import { UploadPanel } from './components/UploadPanel';
import type { LoadMessage } from './components/UploadPanel';
import { EmptyState } from './components/EmptyState';
import { SummaryCards } from './components/SummaryCards';
import { FilterBar } from './components/FilterBar';
import { MonthlyTable } from './components/MonthlyTable';
import { TopExpenses } from './components/TopExpenses';
import type { RankSource } from './components/TopExpenses';
import { BalanceChart } from './components/BalanceChart';
import { TransactionTable } from './components/TransactionTable';
import { sourceLabel } from './components/labels';

const DEFAULT_FILTERS: Filters = { months: [], sources: ['bank', 'card'], keyword: '' };

interface Entry {
  fileName: string;
  getText: () => Promise<string>;
}

/** jsdom など File#arrayBuffer が無い環境向けのフォールバック付き */
async function readBytes(file: File): Promise<Uint8Array> {
  if (typeof file.arrayBuffer === 'function') {
    return new Uint8Array(await file.arrayBuffer());
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.onerror = () => reject(reader.error ?? new Error('ファイルを読み込めませんでした。'));
    reader.readAsArrayBuffer(file);
  });
}

export default function App() {
  const [files, setFiles] = useState<ParsedFile[]>([]);
  const [messages, setMessages] = useState<LoadMessage[]>([]);
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [rankSource, setRankSource] = useState<RankSource>('all');
  const nextId = useRef(1);

  async function ingest(entries: Entry[]) {
    type Result = { fileName: string; parsed: ParsedFile; error?: undefined } | { fileName: string; error: string; parsed?: undefined };
    const results: Result[] = await Promise.all(
      entries.map(async (entry): Promise<Result> => {
        try {
          const parsed = parseCsvText(await entry.getText(), entry.fileName);
          return { fileName: entry.fileName, parsed };
        } catch (err) {
          const raw = err instanceof Error && err.message ? err.message : 'CSVを読み取れませんでした。';
          // ファイル名は画面側で別に表示するため、メッセージ先頭の重複を除く
          const text = raw.startsWith(`${entry.fileName}: `) ? raw.slice(entry.fileName.length + 2) : raw;
          return { fileName: entry.fileName, error: text };
        }
      }),
    );

    const replaced = new Set(files.map((f) => f.fileName));
    const okFiles = new Map<string, ParsedFile>();
    const newMessages: LoadMessage[] = results.map((r) => {
      const id = nextId.current++;
      if (r.parsed) {
        okFiles.set(r.fileName, r.parsed);
        const suffix = replaced.has(r.fileName) ? '（同名のファイルを置き換えました）' : '';
        return {
          id,
          fileName: r.fileName,
          kind: 'success',
          text: `${sourceLabel(r.parsed.source)}の明細として${r.parsed.transactions.length}件を読み込みました。${suffix}`,
          warnings: r.parsed.warnings,
        };
      }
      return { id, fileName: r.fileName, kind: 'error', text: r.error ?? '', warnings: [] };
    });

    if (okFiles.size > 0) {
      setFiles((prev) => [...prev.filter((f) => !okFiles.has(f.fileName)), ...okFiles.values()]);
    }
    const touched = new Set(results.map((r) => r.fileName));
    setMessages((prev) => [...prev.filter((m) => !touched.has(m.fileName)), ...newMessages]);
  }

  const handleFiles = (picked: File[]) =>
    void ingest(picked.map((file) => ({ fileName: file.name, getText: async () => decodeCsv(await readBytes(file)) })));

  const loadSample = () =>
    void ingest([
      { fileName: SAMPLE_BANK_FILE_NAME, getText: async () => SAMPLE_BANK_CSV },
      { fileName: SAMPLE_CARD_FILE_NAME, getText: async () => SAMPLE_CARD_CSV },
    ]);

  const removeFile = (fileName: string) => {
    setFiles((prev) => prev.filter((f) => f.fileName !== fileName));
    setMessages((prev) => prev.filter((m) => m.fileName !== fileName));
  };

  const clearAll = () => {
    setFiles([]);
    setMessages([]);
    setFilters(DEFAULT_FILTERS);
  };

  const all = useMemo(() => mergeTransactions(files), [files]);
  const months = useMemo(() => listMonths(all), [all]);
  // ファイルを削除して存在しなくなった月が選択に残らないようにする
  const effectiveFilters = useMemo<Filters>(
    () => ({ ...filters, months: filters.months.filter((m) => months.includes(m)) }),
    [filters, months],
  );
  const filtered = useMemo(() => applyFilters(all, effectiveFilters), [all, effectiveFilters]);
  const summary = useMemo(() => totals(filtered), [filtered]);
  const bankExpense = useMemo(() => totals(filtered.filter((t) => t.source === 'bank')).expense, [filtered]);
  const cardExpense = useMemo(() => totals(filtered.filter((t) => t.source === 'card')).expense, [filtered]);
  const monthly = useMemo(() => summarizeByMonth(filtered), [filtered]);
  const groups = useMemo(
    () => groupByDescription(filtered, { limit: 10, ...(rankSource === 'all' ? {} : { source: rankSource }) }),
    [filtered, rankSource],
  );

  const hasBank = files.some((f) => f.source === 'bank');
  const bankIncluded = effectiveFilters.sources.length === 0 || effectiveFilters.sources.includes('bank');
  const balance = useMemo(
    () =>
      hasBank && bankIncluded
        ? dailyBalance(applyFilters(all, { ...effectiveFilters, sources: ['bank'], keyword: '' }))
        : [],
    [all, effectiveFilters, hasBank, bankIncluded],
  );

  return (
    <div className="app">
      <header className="app-header">
        <h1>明細チェック</h1>
        <p className="muted">
          銀行の口座明細CSVとカードの利用明細CSVを読み込んで、月別・摘要別に整理します。
          データはこのブラウザの中だけで処理され、送信も保存もされません。
        </p>
      </header>
      <main>
        <UploadPanel
          messages={messages}
          files={files}
          onFiles={handleFiles}
          onDismissMessage={(id) => setMessages((prev) => prev.filter((m) => m.id !== id))}
          onRemoveFile={removeFile}
          onClear={clearAll}
        />
        {files.length === 0 ? (
          <EmptyState onLoadSample={loadSample} />
        ) : (
          <>
            <FilterBar months={months} filters={effectiveFilters} onChange={setFilters} />
            <SummaryCards totals={summary} bankExpense={bankExpense} cardExpense={cardExpense} />
            <MonthlyTable rows={monthly} />
            <TopExpenses groups={groups} source={rankSource} onSourceChange={setRankSource} />
            {hasBank && bankIncluded && <BalanceChart points={balance} />}
            <TransactionTable transactions={filtered} />
          </>
        )}
      </main>
    </div>
  );
}
