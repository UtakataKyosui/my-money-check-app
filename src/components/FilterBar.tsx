import { useId } from 'react';
import type { Filters, SourceKind, Tag } from '../types';
import { formatMonth } from '../lib/format';
import { UNTAGGED } from '../lib/tags';
import { sourceLabel } from './labels';
import { TagChip } from './TagChips';

interface Props {
  months: string[];
  filters: Filters;
  onChange: (next: Filters) => void;
  /** 絞り込みに使えるタグ（空ならタグの絞り込みは出さない） */
  tags: Tag[];
  /** 選択中のタグID。`UNTAGGED` は「タグなし」 */
  tagFilter: string[];
  onTagFilterChange: (next: string[]) => void;
}

const SOURCES: SourceKind[] = ['bank', 'card'];

export function FilterBar({ months, filters, onChange, tags, tagFilter, onTagFilterChange }: Props) {
  const keywordId = useId();
  const active =
    filters.months.length > 0 ||
    filters.sources.length !== SOURCES.length ||
    filters.keyword.trim() !== '' ||
    tagFilter.length > 0;

  const toggleTag = (id: string) =>
    onTagFilterChange(tagFilter.includes(id) ? tagFilter.filter((t) => t !== id) : [...tagFilter, id]);

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
          onClick={() => {
            onChange({ months: [], sources: [...SOURCES], keyword: '' });
            onTagFilterChange([]);
          }}
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
        {tags.length > 0 && (
          <fieldset className="filter-tags">
            <legend>タグ（未選択なら全て。複数選ぶといずれかが付いた明細）</legend>
            <div className="checks">
              {tags.map((tag) => (
                <label key={tag.id} className="check">
                  <input type="checkbox" checked={tagFilter.includes(tag.id)} onChange={() => toggleTag(tag.id)} />
                  <TagChip tag={tag} />
                </label>
              ))}
              <label className="check">
                <input type="checkbox" checked={tagFilter.includes(UNTAGGED)} onChange={() => toggleTag(UNTAGGED)} />
                タグなし
              </label>
            </div>
          </fieldset>
        )}
      </div>
    </section>
  );
}
