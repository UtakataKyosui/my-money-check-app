interface Props {
  onLoadSample: () => void;
}

export function EmptyState({ onLoadSample }: Props) {
  return (
    <section className="panel empty-state" aria-labelledby="empty-title">
      <h2 id="empty-title">まずはCSVを読み込みましょう</h2>
      <ol className="steps">
        <li>三井住友銀行の口座明細CSV（入出金明細）を用意します。</li>
        <li>楽天カードの利用明細CSVを用意します（どちらか一方だけでも構いません）。</li>
        <li>上の枠にファイルをドラッグ&amp;ドロップするか、「CSVファイルを選択」から選びます。</li>
      </ol>
      <p className="muted">
        銀行かカードかは見出しから自動で判定します。文字コードはUTF-8とShift_JISに対応しています。
        読み込んだCSVのデータはこのブラウザの中だけで処理され、サーバーへの送信や保存は行いません。
      </p>
      <p>
        <button type="button" className="btn" onClick={onLoadSample}>
          サンプルCSVを読み込む
        </button>
      </p>
    </section>
  );
}
