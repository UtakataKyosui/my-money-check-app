import { useMemo, useRef, useState } from 'react';
import type { Filters, ParsedFile, ProvisionalPayment, TagStore } from './types';
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
import {
  combineTotals,
  createProvisionalId,
  filterProvisional,
  listAllMonths,
  loadProvisional,
  mergeMonthlyWithProvisional,
  provisionalByMonth,
  provisionalFromCsvByMonth,
  provisionalTotals,
  resolveProvisional,
  saveProvisional,
  withProvisionalExpense,
} from './lib/provisional';
import {
  UNTAGGED,
  addRule,
  loadTagStore,
  matchesTagFilter,
  provisionalKey,
  saveTagStore,
  setOverride,
  summarizeByTag,
  tagIdsFor,
  transactionKey,
} from './lib/tags';
import { SAMPLE_BANK_CSV, SAMPLE_BANK_FILE_NAME, SAMPLE_CARD_CSV, SAMPLE_CARD_FILE_NAME } from './sampleData';
import { UploadPanel } from './components/UploadPanel';
import type { LoadMessage } from './components/UploadPanel';
import { ProvisionalPanel } from './components/ProvisionalPanel';
import type { ProvisionalDraft } from './components/ProvisionalPanel';
import { EmptyState } from './components/EmptyState';
import { SummaryCards } from './components/SummaryCards';
import { FilterBar } from './components/FilterBar';
import { MonthlyTable } from './components/MonthlyTable';
import { TopExpenses } from './components/TopExpenses';
import type { RankSource } from './components/TopExpenses';
import { BalanceChart } from './components/BalanceChart';
import { TransactionTable } from './components/TransactionTable';
import { TagPanel } from './components/TagPanel';
import { TagBreakdown } from './components/TagBreakdown';
import type { RowTagActions } from './components/TagEditor';
import { sourceLabel } from './components/labels';

const DEFAULT_FILTERS: Filters = { months: [], sources: ['bank', 'card'], keyword: '' };
const NO_TAG_IDS: string[] = [];

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
  const [provisional, setProvisional] = useState<ProvisionalPayment[]>(() => loadProvisional());
  const [tagStore, setTagStore] = useState<TagStore>(() => loadTagStore());
  const [tagFilter, setTagFilter] = useState<string[]>([]);
  const nextId = useRef(1);
  // ファイル名ごとの「有効な読み込み要求」。消去・削除・再入稿で無効になった要求の結果は捨てる。
  const pending = useRef(new Map<string, number>());
  const nextToken = useRef(1);

  async function ingest(entries: Entry[]) {
    const tokens = new Map<string, number>();
    for (const entry of entries) {
      const token = nextToken.current++;
      tokens.set(entry.fileName, token);
      pending.current.set(entry.fileName, token);
    }
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

    // 読み込み中に消去・削除・同名の再入稿があった要求の結果は反映しない
    const current = results.filter((r) => {
      const valid = pending.current.get(r.fileName) === tokens.get(r.fileName);
      if (valid) pending.current.delete(r.fileName);
      return valid;
    });
    if (current.length === 0) return;

    const replaced = new Set(files.map((f) => f.fileName));
    const okFiles = new Map<string, ParsedFile>();
    const newMessages: LoadMessage[] = current.map((r) => {
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
    const touched = new Set(current.map((r) => r.fileName));
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
    pending.current.delete(fileName);
    setFiles((prev) => prev.filter((f) => f.fileName !== fileName));
    setMessages((prev) => prev.filter((m) => m.fileName !== fileName));
  };

  const clearAll = () => {
    pending.current.clear();
    setFiles([]);
    setMessages([]);
    setFilters(DEFAULT_FILTERS);
    setTagFilter([]);
  };

  // 手入力の暫定支払いは変更のたびにlocalStorageへ保存する（CSVは保存しない）
  const commitProvisional = (next: ProvisionalPayment[]) => {
    setProvisional(next);
    saveProvisional(next);
  };
  const addProvisional = (value: ProvisionalDraft) =>
    commitProvisional([...provisional, { id: createProvisionalId(), ...value }]);
  const updateProvisional = (item: ProvisionalPayment) =>
    commitProvisional(provisional.map((p) => (p.id === item.id ? item : p)));
  const deleteProvisional = (id: string) => commitProvisional(provisional.filter((p) => p.id !== id));
  const deleteAllProvisional = () => commitProvisional([]);

  // タグ・ルール・手動の設定は変更のたびにlocalStorageへ保存する（CSVは保存しない）
  const commitTags = (next: TagStore) => {
    setTagStore(next);
    saveTagStore(next);
    // 削除されたタグは絞り込みの選択から外す
    setTagFilter((prev) => {
      const kept = prev.filter((id) => id === UNTAGGED || next.tags.some((t) => t.id === id));
      return kept.length === prev.length ? prev : kept;
    });
  };
  const tagging = useMemo<RowTagActions>(
    () => ({
      tags: tagStore.tags,
      overrides: tagStore.overrides,
      onSetOverride: (key, ids) => commitTags(setOverride(tagStore, key, ids)),
      onAddRule: (keyword, tagId) => {
        const result = addRule(tagStore, keyword, tagId);
        if (!result.ok) return result.error;
        commitTags(result.store);
        return null;
      },
    }),
    // commitTags は setter と引数だけを使うので、tagStore が変わったときだけ作り直せばよい
    [tagStore],
  );

  const all = useMemo(() => mergeTransactions(files), [files]);
  // CSVで置き換えられた暫定値は、カードならCSVの支払額で上書きし（支払い月の行を残す）、
  // 銀行なら集計から外す。集計には effective を使う（入力データ自体は provisional に残る）。
  const { superseded, effective } = useMemo(() => resolveProvisional(provisional, files), [provisional, files]);
  const months = useMemo(() => listAllMonths(listMonths(all), effective), [all, effective]);
  // ファイルを削除して存在しなくなった月が選択に残らないようにする
  const effectiveFilters = useMemo<Filters>(
    () => ({ ...filters, months: filters.months.filter((m) => months.includes(m)) }),
    [filters, months],
  );
  // 明細・暫定支払いごとのタグ（行単位に事前計算して、表や絞り込みで使い回す）
  const txTagIds = useMemo(
    () => new Map(all.map((t) => [t.id, tagIdsFor(tagStore, transactionKey(t), t.description)])),
    [all, tagStore],
  );
  const provTagIds = useMemo(
    () => new Map(provisional.map((p) => [p.id, tagIdsFor(tagStore, provisionalKey(p), p.label)])),
    [provisional, tagStore],
  );
  // 削除済みのタグが選択に残らないようにする
  const effectiveTagFilter = useMemo(
    () => tagFilter.filter((id) => id === UNTAGGED || tagStore.tags.some((t) => t.id === id)),
    [tagFilter, tagStore.tags],
  );
  // タグで絞り込んでいないときは、タグの変更で絞り込み結果（と表のページ位置）が変わらないようにする
  const txTagIdsForFilter = effectiveTagFilter.length > 0 ? txTagIds : null;
  const byFilters = useMemo(() => applyFilters(all, effectiveFilters), [all, effectiveFilters]);
  const filtered = useMemo(
    () =>
      txTagIdsForFilter === null
        ? byFilters
        : byFilters.filter((t) => matchesTagFilter(txTagIdsForFilter.get(t.id) ?? NO_TAG_IDS, effectiveTagFilter)),
    [byFilters, effectiveTagFilter, txTagIdsForFilter],
  );
  const csvTotals = useMemo(() => totals(filtered), [filtered]);
  const bankExpense = useMemo(() => totals(filtered.filter((t) => t.source === 'bank')).expense, [filtered]);
  const cardExpense = useMemo(() => totals(filtered.filter((t) => t.source === 'card')).expense, [filtered]);
  const filteredProvisional = useMemo(() => {
    const base = filterProvisional(effective, effectiveFilters);
    return effectiveTagFilter.length === 0
      ? base
      : base.filter((p) => matchesTagFilter(provTagIds.get(p.id) ?? NO_TAG_IDS, effectiveTagFilter));
  }, [effective, effectiveFilters, effectiveTagFilter, provTagIds]);
  // 概要カードの補足は、カードと同じ絞り込み条件で数える
  const supersededCount = useMemo(() => {
    const ids = new Set(
      filterProvisional(superseded.map((s) => s.item), effectiveFilters)
        .filter((p) => matchesTagFilter(provTagIds.get(p.id) ?? NO_TAG_IDS, effectiveTagFilter))
        .map((p) => p.id),
    );
    return superseded.filter((s) => ids.has(s.item.id)).length;
  }, [superseded, effectiveFilters, effectiveTagFilter, provTagIds]);
  // 概要の注記用: 絞り込み後の集計のうち、CSVの支払額で上書きされた件数
  const csvOverriddenCount = useMemo(
    () => filteredProvisional.filter((p) => p.fromCsv).length,
    [filteredProvisional],
  );
  const csvOverriddenTotal = useMemo(
    () => filteredProvisional.reduce((sum, p) => sum + (p.fromCsv ? p.amount : 0), 0),
    [filteredProvisional],
  );
  const provisionalSummary = useMemo(() => provisionalTotals(filteredProvisional), [filteredProvisional]);
  // 概要の支出合計・収支は「CSVの支出 + 暫定支払い（effective。確定・見込みとも）」。
  // CSVの支払額で上書きした分は、元のCSVの利用明細がすでに「カードの支出」に入っているため加算しない（二重計上を避ける）。
  const summary = useMemo(
    () => combineTotals(csvTotals, { total: provisionalSummary.total - csvOverriddenTotal }),
    [csvTotals, provisionalSummary, csvOverriddenTotal],
  );
  const monthly = useMemo(
    () =>
      withProvisionalExpense(
        mergeMonthlyWithProvisional(
          summarizeByMonth(filtered),
          provisionalByMonth(filteredProvisional),
          provisionalFromCsvByMonth(filteredProvisional),
        ),
      ),
    [filtered, filteredProvisional],
  );
  const groups = useMemo(
    () => groupByDescription(filtered, { limit: 10, ...(rankSource === 'all' ? {} : { source: rankSource }) }),
    [filtered, rankSource],
  );

  // タグ別の支出: 絞り込み後のCSV取引（支出>0）と暫定支払い。支出合計と同じく、CSVの支払額で上書きした分（fromCsv）は含めない
  const tagSummaries = useMemo(
    () =>
      summarizeByTag(
        [
          ...filtered.map((t) => ({ key: transactionKey(t), text: t.description, amount: t.expense })),
          ...filteredProvisional
            .filter((p) => !p.fromCsv)
            .map((p) => ({ key: provisionalKey(p), text: p.label, amount: p.amount })),
        ],
        tagStore,
      ),
    [filtered, filteredProvisional, tagStore],
  );
  const toggleTagFilter = (id: string) =>
    setTagFilter((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  // タグの管理パネル用: 読み込み中の明細のタグ別件数と、ルールのプレビューに使う摘要
  const tagCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const ids of [...txTagIds.values(), ...provTagIds.values()]) {
      for (const id of ids) counts[id] = (counts[id] ?? 0) + 1;
    }
    return counts;
  }, [txTagIds, provTagIds]);
  const tagTexts = useMemo(
    () => [...all.map((t) => t.description), ...provisional.map((p) => p.label)],
    [all, provisional],
  );

  const hasBank = files.some((f) => f.source === 'bank');
  const bankIncluded = effectiveFilters.sources.length === 0 || effectiveFilters.sources.includes('bank');
  const balance = useMemo(() => {
    if (!hasBank || !bankIncluded) return [];
    const bank = applyFilters(all, { ...effectiveFilters, sources: ['bank'], keyword: '' });
    return dailyBalance(
      txTagIdsForFilter === null
        ? bank
        : bank.filter((t) => matchesTagFilter(txTagIdsForFilter.get(t.id) ?? NO_TAG_IDS, effectiveTagFilter)),
    );
  }, [all, effectiveFilters, hasBank, bankIncluded, effectiveTagFilter, txTagIdsForFilter]);

  return (
    <div className="app">
      <header className="app-header">
        <h1>明細チェック</h1>
        <p className="muted">
          銀行の口座明細CSVとカードの利用明細CSVを読み込んで、月別・摘要別に整理します。
          CSVのデータはこのブラウザの中だけで処理され、送信も保存もされません。
          手入力した暫定支払いと、タグ・ルール・手動のタグ設定だけは、このブラウザのlocalStorageに保存されます。
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
        {files.length === 0 && <EmptyState onLoadSample={loadSample} />}
        <ProvisionalPanel
          items={provisional}
          superseded={superseded}
          onAdd={addProvisional}
          onUpdate={updateProvisional}
          onDelete={deleteProvisional}
          onDeleteAll={deleteAllProvisional}
          tagIds={provTagIds}
          tagging={tagging}
        />
        <TagPanel store={tagStore} counts={tagCounts} texts={tagTexts} onChange={commitTags} />
        {(files.length > 0 || provisional.length > 0) && (
          <>
            <FilterBar
              months={months}
              filters={effectiveFilters}
              onChange={setFilters}
              tags={tagStore.tags}
              tagFilter={effectiveTagFilter}
              onTagFilterChange={setTagFilter}
            />
            <SummaryCards
              totals={summary}
              bankExpense={bankExpense}
              cardExpense={cardExpense}
              provisional={provisionalSummary}
              supersededCount={supersededCount}
              csvOverriddenCount={csvOverriddenCount}
              csvOverriddenTotal={csvOverriddenTotal}
            />
            <TagBreakdown
              tags={tagStore.tags}
              summaries={tagSummaries}
              expenseTotal={summary.expense}
              selected={effectiveTagFilter}
              onToggle={toggleTagFilter}
            />
            <MonthlyTable rows={monthly} />
          </>
        )}
        {files.length > 0 && (
          <>
            <TopExpenses groups={groups} source={rankSource} onSourceChange={setRankSource} />
            {hasBank && bankIncluded && <BalanceChart points={balance} />}
            <TransactionTable transactions={filtered} tagIds={txTagIds} tagging={tagging} />
          </>
        )}
      </main>
    </div>
  );
}
