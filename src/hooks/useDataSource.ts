import { useCallback, useState } from 'react';

export type DataSource = 'csv' | 'notion';

export const DATA_SOURCE_STORAGE_KEY = 'my-money-check:data-source:v1';

export function loadDataSource(): DataSource {
  try {
    return localStorage.getItem(DATA_SOURCE_STORAGE_KEY) === 'notion' ? 'notion' : 'csv';
  } catch {
    return 'csv';
  }
}

function saveDataSource(value: DataSource): void {
  try {
    localStorage.setItem(DATA_SOURCE_STORAGE_KEY, value);
  } catch {
    // 保存できない環境（プライベートモードなど）でも、選択自体は有効にする
  }
}

/** データの取得元（CSV / Notion）。選択はlocalStorageに保存し、既定は CSV。 */
export function useDataSource(): readonly [DataSource, (next: DataSource) => void] {
  const [source, setSource] = useState<DataSource>(loadDataSource);
  const update = useCallback((next: DataSource) => {
    setSource(next);
    saveDataSource(next);
  }, []);
  return [source, update] as const;
}
