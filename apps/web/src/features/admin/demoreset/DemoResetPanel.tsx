import * as Dialog from '@radix-ui/react-dialog';
import { useEffect, useRef, useState } from 'react';
import { useBeforeUnload, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type components } from '../../../shared/api/client';
import { OperationFailure, operationFailure, requestSignal, sameId, uuid } from '../../../shared/api/operation';
import { reportSessionLoss, sessionEpoch } from '../../../shared/api/session-boundary';
import { clearDraft } from '../../events/create/draft';
import { clearOrganizationDraft } from '../../organizations/create/draft';
import { clearMessageDraft } from '../../discussion/draft';
import { catalogPositionMemory } from '../../events/catalog/return-position';
import { useSession } from '../../auth/SessionProvider';
import { Button } from '../../../shared/ui/Button';
import { TextField } from '../../../shared/ui/Field';
import { StatePanel } from '../../../shared/ui/StatePanel';
import { forgetReset, pendingResetId, rememberReset } from './receipt';
import styles from './reset.module.css';
import dialog from '../../../shared/ui/ui.module.css';
type State = components['schemas']['DemoState'];
async function readState(signal: AbortSignal): Promise<State> {
  const result = await api.GET('/admin/demo-state', { signal: requestSignal(signal), cache: 'no-store' });
  if (result.response.status !== 200 || !result.data) throw operationFailure(result);
  if (!uuid(result.data.generation) || !result.data.seedVersion) throw new OperationFailure(502);
  return result.data;
}
export function DemoResetPanel() {
  const session = useSession();
  if (session.me?.systemRole !== 'ADMIN' || session.logoutPending) return null;
  return <ResetPanel key={sessionEpoch()} />;
}
function ResetPanel() {
  const client = useQueryClient(), navigate = useNavigate();
  const state = useQuery({ queryKey: ['demo-state', sessionEpoch()], queryFn: ({ signal }) => readState(signal), refetchOnMount: 'always', refetchOnWindowFocus: 'always', gcTime: 0 });
  const [snapshot, setSnapshot] = useState<State | null>(null), [word, setWord] = useState('');
  const [pending, setPending] = useState(false), [preparing, setPreparing] = useState(false), [notice, setNotice] = useState('');
  const [receipt, setReceipt] = useState(pendingResetId);
  const lock = useRef(false), mounted = useRef(false), request = useRef<AbortController | null>(null);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; request.current?.abort(); }; }, []);
  useEffect(() => { const update = () => setReceipt(pendingResetId()); window.addEventListener('storage', update); return () => window.removeEventListener('storage', update); }, []);
  useBeforeUnload((event) => { if (lock.current) { event.preventDefault(); event.returnValue = ''; } });
  const data = !state.isError && !state.isFetching ? state.data : undefined;
  async function prepare() {
    if (lock.current || receipt) return;
    lock.current = true; setPreparing(true); setNotice(''); const epoch = sessionEpoch();
    const result = await state.refetch();
    if (mounted.current && epoch === sessionEpoch()) {
      if (result.data && !result.isError) { setWord(''); setSnapshot(result.data); }
      else setNotice('Не удалось получить свежее состояние. Сброс недоступен.');
      setPreparing(false);
    }
    lock.current = false;
  }
  async function reset() {
    if (lock.current || !snapshot || word !== 'СБРОСИТЬ' || receipt || pendingResetId()) return;
    lock.current = true; setPending(true); setNotice('');
    const epoch = sessionEpoch(), resetId = crypto.randomUUID(), controller = new AbortController(); request.current = controller;
    try {
      // Persist before dispatch so reload/session loss can never silently lose the operation ID.
      rememberReset(resetId); setReceipt(resetId);
    } catch {
      setNotice('Не удалось сохранить номер операции в браузере. Сброс не отправлен.'); setSnapshot(null); setPending(false); lock.current = false; return;
    }
    try {
      const result = await api.POST('/admin/demo-reset', { body: { resetId, confirmation: 'СБРОСИТЬ', expectedGeneration: snapshot.generation, expectedSeedVersion: snapshot.seedVersion }, signal: requestSignal(controller.signal) });
      if (epoch !== sessionEpoch() || !mounted.current) return;
      const row = result.data;
      if (result.response.status !== 200 || !row || !sameId(row.resetId, resetId) || !sameId(row.previousGeneration, snapshot.generation) || row.seedVersion !== snapshot.seedVersion || !uuid(row.generation) || sameId(row.generation, snapshot.generation)) {
        if (result.response.status >= 400 && result.response.status < 500) throw operationFailure(result);
        throw new OperationFailure(0, 'UNKNOWN_RESULT');
      }
      clearDraft(); clearOrganizationDraft(); clearMessageDraft(); catalogPositionMemory.clear();
      await client.cancelQueries(); client.clear();
      reportSessionLoss(epoch, null);
      navigate('/login?returnTo=%2Fme', { replace: true, state: { demoResetCompleted: true } });
    } catch (problem) {
      if (epoch !== sessionEpoch() || !mounted.current || controller.signal.aborted) return;
      const code = problem instanceof OperationFailure ? problem.code : 'UNKNOWN_RESULT';
      setNotice(code === 'DEMO_STATE_CHANGED' ? 'Состояние или версия сида изменились. Старый запрос не повторяется. Перечитай состояние и подтверди новое действие отдельно.' : code === 'DEMO_RESET_BUSY' ? 'Другой сброс уже выполняется. Проверь состояние позже; повторного запроса нет.' : 'Результат сброса не подтверждён. Запрос мог сохраниться. Номер операции сохранён; войди заново при необходимости и проверь последнюю квитанцию. Автоматического повтора нет.');
      void state.refetch();
    } finally { lock.current = false; if (mounted.current && epoch === sessionEpoch()) { setPending(false); setSnapshot(null); setWord(''); } }
  }
  const disabledMode = state.error instanceof OperationFailure && state.error.status === 404;
  if (disabledMode && !receipt) return null;
  const match = receipt && data?.lastReset && sameId(data.lastReset.resetId, receipt);
  return <section className={styles.panel} aria-label="Демоданные"><h2>Демоданные</h2>
    {state.isPending ? <StatePanel kind="loading" title="Проверяем доступность демоданных" /> : state.isError ? <StatePanel kind="error" title="Состояние демоданных недоступно" action={<Button onClick={() => void state.refetch()}>Проверить состояние демобазы</Button>}>Сброс сейчас недоступен.</StatePanel> : <>
      {data && <><p>Версия сида: {data.seedVersion}</p><p>Предлагаемая базовая дата: {data.plannedBaseDate} · Asia/Krasnoyarsk</p></>}
      {receipt ? <div role="status" className={styles.notice}><p>Сохранён номер операции: {receipt}</p><p>{match ? 'Квитанция сервера подтверждает: демоданные восстановлены. Все прежние сессии завершены.' : 'Последняя квитанция пока не подтверждает эту операцию. Текущее состояние не доказывает её неуспех; старый запрос повторно не отправляется.'}</p>
        <Button pending={state.isFetching} onClick={() => void state.refetch()}>Проверить последнюю квитанцию</Button>
        {data && <Button variant="secondary" onClick={() => { try { forgetReset(); setReceipt(null); setNotice('Проверка прежней операции закрыта. Новое действие потребует свежего состояния и отдельного подтверждения.'); } catch { setNotice('Браузер не удалил сохранённый номер. Новое действие заблокировано.'); } }}>Завершить проверку этой операции</Button>}
      </div> : <Button variant="secondary" pending={preparing} disabled={!data || pending} onClick={() => void prepare()}>Восстановить демоданные</Button>}
    </>}
    {notice && <p role="status" className={styles.notice}>{notice}</p>}
    <Dialog.Root open={!!snapshot} onOpenChange={(open) => { if (!open && !lock.current) { setSnapshot(null); setWord(''); } }}><Dialog.Portal><Dialog.Overlay className={dialog.overlay} /><Dialog.Content className={dialog.dialog} onEscapeKeyDown={(e) => { if (pending) e.preventDefault(); }} onInteractOutside={(e) => { if (pending) e.preventDefault(); }}>
      <Dialog.Title className={dialog.dialogTitle}>Восстановить демоданные?</Dialog.Title><Dialog.Description>Все текущие аккаунты и изменения будут удалены, штатный демонабор восстановлен. Все пользователи, включая администратора, выйдут из аккаунтов.</Dialog.Description>
      <p>Версия: {snapshot?.seedVersion} · Дата: {snapshot?.plannedBaseDate} (Asia/Krasnoyarsk)</p>
      <TextField label="Для подтверждения введи СБРОСИТЬ" value={word} disabled={pending} autoComplete="off" onChange={(e) => setWord(e.target.value)} />
      <div className={dialog.dialogFooter}><Button variant="secondary" disabled={pending} onClick={() => { setSnapshot(null); setWord(''); }}>Отмена</Button><Button variant="danger" pending={pending} disabled={word !== 'СБРОСИТЬ'} onClick={() => void reset()}>Сбросить базу</Button></div>
    </Dialog.Content></Dialog.Portal></Dialog.Root>
  </section>;
}
