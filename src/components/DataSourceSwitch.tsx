import { useId } from 'react';
import type { DataSource } from '../hooks/useDataSource';

interface Props {
  value: DataSource;
  onChange: (next: DataSource) => void;
}

const OPTIONS: { value: DataSource; label: string }[] = [
  { value: 'csv', label: 'CSVを読み込む' },
  { value: 'notion', label: 'Notionから取得' },
];

/** データの取得元（CSV / Notion）の切り替え。切り替えても、もう一方で読み込んだデータは破棄しない。 */
export function DataSourceSwitch({ value, onChange }: Props) {
  const uid = useId();
  return (
    <section className="panel data-source" aria-label="データの取得元">
      <fieldset>
        <legend>データの取得元</legend>
        <div className="checks">
          {OPTIONS.map((option) => (
            <label key={option.value} className="check">
              <input
                type="radio"
                name={`${uid}-data-source`}
                checked={value === option.value}
                onChange={() => onChange(option.value)}
              />
              {option.label}
            </label>
          ))}
        </div>
        <p className="muted small field-hint">
          切り替えても、読み込み済みのデータは消えません。集計には、選んだ取得元のデータを使います。
        </p>
      </fieldset>
    </section>
  );
}
