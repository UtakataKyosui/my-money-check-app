import type { Tag } from '../types';

/** 色名ごとのCSS変数は styles.css の .tag-<color> で定義する。色だけに頼らず、名前を必ずテキストで出す。 */
export function TagChip({ tag }: { tag: Pick<Tag, 'name' | 'color'> }) {
  return <span className={`tag-chip tag-${tag.color}`}>{tag.name}</span>;
}

interface Props {
  tags: Tag[];
  /** タグが無いときに出す文言。null なら何も出さない */
  emptyLabel?: string | null;
}

export function TagChips({ tags, emptyLabel = 'タグなし' }: Props) {
  if (tags.length === 0) {
    return emptyLabel === null ? null : <span className="tag-none muted small">{emptyLabel}</span>;
  }
  return (
    <span className="tag-chips">
      {tags.map((tag) => (
        <TagChip key={tag.id} tag={tag} />
      ))}
    </span>
  );
}
