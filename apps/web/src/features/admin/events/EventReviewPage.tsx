import { EventReports } from '../../reports/EventReports';
import { useState } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { api, type components } from '../../../shared/api/client';
import { operationFailure, requestSignal, sameId } from '../../../shared/api/operation';
import { useResourceQuery } from '../../../shared/api/resource-query';
import { confirmed, useAdminAction } from '../../../shared/api/admin-action';
import { sessionEpoch } from '../../../shared/api/session-boundary';
import { formatEventStart } from '../../../shared/lib/event-time';
import { PageTitle } from '../../../shared/ui/PageTitle';
import { ResourceState } from '../../../shared/ui/ResourceState';
import { StatePanel } from '../../../shared/ui/StatePanel';
import { StatusBadge } from '../../../shared/ui/StatusBadge';
import { TextAreaField } from '../../../shared/ui/Field';
import { Button } from '../../../shared/ui/Button';
import { useRefreshToken } from '../../participation/user/queries';
import { AdminBoundary } from './AdminBoundary';
import styles from './admin.module.css';
type Message = components['schemas']['AdminMessage'];
async function readEvent(id: string, signal: AbortSignal) {
  const result = await api.GET('/admin/events/{eventId}', { params: { path: { eventId: id } }, signal, cache: 'no-store' });
  if (result.response.status !== 200 || !result.data || !sameId(result.data.id, id)) throw operationFailure(result); return result.data;
}
export function EventReviewPage() {
  const { eventId = '' } = useParams();
  return <AdminBoundary title="Модерация встречи"><Review key={`${sessionEpoch()}:${eventId}`} id={eventId} /></AdminBoundary>;
}
function Review({ id }: { id: string }) {
  const resource = useResourceQuery('admin-event', id, readEvent), event = !resource.isError ? resource.data : undefined;
  const [reason, setReason] = useState(''), [error, setError] = useState('');
  const action = useAdminAction(async () => !(await resource.refetch()).isError);
  const disabled = action.pending || action.locked || resource.isFetching;
  async function unpublish() {
    if (!event || disabled || !event.canUnpublish) return;
    if (!reason.trim() || [...reason.trim()].length > 2000) { setError('Укажи причину от 1 до 2000 символов.'); document.getElementById('unpublish-reason')?.focus(); return; }
    await action.run(async (signal) => {
      const result = await api.POST('/admin/events/{eventId}/unpublish', { params: { path: { eventId: id } }, body: { reason: reason.trim() }, signal });
      return confirmed(result, (row) => sameId(row.id, id) && row.publicationStatus === 'UNPUBLISHED' && row.unpublication?.reason === reason.trim());
    }, 'Сервер подтвердил снятие встречи с публикации.');
  }
  return <div className={styles.page}><Link to="/admin/events">← К модерации встреч</Link>
    {!event ? <ResourceState error={resource.error} loadingTitle="Открываем модерацию встречи" notFoundTitle="Встреча не найдена" retry={() => void resource.refetch()} /> : <>
      <PageTitle title={event.title} /><StatusBadge domain="publication" status={event.publicationStatus} />
      <section className={styles.card}><h2>Сведения встречи</h2><time dateTime={event.startsAt}>{formatEventStart(event)}</time><p>{event.city} · {event.locationText}</p><p className={styles.text}>{event.description}</p><h3>Условия участия</h3><p className={styles.text}>{event.conditions || 'Дополнительных условий нет.'}</p><p>{event.joinMode === 'OPEN' ? 'Свободная запись' : 'По заявке'} · Участников: {event.confirmedCount}</p>
        <Link to={`/people/${event.createdBy.id}`}>Создатель: {event.createdBy.displayName}</Link>
        <Link to={`/admin/events?activityTypeId=${event.activityType.id}`}>Направление: {event.activityType.name}</Link>
        {event.organizer.type === 'ORGANIZATION' && <div className={styles.row}><Link to={`/admin/organizations/${event.organizer.organization.id}`}>{event.organizer.organization.name}</Link><Link to={`/admin/events?organizationId=${event.organizer.organization.id}`}>Все встречи организации</Link></div>}
        {event.canManageParticipants && <Link to={`/events/${id}/manage`}>Участники и заявки</Link>}<Link to={`/events/${id}`}>Публичная карточка</Link>
      </section>
      <section className={styles.card}><h2>Публикация</h2>{event.unpublication && <p className={styles.text}>Причина снятия: {event.unpublication.reason}</p>}
        {event.canUnpublish && <><TextAreaField id="unpublish-reason" label="Причина снятия" required value={reason} error={error} disabled={disabled} onChange={(e) => { setReason(e.target.value); setError(''); }} /><Button variant="danger" disabled={disabled} pending={action.pending} onClick={() => void unpublish()}>Снять с публикации</Button></>}
        {action.notice && <p role="status" className={styles.notice}>{action.notice}</p>}<Button variant="quiet" pending={action.pending} onClick={() => void action.check()}>Перечитать встречу</Button>
      </section>
      <EventReports event={event} refreshing={resource.isFetching} reload={async () => !(await resource.refetch()).isError} />
      <AdminMessages eventId={id} />
    </>}
  </div>;
}
export function AdminMessages({ eventId }: { eventId: string }) {
  const { token, refresh } = useRefreshToken();
  const [params, setParams] = useSearchParams();
  const filter = params.get('messageReports') ?? '';
  const [pinned, setPinned] = useState<Message | null>(null);
  const feed = useInfiniteQuery({ queryKey: ['admin-messages', sessionEpoch(), eventId, token, filter], enabled: ['', 'true', 'false'].includes(filter), initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam, signal }) => { const result = await api.GET('/admin/events/{eventId}/messages', { params: { path: { eventId }, query: { limit: 20, cursor: pageParam, hasOpenReports: filter ? filter === 'true' : undefined } }, signal: requestSignal(signal), cache: 'no-store' }); if (result.response.status !== 200 || !result.data) throw operationFailure(result); return result.data; },
    getNextPageParam: (last, _pages, previous, all) => last.nextCursor && last.nextCursor !== previous && !all.includes(last.nextCursor) ? last.nextCursor : undefined, gcTime: 0, refetchOnWindowFocus: false });
  const messages = [...new Map((feed.data?.pages.flatMap((page) => page.items) ?? []).map((item) => [item.id, item])).values()];
  async function reloadOne(id: string) {
    const result = await api.GET('/admin/messages/{messageId}', { params: { path: { messageId: id } }, signal: AbortSignal.timeout(15_000), cache: 'no-store' });
    if (result.response.status === 200 && result.data && sameId(result.data.id, id) && sameId(result.data.eventId, eventId)) { setPinned(result.data); await feed.refetch(); return true; }
    // BE-08 already supplies originals in the list; direct GET arrives with BE-11.
    if (result.response.status === 404) {
      const current = await feed.refetch();
      if (current.isError) return false;
      const row = current.data?.pages.flatMap((page) => page.items).find((item) => sameId(item.id, id));
      if (row) { setPinned(row); return true; }
    }
    return false;
  }
  return <section className={styles.stack} aria-label="Административное обсуждение"><h2>Сообщения встречи</h2><p>Оригиналы видны только администратору. Публичное обсуждение скрытых текстов не раскрывает.</p><label className={styles.select}>Жалобы на сообщения<select value={filter} onChange={(e) => { const next = new URLSearchParams(params); if (e.target.value) next.set('messageReports', e.target.value); else next.delete('messageReports'); setPinned(null); setParams(next); }}><option value="">Все сообщения</option><option value="true">Есть открытые жалобы</option><option value="false">Нет открытых жалоб</option></select></label><Button variant="quiet" onClick={() => { setPinned(null); refresh(); }}>Обновить сообщения</Button>
    {!['', 'true', 'false'].includes(filter) && <StatePanel kind="error" title="Неизвестный фильтр сообщений">Выбери фильтр из списка.</StatePanel>}
    {pinned && <p className={styles.notice}>Выбранное сообщение перечитывается по ID независимо от фильтра.</p>}
    {feed.isError && !feed.isFetchNextPageError ? <StatePanel kind="error" title="Сообщения не загрузились" action={<Button onClick={refresh}>Перечитать сообщения</Button>}>Оригиналы скрыты до успешного чтения.</StatePanel> : feed.isPending ? <StatePanel kind="loading" title="Загружаем сообщения" /> : <>
      {!messages.length && !pinned && <p>По этим условиям сообщений нет.</p>}
      {(pinned ? [pinned, ...messages.filter((message) => message.id !== pinned.id)] : messages).map((message) => <MessageCard key={message.id} message={message} refreshing={feed.isFetching} pin={() => setPinned(message)} reload={() => reloadOne(message.id)} />)}
      {feed.isFetchNextPageError ? <Button onClick={refresh}>Читать сообщения заново</Button> : feed.hasNextPage && <Button pending={feed.isFetchingNextPage} onClick={() => void feed.fetchNextPage()}>Ещё сообщения</Button>}
    </>}
  </section>;
}
function MessageCard({ message, refreshing, reload, pin }: { message: Message; refreshing: boolean; reload: () => Promise<boolean>; pin: () => void }) {
  const action = useAdminAction(reload);
  async function hide() { if (refreshing || action.pending || action.locked) return;
    pin();
    await action.run(async (signal) => confirmed(await api.POST('/admin/messages/{messageId}/hide', { params: { path: { messageId: message.id } }, body: { expectedRevision: message.moderationRevision }, signal }), (row) => sameId(row.id, message.id) && row.status === 'HIDDEN'), 'Сервер подтвердил скрытие сообщения.');
  }
  async function restore() { if (refreshing || action.pending || action.locked) return;
    pin();
    await action.run(async (signal) => confirmed(await api.POST('/admin/messages/{messageId}/restore', { params: { path: { messageId: message.id } }, body: { expectedRevision: message.moderationRevision }, signal }), (row) => sameId(row.id, message.id) && row.status === 'VISIBLE'), 'Сервер подтвердил восстановление сообщения.');
  }
  async function dismiss() { if (refreshing || action.pending || action.locked) return;
    pin();
    await action.run(async (signal) => confirmed(await api.POST('/admin/messages/{messageId}/reports/dismiss', { params: { path: { messageId: message.id } }, body: { expectedReportsRevision: message.reportsRevision }, signal }), (row) => sameId(row.id, message.id) && row.openReportsCount === 0), 'Сервер подтвердил отклонение жалоб на сообщение.');
  }
  return <article className={styles.card}><div className={styles.row}><Link to={`/people/${message.author.id}`}>{message.author.displayName}</Link>{message.authorIsOrganizer && <strong>Организатор</strong>}<span>{message.status === 'HIDDEN' ? 'Скрыто' : 'Видимо'}</span></div><p className={styles.text}>{message.body}</p>
    {message.status === 'VISIBLE' && <Button variant="danger" pending={action.pending} disabled={refreshing || action.locked} onClick={() => void hide()}>Скрыть сообщение</Button>}
    <p>Открытых жалоб: {message.openReportsCount}</p>
    {message.status === 'HIDDEN' && <Button variant="secondary" disabled={refreshing || action.locked} pending={action.pending} onClick={() => void restore()}>Восстановить сообщение</Button>}
    {message.openReportsCount > 0 && <Button variant="secondary" disabled={refreshing || action.locked} pending={action.pending} onClick={() => void dismiss()}>Отклонить жалобы на сообщение</Button>}
    <Button variant="quiet" disabled={action.pending} onClick={() => void action.check()}>Прочитать сообщение по ID</Button>
    {action.notice && <p role="status" className={styles.notice}>{action.notice}</p>}{action.locked && <Button pending={action.pending} onClick={() => void action.check()}>Перечитать сообщение</Button>}
  </article>;
}
