import { useEffect, useRef, useState } from 'react';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { api, type components } from '../../../shared/api/client';
import { useResourceQuery } from '../../../shared/api/resource-query';
import { OperationFailure, operationFailure, requestSignal, sameId, uuid } from '../../../shared/api/operation';
import { sessionEpoch } from '../../../shared/api/session-boundary';
import { refreshEventData } from '../../../shared/api/event-cache';
import { ResourceState } from '../../../shared/ui/ResourceState';
import { Button } from '../../../shared/ui/Button';
import { StatePanel } from '../../../shared/ui/StatePanel';
import { PageTitle } from '../../../shared/ui/PageTitle';
import { Avatar } from '../../../shared/ui/Avatar';
import { StatusBadge } from '../../../shared/ui/StatusBadge';
import { PrivateGate } from '../user/PrivateGate';
import { useEventBoundary } from '../user/boundary';
import { useRefreshToken } from '../user/queries';
import { readEvent } from '../../events/detail/EventPage';
import styles from '../user/participation.module.css';

type Entry = components['schemas']['ParticipantEntry'];
type Decision = components['schemas']['ParticipationDecisionInput']['decision'];
export function ManagePage() {
  const { eventId = '' } = useParams();
  return <PrivateGate><Manage key={`${sessionEpoch()}:${eventId}`} eventId={eventId} /></PrivateGate>;
}
function Manage({ eventId }: { eventId: string }) {
  const event = useResourceQuery('event', eventId, readEvent);
  const [params] = useSearchParams();
  const status = params.get('status') ?? 'PENDING';
  const allowed = event.data?.publicationStatus === 'UNPUBLISHED' || event.data?.publicationStatus === 'PUBLISHED' && event.data.capabilities.canManageParticipants;
  useEventBoundary(event.data?.publicationStatus === 'PUBLISHED' ? event.data.startsAt : undefined, () => void event.refetch());
  return <div className={styles.page}>
    <Link to={`/events/${eventId}`}>← К встрече</Link>
    {!event.data || event.isError ? <ResourceState error={event.error} loadingTitle="Открываем состав встречи" notFoundTitle="Встреча не найдена" retry={() => void event.refetch()} />
      : <><PageTitle title="Участники и заявки" /><h2>{event.data.title}</h2>
        {!allowed ? <StatePanel kind="unavailable" title="Состав доступен автору встречи">Роль администратора сама по себе не даёт доступ к составу.</StatePanel>
          : <>
            <nav className={styles.tabs} aria-label="Состав встречи">{[['PENDING', 'Заявки'], ['CONFIRMED', 'Участники'], ['REJECTED', 'Отказы'], ['ALL', 'Все записи']].map(([key, label]) => <Link key={key} to={`?status=${key}`} aria-current={status === key ? 'page' : undefined}>{label}</Link>)}</nav>
            {!['PENDING', 'CONFIRMED', 'REJECTED', 'ALL'].includes(status) ? <StatePanel kind="error" title="Неизвестный фильтр состава">Выбери раздел состава.</StatePanel> : <Roster key={status} event={event.data} status={status as Entry['status'] | 'ALL'} refreshingEvent={event.isFetching} />}
          </>}
      </>}
  </div>;
}
function Roster({ event, status, refreshingEvent }: { event: components['schemas']['EventDetail']; status: Entry['status'] | 'ALL'; refreshingEvent: boolean }) {
  const client = useQueryClient(), { token, refresh } = useRefreshToken();
  const [pending, setPending] = useState<string | null>(null), [uncertain, setUncertain] = useState(false), [notice, setNotice] = useState('');
  const lock = useRef(false), mounted = useRef(false), request = useRef<AbortController | null>(null);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; request.current?.abort(); }; }, []);
  const epoch = sessionEpoch();
  const feed = useInfiniteQuery({
    queryKey: ['participants', epoch, event.id, status, token], initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam, signal }) => {
      const result = await api.GET('/events/{eventId}/participations', { params: { path: { eventId: event.id }, query: { status: status === 'ALL' ? undefined : [status], limit: 20, cursor: pageParam } }, querySerializer: { array: { style: 'form', explode: false } }, signal: requestSignal(signal), cache: 'no-store' });
      if (result.response.status !== 200 || !result.data) throw operationFailure(result);
      if (result.data.items.some((item) => !sameId(item.eventId, event.id) || !sameId(item.accountId, item.account.id) || status !== 'ALL' && item.status !== status)) throw new OperationFailure(502);
      if (result.data.nextCursor === pageParam || new Set(result.data.items.map((item) => item.id.toLowerCase())).size !== result.data.items.length) throw new OperationFailure(502);
      return result.data;
    },
    getNextPageParam: (last, _pages, previous, params) => last.nextCursor && last.nextCursor !== previous && !params.includes(last.nextCursor) ? last.nextCursor : undefined,
    gcTime: 0, refetchOnMount: 'always', refetchOnWindowFocus: false,
  });
  const entries = new Map<string, Entry>();
  for (const page of feed.data?.pages ?? []) for (const item of page.items) entries.set(item.id.toLowerCase(), item);
  const canDecide = event.publicationStatus === 'PUBLISHED' && event.capabilities.canDecideParticipations && !refreshingEvent && !feed.isFetching && !feed.isError && !uncertain;
  async function verify() {
    if (lock.current) return;
    lock.current = true; setPending('verify');
    try {
      const result = await feed.refetch();
      if (result.isError) throw result.error;
      await refreshEventData(client, event.id);
      if (mounted.current && epoch === sessionEpoch()) { setUncertain(false); setNotice('Состав перечитан. Текущее состояние не доказывает результат потерянного ответа.'); }
    } catch { if (mounted.current && epoch === sessionEpoch()) setNotice('Не удалось проверить состав. Повторное решение остаётся заблокированным.'); }
    finally { lock.current = false; if (mounted.current) setPending(null); }
  }
  async function decide(item: Entry, decision: Decision) {
    if (lock.current || !canDecide || item.status !== 'PENDING') return;
    lock.current = true; setPending(item.id); setNotice('');
    const controller = new AbortController(); request.current = controller;
    try {
      const result = await api.POST('/participations/{participationId}/decision', { params: { path: { participationId: item.id } }, body: { decision }, signal: requestSignal(controller.signal) });
      if (!mounted.current || epoch !== sessionEpoch()) return;
      const row = result.data;
      if (result.response.status !== 200 || !row || !uuid(row.id) || !sameId(row.id, item.id) || !sameId(row.eventId, event.id) || !sameId(row.accountId, item.accountId) || row.status !== (decision === 'ACCEPT' ? 'CONFIRMED' : 'REJECTED')) {
        if (result.response.status >= 400 && result.response.status < 500) throw operationFailure(result);
        throw new OperationFailure(0, 'UNKNOWN_RESULT');
      }
      setNotice(decision === 'ACCEPT' ? 'Принятие подтверждено сервером.' : 'Отказ подтверждён сервером.');
      await refreshEventData(client, event.id); refresh();
    } catch (error) {
      if (!mounted.current || epoch !== sessionEpoch() || controller.signal.aborted) return;
      const code = error instanceof OperationFailure ? error.code : 'UNKNOWN_RESULT';
      setUncertain(code === 'UNKNOWN_RESULT');
      setNotice(code === 'UNKNOWN_RESULT' ? 'Результат решения неизвестен. Сначала проверь состав. Запрос не повторяется автоматически.' : code === 'DECISION_CONFLICT' ? 'Заявка уже получила другое решение. Состав будет обновлён.' : code === 'EVENT_STARTED' ? 'Встреча началась. Решения закрыты, записи сохранены.' : code === 'EVENT_UNAVAILABLE' ? 'Публикация недоступна. Решения закрыты.' : 'Не удалось принять решение. Обнови состав и проверь доступ.');
      if (code !== 'UNKNOWN_RESULT') { await refreshEventData(client, event.id); refresh(); }
    } finally { lock.current = false; if (mounted.current && epoch === sessionEpoch()) setPending(null); }
  }
  return <section className={styles.stack} aria-label="Записи участников">
    {notice && <p role="status" className={styles.notice}>{notice}</p>}
    {event.publicationStatus === 'UNPUBLISHED' ? <p>Встреча снята с публикации. Записи сохранены, новые решения недоступны.</p> : !event.capabilities.canDecideParticipations && <p>Решения по заявкам закрыты. Состав и ожидающие заявки сохраняются.</p>}
    <Button variant="quiet" pending={pending === 'verify'} disabled={!!pending} onClick={uncertain ? () => void verify() : refresh}>{uncertain ? 'Проверить состав после ошибки' : 'Обновить состав'}</Button>
    {!feed.data && feed.isPending ? <StatePanel kind="loading" title="Загружаем состав" /> : feed.isError && !feed.isFetchNextPageError ? <StatePanel kind="error" title="Состав сейчас недоступен" action={<Button onClick={refresh}>Повторить загрузку состава</Button>}>Сведения и действия скрыты до успешного чтения.</StatePanel> : <>
      {!entries.size && <StatePanel kind="empty" title="В этом разделе пока нет записей">Выбери другой раздел или обнови состав позже.</StatePanel>}
      {[...entries.values()].map((item) => <article key={item.id} className={styles.card}>
        <div className={styles.row}><Avatar name={item.account.displayName} url={item.account.avatarUrl} /><h3><Link to={`/people/${item.account.id}`}>{item.account.displayName}</Link></h3><StatusBadge domain="participation" status={item.status} /></div>
        {item.account.isBlocked && <p>Аккаунт участника заблокирован. Запись сохранена.</p>}
        {item.status === 'PENDING' && canDecide && <div className={styles.row}><Button disabled={!!pending} pending={pending === item.id} onClick={() => void decide(item, 'ACCEPT')}>Принять</Button><Button variant="secondary" disabled={!!pending} onClick={() => void decide(item, 'REJECT')}>Отклонить</Button></div>}
      </article>)}
      {feed.isFetchNextPageError && <StatePanel kind="error" title="Не удалось продолжить состав" action={<Button onClick={refresh}>Читать состав заново</Button>}>Курсор и состав нужно обновить.</StatePanel>}
      {feed.hasNextPage && !feed.isError && <Button pending={feed.isFetchingNextPage} disabled={feed.isFetching || !!pending} onClick={() => void feed.fetchNextPage()}>Показать ещё участников</Button>}
    </>}
  </section>;
}
