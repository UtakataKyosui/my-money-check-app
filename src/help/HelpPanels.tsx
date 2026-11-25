import { useId } from 'react';
import { NOTION_SPECS } from '../lib/notion';
import type { NotionDatabaseSpec, NotionPropertyKind, NotionPropertySpec } from '../lib/notion';
import type { HelpTabId } from './tabs';

interface PanelProps {
  /** 別のタブへ移る（本文中のリンク用） */
  onNavigate: (tab: HelpTabId) => void;
}

function LinkButton({ tab, onNavigate, children }: { tab: HelpTabId; onNavigate: (tab: HelpTabId) => void; children: string }) {
  return (
    <button type="button" className="link-btn" onClick={() => onNavigate(tab)}>
      {children}
    </button>
  );
}

function ExternalLink({ href, children }: { href: string; children: string }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {children}
      <span className="sr-only">（新しいタブで開く）</span>
    </a>
  );
}

/* ---------------- ① CSVの形式 ---------------- */

interface ColumnRow {
  name: string;
  required: boolean;
  note: string;
}

const BANK_COLUMNS: ColumnRow[] = [
  { name: '年月日', required: true, note: '取引日' },
  { name: 'お引出し', required: true, note: '支出額' },
  { name: 'お預入れ', required: true, note: '収入額' },
  { name: 'お取り扱い内容', required: true, note: '摘要' },
  { name: '残高', required: true, note: '取引後の残高（空欄・マイナスも可）' },
  { name: 'メモ', required: false, note: '明細のメモ' },
  { name: 'ラベル', required: false, note: '明細のラベル' },
];

const CARD_COLUMNS: ColumnRow[] = [
  { name: '利用日', required: true, note: '利用した日' },
  { name: '利用店名・商品名', required: true, note: '摘要' },
  { name: '利用者', required: true, note: '利用者（本人・家族など）' },
  { name: '支払方法', required: true, note: '1回払い・分割など' },
  { name: '利用金額', required: true, note: '利用金額（返金はマイナス）' },
  { name: '手数料/利息', required: true, note: '分割・リボ払いの手数料や利息' },
  { name: '支払総額', required: true, note: '支出として集計する金額。空欄なら 利用金額＋手数料/利息' },
  { name: '◯月支払金額', required: false, note: '例: 11月支払金額。その月に実際に支払う金額（下記）' },
];

function ColumnTable({ caption, rows }: { caption: string; rows: ColumnRow[] }) {
  return (
    <div className="table-scroll" tabIndex={0} role="region" aria-label={`${caption}（横にスクロールできます）`}>
      <table className="help-table">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            <th scope="col">見出し</th>
            <th scope="col">必須</th>
            <th scope="col">内容</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.name}>
              <th scope="row">
                <code>{row.name}</code>
              </th>
              <td>{row.required ? '必須' : '任意'}</td>
              <td>{row.note}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function CsvHelp() {
  return (
    <>
      <h3>CSVの形式</h3>
      <p>
        銀行とカードのどちらのCSVかは、1行目の見出しから自動で判定します。列の順番は問いません。
        見出しが次の必須の列をすべて含むと、その種類のCSVとして読み込みます。
      </p>

      <h4>銀行: 三井住友銀行の入出金明細</h4>
      <ColumnTable caption="銀行CSVの見出し" rows={BANK_COLUMNS} />

      <h4>カード: 楽天カードの利用明細</h4>
      <ColumnTable caption="カードCSVの見出し" rows={CARD_COLUMNS} />
      <p>
        「◯月支払金額」の列があると、見出しの月と最後の利用日から支払い月を推定し、その列の合計を
        「その月に実際に支払う金額」として扱います。同じ支払い月の暫定支払い（カード）は、この金額で上書きされます。
        列が無い場合は、暫定値の置き換えは起きません。「当月請求額」など、ほかの月によって変わる列は無視します。
      </p>

      <h4>文字コード・日付・金額</h4>
      <ul>
        <li>文字コードは UTF-8 と Shift_JIS に対応しています。UTF-8として読めなければ Shift_JIS とみなします。</li>
        <li>
          日付は <code>2026/11/05</code>、<code>2026-11-05</code>、<code>2026.11.05</code>、
          <code>2026年11月5日</code>、<code>20261105</code> の形式を読み取ります（全角でも可）。
        </li>
        <li>
          金額は円の整数です。カンマ区切りや「円」「¥」が付いていても読み取れます。空欄は0円として扱います。
        </li>
        <li>
          銀行の「お引出し」「お預入れ」がマイナスの行、日付や金額を解釈できない行、列数が見出しと合わない行は読み飛ばし、
          読み込み結果に警告を出します。
        </li>
        <li>カードは、マイナスの支払総額を返金として収入に計上します。</li>
        <li>同じ名前のファイルを入れ直すと置き換わります。期間が重なる銀行CSVに同じ取引があっても、1件として数えます。</li>
      </ul>
    </>
  );
}

/* ---------------- ② Notionのデータ形式 ---------------- */

const KIND_LABEL: Record<NotionPropertyKind, string> = {
  title: 'タイトル型',
  date: '日付型',
  number: '数値型',
  text: 'テキスト型',
  month: 'テキスト型または日付型',
};

/** Notionのプロパティ型名の日本語表示（画面ではNotionの表示名と型名を併記する） */
const TYPE_LABEL: Record<string, string> = {
  title: 'タイトル',
  rich_text: 'テキスト',
  number: '数値',
  select: 'セレクト',
  multi_select: 'マルチセレクト',
  status: 'ステータス',
  date: '日付',
  url: 'URL',
  email: 'メール',
  phone_number: '電話番号',
  formula: '数式',
  rollup: 'ロールアップ',
};

function TypeList({ types }: { types: readonly string[] }) {
  return (
    <ul className="help-types">
      {types.map((type) => (
        <li key={type}>
          <code>{type}</code>
          {TYPE_LABEL[type] ? <span className="muted small">（{TYPE_LABEL[type]}）</span> : null}
        </li>
      ))}
    </ul>
  );
}

function PropertyRow({ spec, property }: { spec: NotionDatabaseSpec; property: NotionPropertySpec }) {
  return (
    <tr>
      <th scope="row">
        {property.name === null ? (
          <>
            <span>名前は自由</span>
            <span className="cell-sub muted">
              推奨名: <code>{spec.recommendedTitleName}</code>
            </span>
          </>
        ) : (
          <code>{property.name}</code>
        )}
      </th>
      <td>{KIND_LABEL[property.kind]}</td>
      <td>{property.required ? '必須' : '任意'}</td>
      <td>
        <TypeList types={property.types} />
      </td>
      <td>{property.csvColumn ? <code>{property.csvColumn}</code> : <span aria-label="なし">―</span>}</td>
      <td>{property.description}</td>
      <td>
        <code>{property.example}</code>
      </td>
    </tr>
  );
}

function SpecTable({ spec }: { spec: NotionDatabaseSpec }) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="help-spec">
      <h4 id={headingId}>{spec.title}</h4>
      <div className="table-scroll" tabIndex={0} role="region" aria-label={`${spec.title}のプロパティ一覧（横にスクロールできます）`}>
        <table className="help-table help-spec-table">
          <caption className="sr-only">{spec.title}のプロパティ一覧</caption>
          <thead>
            <tr>
              <th scope="col">プロパティ名</th>
              <th scope="col">種別</th>
              <th scope="col">必須か</th>
              <th scope="col">許容するNotionの型</th>
              <th scope="col">対応するCSV列</th>
              <th scope="col">説明</th>
              <th scope="col">例</th>
            </tr>
          </thead>
          <tbody>
            {spec.properties.map((property) => (
              <PropertyRow key={property.name ?? '(title)'} spec={spec} property={property} />
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function NotionFormatHelp({ onNavigate }: PanelProps) {
  return (
    <>
      <h3>Notionのデータ形式</h3>
      <p>
        Notionのデータベースを読み込むときは、下の表のプロパティを持つデータベースを用意します。
        銀行用とカード用のデータベースは別々に用意し、どちらか片方だけでも読み込めます。
        プロパティ名は表のとおりにしてください（タイトル型だけは名前が自由です）。
        CSVの列と同じ名前なので、CSVをNotionにインポートして、プロパティの型を直せば使えます。
        手順は<LinkButton tab="notion-setup" onNavigate={onNavigate}>Notionの設定手順</LinkButton>を見てください。
      </p>
      {NOTION_SPECS.map((spec) => (
        <SpecTable key={spec.kind} spec={spec} />
      ))}
      <h4>共通のルール</h4>
      <ul>
        <li>金額は整数の円です。</li>
        <li>
          銀行の「お引出し」「お預入れ」がマイナスの行、日付を解釈できない行は読み飛ばして、取得結果に警告を出します。
        </li>
        <li>
          数式（<code>formula</code>）と<code>rollup</code>は、結果が数値・日付・文字列のどれかで読み取れる場合に使えます。
        </li>
        <li>
          カードの「支払い月」と「今回支払金額」の両方があると、その支払い月の暫定支払い（カード）を、Notionの金額で上書きできます。
          どちらかが無いと、暫定値の置き換えは起きません。
        </li>
      </ul>
    </>
  );
}

/* ---------------- ③ Notionの設定手順 ---------------- */

export function NotionSetupHelp({ onNavigate }: PanelProps) {
  return (
    <>
      <h3>Notionの設定手順</h3>
      <p className="muted small">画面の名称はNotionの更新で変わることがあります。</p>
      <ol className="help-steps">
        <li>
          <strong>インテグレーションを作る。</strong>
          <ExternalLink href="https://www.notion.so/profile/integrations">Notionのインテグレーションの管理ページ</ExternalLink>
          を開き、新しいインテグレーションを作ります。種類は「内部」を選びます。必要な権限は「コンテンツを読み取る」だけです。
          書き込みの権限は付けないでください。
        </li>
        <li>
          <strong>トークンを取得する。</strong>
          作成したインテグレーションの「シークレット」（トークン）をコピーします。このアプリの「トークン」欄に貼り付けます。
          トークンは他人に見せないでください。
        </li>
        <li>
          <strong>データベースをインテグレーションに共有する。</strong>
          銀行・カードそれぞれのデータベースのページを開き、右上の「…」メニューから「接続」を選んで、
          作成したインテグレーションを追加します。共有していないデータベースは「見つかりません」と表示されます。
        </li>
        <li>
          <strong>データベースのURLを取得する。</strong>
          データベースをページいっぱいに開き、「リンクをコピー」でURLをコピーして、このアプリの「銀行のデータベース」「カードのデータベース」欄に貼り付けます。
          URLの代わりに32桁のIDでも構いません。
        </li>
        <li>
          <strong>読み込む。</strong>
          「Notionから読み込む」を押します。形式が合わないときは、不足しているプロパティや型の違いが一覧で表示されます。
        </li>
      </ol>

      <h4>CSVをNotionにインポートして使う</h4>
      <ol className="help-steps">
        <li>
          Notionのサイドバーなどにある「インポート」から「CSV」を選び、銀行またはカードのCSVを取り込みます。
          文字化けするときは、CSVをUTF-8に変換してから取り込んでください。
        </li>
        <li>
          取り込まれたデータベースの各プロパティの型を直します。日付の列（「年月日」「利用日」）は「日付」、
          金額の列（「お引出し」「お預入れ」「残高」「利用金額」「手数料/利息」「支払総額」）は「数値」にします。
          「利用者」「支払方法」「メモ」「ラベル」はテキストのままで構いません。
        </li>
        <li>
          カードの支払い月ごとの金額で暫定支払いを置き換えたいときは、「支払い月」（例: 2026-11）と
          「今回支払金額」を追加します。形式は
          <LinkButton tab="notion-format" onNavigate={onNavigate}>Notionのデータ形式</LinkButton>
          を見てください。
        </li>
        <li>上の「データベースをインテグレーションに共有する」を行い、URLをこのアプリに貼り付けます。</li>
      </ol>
    </>
  );
}

/* ---------------- ④ 保存とプライバシー ---------------- */

export function PrivacyHelp() {
  return (
    <>
      <h3>保存とプライバシー</h3>

      <h4>CSVを読み込むとき</h4>
      <ul>
        <li>CSVのデータは、このブラウザの中だけで処理されます。サーバーへの送信も保存もしません。</li>
        <li>ページを閉じるか再読み込みすると、読み込んだCSVは消えます。</li>
      </ul>

      <h4>Notionから取得するとき</h4>
      <ul>
        <li>
          トークンとデータベースのIDは、同じサイトの中継関数（<code>/api/notion/query</code>）を経由してNotionに送られます。
          ブラウザから直接Notionへ接続しないのは、Notion APIがブラウザからの直接の呼び出しを許していないためです。
        </li>
        <li>
          中継関数は、受け取ったトークンでNotionのデータを読み取って返すだけです。トークンやデータをサーバーに保存せず、ログにも出さない設計です。
          トークンはリクエストごとにヘッダーで渡します。
        </li>
        <li>
          トークンの保存先は、既定ではこのタブの中だけ（sessionStorage）です。タブを閉じると消えます。
          「このブラウザに保存する」をオンにすると、このブラウザのlocalStorageに保存され、次回以降も使えます。
          共有のパソコンではオンにしないでください。「トークンを削除」でいつでも消せます。
        </li>
        <li>取得したデータはメモリ上にだけ置き、保存しません。ページを閉じるか再読み込みすると消えます。</li>
        <li>データベースのURL・IDの入力欄の内容は、次回の入力の手間を省くため、このブラウザのlocalStorageに保存します。</li>
      </ul>

      <h4>どちらの場合も保存されるもの</h4>
      <ul>
        <li>
          手入力した暫定支払いと、タグ・ルール・手動のタグ設定は、このブラウザのlocalStorageに保存されます。
          データの取得元の選択（CSV / Notion）も保存します。
        </li>
        <li>明細の日付・摘要・金額そのものは保存しません。</li>
      </ul>
    </>
  );
}
