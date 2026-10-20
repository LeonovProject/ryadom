import { useEffect, useLayoutEffect, useRef } from 'react';
import { ResourceFailure } from '../api/resource-query';
import { Button, ButtonLink } from './Button';
import { StatePanel } from './StatePanel';

export function ResourceState({ error, loadingTitle, notFoundTitle, retry }: { error: unknown; loadingTitle: string; notFoundTitle: string; retry: () => void }) {
  const status = error instanceof ResourceFailure ? error.status : 0;
  const headingRef = useRef<HTMLHeadingElement>(null);
  const title = !error ? loadingTitle : status === 404 ? notFoundTitle : status === 401 ? 'Нужно проверить текущий вход' : status === 403 ? 'Нет доступа к странице' : 'Не удалось загрузить страницу';
  useEffect(() => { document.title = `${title} — Рядом`; }, [title]);
  useLayoutEffect(() => {
    const heading = headingRef.current;
    const main = heading?.closest('main');
    return () => {
      if (heading !== document.activeElement) return;
      // Keep SPA keyboard focus when the loading heading is replaced by real data.
      requestAnimationFrame(() => {
        if (document.activeElement === document.body) main?.querySelector<HTMLElement>('h1')?.focus({ preventScroll: true });
      });
    };
  }, []);
  return <div style={{ display: 'grid', gap: 'var(--space-6)' }}>
    <h1 ref={headingRef} tabIndex={-1}>{title}</h1>
    {!error ? <StatePanel kind="loading" title="Загружаем данные" />
      : status === 404 ? <StatePanel kind="unavailable" title="Проверь ссылку" action={<ButtonLink to="/events" variant="secondary">Найти другую встречу</ButtonLink>}>Страница отсутствует или недоступна по этой ссылке.</StatePanel>
        : <StatePanel kind="error" title="Данные сейчас недоступны" action={<Button onClick={retry}>Повторить загрузку</Button>}>Проверь соединение или попробуй открыть страницу позже.</StatePanel>}
  </div>;
}
