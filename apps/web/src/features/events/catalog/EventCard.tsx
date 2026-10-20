import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { components } from '../../../shared/api/client';
import { formatEventStart } from '../../../shared/lib/event-time';
import { Avatar } from '../../../shared/ui/Avatar';
import { ButtonLink } from '../../../shared/ui/Button';
import markUrl from '../../../../../../brandbook/assets/mark.svg';
import styles from './catalog.module.css';

export function EventCard({ event, returnTo }: { event: components['schemas']['PublishedEventSummary']; returnTo?: string }) {
  const [failedCover, setFailedCover] = useState<string | null>(null);
  const organizer = event.organizer;
  const owner = organizer.type === 'PERSONAL' ? organizer.account.displayName : organizer.organization.name;
  const ownerLink = organizer.type === 'PERSONAL' ? `/people/${organizer.account.id}` : `/organizations/${organizer.organization.id}`;
  const blocked = organizer.type === 'PERSONAL' ? organizer.account.isBlocked : organizer.ownerIsBlocked;
  const target = `/events/${encodeURIComponent(event.id)}`;
  const state = returnTo ? { catalogReturnTo: returnTo } : undefined;
  return <article className={styles.eventCard}>
    <div className={styles.cover}>
      {event.coverUrl && failedCover !== event.coverUrl ? <img src={event.coverUrl} alt="" loading="lazy" onError={() => setFailedCover(event.coverUrl)} /> : <img className={styles.coverMark} src={markUrl} alt="" />}
      <span className={styles.activity}>{event.activityType.name}</span>
    </div>
    <div className={styles.eventBody}>
      <h3><Link to={target} state={state}>{event.title}</Link></h3>
      <time dateTime={event.startsAt} title={`Зона встречи: ${event.timezone}`} className={styles.time}>{formatEventStart(event)}</time>
      <p className={styles.muted}>{event.city} · {event.locationText}</p>
      <p className={styles.mode}>{event.joinMode === 'OPEN' ? 'Свободная запись' : 'По заявке'}</p>
      <Link to={ownerLink} className={styles.organizer}>
        <Avatar name={owner} url={organizer.type === 'PERSONAL' ? organizer.account.avatarUrl : null} />
        <span><small>{organizer.type === 'PERSONAL' ? 'Организатор' : 'Организация'}</small>{owner}</span>
      </Link>
      {blocked && <p className={styles.blocked}>Организатор временно недоступен</p>}
      <ButtonLink to={target} state={state} variant="secondary">Открыть встречу</ButtonLink>
    </div>
  </article>;
}
