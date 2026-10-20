import * as Dialog from '@radix-ui/react-dialog';
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { Button } from '../../../shared/ui/Button';
import { TextAreaField } from '../../../shared/ui/Field';
import ui from '../../../shared/ui/ui.module.css';
import type { useDecision } from './useDecision';
import styles from './organizations.module.css';

type Decision = ReturnType<typeof useDecision>;
export function DecisionNotice({ decision, refreshing, pendingApplication }: { decision: Decision; refreshing: boolean; pendingApplication: boolean }) {
  const summary = useRef<HTMLDivElement>(null);
  const { failure, notice, unknown, open } = decision;
  useEffect(() => { if (!open && (failure || notice)) summary.current?.focus(); }, [failure, notice, open]);
  const definiteFailure = failure && failure.code !== 'UNKNOWN_RESULT';
  if (!notice && !failure && !decision.pending) return null;
  return <div ref={summary} tabIndex={-1} role={definiteFailure ? 'alert' : 'status'} className={definiteFailure ? styles.error : styles.notice}>
    {decision.pending && <p>Отправляем решение…</p>}
    {notice && <p>{notice}</p>}
    {unknown && !notice && <p>Результат первоначального запроса остаётся неизвестным.</p>}
    {definiteFailure && failure.code !== 'DECISION_CONFLICT' && <p>{failureMessage(failure.code)}</p>}
    {unknown && !decision.blocked && pendingApplication && <><p>Если заявка ещё на проверке, проверь её перед явным повтором с теми же данными.</p>
      <div className={styles.actions}><Button variant="secondary" pending={refreshing} disabled={decision.pending} onClick={() => void decision.check()}>Проверить решение</Button>
        <Button disabled={!decision.checked || refreshing} pending={decision.pending} onClick={() => void decision.retry()}>Повторить то же решение</Button></div></>}
  </div>;
}
export function DecisionControls({ decision, refreshing }: { decision: Decision; refreshing: boolean }) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string>();
  const id = useId();
  const disabled = decision.pending || refreshing;
  const serverError = decision.failure?.code === 'VALIDATION_ERROR' ? decision.failure.fields['/reason']?.join(' ') || 'Проверь причину отказа.' : undefined;
  useEffect(() => { if (decision.open && serverError && !decision.pending) document.getElementById(id)?.focus(); }, [decision.open, decision.pending, serverError, id]);
  function reject(event: FormEvent) {
    event.preventDefault();
    const value = reason.trim();
    if (!value || Array.from(value).length > 2000) { setError(!value ? 'Укажи причину отказа.' : 'Причина — не более 2000 символов.'); document.getElementById(id)?.focus(); return; }
    setError(undefined); void decision.send({ decision: 'REJECT', reason: value });
  }
  if (!decision.canDecide && !decision.open) return null;
  return <div className={styles.actions}>
    <Button disabled={disabled || !decision.canDecide} pending={decision.pending && !decision.open} onClick={() => void decision.send({ decision: 'APPROVE' })}>Предоставить допуск</Button>
    <Dialog.Root open={decision.open} onOpenChange={(value) => { if (!decision.pending) { decision.setOpen(value); setError(undefined); } }}>
      <Dialog.Trigger asChild><Button variant="danger" disabled={disabled || !decision.canDecide}>Отклонить</Button></Dialog.Trigger>
      <Dialog.Portal><Dialog.Overlay className={ui.overlay} /><Dialog.Content className={ui.dialog} onEscapeKeyDown={(event) => { if (decision.pending) event.preventDefault(); }} onPointerDownOutside={(event) => { if (decision.pending) event.preventDefault(); }}>
        <Dialog.Title className={ui.dialogTitle}>Отказать в допуске</Dialog.Title>
        <Dialog.Description className={ui.hint}>Причину увидит ответственный за организацию. Повторное рассмотрение не предусмотрено.</Dialog.Description>
        <form className={styles.stack} onSubmit={reject} noValidate>
          <TextAreaField id={id} label="Причина отказа" required hint="До 2000 символов" value={reason} error={error || serverError} disabled={disabled} onChange={(event) => { setReason(event.target.value); setError(undefined); }} />
          {decision.failure && decision.failure.code !== 'VALIDATION_ERROR' && !decision.unknown && <p role="alert">{failureMessage(decision.failure.code)}</p>}
          <div className={ui.dialogFooter}><Button type="submit" variant="danger" pending={decision.pending} disabled={refreshing || !decision.canDecide}>Подтвердить отказ</Button><Dialog.Close asChild><Button variant="secondary" disabled={decision.pending}>Отмена</Button></Dialog.Close></div>
        </form>
      </Dialog.Content></Dialog.Portal>
    </Dialog.Root>
  </div>;
}
function failureMessage(code: string) {
  if (code === 'CSRF_REJECTED') return 'Сервер не принял запрос с этой страницы. Проверь текущий вход.';
  if (code === 'FORBIDDEN' || code === 'ACCOUNT_BLOCKED') return 'Нет права принимать решение. Обнови сведения о доступе.';
  if (code === 'NOT_FOUND') return 'Заявка больше недоступна. Обнови профиль.';
  if (code === 'VALIDATION_ERROR') return 'Решение не принято. Проверь причину отказа.';
  return 'Сервер не принял решение. Проверь сведения и попробуй позже.';
}
