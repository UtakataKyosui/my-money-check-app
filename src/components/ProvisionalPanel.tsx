import { useId, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import type { ProvisionalKind, ProvisionalPayment } from '../types';
import { validateProvisionalInput } from '../lib/provisional';
import { formatMonth, formatYen } from '../lib/format';
import { formatCount, provisionalKindLabel } from './labels';

export type ProvisionalDraft = Omit<ProvisionalPayment, 'id'>;

interface Props {
  items: ProvisionalPayment[];
  onAdd: (value: ProvisionalDraft) => void;
  onUpdate: (item: ProvisionalPayment) => void;
  onDelete: (id: string) => void;
  onDeleteAll: () => void;
}

interface FormState {
  month: string;
  label: string;
  amount: string;
  kind: ProvisionalKind;
  confirmed: boolean;
  note: string;
}

type FieldName = 'month' | 'label' | 'amount';
type FieldErrors = Partial<Record<FieldName, string>>;

const KINDS: ProvisionalKind[] = ['card', 'bank', 'other'];
const FIELD_ORDER: FieldName[] = ['month', 'label', 'amount'];

/** 今月（ローカル時間）を YYYY-MM で返す */
function currentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function emptyForm(): FormState {
  return { month: currentMonth(), label: '', amount: '', kind: 'card', confirmed: true, note: '' };
}

export function ProvisionalPanel({ items, onAdd, onUpdate, onDelete, onDeleteAll }: Props) {
  const uid = useId();
  const [form, setForm] = useState<FormState>(emptyForm);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [editingId, setEditingId] = useState<string | null>(null);
  const [status, setStatus] = useState('');
  const inputs = {
    month: useRef<HTMLInputElement>(null),
    label: useRef<HTMLInputElement>(null),
    amount: useRef<HTMLInputElement>(null),
  };

  const editingItem = editingId === null ? undefined : items.find((i) => i.id === editingId);
  const sorted = [...items].sort((a, b) => a.month.localeCompare(b.month));

  const ids = {
    month: `${uid}-month`,
    label: `${uid}-label`,
    amount: `${uid}-amount`,
    note: `${uid}-note`,
    monthHint: `${uid}-month-hint`,
    amountHint: `${uid}-amount-hint`,
    monthError: `${uid}-month-error`,
    labelError: `${uid}-label-error`,
    amountError: `${uid}-amount-error`,
  };

  const setField = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    setStatus('');
  };

  const describedBy = (hint: string | undefined, error: string | undefined, errorId: string) =>
    [hint, error ? errorId : undefined].filter(Boolean).join(' ') || undefined;

  const resetForm = () => {
    setForm(emptyForm());
    setErrors({});
    setEditingId(null);
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const result = validateProvisionalInput({
      month: form.month,
      label: form.label,
      amount: form.amount,
      kind: form.kind,
      confirmed: form.confirmed,
      note: form.note,
    });
    if (!result.ok) {
      setErrors(result.errors);
      setStatus('');
      const first = FIELD_ORDER.find((name) => result.errors[name]);
      if (first) inputs[first].current?.focus();
      return;
    }
    const wasEditing = editingItem !== undefined;
    if (editingItem) {
      onUpdate({ id: editingItem.id, ...result.value });
    } else {
      onAdd(result.value);
    }
    setStatus(`「${result.value.label}」を${wasEditing ? '保存' : '追加'}しました。`);
    resetForm();
    if (!wasEditing) inputs.label.current?.focus();
  };

  const startEdit = (item: ProvisionalPayment) => {
    setForm({
      month: item.month,
      label: item.label,
      amount: String(item.amount),
      kind: item.kind,
      confirmed: item.confirmed,
      note: item.note ?? '',
    });
    setErrors({});
    setStatus('');
    setEditingId(item.id);
    inputs.label.current?.focus();
    inputs.label.current?.scrollIntoView?.({ block: 'center' });
  };

  const handleDelete = (item: ProvisionalPayment) => {
    if (editingId === item.id) resetForm();
    onDelete(item.id);
    setStatus(`「${item.label}」を削除しました。`);
  };

  const handleDeleteAll = () => {
    if (!window.confirm('登録済みの暫定支払いをすべて削除します。元に戻せません。よろしいですか？')) return;
    resetForm();
    onDeleteAll();
    setStatus('暫定支払いをすべて削除しました。');
  };

  return (
    <section className="panel" aria-labelledby="provisional-title">
      <h2 id="provisional-title">暫定支払い（手入力）</h2>
      <p className="muted prov-intro">
        CSVに含まれない確定済みの支払い金額（例: 楽天カードの今月の請求額）を入力できます。
        CSVの取引とは別枠で集計され、二重計上に注意してください。
        入力した内容はこのブラウザのlocalStorageに保存されます（CSVの内容は保存されません）。
      </p>

      <form className="prov-form" onSubmit={handleSubmit} noValidate aria-labelledby={`${uid}-form-title`}>
        <h3 id={`${uid}-form-title`} className="prov-form-title">
          {editingItem ? `「${editingItem.label}」を編集中` : '暫定支払いを追加'}
        </h3>
        <div className="prov-grid">
          <div className="field">
            <label htmlFor={ids.month}>支払い月</label>
            <input
              ref={inputs.month}
              id={ids.month}
              type="month"
              value={form.month}
              placeholder="2026-11"
              aria-invalid={errors.month ? true : undefined}
              aria-describedby={describedBy(ids.monthHint, errors.month, ids.monthError)}
              onChange={(e) => setField('month', e.target.value)}
            />
            <p id={ids.monthHint} className="muted small field-hint">例: 2026-11</p>
            {errors.month && (
              <p id={ids.monthError} className="field-error">
                {errors.month}
              </p>
            )}
          </div>

          <div className="field prov-wide">
            <label htmlFor={ids.label}>支払先・内容</label>
            <input
              ref={inputs.label}
              id={ids.label}
              type="text"
              value={form.label}
              placeholder="例: 楽天カード 11月分"
              autoComplete="off"
              aria-invalid={errors.label ? true : undefined}
              aria-describedby={describedBy(undefined, errors.label, ids.labelError)}
              onChange={(e) => setField('label', e.target.value)}
            />
            {errors.label && (
              <p id={ids.labelError} className="field-error">
                {errors.label}
              </p>
            )}
          </div>

          <div className="field">
            <label htmlFor={ids.amount}>金額（円）</label>
            <input
              ref={inputs.amount}
              id={ids.amount}
              type="text"
              inputMode="numeric"
              value={form.amount}
              placeholder="例: 48,500"
              autoComplete="off"
              aria-invalid={errors.amount ? true : undefined}
              aria-describedby={describedBy(ids.amountHint, errors.amount, ids.amountError)}
              onChange={(e) => setField('amount', e.target.value)}
            />
            <p id={ids.amountHint} className="muted small field-hint">全角・カンマ・「円」付きでも入力できます</p>
            {errors.amount && (
              <p id={ids.amountError} className="field-error">
                {errors.amount}
              </p>
            )}
          </div>

          <fieldset className="prov-radios">
            <legend>種別</legend>
            <div className="checks">
              {KINDS.map((k) => (
                <label key={k} className="check">
                  <input
                    type="radio"
                    name={`${uid}-kind`}
                    checked={form.kind === k}
                    onChange={() => setField('kind', k)}
                  />
                  {provisionalKindLabel(k)}
                </label>
              ))}
            </div>
          </fieldset>

          <fieldset className="prov-radios">
            <legend>金額の状態</legend>
            <div className="checks">
              <label className="check">
                <input
                  type="radio"
                  name={`${uid}-confirmed`}
                  checked={form.confirmed}
                  onChange={() => setField('confirmed', true)}
                />
                確定
              </label>
              <label className="check">
                <input
                  type="radio"
                  name={`${uid}-confirmed`}
                  checked={!form.confirmed}
                  onChange={() => setField('confirmed', false)}
                />
                見込み
              </label>
            </div>
          </fieldset>

          <div className="field prov-wide">
            <label htmlFor={ids.note}>メモ（任意）</label>
            <input
              id={ids.note}
              type="text"
              value={form.note}
              autoComplete="off"
              onChange={(e) => setField('note', e.target.value)}
            />
          </div>
        </div>

        <div className="prov-actions">
          <button type="submit" className="btn">
            {editingItem ? '保存' : '追加'}
          </button>
          {editingItem && (
            <button type="button" className="btn btn-ghost" onClick={resetForm}>
              キャンセル
            </button>
          )}
        </div>
        <div className="form-status" aria-live="polite">
          {status}
        </div>
      </form>

      <div className="prov-list">
        <div className="file-list-head">
          <h3>登録済みの暫定支払い（{formatCount(items.length)}）</h3>
          {items.length > 0 && (
            <button type="button" className="btn btn-small btn-ghost" onClick={handleDeleteAll}>
              暫定支払いをすべて削除
            </button>
          )}
        </div>
        {items.length === 0 ? (
          <p className="muted">まだ暫定支払いは登録されていません。</p>
        ) : (
          <>
            <p className="muted small">
              概要・月別サマリーの暫定支払いには、絞り込み条件（月・キーワード）が反映されます。この一覧には登録済みのものをすべて表示します。
            </p>
            <div className="table-scroll" tabIndex={0} role="region" aria-label="暫定支払いの表">
              <table className="num-table prov-table">
                <thead>
                  <tr>
                    <th scope="col">月</th>
                    <th scope="col">支払先・内容</th>
                    <th scope="col">種別</th>
                    <th scope="col" className="num">金額</th>
                    <th scope="col">状態</th>
                    <th scope="col">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((item) => (
                    <tr key={item.id} className={item.id === editingId ? 'is-editing' : undefined}>
                      <th scope="row" className="nowrap">{formatMonth(item.month)}</th>
                      <td className="desc">
                        {item.label}
                        {item.note && <span className="cell-sub muted">{item.note}</span>}
                      </td>
                      <td>
                        <span className={`badge badge-kind-${item.kind}`}>{provisionalKindLabel(item.kind)}</span>
                      </td>
                      <td className="num">{formatYen(item.amount)}</td>
                      <td>
                        <span className={`badge ${item.confirmed ? 'badge-confirmed' : 'badge-estimated'}`}>
                          {item.confirmed ? '確定' : '見込み'}
                        </span>
                      </td>
                      <td className="prov-row-actions">
                        <button
                          type="button"
                          className="btn btn-small btn-ghost"
                          aria-label={`${item.label}を編集`}
                          onClick={() => startEdit(item)}
                        >
                          編集
                        </button>
                        <button
                          type="button"
                          className="btn btn-small btn-ghost"
                          aria-label={`${item.label}を削除`}
                          onClick={() => handleDelete(item)}
                        >
                          削除
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
