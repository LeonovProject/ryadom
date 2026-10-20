import { useEffect, useRef } from 'react';
import { useLocation, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { sessionEpoch } from '../../../shared/api/session-boundary';
import { Button, ButtonLink } from '../../../shared/ui/Button';
import { StatePanel } from '../../../shared/ui/StatePanel';
import { CatalogFilters } from './CatalogFilters';
import { EventFeed } from './EventFeed';
import { adjacentDay, parseCatalogSearch } from './filters';
import { useActivityTypes } from './queries';
import styles from './catalog.module.css';

export function CatalogPage() {
  const [params, setParams] = useSearchParams();
  const { pathname, search } = useLocation();
  const client = useQueryClient();
  const types = useActivityTypes();
  const defaultFrom = useRef(new Date().toISOString()).current;
  const { query, error } = parseCatalogSearch(search, defaultFrom);
  useEffect(() => {
    if (!error && (!params.has('from') || params.has('cursor'))) {
      const next = new URLSearchParams(params);
      if (!next.has('from')) next.set('from', defaultFrom);
      next.delete('cursor');
      setParams(next, { replace: true });
    }
  }, [search, defaultFrom, error, params, setParams]);
  function reset() { setParams({ from: new Date().toISOString() }); }
  function restart() {
    // Retain all filters, including an explicit absolute window, but discard every cursor.
    void client.resetQueries({ queryKey: ['public', 'events', sessionEpoch(), query], exact: true });
  }
  const typeLabel = (!types.isError ? types.data : undefined)?.find((item) => item.id.toLowerCase() === query.activityTypeId?.toLowerCase())?.name ?? 'Направление из ссылки';
  let lastDay = query.dateTo;
  if (lastDay) { try { lastDay = adjacentDay(lastDay, -1); } catch { /* The exclusive year-one boundary has no displayable previous day. */ } }
  const selected = [
    query.q && `Поиск: ${query.q}`, query.city && `Город: ${query.city}`,
    query.activityTypeId && `Направление: ${typeLabel}`,
    query.joinMode && (query.joinMode === 'OPEN' ? 'Свободная запись' : 'По заявке'),
    query.dateFrom && `С ${query.dateFrom.split('-').reverse().join('.')}`, lastDay && `По ${lastDay.split('-').reverse().join('.')} включительно`,
    query.organizationId && 'Организация из ссылки', query.organizerAccountId && 'Организатор из ссылки',
    query.to && `Начало раньше ${query.to}`,
  ].filter(Boolean);
  return <div className={styles.page}>
    <div className={styles.pageHeader}>
      <div><p className={styles.eyebrow}>Компания по интересам</p><h1 tabIndex={-1}>Найти встречу</h1><p className={styles.muted}>Выбери спорт, время и компанию. Город можно оставить пустым.</p></div>
      <ButtonLink to="/events/new">Создать встречу</ButtonLink>
    </div>
    <CatalogFilters search={search} defaultFrom={defaultFrom} onApply={(value) => setParams(value)} onReset={reset} />
    {!!selected.length && <ul className={styles.chips} aria-label="Применённые фильтры">{selected.map((label) => <li key={String(label)}>{label}</li>)}</ul>}
    {error ? <StatePanel kind="error" title="Проверь фильтры в ссылке" action={<Button onClick={reset}>Сбросить фильтры</Button>}>{error}</StatePanel>
      : <section className={styles.results} aria-label="Результаты поиска">
        <div className={styles.sectionHeader}><div><h2>Встречи по выбранным условиям</h2><p className={styles.caption}>Начиная с {new Intl.DateTimeFormat('ru-RU', { timeZone: 'UTC', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(query.from!))} UTC. Ранние встречи — первыми.</p></div><Button variant="quiet" onClick={restart}>Обновить</Button></div>
        <EventFeed query={query} returnTo={`${pathname}${search}`} onRestart={restart} />
      </section>}
  </div>;
}
