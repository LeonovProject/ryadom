import { ReportButton } from '../../reports/ReportButton';
import { readEvent } from './api';
import { Discussion } from '../../discussion/Discussion';
import { JoinControl } from '../../participation/user/JoinControl';
import { useEventBoundary } from '../../participation/user/boundary';
import { useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { type components } from '../../../shared/api/client';
import { useResourceQuery } from '../../../shared/api/resource-query';
import { formatEventStart } from '../../../shared/lib/event-time';
import { Avatar } from '../../../shared/ui/Avatar';
import { Button, ButtonLink } from '../../../shared/ui/Button';
import { ResourceState } from '../../../shared/ui/ResourceState';
import { PageTitle } from '../../../shared/ui/PageTitle';
import { StatusBadge } from '../../../shared/ui/StatusBadge';
import { useSession } from '../../auth/SessionProvider';
import { catalogReturnTo } from './navigation';
import styles from './detail.module.css';


export function EventPage() {
  const { eventId = '' } = useParams();
  const location = useLocation();
  const session = useSession();
  const resource = useResourceQuery('event', eventId, readEvent);
  const backTo = catalogReturnTo(location.state);
  const event = resource.data;
  return <div className={styles.page}>
    <Link to={backTo} className={styles.back}>← К найденным встречам</Link>
    {resource.isPending || resource.isError || !event ? <ResourceState error={resource.error} loadingTitle="Открываем встречу" notFoundTitle="Встреча не найдена" retry={() => void resource.refetch()} />
      : event.publicationStatus === 'UNPUBLISHED' ? <section className={styles.unavailable}>
        <StatusBadge domain="publication" status="UNPUBLISHED" />
        <PageTitle title={event.title} />
        <h2>Публикация недоступна</h2>
        <p>Встреча снята с публикации. Новая запись и отправка сообщений недоступны.</p>
        {event.unpublishReason !== null && <div className={styles.notice}><h3>Причина снятия</h3><p className={styles.text}>{event.unpublishReason}</p></div>}
        {event.myParticipation && <div className={styles.stack}><h3>Твоя запись</h3><StatusBadge domain="participation" status={event.myParticipation.status} /><p>Сохранённый статус записи не означает доступность публикации.</p></div>}
        <ButtonLink to="/events" variant="secondary">Найти другую встречу</ButtonLink>
        <Button variant="quiet" pending={resource.isFetching} onClick={() => void resource.refetch()}>Обновить сведения</Button>
      </section>
        : <PublishedEvent key={event.id} event={event} backTo={backTo} isAdmin={session.me?.systemRole === 'ADMIN'} loggedIn={!!session.me} refreshing={resource.isFetching} refresh={() => void resource.refetch()} />}
  </div>;
}

function PublishedEvent({ event, backTo, isAdmin, loggedIn, refreshing, refresh }: { backTo: string; event: components['schemas']['PublishedEventDetail']; isAdmin: boolean; loggedIn: boolean; refreshing: boolean; refresh: () => void }) {
  useEventBoundary(event.startsAt, refresh);
  const [failedCover, setFailedCover] = useState<string | null>(null);
  const organizer = event.organizer;
  const owner = organizer.type === 'PERSONAL' ? organizer.account.displayName : organizer.organization.name;
  const ownerLink = organizer.type === 'PERSONAL' ? `/people/${organizer.account.id}` : `/organizations/${organizer.organization.id}`;
  const profileState = { eventReturnTo: `/events/${event.id}`, catalogReturnTo: backTo };
  const blocked = organizer.type === 'PERSONAL' ? organizer.account.isBlocked : organizer.ownerIsBlocked;
  const started = event.capabilities.joinBlockedReason === 'EVENT_STARTED';
  return <>
    <div className={styles.intro}>
      <Link className={styles.activity} to={`/events?${new URLSearchParams({ activityTypeId: event.activityType.id })}`}>{event.activityType.name}</Link>
      <PageTitle title={event.title} />
    </div>
    {event.coverUrl && failedCover !== event.coverUrl && <div className={styles.cover}><img src={event.coverUrl} alt="" onError={() => setFailedCover(event.coverUrl)} /></div>}
    <section className={styles.card}>
          <h2>Когда и где</h2>
          <dl className={styles.facts}>
            <div><dt>Начало</dt><dd><time dateTime={event.startsAt}>{formatEventStart(event)}</time><span className={styles.muted}>Зона встречи: {event.timezone}</span></dd></div>
            <div><dt>Город</dt><dd>{event.city}</dd></div>
            <div><dt>Место встречи</dt><dd className={styles.text}>{event.locationText}</dd></div>
          </dl>
    </section>
    <div className={styles.layout}>
      <div className={styles.content}>
        <section className={styles.card}><h2>О встрече</h2><p className={styles.text}>{event.description}</p></section>
        <section className={styles.card}><h2>Что нужно для участия</h2><p className={styles.text}>{event.conditions.trim() ? event.conditions : 'Организатор не указал дополнительных требований к подготовке и инвентарю.'}</p></section>
        {event.activityTypeReview && event.capabilities.canManageParticipants && loggedIn && <section className={styles.card}>
          <h2>Направление в общем списке</h2>
          <p>{event.activityTypeReview.catalogStatus === 'PENDING' ? 'Новое направление на проверке.' : event.activityTypeReview.catalogStatus === 'REJECTED' ? 'Направление не включено в общий список.' : 'Направление включено в общий список.'}</p>
          {event.activityTypeReview.rejectionReason && <p className={styles.text}>{event.activityTypeReview.rejectionReason}</p>}
          <p className={styles.muted}>Это не меняет публикацию встречи или возможность использовать направление.</p>
        </section>}
      </div>
      <aside className={styles.side} aria-label="Организатор и участие">
        <section className={styles.card}>
          <h2>{organizer.type === 'PERSONAL' ? 'Организатор' : 'Организация'}</h2>
          <Link to={ownerLink} state={profileState} className={styles.owner}><Avatar name={owner} url={organizer.type === 'PERSONAL' ? organizer.account.avatarUrl : null} /><span>{owner}</span></Link>
          {blocked && <p className={styles.warning}>Организатор временно недоступен.{event.joinMode === 'APPROVAL' ? ' Сейчас он не может рассмотреть заявки.' : ''}</p>}
          <Link to={ownerLink} state={profileState}>Открыть {organizer.type === 'PERSONAL' ? 'профиль' : 'страницу организации'}</Link>
        </section>
        <section className={styles.card}>
          <h2>Участие</h2>
          <StatusBadge domain="publication" status="PUBLISHED" />
          <p className={styles.mode}>{event.joinMode === 'OPEN' ? 'Свободная запись' : 'По заявке'}</p>
          <p className={styles.muted}>{event.joinMode === 'OPEN' ? 'При записи участник сразу попадает в подтверждённый состав.' : 'Заявку рассматривает организатор. До принятия она не считается подтверждённым участием.'}</p>
          <p>Подтверждённых участников: <strong>{event.confirmedCount}</strong></p>
          {event.myParticipation && <div className={styles.stack}><h3>Твоя запись</h3><StatusBadge domain="participation" status={event.myParticipation.status} />{started && event.myParticipation.status === 'PENDING' && <p className={styles.warning}>Заявка не рассмотрена до начала встречи.</p>}</div>}
          {started && <p className={styles.notice}>Встреча уже началась. Запись и решения по заявкам закрыты.</p>}
          {event.capabilities.canManageParticipants && loggedIn && <ButtonLink to={`/events/${event.id}/manage`} variant="secondary">Участники и заявки</ButtonLink>}
          {isAdmin && <ButtonLink to={`/admin/events/${event.id}`} variant="secondary">Открыть модерацию</ButtonLink>}
          <JoinControl event={event} refreshing={refreshing} /><ReportButton type="EVENT" id={event.id} own={event.capabilities.canManageParticipants} />
          <Button variant="quiet" pending={refreshing} onClick={refresh}>{refreshing ? 'Обновляем…' : 'Обновить сведения'}</Button>
        </section>
      </aside>
    </div>
    <Discussion event={event} refreshingEvent={refreshing} />
  </>;
}
