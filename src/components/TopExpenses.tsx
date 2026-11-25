import { useId } from 'react';
import type { GroupSummary, SourceKind } from '../types';
import { formatYen } from '../lib/format';
import { formatCount } from './labels';

export type RankSource = 'all' | SourceKind;

interface Props {
  groups: GroupSummary[];
  source: RankSource;
  onSourceChange: (source: RankSource) => void;
}

export function TopExpenses({ groups, source, onSourceChange }: Props) {
  const selectId = useId();
  const max = Math.max(1, ...groups.map((g) => g.total));

  return (
    <section className="panel" aria-labelledby="top-title">
      <div className="panel-head">
        <h2 id="top-title">摘要別の支出ランキング</h2>
        <div className="field field-inline">
          <label htmlFor={selectId}>対象</label>
          <select id={selectId} value={source} onChange={(e) => onSourceChange(e.target.value as RankSource)}>
            <option value="all">銀行＋カード</option>
            <option value="bank">銀行のみ</option>
            <option value="card">カードのみ</option>
          </select>
        </div>
      </div>
      {groups.length === 0 ? (
        <p className="muted">支出の明細がありません。</p>
      ) : (
        <ol className="rank">
          {groups.map((g) => (
            <li key={g.key} className={g.key === 'その他' ? 'rank-other' : undefined}>
              <div className="rank-head">
                <span className="rank-key">{g.key}</span>
                <span className="rank-total">
                  {formatYen(g.total)}
                  <span className="muted small">（{formatCount(g.count)}）</span>
                </span>
              </div>
              <div className="bar-track" aria-hidden="true">
                <div className="bar bar-expense" style={{ width: `${(g.total / max) * 100}%` }} />
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
