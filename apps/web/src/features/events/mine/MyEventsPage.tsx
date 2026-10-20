import { useEffect } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { PrivateGate } from '../../participation/user/PrivateGate';
import { MeetingRow } from '../../participation/user/MeetingRow';
import { privateRows, usePrivateEvents, useRefreshToken, type ParticipationQuery } from '../../participation/user/queries';
import { Button, ButtonLink } from '../../../shared/ui/Button';
import { StatePanel } from '../../../shared/ui/StatePanel';
import { PageTitle } from '../../../shared/ui/PageTitle';
import { uuid } from '../../../shared/api/operation';
import styles from '../../participation/user/participation.module.css';

export function MyEventsPage() {
  return <div className={styles.page}><PageTitle title="Мои встречи" /><PrivateGate><MyEvents /></PrivateGate></div>;
}
function MyEvents() {
  const [params] = useSearchParams();
  const tab = params.get('tab') ?? 'confirmed', view = params.get('view') ?? 'upcoming';
  const organization = params.get('organizationId') ?? undefined;
  const valid = ['confirmed', 'applications', 'created'].includes(tab) && (tab !== 'confirmed' || ['upcoming', 'started', 'all'].includes(view)) && (!organization || uuid(organization));
  const query: ParticipationQuery = tab === 'applications' ? { status: ['PENDING', 'REJECTED'], limit: 12 } : { status: ['CONFIRMED'], limit: 12, ...(view !== 'all' ? { eventWindow: view === 'started' ? 'STARTED' as const : 'UPCOMING' as const } : {}) };
  return <>
    <nav className={styles.tabs} aria-label="Разделы моих встреч">{[['confirmed', 'Участвую'], ['applications', 'Заявки'], ['created', 'Организую']].map(([key, label]) => <Link key={key} to={`/me/events?tab=${key}`} aria-current={tab === key ? 'page' : undefined}>{label}</Link>)}</nav>
    {tab === 'confirmed' && <nav className={styles.tabs} aria-label="Время моих встреч">{[['upcoming', 'Предстоящие'], ['started', 'Начавшиеся'], ['all', 'Все записи']].map(([key, label]) => <Link key={key} to={`/me/events?tab=confirmed&view=${key}`} aria-current={view === key ? 'page' : undefined}>{label}</Link>)}</nav>}
    {!valid ? <StatePanel kind="error" title="Проверь ссылку на свои встречи" action={<ButtonLink to="/me/events">Открыть предстоящие</ButtonLink>}>В ссылке неизвестный раздел или фильтр.</StatePanel>
      : <MyFeed key={`${tab}:${view}:${organization}`} tab={tab} view={view} query={query} organization={organization} />}
  </>;
}
function MyFeed({ tab, view, query, organization }: { tab: string; view: string; query: ParticipationQuery; organization?: string }) {
  const { token, refresh } = useRefreshToken();
  const feed = usePrivateEvents(query, tab === 'created', organization, token);
  const rows = privateRows(feed.data?.pages ?? []);
  const first = feed.data?.pages[0];
  useEffect(() => {
    if (tab !== 'confirmed' || view !== 'upcoming' || !first?.referenceTime || feed.isError) return;
    const nearest = rows.find((row) => row.event.publicationStatus === 'PUBLISHED')?.event;
    if (!nearest || nearest.publicationStatus !== 'PUBLISHED') return;
    const delay = Date.parse(nearest.startsAt) - Date.parse(first.referenceTime);
    const timer = setTimeout(refresh, Math.min(2_147_483_647, Math.max(100, delay + 50)));
    return () => clearTimeout(timer);
  }, [feed.dataUpdatedAt, tab, view, first?.referenceTime, refresh]);
  const title = tab === 'created' ? 'Встречи, которые ты организуешь' : tab === 'applications' ? 'Заявки и решения' : view === 'started' ? 'Начавшиеся встречи' : view === 'all' ? 'Все сохранённые записи' : 'Предстоящие встречи';
  return <section className={styles.stack} aria-label={title}>
    <div className={styles.row}><h2>{title}</h2><Button variant="quiet" onClick={refresh} pending={feed.isFetching && !feed.isFetchingNextPage}>Обновить мои встречи</Button>{tab === 'created' && <ButtonLink to="/events/new">Создать встречу</ButtonLink>}</div>
    {tab === 'applications' && <p className={styles.muted}>Ожидающие и отклонённые заявки. После принятия встреча появится в «Участвую».</p>}
    {view === 'started' && tab === 'confirmed' && <p className={styles.muted}>Начало не означает завершение встречи или подтверждённое посещение.</p>}
    {!feed.data && feed.isPending ? <StatePanel kind="loading" title="Загружаем свои встречи" />
      : feed.isError && !feed.isFetchNextPageError ? <StatePanel kind="error" title="Не удалось загрузить свои встречи" action={<Button onClick={refresh}>Повторить загрузку</Button>}>Прежние данные скрыты. Обнови сведения, чтобы проверить доступность.</StatePanel>
        : <>
          {!rows.length && <StatePanel kind="empty" title={tab === 'applications' ? 'Пока нет заявок' : 'В этом разделе пока нет встреч'} action={<ButtonLink to="/events" variant="secondary">Найти встречу</ButtonLink>}>Попробуй другой раздел или найди новую встречу.</StatePanel>}
          <div className={styles.grid}>{rows.map((row) => <MeetingRow key={row.event.id} row={row} />)}</div>
          {feed.isFetchNextPageError && <StatePanel kind="error" title="Не удалось продолжить список" action={<Button onClick={refresh}>Обновить список с начала</Button>}>Загруженные записи сохранены. Начни чтение заново, чтобы получить актуальные страницы.</StatePanel>}
          {feed.hasNextPage && !feed.isError && <Button pending={feed.isFetchingNextPage} disabled={feed.isFetching} onClick={() => void feed.fetchNextPage()}>Показать ещё мои встречи</Button>}
        </>}
  </section>;
}
