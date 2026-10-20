import * as Dialog from '@radix-ui/react-dialog';
import { useEffect, useRef, useState } from 'react';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { api, type components } from '../../../shared/api/client';
import { OperationFailure, operationFailure, requestSignal, sameId } from '../../../shared/api/operation';
import { sessionEpoch } from '../../../shared/api/session-boundary';
import { useResourceQuery } from '../../../shared/api/resource-query';
import { Button } from '../../../shared/ui/Button';
import { TextField } from '../../../shared/ui/Field';
import { StatePanel } from '../../../shared/ui/StatePanel';
import { PageTitle } from '../../../shared/ui/PageTitle';
import { useRefreshToken } from '../../participation/user/queries';
import { AdminBoundary } from '../events/AdminBoundary';
import styles from '../events/admin.module.css';
import dialog from '../../../shared/ui/ui.module.css';
type Account = components['schemas']['AdminAccount'];
async function readAccount(id: string, signal: AbortSignal) {
  const result = await api.GET('/admin/accounts/{accountId}', { params: { path: { accountId: id } }, signal, cache: 'no-store' });
  if (result.response.status !== 200 || !result.data || !sameId(result.data.account.id, id)) throw operationFailure(result);
  return result.data;
}
export function AccountsPage() { return <AdminBoundary title="Модерация аккаунтов"><Accounts /></AdminBoundary>; }
function Accounts() {
  const [params, setParams] = useSearchParams(), [q, setQ] = useState(params.get('q') ?? '');
  const status = params.get('status') ?? '', selected = params.get('id');
  useEffect(() => setQ(params.get('q') ?? ''), [params.get('q')]);
  const { token, refresh } = useRefreshToken();
  const valid = ['', 'ACTIVE', 'BLOCKED'].includes(status) && [...(params.get('q') ?? '')].length <= 200;
  const feed = useInfiniteQuery({ queryKey: ['admin-accounts', sessionEpoch(), params.get('q'), status, token], enabled: valid, initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam, signal }) => { const result = await api.GET('/admin/accounts', { params: { query: { q: params.get('q')?.trim() || undefined, status: status as Account['status'] || undefined, limit: 20, cursor: pageParam } }, signal: requestSignal(signal), cache: 'no-store' }); if (result.response.status !== 200 || !result.data) throw operationFailure(result); return result.data; },
    getNextPageParam: (last, _pages, previous, all) => last.nextCursor && last.nextCursor !== previous && !all.includes(last.nextCursor) ? last.nextCursor : undefined, gcTime: 0, refetchOnWindowFocus: false });
  const rows = [...new Map((feed.data?.pages.flatMap((page) => page.items) ?? []).map((item) => [item.account.id.toLowerCase(), item])).values()];
  function set(key: string, value: string) { const next = new URLSearchParams(params); next.delete('cursor'); if (value) next.set(key, value); else next.delete(key); setParams(next); }
  return <div className={styles.page}><PageTitle title="Модерация аккаунтов" /><p>Блокировка завершает сессии пользователя. Контент, допуск организаций и сохранённые участия остаются в прежнем состоянии.</p>
    <form className={styles.row} onSubmit={(e) => { e.preventDefault(); set('q', q.trim()); }}><TextField label="Поиск по имени, email или ID" value={q} onChange={(e) => setQ(e.target.value)} /><label className={styles.select}>Статус аккаунта<select value={status} onChange={(e) => set('status', e.target.value)}><option value="">Все</option><option value="ACTIVE">Активные</option><option value="BLOCKED">Заблокированные</option></select></label><Button type="submit">Найти аккаунты</Button></form>
    <Button variant="quiet" onClick={refresh}>Обновить список аккаунтов</Button>
    {!valid ? <StatePanel kind="error" title="Проверь фильтры аккаунтов">Неизвестный статус или слишком длинный поиск.</StatePanel> : feed.isError && !feed.isFetchNextPageError ? <StatePanel kind="error" title="Аккаунты не загрузились" action={<Button onClick={refresh}>Перечитать аккаунты</Button>}>Данные скрыты до успешного чтения.</StatePanel> : feed.isPending ? <StatePanel kind="loading" title="Загружаем аккаунты" /> : <>
      {!rows.length && <p>По этим условиям аккаунтов нет.</p>}
      {rows.map((item) => <article className={styles.card} key={item.account.id}><h2><Link to={`?${new URLSearchParams({ ...Object.fromEntries(params), id: item.account.id })}`}>{item.account.displayName}</Link></h2><p>{item.email}</p><p>{item.systemRole === 'ADMIN' ? 'Администратор' : 'Пользователь'} · {item.status === 'ACTIVE' ? 'Активен' : 'Заблокирован'}</p></article>)}
      {feed.isFetchNextPageError ? <Button onClick={refresh}>Читать список аккаунтов заново</Button> : feed.hasNextPage && <Button pending={feed.isFetchingNextPage} onClick={() => void feed.fetchNextPage()}>Ещё аккаунты</Button>}
    </>}
    {selected && <AccountEditor key={`${sessionEpoch()}:${selected}`} id={selected} />}
  </div>;
}
function AccountEditor({ id }: { id: string }) {
  const resource = useResourceQuery('admin-account', id, readAccount), client = useQueryClient();
  const account = !resource.isError ? resource.data : undefined;
  const [attempt, setAttempt] = useState<{ account: Account; status: Account['status'] } | null>(null);
  const [pending, setPending] = useState(false), [locked, setLocked] = useState(false), [notice, setNotice] = useState('');
  const lock = useRef(false), mounted = useRef(false), request = useRef<AbortController | null>(null);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; request.current?.abort(); }; }, []);
  async function check() {
    if (lock.current) return;
    lock.current = true; setPending(true); const epoch = sessionEpoch();
    const result = await resource.refetch();
    if (mounted.current && epoch === sessionEpoch()) { setAttempt(null); setLocked(result.isError); setNotice(result.isError ? 'Перечитывание не удалось. Действия заблокированы.' : 'Показано текущее состояние. Оно не подтверждает авторство потерянного запроса; новое действие требует отдельного подтверждения.'); setPending(false); }
    lock.current = false;
  }
  async function send() {
    if (lock.current || locked || !attempt || attempt.account.systemRole !== 'USER') return;
    if (!account || resource.isFetching || account.revision !== attempt.account.revision || account.status !== attempt.account.status) { setAttempt(null); setLocked(true); setNotice('Сведения изменились после открытия подтверждения. Перечитай аккаунт и подтверди действие заново.'); return; }
    lock.current = true; setPending(true); setNotice(''); const epoch = sessionEpoch(), controller = new AbortController(); request.current = controller;
    try {
      const result = await api.PATCH('/admin/accounts/{accountId}/status', { params: { path: { accountId: id } }, body: { status: attempt.status, expectedRevision: attempt.account.revision }, signal: requestSignal(controller.signal) });
      if (!mounted.current || epoch !== sessionEpoch()) return;
      const row = result.data;
      if (result.response.status !== 200 || !row || !sameId(row.account.id, id) || row.systemRole !== 'USER' || row.status !== attempt.status || row.revision !== attempt.account.revision + 1 || row.account.isBlocked !== (attempt.status === 'BLOCKED')) {
        if (result.response.status >= 400 && result.response.status < 500) throw operationFailure(result);
        throw new OperationFailure(0, 'UNKNOWN_RESULT');
      }
      setNotice(attempt.status === 'BLOCKED' ? 'Сервер подтвердил блокировку. Прежние сессии пользователя завершены.' : 'Сервер подтвердил разблокировку. Пользователю нужен новый вход; старые сессии не восстановлены.');
      setAttempt(null); setLocked(true);
      await client.invalidateQueries({ predicate: (query) => ['admin-accounts', 'public', 'resource', 'participants', 'messages'].includes(String(query.queryKey[0])) });
      const fresh = await resource.refetch(); if (mounted.current && epoch === sessionEpoch()) setLocked(fresh.isError);
    } catch (problem) {
      if (!mounted.current || epoch !== sessionEpoch() || controller.signal.aborted) return;
      const code = problem instanceof OperationFailure ? problem.code : 'UNKNOWN_RESULT';
      setLocked(true); setAttempt(null);
      setNotice(code === 'ACCOUNT_REVISION_CONFLICT' ? 'Версия аккаунта изменилась. Запрос не повторяется со свежей версией; проверь состояние и подтверди новое действие отдельно.' : code === 'ACCOUNT_PROTECTED' ? 'Аккаунт администратора защищён от блокировки.' : 'Результат действия не подтверждён. Автоматического повтора нет. Перечитай аккаунт перед новым решением.');
      // A read updates displayed facts, but never unlocks an uncertain command automatically.
      await resource.refetch();
    } finally { lock.current = false; if (mounted.current && epoch === sessionEpoch()) setPending(false); }
  }
  return <section className={styles.card} aria-label="Выбранный аккаунт"><h2>Выбранный аккаунт</h2>
    {!account ? <StatePanel kind={resource.isError ? 'error' : 'loading'} title={resource.isError ? 'Аккаунт недоступен' : 'Открываем аккаунт'} action={<Button onClick={() => void check()}>Перечитать аккаунт</Button>}>Проверь ссылку и доступ.</StatePanel> : <>
      <h3>{account.account.displayName}</h3><p>{account.email}</p><p>Роль: {account.systemRole === 'ADMIN' ? 'Администратор' : 'Пользователь'}</p><p>Статус: {account.status === 'ACTIVE' ? 'Активен' : 'Заблокирован'}</p>
      <Link to={`/people/${id}`}>Публичный профиль</Link>
      {account.blockedAt && <p>Заблокирован: <time dateTime={account.blockedAt}>{account.blockedAt}</time></p>}{account.blockedByAccountId && <Link to={`/people/${account.blockedByAccountId}`}>Администратор, выполнивший блокировку</Link>}
      {account.systemRole === 'ADMIN' ? <p>Администратора нельзя заблокировать этим действием.</p> : <Button variant={account.status === 'ACTIVE' ? 'danger' : 'secondary'} disabled={pending || locked || resource.isFetching} onClick={() => setAttempt({ account, status: account.status === 'ACTIVE' ? 'BLOCKED' : 'ACTIVE' })}>{account.status === 'ACTIVE' ? 'Заблокировать пользователя' : 'Разблокировать пользователя'}</Button>}
    </>}
    {notice && <p role="status" className={styles.notice}>{notice}</p>}<Button variant="quiet" pending={pending} onClick={() => void check()}>Проверить текущее состояние аккаунта</Button>
    <Dialog.Root open={!!attempt} onOpenChange={(open) => { if (!open && !lock.current) setAttempt(null); }}><Dialog.Portal><Dialog.Overlay className={dialog.overlay} /><Dialog.Content className={dialog.dialog} onEscapeKeyDown={(e) => { if (pending) e.preventDefault(); }} onInteractOutside={(e) => { if (pending) e.preventDefault(); }}>
      <Dialog.Title className={dialog.dialogTitle}>{attempt?.status === 'BLOCKED' ? 'Заблокировать пользователя?' : 'Разблокировать пользователя?'}</Dialog.Title>
      <Dialog.Description>{attempt?.account.account.displayName}. {attempt?.status === 'BLOCKED' ? 'Все сессии пользователя завершатся. Публикации, сообщения, организации и участия сохранятся.' : 'Пользователь сможет войти заново. Старые сессии останутся отозванными.'}</Dialog.Description>
      <div className={dialog.dialogFooter}><Button variant="secondary" disabled={pending} onClick={() => setAttempt(null)}>Отмена</Button><Button variant={attempt?.status === 'BLOCKED' ? 'danger' : 'primary'} pending={pending} onClick={() => void send()}>Подтвердить изменение статуса</Button></div>
    </Dialog.Content></Dialog.Portal></Dialog.Root>
  </section>;
}
