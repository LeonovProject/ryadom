import { useId, useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Button, ButtonLink } from '../../../shared/ui/Button';
import { TextField } from '../../../shared/ui/Field';
import { PageTitle } from '../../../shared/ui/PageTitle';
import { StatePanel } from '../../../shared/ui/StatePanel';
import { StatusBadge } from '../../../shared/ui/StatusBadge';
import { AdminGate } from './AdminGate';
import { approvalOptions, filterSearch, safeListSearch } from './filters';
import { ListFailure, uniqueOrganizations, useAdminOrganizations } from './queries';
import styles from './organizations.module.css';

export function OrganizationListPage() { return <AdminGate><OrganizationList /></AdminGate>; }
function OrganizationList() {
  const location = useLocation();
  const navigate = useNavigate();
  const client = useQueryClient();
  const { query, queryKey, filterError } = useAdminOrganizations(location.search);
  const items = query.data ? uniqueOrganizations(query.data.pages) : [];
  const denied = query.error instanceof ListFailure && (query.error.status === 401 || query.error.status === 403);
  const visible = !filterError && (!query.isError || (query.isFetchNextPageError && !denied));
  const restart = () => { void client.resetQueries({ queryKey }); };
  return <div className={styles.page}>
    <div className={styles.intro}><p className={styles.eyebrow}>Администратору</p><PageTitle title="Организации" /><p>Все профили организаций: от создания до решения о допуске.</p></div>
    <Filters key={location.search} search={location.search} apply={(search) => navigate(`/admin/organizations${search}`)} />
    {filterError ? <StatePanel kind="error" title="Проверь фильтры" action={<Button onClick={() => navigate('/admin/organizations')}>Сбросить фильтры</Button>}>{filterError.message}</StatePanel>
      : query.isPending ? <StatePanel kind="loading" title="Ищем организации" />
        : query.isError && (!query.isFetchNextPageError || denied) ? <StatePanel kind="error" title={denied ? 'Нет доступа к списку' : 'Не удалось загрузить организации'} action={<Button onClick={() => void query.refetch()}>Повторить загрузку</Button>}>Прежний список скрыт. Проверь доступ и соединение.</StatePanel> : null}
    {visible && query.isSuccess && !items.length && <StatePanel kind="empty" title="Организации не найдены">Попробуй другое название или состояние допуска.</StatePanel>}
    {visible && !!items.length && <div className={styles.list} aria-label="Список организаций">{items.map((organization) => <article className={styles.card} key={organization.id}>
      <div className={styles.row}><h2><Link to={`/admin/organizations/${organization.id}${safeListSearch(location.search)}`}>{organization.name}</Link></h2><StatusBadge domain="organization" status={organization.approvalState} /></div>
      <p className={styles.text}>{organization.description}</p><p className={styles.muted}>Создана <time dateTime={organization.createdAt}>{formatDate(organization.createdAt)}</time></p>
      <ButtonLink variant="secondary" to={`/admin/organizations/${organization.id}${safeListSearch(location.search)}`}>Открыть профиль</ButtonLink>
    </article>)}</div>}
    {visible && query.isFetchNextPageError && <StatePanel kind="error" title="Не удалось загрузить следующую страницу" action={query.error instanceof ListFailure && query.error.invalidCursor ? <Button onClick={restart}>Начать список заново</Button> : <Button onClick={() => void query.fetchNextPage()}>Повторить загрузку страницы</Button>}>Уже загруженные профили сохранены.</StatePanel>}
    {visible && query.hasNextPage && !query.isFetchNextPageError && <Button variant="secondary" pending={query.isFetching} onClick={() => void query.fetchNextPage()}>Показать ещё организации</Button>}
  </div>;
}
function Filters({ search, apply }: { search: string; apply: (search: string) => void }) {
  const params = new URLSearchParams(search);
  const [q, setQ] = useState(params.get('q') ?? '');
  const [state, setState] = useState(params.get('approvalState') ?? '');
  const [error, setError] = useState<string>();
  const id = useId();
  function submit(event: FormEvent) {
    event.preventDefault();
    try { apply(filterSearch(q, state)); setError(undefined); } catch (problem) { setError((problem as Error).message); document.getElementById(`${id}-search`)?.focus(); }
  }
  return <form className={`${styles.card} ${styles.filters}`} onSubmit={submit} noValidate aria-label="Поиск организаций">
    <TextField id={`${id}-search`} label="Поиск по профилю" type="search" hint="Название, деятельность или спортивные интересы" value={q} onChange={(event) => { setQ(event.target.value); setError(undefined); }} error={error} />
    <div className={styles.select}><label htmlFor={id}>Допуск организации</label><select id={id} value={state} onChange={(event) => setState(event.target.value)}><option value="">Все состояния</option>{approvalOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></div>
    <div className={styles.filterActions}><Button type="submit">Найти организации</Button><Button variant="quiet" onClick={() => apply('')}>Сбросить</Button></div>
  </form>;
}
export function formatDate(value: string) { return new Intl.DateTimeFormat('ru-RU', { timeZone: 'UTC', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZoneName: 'shortOffset' }).format(new Date(value)); }
