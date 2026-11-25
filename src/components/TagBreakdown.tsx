import type { Tag, TagSummary } from '../types';
import { formatYen } from '../lib/format';
import { UNTAGGED } from '../lib/tags';
import { formatCount } from './labels';
import { TagChip } from './TagChips';

interface Props {
  tags: Tag[];
  /** 絞り込み後の支出のタグ別集計（summarizeByTag の結果） */
  summaries: TagSummary[];
  /** 割合の分母にする支出合計（概要の「支出合計」） */
  expenseTotal: number;
  /** 絞り込み中のタグID（`UNTAGGED` は「タグなし」） */
  selected: string[];
  onToggle: (tagId: string) => void;
}

function formatPercent(part: number, whole: number): string {
  if (whole <= 0) return '0%';
  return `${((part / whole) * 100).toFixed(1)}%`;
}

export function TagBreakdown({ tags, summaries, expenseTotal, selected, onToggle }: Props) {
  const tagsById = new Map(tags.map((t) => [t.id, t]));

  return (
    <section className="panel" aria-labelledby="tagbd-title">
      <h2 id="tagbd-title">タグ別の支出</h2>
      {tags.length === 0 ? (
        <p className="muted">
          タグがまだありません。「タグとルール」でタグを作ると、タグごとの支出をここで確認できます。
        </p>
      ) : summaries.length === 0 ? (
        <p className="muted">支出の明細がありません。</p>
      ) : (
        <>
          <p className="muted small">
            タグを押すと、そのタグで絞り込みます（もう一度押すと解除）。
            複数のタグが付いた明細は各タグに全額を計上するため、タグ別の合計が支出合計を超えることがあります。
            割合は支出合計に対するものです。
          </p>
          <ul className="tagbd" data-testid="tag-breakdown">
            {summaries.map((row) => {
              const id = row.tagId ?? UNTAGGED;
              const tag = row.tagId === null ? undefined : tagsById.get(row.tagId);
              if (row.tagId !== null && !tag) return null;
              const pressed = selected.includes(id);
              const width = expenseTotal > 0 ? Math.min(100, (row.total / expenseTotal) * 100) : 0;
              return (
                <li key={id}>
                  <button
                    type="button"
                    className={`tagbd-row ${tag ? `tag-${tag.color}` : 'tag-none-color'}`}
                    aria-pressed={pressed}
                    onClick={() => onToggle(id)}
                  >
                    <span className="tagbd-head">
                      <span className="tagbd-name">{tag ? <TagChip tag={tag} /> : 'タグなし'}</span>
                      <span className="tagbd-value">
                        {formatYen(row.total)}
                        <span className="muted small">
                          （{formatCount(row.count)}・{formatPercent(row.total, expenseTotal)}）
                        </span>
                      </span>
                    </span>
                    <span className="bar-track tagbd-track" aria-hidden="true">
                      <span className="tagbd-bar" style={{ width: `${width}%` }} />
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </section>
  );
}
