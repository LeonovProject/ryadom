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
      <AdminMessages eventId={id} />
    </>}
  </div>;
}
export function AdminMessages({ eventId }: { eventId: string }) {
  const { token, refresh } = useRefreshToken();
  const feed = useInfiniteQuery({ queryKey: ['admin-messages', sessionEpoch(), eventId, token], initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam, signal }) => { const result = await api.GET('/admin/events/{eventId}/messages', { params: { path: { eventId }, query: { limit: 20, cursor: pageParam } }, signal: requestSignal(signal), cache: 'no-store' }); if (result.response.status !== 200 || !result.data) throw operationFailure(result); return result.data; },
    getNextPageParam: (last, _pages, previous, all) => last.nextCursor && last.nextCursor !== previous && !all.includes(last.nextCursor) ? last.nextCursor : undefined, gcTime: 0, refetchOnWindowFocus: false });
  const messages = [...new Map((feed.data?.pages.flatMap((page) => page.items) ?? []).map((item) => [item.id, item])).values()];
  return <section className={styles.stack} aria-label="Административное обсуждение"><h2>Сообщения встречи</h2><p>Оригиналы видны только администратору. Публичное обсуждение скрытых текстов не раскрывает.</p><Button variant="quiet" onClick={refresh}>Обновить сообщения</Button>
    {feed.isError && !feed.isFetchNextPageError ? <StatePanel kind="error" title="Сообщения не загрузились" action={<Button onClick={refresh}>Перечитать сообщения</Button>}>Оригиналы скрыты до успешного чтения.</StatePanel> : feed.isPending ? <StatePanel kind="loading" title="Загружаем сообщения" /> : <>
      {!messages.length && <p>По этим условиям сообщений нет.</p>}
      {messages.map((message) => <MessageCard key={message.id} message={message} refreshing={feed.isFetching} reload={async () => !(await feed.refetch()).isError} />)}
      {feed.isFetchNextPageError ? <Button onClick={refresh}>Читать сообщения заново</Button> : feed.hasNextPage && <Button pending={feed.isFetchingNextPage} onClick={() => void feed.fetchNextPage()}>Ещё сообщения</Button>}
    </>}
  </section>;
}
function MessageCard({ message, refreshing, reload }: { message: Message; refreshing: boolean; reload: () => Promise<boolean> }) {
  const action = useAdminAction(reload);
  async function hide() { if (refreshing || action.pending || action.locked) return;
    await action.run(async (signal) => confirmed(await api.POST('/admin/messages/{messageId}/hide', { params: { path: { messageId: message.id } }, body: { expectedRevision: message.moderationRevision }, signal }), (row) => sameId(row.id, message.id) && row.status === 'HIDDEN'), 'Сервер подтвердил скрытие сообщения.');
  }
  return <article className={styles.card}><div className={styles.row}><Link to={`/people/${message.author.id}`}>{message.author.displayName}</Link>{message.authorIsOrganizer && <strong>Организатор</strong>}<span>{message.status === 'HIDDEN' ? 'Скрыто' : 'Видимо'}</span></div><p className={styles.text}>{message.body}</p>
    {message.status === 'VISIBLE' && <Button variant="danger" pending={action.pending} disabled={refreshing || action.locked} onClick={() => void hide()}>Скрыть сообщение</Button>}
    {action.notice && <p role="status" className={styles.notice}>{action.notice}</p>}{action.locked && <Button pending={action.pending} onClick={() => void action.check()}>Перечитать сообщение</Button>}
  </article>;
}
