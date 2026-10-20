import { Link } from 'react-router-dom';
import type { PrivateRow } from './queries';
import { StatusBadge } from '../../../shared/ui/StatusBadge';
import { formatEventStart } from '../../../shared/lib/event-time';
import styles from './participation.module.css';

export function MeetingRow({ row, compact = false }: { row: PrivateRow; compact?: boolean }) {
  const event = row.event;
  return <article className={compact ? styles.compact : styles.card}>
    <h3><Link to={`/events/${event.id}`}>{event.title}</Link></h3>
    {event.publicationStatus === 'PUBLISHED' ? <>
      <time dateTime={event.startsAt} title={`Зона встречи: ${event.timezone}`}>{formatEventStart(event)}</time>
      <p>{event.city} · {event.locationText}</p>
      {!compact && <p className={styles.muted}>{event.joinMode === 'OPEN' ? 'Свободная запись' : 'По заявке'} · {event.activityType.name}</p>}
    </> : <><StatusBadge domain="publication" status="UNPUBLISHED" /><p>Публикация недоступна. Сохранённая запись не подтверждает доступность встречи.</p></>}
    {row.participation && <StatusBadge domain="participation" status={row.participation.status} />}
    {event.publicationStatus === 'PUBLISHED' && row.canManage && <Link to={`/events/${event.id}/manage`}>Участники и заявки</Link>}
  </article>;
}
