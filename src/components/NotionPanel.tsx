import { useId, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import {
  clearNotionToken,
  loadNotionConfig,
  loadNotionToken,
  parseDatabaseId,
  saveNotionConfig,
  saveNotionToken,
} from '../lib/notion';
import type { NotionDbStatus, NotionLoadRequest } from '../hooks/useNotionData';
import type { HelpTabId } from '../help';
import { formatCount } from './labels';

interface Props {
  bank: NotionDbStatus;
  card: NotionDbStatus;
  /** 読み込みを1回でも要求したか（ボタンの表示が「再読み込み」になる） */
  requested: boolean;
  onLoad: (request: NotionLoadRequest) => void;
  onOpenHelp: (tab: HelpTabId) => void;
}

type FieldName = 'token' | 'bank' | 'card';
type FieldErrors = Partial<Record<FieldName | 'group', string>>;

const MAX_WARNINGS_SHOWN = 5;
const DB_ERROR = 'データベースのURLまたはIDを解釈できません。NotionのデータベースのURL、または32桁のIDを入力してください。';

const KIND_TITLE = { bank: '銀行のデータベース', card: 'カードのデータベース' } as const;

function checkDatabase(value: string): { id: string | null; error?: string } {
  if (value.trim() === '') return { id: null };
  const id = parseDatabaseId(value);
  return id ? { id } : { id: null, error: DB_ERROR };
}

function StatusItem({ status }: { status: NotionDbStatus }) {
  if (status.databaseId === null) return null;
  const title = KIND_TITLE[status.kind];
  if (status.status === 'loading') {
    return (
      <li className="message">
        <div className="message-body">
          <strong className="message-file">{title}</strong>
          <span>取得中です…{status.progressRows > 0 ? `（${status.progressRows.toLocaleString('ja-JP')}行を取得）` : ''}</span>
        </div>
      </li>
    );
  }
  if (status.status === 'error' && status.error) {
    return (
      <li className="message message-error" role="alert">
        <div className="message-body">
          <strong className="message-file">{title}</strong>
          <span>取得できませんでした: {status.error.message}</span>
          {status.error.details.length > 0 && (
            <ul className="notion-details" aria-label={`${title}で修正が必要な点`}>
              {status.error.details.map((d, i) => (
                <li key={i}>{d}</li>
              ))}
            </ul>
          )}
        </div>
      </li>
    );
  }
  if (status.status === 'success') {
    return (
      <li className="message message-success">
        <div className="message-body">
          <strong className="message-file">{title}</strong>
          <span>
            {status.rowCount.toLocaleString('ja-JP')}行を取得し、{formatCount(status.transactionCount)}の明細として読み込みました。
          </span>
          {status.warnings.length > 0 && (
            <details className="warnings">
              <summary>読み飛ばした行の警告 {status.warnings.length}件</summary>
              <ul>
                {status.warnings.slice(0, MAX_WARNINGS_SHOWN).map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
                {status.warnings.length > MAX_WARNINGS_SHOWN && <li>ほか{status.warnings.length - MAX_WARNINGS_SHOWN}件</li>}
              </ul>
            </details>
          )}
        </div>
      </li>
    );
  }
  return null;
}

export function NotionPanel({ bank, card, requested, onLoad, onOpenHelp }: Props) {
  const uid = useId();
  const [initial] = useState(loadNotionConfig);
  const [token, setToken] = useState(loadNotionToken);
  const [remember, setRemember] = useState(initial.rememberToken);
  const [bankInput, setBankInput] = useState(initial.bankDatabase);
  const [cardInput, setCardInput] = useState(initial.cardDatabase);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [notice, setNotice] = useState('');
  const inputs = {
    token: useRef<HTMLInputElement>(null),
    bank: useRef<HTMLInputElement>(null),
    card: useRef<HTMLInputElement>(null),
  };
  const ids = {
    token: `${uid}-token`,
    tokenHint: `${uid}-token-hint`,
    tokenError: `${uid}-token-error`,
    remember: `${uid}-remember`,
    rememberHint: `${uid}-remember-hint`,
    bank: `${uid}-bank`,
    bankHint: `${uid}-bank-hint`,
    bankError: `${uid}-bank-error`,
    card: `${uid}-card`,
    cardError: `${uid}-card-error`,
    group: `${uid}-group-error`,
  };

  const describedBy = (...parts: (string | undefined | false)[]) => parts.filter(Boolean).join(' ') || undefined;

  const persistConfig = (next: { bank?: string; card?: string; remember?: boolean }) =>
    saveNotionConfig({
      bankDatabase: next.bank ?? bankInput,
      cardDatabase: next.card ?? cardInput,
      rememberToken: next.remember ?? remember,
    });

  const handleToken = (value: string) => {
    setToken(value);
    setNotice('');
    setErrors((prev) => ({ ...prev, token: undefined }));
    // トークンは「このブラウザに保存する」がオフなら sessionStorage（タブを閉じると消える）に置く
    if (value.trim() === '') clearNotionToken();
    else saveNotionToken(value.trim(), remember);
  };

  const handleRemember = (checked: boolean) => {
    setRemember(checked);
    setNotice('');
    persistConfig({ remember: checked });
    if (token.trim() !== '') saveNotionToken(token.trim(), checked);
  };

  const handleDatabase = (field: 'bank' | 'card', value: string) => {
    if (field === 'bank') setBankInput(value);
    else setCardInput(value);
    persistConfig(field === 'bank' ? { bank: value } : { card: value });
    setNotice('');
    // 直す途中の入力にはエラーを出さない。すでにエラーが出ている項目だけ、入力のたびに確認し直す
    setErrors((prev) => ({
      ...prev,
      group: undefined,
      [field]: prev[field] ? checkDatabase(value).error : undefined,
    }));
  };

  const handleDatabaseBlur = (field: 'bank' | 'card') => {
    const value = field === 'bank' ? bankInput : cardInput;
    setErrors((prev) => ({ ...prev, [field]: checkDatabase(value).error }));
  };

  const handleDeleteToken = () => {
    clearNotionToken();
    setToken('');
    setErrors((prev) => ({ ...prev, token: undefined }));
    setNotice('トークンを削除しました。');
    inputs.token.current?.focus();
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const trimmed = token.trim();
    const bankCheck = checkDatabase(bankInput);
    const cardCheck = checkDatabase(cardInput);
    const next: FieldErrors = {};
    if (trimmed === '') next.token = 'インテグレーションのトークンを入力してください。';
    if (bankCheck.error) next.bank = bankCheck.error;
    if (cardCheck.error) next.card = cardCheck.error;
    if (!bankCheck.error && !cardCheck.error && bankCheck.id === null && cardCheck.id === null) {
      next.group = '銀行かカードのどちらか一方は、データベースのURLまたはIDを入力してください。';
    }
    setErrors(next);
    setNotice('');
    if (Object.keys(next).length > 0) {
      const first = next.token ? inputs.token : next.bank || next.group ? inputs.bank : inputs.card;
      first.current?.focus();
      return;
    }
    persistConfig({});
    saveNotionToken(trimmed, remember);
    onLoad({ token: trimmed, bankDatabaseId: bankCheck.id, cardDatabaseId: cardCheck.id });
  };

  const busy = bank.status === 'loading' || card.status === 'loading';
  const hasStatus = bank.databaseId !== null || card.databaseId !== null;

  return (
    <section className="panel" aria-labelledby="notion-title">
      <h2 id="notion-title">Notionから取得</h2>
      <p className="muted notion-intro">
        Notionのデータベースから、銀行・カードの明細を読み込みます。データベースには決まった形式のプロパティが必要です。
        詳しくは
        <button type="button" className="link-btn" onClick={() => onOpenHelp('notion-format')}>
          データ形式
        </button>
        と
        <button type="button" className="link-btn" onClick={() => onOpenHelp('notion-setup')}>
          設定手順
        </button>
        を見てください。読み込んだデータは保存しません（
        <button type="button" className="link-btn" onClick={() => onOpenHelp('privacy')}>
          保存とプライバシー
        </button>
        ）。
      </p>

      <form className="notion-form" onSubmit={handleSubmit} noValidate aria-labelledby="notion-title">
        <div className="field">
          <label htmlFor={ids.token}>Notionのトークン</label>
          <input
            ref={inputs.token}
            id={ids.token}
            type="password"
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            value={token}
            aria-invalid={errors.token ? true : undefined}
            aria-describedby={describedBy(ids.tokenHint, errors.token && ids.tokenError)}
            onChange={(e) => handleToken(e.target.value)}
          />
          <p id={ids.tokenHint} className="muted small field-hint">
            Notionのインテグレーションのトークンです。アプリ運営者のサーバーには保存されません。
            読み込むたびに、同じサイトの中継関数へ渡し、Notionへの問い合わせにだけ使います。
          </p>
          {errors.token && (
            <p id={ids.tokenError} className="field-error">
              {errors.token}
            </p>
          )}
        </div>

        <div className="field">
          <label className="check">
            <input
              id={ids.remember}
              type="checkbox"
              checked={remember}
              aria-describedby={ids.rememberHint}
              onChange={(e) => handleRemember(e.target.checked)}
            />
            このブラウザに保存する
          </label>
          <p id={ids.rememberHint} className="muted small field-hint">
            オフ（既定）のときは、このタブを閉じるとトークンが消えます。オンにすると、このブラウザに残り、次回も入力せずに使えます。
            共有のパソコンではオンにしないでください。
          </p>
          <p>
            <button type="button" className="btn btn-small btn-ghost" onClick={handleDeleteToken}>
              トークンを削除
            </button>
          </p>
        </div>

        <div className="field">
          <label htmlFor={ids.bank}>銀行のデータベースのURLまたはID</label>
          <input
            ref={inputs.bank}
            id={ids.bank}
            type="text"
            autoComplete="off"
            spellCheck={false}
            placeholder="https://www.notion.so/…"
            value={bankInput}
            aria-invalid={errors.bank || errors.group ? true : undefined}
            aria-describedby={describedBy(ids.bankHint, errors.bank && ids.bankError, errors.group && ids.group)}
            onChange={(e) => handleDatabase('bank', e.target.value)}
            onBlur={() => handleDatabaseBlur('bank')}
          />
          <p id={ids.bankHint} className="muted small field-hint">
            三井住友銀行の明細用。どちらか片方だけでも読み込めます。
          </p>
          {errors.bank && (
            <p id={ids.bankError} className="field-error">
              {errors.bank}
            </p>
          )}
        </div>

        <div className="field">
          <label htmlFor={ids.card}>カードのデータベースのURLまたはID</label>
          <input
            ref={inputs.card}
            id={ids.card}
            type="text"
            autoComplete="off"
            spellCheck={false}
            placeholder="https://www.notion.so/…"
            value={cardInput}
            aria-invalid={errors.card || errors.group ? true : undefined}
            aria-describedby={describedBy(errors.card && ids.cardError, errors.group && ids.group)}
            onChange={(e) => handleDatabase('card', e.target.value)}
            onBlur={() => handleDatabaseBlur('card')}
          />
          {errors.card && (
            <p id={ids.cardError} className="field-error">
              {errors.card}
            </p>
          )}
        </div>

        {errors.group && (
          <p id={ids.group} className="field-error">
            {errors.group}
          </p>
        )}

        <div className="prov-actions">
          <button type="submit" className="btn" disabled={busy}>
            {requested ? '再読み込み' : 'Notionから読み込む'}
          </button>
        </div>
        <p className="form-status" aria-live="polite">
          {notice}
        </p>
      </form>

      <div className="notion-statuses" aria-live="polite">
        {hasStatus && (
          <ul className="messages" aria-label="Notionの取得状況">
            <StatusItem status={bank} />
            <StatusItem status={card} />
          </ul>
        )}
      </div>
    </section>
  );
}
