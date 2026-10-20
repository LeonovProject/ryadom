import { useInfiniteQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { useState, type FormEvent } from 'react';
import { api, type operations } from '../../../shared/api/client';
import { operationFailure, requestSignal, uuid } from '../../../shared/api/operation';
import { sessionEpoch } from '../../../shared/api/session-boundary';
import { formatEventStart } from '../../../shared/lib/event-time';
import { Button } from '../../../shared/ui/Button';
import { TextField } from '../../../shared/ui/Field';
import { PageTitle } from '../../../shared/ui/PageTitle';
import { StatePanel } from '../../../shared/ui/StatePanel';
import { StatusBadge } from '../../../shared/ui/StatusBadge';
import { useRefreshToken } from '../../participation/user/queries';
import { AdminBoundary } from './AdminBoundary';
import styles from './admin.module.css';
export function EventListPage() { return <AdminBoundary title="Модерация встреч"><EventList /></AdminBoundary>; }
function EventList() {
  const [params, setParams] = useSearchParams(), { token, refresh } = useRefreshToken();
  const [q, setQ] = useState(params.get('q') ?? '');
  const status = params.get('publicationStatus') ?? '', reports = params.get('hasOpenReports') ?? '';
  const organizationId = params.get('organizationId') ?? undefined, activityTypeId = params.get('activityTypeId') ?? undefined;
  const valid = ['', 'PUBLISHED', 'UNPUBLISHED'].includes(status) && ['', 'true', 'false'].includes(reports) && (!organizationId || uuid(organizationId)) && (!activityTypeId || uuid(activityTypeId)) && [...(params.get('q') ?? '')].length <= 200;
  const query: NonNullable<operations['adminListEvents']['parameters']['query']> = { limit: 20, q: params.get('q')?.trim() || undefined, publicationStatus: status as 'PUBLISHED' | 'UNPUBLISHED' || undefined, organizationId, activityTypeId, hasOpenReports: reports ? reports === 'true' : undefined };
  const feed = useInfiniteQuery({ queryKey: ['admin-events', sessionEpoch(), query, token], enabled: valid, initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam, signal }) => { const result = await api.GET('/admin/events', { params: { query: { ...query, cursor: pageParam } }, signal: requestSignal(signal), cache: 'no-store' }); if (result.response.status !== 200 || !result.data) throw operationFailure(result); return result.data; },
    getNextPageParam: (last, _pages, previous, all) => last.nextCursor && last.nextCursor !== previous && !all.includes(last.nextCursor) ? last.nextCursor : undefined, gcTime: 0, refetchOnWindowFocus: false });
  function set(key: string, value: string) { const next = new URLSearchParams(params); next.delete('cursor'); if (value) next.set(key, value); else next.delete(key); setParams(next); }
  function search(e: FormEvent) { e.preventDefault(); set('q', q.trim()); }
  const items = [...new Map((feed.data?.pages.flatMap((page) => page.items) ?? []).map((item) => [item.id, item])).values()];
  return <div className={styles.page}><PageTitle title="Модерация встреч" />
    <form className={styles.filters} onSubmit={search}><TextField label="Поиск встреч" value={q} onChange={(e) => setQ(e.target.value)} /><label className={styles.select}>Публикация<select value={status} onChange={(e) => set('publicationStatus', e.target.value)}><option value="">Все</option><option value="PUBLISHED">Опубликованы</option><option value="UNPUBLISHED">Сняты</option></select></label><label className={styles.select}>Открытые жалобы<select value={reports} onChange={(e) => set('hasOpenReports', e.target.value)}><option value="">Все встречи</option><option value="true">Есть</option><option value="false">Нет</option></select></label><Button type="submit">Найти встречи</Button></form>
    {(organizationId || activityTypeId) && <p>Применён фильтр из ссылки. <Link to="/admin/events">Все встречи</Link></p>}
    <Button variant="quiet" onClick={refresh}>Обновить список встреч</Button>
    {!valid ? <StatePanel kind="error" title="Проверь фильтры ссылки">Неизвестный статус, неверный ID или слишком длинный поиск.</StatePanel> : feed.isError && !feed.isFetchNextPageError ? <StatePanel kind="error" title="Не удалось загрузить модерацию" action={<Button onClick={refresh}>Повторить загрузку</Button>}>Данные скрыты до успешного чтения.</StatePanel> : feed.isPending ? <StatePanel kind="loading" title="Загружаем встречи" /> : <>
      {!items.length && <StatePanel kind="empty" title="По этим условиям встреч нет">Измени фильтры.</StatePanel>}
      {items.map((event) => <article className={styles.card} key={event.id}><h2><Link to={`/admin/events/${event.id}`}>{event.title}</Link></h2><StatusBadge domain="publication" status={event.publicationStatus} /><time dateTime={event.startsAt}>{formatEventStart(event)}</time><p>{event.city} · {event.activityType.name}</p><p>Жалобы на встречу: {event.openEventReportsCount} · На сообщения: {event.openMessageReportsCount}</p><Link to={`/people/${event.createdBy.id}`}>Создатель: {event.createdBy.displayName}</Link></article>)}
      {feed.isFetchNextPageError ? <StatePanel kind="error" title="Продолжение не загрузилось" action={<Button onClick={refresh}>Читать список заново</Button>}>Загруженные строки сохранены.</StatePanel> : feed.hasNextPage && <Button pending={feed.isFetchingNextPage} onClick={() => void feed.fetchNextPage()}>Ещё встречи для модерации</Button>}
    </>}
  </div>;
}
