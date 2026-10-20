import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { components } from '../../../shared/api/client';
import { sessionEpoch } from '../../../shared/api/session-boundary';
import { Button } from '../../../shared/ui/Button';
import { OrganizationWriteFailure, submitOrganization } from './api';
import styles from './organizations.module.css';

export function OrganizationSubmission({ organization, refreshing, reload }: { organization: components['schemas']['PrivateOrganization']; refreshing: boolean; reload: () => Promise<boolean> }) {
  const [pending, setPending] = useState(false);
  const [unknown, setUnknown] = useState(false);
  const [checked, setChecked] = useState(false);
  const [receipt, setReceipt] = useState<string | null>(null);
  const [failure, setFailure] = useState<OrganizationWriteFailure | null>(null);
  const client = useQueryClient();
  const lock = useRef(false);
  const mounted = useRef(false);
  const request = useRef<AbortController | null>(null);
  const summary = useRef<HTMLDivElement>(null);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; request.current?.abort(); }; }, []);
  useEffect(() => { if (receipt || failure || unknown) summary.current?.focus(); }, [receipt, failure, unknown]);

  async function submit() {
    if (lock.current || refreshing || !organization.canSubmit || organization.approvalState !== 'NOT_SUBMITTED' || (unknown && !checked)) return;
    lock.current = true; setPending(true); setFailure(null); setReceipt(null);
    const controller = new AbortController(); request.current = controller;
    const epoch = sessionEpoch();
    try {
      const result = await submitOrganization(organization.id, AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]));
      if (!mounted.current || epoch !== sessionEpoch()) return;
      setUnknown(false); setChecked(false);
      setReceipt(result.repeated ? 'На сервере уже есть заявка этой организации. Повторной подачи и нового рассмотрения нет.' : 'Сервер подтвердил получение заявки. Сведения кабинета перечитываются.');
      void client.invalidateQueries({ queryKey: ['private', epoch, 'organizations'] });
      await reload();
    } catch (problem) {
      if (!mounted.current || controller.signal.aborted || epoch !== sessionEpoch()) return;
      const error = problem instanceof OrganizationWriteFailure ? problem : new OrganizationWriteFailure('UNKNOWN_RESULT');
      setFailure(error); setUnknown(error.code === 'UNKNOWN_RESULT'); setChecked(false);
      if (error.code === 'UNKNOWN_RESULT' || error.status === 404) await reload();
    } finally {
      lock.current = false;
      if (mounted.current) setPending(false);
    }
  }
  if (!receipt && !failure && !unknown && (organization.approvalState !== 'NOT_SUBMITTED' || !organization.canSubmit)) return null;
  return <div className={styles.stack}>
    {(receipt || failure || unknown) && <div ref={summary} tabIndex={-1} role={failure && !unknown ? 'alert' : 'status'} className={failure && !unknown ? styles.error : styles.notice}>
      {unknown ? <><p>Ответ на отправку не получен. Показано текущее состояние заявки; её наличие не подтверждает, какой запрос создал её.</p><p>Автоматической повторной отправки нет. Если заявки нет, сначала проверь сведения ещё раз.</p></>
        : failure ? <p>{failure.code === 'CSRF_REJECTED' ? 'Сервер не принял запрос с этой страницы. Проверь текущий вход.' : 'Не удалось отправить заявку. Проверь сведения и попробуй позже.'}</p> : <p>{receipt}</p>}
    </div>}
    {organization.approvalState === 'NOT_SUBMITTED' && organization.canSubmit && <div className={styles.actions}>
      {unknown && <Button variant="secondary" pending={refreshing} disabled={pending} onClick={async () => { const success = await reload(); if (mounted.current) setChecked(success); }}>Проверить заявку</Button>}
      <Button pending={pending} disabled={refreshing || (unknown && !checked)} onClick={() => void submit()}>{pending ? 'Отправляем…' : unknown ? 'Повторить отправку' : 'Отправить на проверку'}</Button>
    </div>}
  </div>;
}
