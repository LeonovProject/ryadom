import { Button, ButtonLink } from '../../../shared/ui/Button';
import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { sessionEpoch } from '../../../shared/api/session-boundary';
import { StatePanel } from '../../../shared/ui/StatePanel';
import type { EventQuery } from './filters';
import { EventCard } from './EventCard';
import { CatalogFailure, uniqueEvents, useEventFeed } from './queries';
import styles from './catalog.module.css';

export function EventFeed({ query, returnTo, preview = false, onRestart, emptyTitle, emptyDescription, allowCreate = true }: { query: EventQuery; returnTo?: string; preview?: boolean; onRestart?: () => void; emptyTitle?: string; emptyDescription?: string; allowCreate?: boolean }) {
  const client = useQueryClient();
  const feed = useEventFeed(query);
  const items = uniqueEvents(feed.data?.pages ?? []);
  const hasData = !!feed.data;
  const grid = useRef<HTMLDivElement>(null);
  const more = useRef<{ ids: Set<string>; scope: string; button: HTMLElement | null } | null>(null);
  const scope = JSON.stringify(query);
  useEffect(() => {
    const previous = more.current;
    if (!previous || feed.isFetchingNextPage) return;
    more.current = null;
    if (previous.scope !== scope || feed.isError || (document.activeElement !== document.body && document.activeElement !== previous.button)) return;
    const next = [...(grid.current?.querySelectorAll<HTMLElement>('[data-event-id]') ?? [])].find((card) => !previous.ids.has(card.dataset.eventId!));
    next?.querySelector<HTMLElement>('h3 a')?.focus({ preventScroll: true });
  }, [feed.isFetchingNextPage, feed.isError, feed.dataUpdatedAt, scope]);
  const restart = onRestart ?? (() => { void client.resetQueries({ queryKey: ['public', 'events', sessionEpoch(), query], exact: true }); });
  const cursorError = feed.error instanceof CatalogFailure && feed.error.code === 'INVALID_CURSOR';
  if (!hasData && feed.isPending) return <StatePanel kind="loading" title="Ищем встречи" />;
  if (!hasData && feed.isError) return <StatePanel kind="error" title="Не удалось загрузить встречи" action={<Button onClick={restart}>Повторить загрузку</Button>}>Проверь соединение и попробуй ещё раз.</StatePanel>;
  if (feed.isError && !feed.isFetchNextPageError) return <StatePanel kind="error" title="Не удалось обновить встречи" action={<Button onClick={restart}>Повторить загрузку</Button>}>Прежние карточки скрыты: их доступность могла измениться. Проверь соединение и обнови поиск.</StatePanel>;
  return <div className={styles.feed}>
    {feed.isError && <StatePanel kind="error" title={cursorError ? 'Выдачу нужно обновить' : 'Не удалось обновить встречи'}
      action={cursorError ? <Button onClick={restart}>Начать поиск заново</Button> : <Button onClick={() => { if (feed.isFetchNextPageError) void feed.fetchNextPage(); else void feed.refetch(); }}>Повторить загрузку</Button>}>
      Уже загруженные встречи сохранены. Их доступность могла измениться.
    </StatePanel>}
    {hasData && !items.length && !feed.isError && <StatePanel kind="empty" title={emptyTitle ?? (preview ? 'Пока нет ближайших встреч' : 'По этим условиям встреч пока нет')}
      action={preview ? <ButtonLink to="/events" variant="secondary">Открыть каталог</ButtonLink> : allowCreate ? <ButtonLink to="/events/new" variant="secondary">Создать встречу</ButtonLink> : undefined}>
      {emptyDescription ?? (preview ? 'Посмотри каталог или предложи свою встречу.' : 'Попробуй изменить фильтры или создай свою встречу.')}
    </StatePanel>}
    {!!items.length && <>
      {!preview && <p role="status" className={styles.muted}>Показано встреч: {items.length}{feed.isFetching && !feed.isFetchingNextPage ? ' · Обновляем…' : ''}</p>}
      <div ref={grid} className={styles.eventGrid}>{items.map((event) => <EventCard key={event.id.toLowerCase()} event={event} returnTo={returnTo} />)}</div>
    </>}
    {!preview && feed.hasNextPage && !cursorError && !feed.isFetchNextPageError && <div className={styles.loadMore}>
      <Button variant="secondary" pending={feed.isFetchingNextPage} disabled={feed.isFetching} onClick={(event) => { more.current = { ids: new Set(items.map((item) => item.id.toLowerCase())), scope, button: event.currentTarget }; void feed.fetchNextPage(); }}>{feed.isFetchingNextPage ? 'Загружаем…' : 'Показать ещё'}</Button>
    </div>}
  </div>;
}
