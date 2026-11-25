import { useId, useState } from 'react';
import type { DragEvent } from 'react';
import type { ParsedFile } from '../types';
import { formatCount, sourceLabel } from './labels';

export interface LoadMessage {
  id: number;
  fileName: string;
  kind: 'success' | 'error';
  text: string;
  warnings: string[];
}

interface Props {
  messages: LoadMessage[];
  files: ParsedFile[];
  onFiles: (files: File[]) => void;
  onDismissMessage: (id: number) => void;
  onRemoveFile: (fileName: string) => void;
  onClear: () => void;
}

const MAX_WARNINGS_SHOWN = 5;

export function UploadPanel({ messages, files, onFiles, onDismissMessage, onRemoveFile, onClear }: Props) {
  const inputId = useId();
  const [dragging, setDragging] = useState(false);

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragging(false);
    const dropped = Array.from(e.dataTransfer?.files ?? []);
    if (dropped.length > 0) onFiles(dropped);
  };

  return (
    <section className="panel" aria-labelledby="upload-title">
      <h2 id="upload-title">CSVを読み込む</h2>
      <div
        className={`dropzone${dragging ? ' is-dragging' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
      >
        <p>ここにCSVファイルをドラッグ&amp;ドロップ（複数可）</p>
        <p className="muted small">または</p>
        <label htmlFor={inputId} className="btn file-label">
          CSVファイルを選択
        </label>
        <input
          id={inputId}
          className="file-input"
          type="file"
          accept=".csv,text/csv"
          multiple
          onChange={(e) => {
            const picked = Array.from(e.target.files ?? []);
            if (picked.length > 0) onFiles(picked);
            e.target.value = '';
          }}
        />
        <p className="muted small">同じ名前のファイルを入れ直すと置き換わります。</p>
      </div>

      {messages.length > 0 && (
        <ul className="messages" aria-label="読み込み結果">
          {messages.map((m) => (
            <li key={m.id} className={`message message-${m.kind}`} role={m.kind === 'error' ? 'alert' : 'status'}>
              <div className="message-body">
                <strong className="message-file">{m.fileName}</strong>
                <span>{m.kind === 'error' ? `読み込めませんでした: ${m.text}` : m.text}</span>
                {m.warnings.length > 0 && (
                  <details className="warnings">
                    <summary>警告 {m.warnings.length}件</summary>
                    <ul>
                      {m.warnings.slice(0, MAX_WARNINGS_SHOWN).map((w, i) => (
                        <li key={i}>{w}</li>
                      ))}
                      {m.warnings.length > MAX_WARNINGS_SHOWN && (
                        <li>ほか{m.warnings.length - MAX_WARNINGS_SHOWN}件</li>
                      )}
                    </ul>
                  </details>
                )}
              </div>
              <button type="button" className="btn btn-small btn-ghost" onClick={() => onDismissMessage(m.id)}>
                閉じる<span className="sr-only">（{m.fileName}の結果）</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {files.length > 0 && (
        <div className="file-list">
          <div className="file-list-head">
            <h3>読み込み済みファイル（{files.length}）</h3>
            <button type="button" className="btn btn-small btn-ghost" onClick={onClear}>
              すべて消去
            </button>
          </div>
          <ul>
            {files.map((f) => (
              <li key={f.fileName}>
                <span className={`badge badge-${f.source}`}>{sourceLabel(f.source)}</span>
                <span className="file-name">{f.fileName}</span>
                <span className="muted small">
                  {formatCount(f.transactions.length)}
                  {f.warnings.length > 0 && `・警告${f.warnings.length}件`}
                </span>
                <button
                  type="button"
                  className="btn btn-small btn-ghost"
                  aria-label={`${f.fileName}を削除`}
                  onClick={() => onRemoveFile(f.fileName)}
                >
                  削除
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
