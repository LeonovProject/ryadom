import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { formatEventStart } from '../../../shared/lib/event-time';
import { Button } from '../../../shared/ui/Button';
import { StatePanel } from '../../../shared/ui/StatePanel';
import { StatusBadge } from '../../../shared/ui/StatusBadge';
import { ResourceFailure } from '../../../shared/api/resource-query';
import { organizationEventsKey, OrganizationListFailure, uniqueOrganizationEvents, useOrganizationEvents } from './queries';
import styles from './organizations.module.css';

export function OrganizationEvents({ ownerId, organizationId }: { ownerId: string; organizationId: string }) {
  const feed = useOrganizationEvents(ownerId, organizationId);
  const client = useQueryClient();
  const items = uniqueOrganizationEvents(feed.data?.pages ?? []);
  const cursorError = feed.error instanceof OrganizationListFailure && feed.error.invalidCursor;
  const restart = () => void client.resetQueries({ queryKey: organizationEventsKey(ownerId, organizationId), exact: true });
  const hideOld = feed.isError && (!feed.isFetchNextPageError || (feed.error instanceof ResourceFailure && ![400, 500].includes(feed.error.status)));
  const initialFailure = !feed.data && feed.isError;
  return <section className={styles.card} aria-label="Встречи организации">
    <h2>Встречи организации</h2><p className={styles.muted}>Все даты, включая снятые публикации. Сначала — недавно созданные встречи.</p>
    <div><Button variant="quiet" pending={feed.isFetching} onClick={restart}>Обновить встречи</Button></div>
    {feed.isPending ? <StatePanel kind="loading" title="Загружаем встречи организации" />
      : hideOld || initialFailure ? <StatePanel kind="error" title="Не удалось загрузить встречи организации" action={<Button onClick={restart}>Повторить загрузку встреч</Button>}>Проверь доступность кабинета и соединение.</StatePanel>
        : <>
          {feed.isError && <StatePanel kind="error" title={cursorError ? 'Список встреч нужно обновить' : 'Не удалось догрузить встречи'} action={<Button onClick={cursorError ? restart : () => void feed.fetchNextPage()}>{cursorError ? 'Начать встречи заново' : 'Повторить догрузку'}</Button>}>Уже загруженные строки сохранены.</StatePanel>}
          {!items.length && !feed.isError && <p>У организации пока нет встреч.</p>}
          {items.map(({ event, canManageParticipants }) => <article key={event.id} className={styles.event}>
            <h3><Link to={`/events/${event.id}`}>{event.title}</Link></h3><StatusBadge domain="publication" status={event.publicationStatus} />
            {event.publicationStatus === 'PUBLISHED' ? <><p><time dateTime={event.startsAt}>{formatEventStart(event)}</time> · {event.timezone}</p><p className={styles.text}>{event.city} · {event.locationText}</p></>
              : <p className={styles.muted}>Публикация недоступна. Причину можно посмотреть на странице встречи.</p>}
            <div className={styles.actions}><Link to={`/events/${event.id}`}>Открыть встречу</Link>{event.publicationStatus === 'PUBLISHED' && canManageParticipants && <Link to={`/events/${event.id}/manage`}>Участники и заявки</Link>}</div>
          </article>)}
          {feed.hasNextPage && !cursorError && <Button variant="secondary" pending={feed.isFetchingNextPage} disabled={feed.isFetching} onClick={() => void feed.fetchNextPage()}>Показать ещё встречи</Button>}
        </>}
  </section>;
}
