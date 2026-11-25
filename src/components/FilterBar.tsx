import { useId } from 'react';
import type { Filters, SourceKind } from '../types';
import { formatMonth } from '../lib/format';
import { sourceLabel } from './labels';

interface Props {
  months: string[];
  filters: Filters;
  onChange: (next: Filters) => void;
}

const SOURCES: SourceKind[] = ['bank', 'card'];

export function FilterBar({ months, filters, onChange }: Props) {
  const keywordId = useId();
  const active =
    filters.months.length > 0 || filters.sources.length !== SOURCES.length || filters.keyword.trim() !== '';

  const toggleMonth = (month: string) => {
    const has = filters.months.includes(month);
    onChange({
      ...filters,
      months: has ? filters.months.filter((m) => m !== month) : [...filters.months, month].sort(),
    });
  };

  const toggleSource = (source: SourceKind) => {
    const has = filters.sources.includes(source);
    // 空だと意味が曖昧になるため、最後の1つは外せないようにする
    if (has && filters.sources.length === 1) return;
    onChange({
      ...filters,
      sources: has ? filters.sources.filter((s) => s !== source) : SOURCES.filter((s) => s === source || filters.sources.includes(s)),
    });
  };

  return (
    <section className="panel" aria-labelledby="filter-title">
      <div className="panel-head">
        <h2 id="filter-title">絞り込み</h2>
        <button
          type="button"
          className="btn btn-small btn-ghost"
          disabled={!active}
          onClick={() => onChange({ months: [], sources: [...SOURCES], keyword: '' })}
        >
          条件をリセット
        </button>
      </div>
      <div className="filters">
        <fieldset>
          <legend>月（未選択なら全期間）</legend>
          <div className="checks">
            {months.map((m) => (
              <label key={m} className="check">
                <input type="checkbox" checked={filters.months.includes(m)} onChange={() => toggleMonth(m)} />
                {formatMonth(m)}
              </label>
            ))}
          </div>
        </fieldset>
        <fieldset>
          <legend>ソース</legend>
          <div className="checks">
            {SOURCES.map((s) => (
              <label key={s} className="check">
                <input type="checkbox" checked={filters.sources.includes(s)} onChange={() => toggleSource(s)} />
                {sourceLabel(s)}
              </label>
            ))}
          </div>
        </fieldset>
        <div className="field">
          <label htmlFor={keywordId}>キーワード（摘要）</label>
          <input
            id={keywordId}
            type="search"
            value={filters.keyword}
            placeholder="例: スーパー"
            onChange={(e) => onChange({ ...filters, keyword: e.target.value })}
          />
        </div>
      </div>
    </section>
  );
}
