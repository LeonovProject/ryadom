import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { sessionEpoch } from '../../../shared/api/session-boundary';
import { Button, ButtonLink } from '../../../shared/ui/Button';
import { StatePanel } from '../../../shared/ui/StatePanel';
import { MeetingRow } from '../user/MeetingRow';
import { readParticipations } from '../user/queries';
import { nextLocalDay } from './time';
import styles from '../user/participation.module.css';

export function PersonalPlans() {
  const plans = useQuery({
    queryKey: ['personal-plans', sessionEpoch()],
    queryFn: async ({ signal }) => {
      const upcoming = await readParticipations({ status: ['CONFIRMED'], eventWindow: 'UPCOMING', limit: 3 }, signal);
      const today = await readParticipations({ status: ['CONFIRMED'], eventWindow: 'STARTED_TODAY', referenceTime: upcoming.referenceTime!, limit: 3 }, signal);
      return { upcoming, today };
    },
    refetchOnMount: 'always', refetchOnWindowFocus: 'always', gcTime: 0,
  });
  useEffect(() => {
    if (!plans.data || plans.isError || plans.isFetching) return;
    const { upcoming, today } = plans.data;
    const reference = Date.parse(upcoming.referenceTime!);
    const boundaries = upcoming.items.flatMap(({ event }) => event.publicationStatus === 'PUBLISHED' ? [Date.parse(event.startsAt)] : []);
    for (const { event } of today.items) if (event.publicationStatus === 'PUBLISHED') boundaries.push(nextLocalDay(reference, event.timezone));
    if (!boundaries.length) return;
    const delay = Math.min(...boundaries) - reference;
    const timer = setTimeout(() => void plans.refetch(), Math.min(2_147_483_647, Math.max(100, delay + 50)));
    return () => clearTimeout(timer);
  }, [plans.dataUpdatedAt, plans.isFetching, plans.isError]);
  const data = !plans.isError && !plans.isFetching ? plans.data : undefined;
  return <div className={styles.stack}>
    <div className={styles.row}><ButtonLink to="/me/events" variant="quiet">Все мои встречи</ButtonLink><Link to="/me/events?tab=applications">Мои заявки</Link><Button variant="quiet" pending={plans.isFetching} onClick={() => void plans.refetch()}>Обновить мои планы</Button></div>
    {!data ? plans.isError ? <StatePanel kind="error" title="Не удалось загрузить личные планы" action={<Button onClick={() => void plans.refetch()}>Повторить загрузку планов</Button>}>Личные записи сейчас не показаны. Каталог доступен ниже.</StatePanel> : <StatePanel kind="loading" title="Загружаем личные планы" /> : <>
      <section className={styles.stack} aria-label="Ближайшие личные встречи"><h2>Предстоящие</h2>
        {!data.upcoming.items.length && <p>Пока нет предстоящих подтверждённых встреч. <Link to="/events">Найти встречу</Link></p>}
        {data.upcoming.items.map((item) => <MeetingRow compact key={item.participation.id} row={{ event: item.event, participation: item.participation, canManage: false }} />)}
      </section>
      <section className={styles.stack} aria-label="Начались сегодня"><h2>Начались сегодня</h2>
        {!data.today.items.length ? <p className={styles.muted}>Сегодня ещё нет начавшихся подтверждённых встреч.</p> : data.today.items.map((item) => <MeetingRow compact key={item.participation.id} row={{ event: item.event, participation: item.participation, canManage: false }} />)}
        {(data.today.nextCursor || data.today.items.length > 0) && <Link to="/me/events?tab=confirmed&view=started">Все начавшиеся встречи</Link>}
      </section>
    </>}
  </div>;
}
