import { expect, test } from '@playwright/test';
import type { components, operations } from '../../../../shared/api/client';
import { fulfillCase, guestFixtures, httpCase } from '../../../auth/tests/http-fixtures';

const from = '2026-10-20T07:00:00Z';
const eventPage = () => httpCase('listEventsSuccess').responseBody as components['schemas']['EventPage'];
const item = (suffix: string, title: string) => ({ ...eventPage().items[0], id: `00000002-0000-4000-8000-${suffix}`, title });
async function revisit(page: import('@playwright/test').Page) {
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' }); document.dispatchEvent(new Event('visibilitychange', { bubbles: true }));
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' }); document.dispatchEvent(new Event('visibilitychange', { bubbles: true }));
  });
}
test.beforeEach(async ({ page }) => { await guestFixtures(page); });

test('text search preserves a lower-only calendar URL and browser history restores both searches', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); const queries: URL[] = [];
  await page.route('**/api/v1/events?*', async (route) => { queries.push(new URL(route.request().url())); await fulfillCase(route, 'listEventsSuccess'); });
  const search = new URLSearchParams({ from, dateFrom: '2026-11-07', city: 'Красноярск', to: '2027-01-01T00:00:00Z' });
  await page.goto(`/events?${search}`); await expect(page.getByRole('article')).toHaveCount(1);
  await expect(page.getByLabel('Первый день', { exact: true })).toBeVisible(); await expect(page.getByText(/В ссылке выбраны встречи начиная/)).toBeVisible();
  await page.getByLabel('Что интересно?').fill('шахматы'); await page.getByRole('button', { name: 'Найти встречи', exact: true }).click();
  await expect.poll(() => queries.at(-1)?.searchParams.get('q')).toBe('шахматы');
  expect(queries.at(-1)?.searchParams.has('dateTo')).toBe(false); expect(queries.at(-1)?.searchParams.get('dateFrom')).toBe('2026-11-07'); expect(queries.at(-1)?.searchParams.get('to')).toBe('2027-01-01T00:00:00Z');
  await page.getByLabel('Последний день включительно').fill('2026-11-07'); await page.getByRole('button', { name: 'Применить фильтры' }).click();
  await expect.poll(() => queries.at(-1)?.searchParams.get('dateTo')).toBe('2026-11-08');
  await page.goBack(); await expect(page.getByLabel('Последний день включительно')).toHaveValue(''); await expect(page.getByLabel('Что интересно?')).toHaveValue('шахматы');
  await page.goBack(); await expect(page.getByLabel('Что интересно?')).toHaveValue(''); await expect(page.getByLabel('Город', { exact: true })).toHaveValue('Красноярск');
});

test('an uppercase approved direction stays selected without becoming an unknown option', async ({ page }) => {
  const types = httpCase('listActivityTypesSuccess').responseBody as operations['listActivityTypes']['responses'][200]['content']['application/json'];
  types.items[0] = { ...types.items[0], id: '00000007-0000-4000-8000-abcdefabcdef' };
  await page.route('**/api/v1/activity-types', (route) => fulfillCase(route, 'listActivityTypesSuccess', { responseBody: types }));
  await page.goto(`/events?${new URLSearchParams({ from, activityTypeId: types.items[0].id.toUpperCase() })}`);
  await expect(page.getByLabel('Направление', { exact: true })).toHaveValue(types.items[0].id);
  await expect(page.getByRole('option', { name: 'Направление из ссылки' })).toHaveCount(0);
  await expect(page.getByRole('list', { name: 'Применённые фильтры' })).toContainText(types.items[0].name);
});

test('return to the tab rereads within the cache freshness interval and removes unpublished cards', async ({ page }) => {
  let visible = true; let reads = 0;
  await page.route('**/api/v1/events?*', async (route) => { reads++; await fulfillCase(route, visible ? 'listEventsSuccess' : 'emptyCatalog'); });
  await page.goto(`/events?${new URLSearchParams({ from })}`); await expect(page.getByRole('article')).toHaveCount(1);
  visible = false; const before = reads; await revisit(page);
  await expect(page.getByRole('article')).toHaveCount(0); await expect(page.getByRole('heading', { name: 'По этим условиям встреч пока нет' })).toBeVisible(); expect(reads).toBeGreaterThan(before);
});

test('a failed refresh hides stale public cards and an explicit retry uses the same filters', async ({ page }) => {
  let mode = 'populated'; const queries: URL[] = [];
  await page.route('**/api/v1/events?*', async (route) => { queries.push(new URL(route.request().url())); await fulfillCase(route, mode === 'populated' ? 'listEventsSuccess' : mode === 'error' ? 'internalError' : 'emptyCatalog'); });
  await page.goto(`/events?${new URLSearchParams({ from, city: 'Красноярск', joinMode: 'APPROVAL', dateFrom: '2026-11-07' })}`); await expect(page.getByRole('article')).toHaveCount(1);
  mode = 'error'; await revisit(page); await expect(page.getByRole('heading', { name: 'Не удалось обновить встречи' })).toBeVisible(); await expect(page.getByRole('article')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'По этим условиям встреч пока нет' })).toHaveCount(0);
  mode = 'empty'; await page.getByRole('button', { name: 'Повторить загрузку', exact: true }).click(); await expect(page.getByRole('heading', { name: 'По этим условиям встреч пока нет' })).toBeVisible();
  expect(queries.at(-1)?.searchParams.toString()).toBe(queries[0].searchParams.toString());
});

test('a failed next page keeps cards, exposes one retry and does not offer another load-more button', async ({ page }) => {
  await page.route('**/api/v1/events?*', async (route) => {
    if (new URL(route.request().url()).searchParams.has('cursor')) return fulfillCase(route, 'internalError');
    await fulfillCase(route, 'listEventsSuccess', { responseBody: { ...eventPage(), nextCursor: 'next' } });
  });
  await page.goto('/events'); await page.getByRole('button', { name: 'Показать ещё' }).click();
  await expect(page.getByRole('heading', { name: 'Не удалось обновить встречи' })).toBeVisible(); await expect(page.getByRole('article')).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Повторить загрузку', exact: true })).toHaveCount(1); await expect(page.getByRole('button', { name: 'Показать ещё' })).toHaveCount(0);
});

test('keyboard continuation focuses the first new card rather than restarting from the first page', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route('**/api/v1/events?*', async (route) => {
    const next = new URL(route.request().url()).searchParams.has('cursor');
    await fulfillCase(route, 'listEventsSuccess', { responseBody: { items: next ? [item('000000000013', 'Новая встреча')] : Array.from({ length: 12 }, (_, index) => item(String(index + 1).padStart(12, '0'), `Встреча ${index + 1}`)), nextCursor: next ? null : 'next' } });
  });
  await page.goto('/events'); const more = page.getByRole('button', { name: 'Показать ещё' }); await more.focus(); await page.keyboard.press('Enter');
  await expect(page.getByRole('link', { name: 'Новая встреча', exact: true })).toBeFocused(); await expect(page.getByRole('link', { name: 'Новая встреча', exact: true })).toBeInViewport(); await expect(page.getByRole('article')).toHaveCount(13);
});

test('pagination never steals focus after the user moves to a filter while waiting', async ({ page }) => {
  let release!: () => void; const held = new Promise<void>((resolve) => { release = resolve; });
  await page.route('**/api/v1/events?*', async (route) => {
    const next = new URL(route.request().url()).searchParams.has('cursor'); if (next) await held;
    await fulfillCase(route, 'listEventsSuccess', { responseBody: { items: [item(next ? '000000000002' : '000000000001', next ? 'Новая встреча' : 'Первая встреча')], nextCursor: next ? null : 'next' } });
  });
  await page.goto('/events'); await page.getByRole('button', { name: 'Показать ещё' }).click(); const field = page.getByLabel('Что интересно?'); await field.focus(); release();
  await expect(page.getByRole('article')).toHaveCount(2); await expect(field).toBeFocused();
});

test('a late response from an old city cannot overwrite the new search', async ({ page }) => {
  let release!: () => void; const held = new Promise<void>((resolve) => { release = resolve; }); let oldStarted = false;
  await page.route('**/api/v1/events?*', async (route) => {
    const old = new URL(route.request().url()).searchParams.get('city') === 'Красноярск';
    if (old) { oldStarted = true; await held; }
    await fulfillCase(route, 'listEventsSuccess', { responseBody: { items: [item(old ? '000000000001' : '000000000002', old ? 'Старый поиск' : 'Новый поиск')], nextCursor: null } }).catch(() => undefined);
  });
  await page.goto(`/events?${new URLSearchParams({ from, city: 'Красноярск' })}`); await expect.poll(() => oldStarted).toBe(true);
  await page.getByLabel('Город', { exact: true }).fill('Москва'); await page.getByRole('button', { name: 'Найти встречи', exact: true }).click();
  await expect(page.locator('article h3')).toHaveText(['Новый поиск']); release(); await expect(page.locator('article h3')).toHaveText(['Новый поиск']);
});

test('case-equivalent duplicates within a response fail instead of showing repeated meetings', async ({ page }) => {
  const first = item('abcdefabcdef', 'Первая встреча');
  await page.route('**/api/v1/events?*', (route) => fulfillCase(route, 'listEventsSuccess', { responseBody: { items: [first, { ...first, id: first.id.toUpperCase() }], nextCursor: null } }));
  await page.goto('/events'); await expect(page.getByRole('heading', { name: 'Не удалось загрузить встречи' })).toBeVisible(); await expect(page.getByRole('article')).toHaveCount(0);
});

test('an unpublished summary accidentally returned by a public list cannot reveal injected fields', async ({ page }) => {
  await page.route('**/api/v1/events?*', (route) => fulfillCase(route, 'listEventsSuccess', { responseBody: { items: [{ ...item('000000000001', 'CLOSED_EVENT'), publicationStatus: 'UNPUBLISHED', locationText: 'CLOSED_ADDRESS' }], nextCursor: null } }));
  await page.goto('/events'); await expect(page.getByRole('heading', { name: 'Не удалось загрузить встречи' })).toBeVisible(); await expect(page.locator('main')).not.toContainText('CLOSED_EVENT'); await expect(page.locator('main')).not.toContainText('CLOSED_ADDRESS');
});

test('failed directions refresh removes old approved choices while preserving a selected ID', async ({ page }) => {
  let fail = false; const types = httpCase('listActivityTypesSuccess').responseBody as operations['listActivityTypes']['responses'][200]['content']['application/json'];
  await page.route('**/api/v1/activity-types', (route) => fulfillCase(route, fail ? 'internalError' : 'listActivityTypesSuccess'));
  await page.clock.install(); await page.goto(`/events?${new URLSearchParams({ from, activityTypeId: types.items[0].id })}`);
  await expect(page.getByRole('option', { name: types.items[0].name, exact: true })).toBeAttached();
  fail = true; await page.clock.fastForward(31_000); await revisit(page);
  await expect(page.getByText('Не удалось загрузить направления. Другие фильтры доступны.')).toBeVisible();
  await expect(page.getByRole('option', { name: types.items[0].name, exact: true })).toHaveCount(0);
  await expect(page.getByRole('option', { name: 'Направление из ссылки', exact: true })).toBeAttached(); await expect(page.getByLabel('Направление', { exact: true })).toHaveValue(types.items[0].id);
  await expect(page.getByRole('article')).toHaveCount(1);
});

test('home field errors retain text, focus the invalid field and do not navigate', async ({ page }) => {
  await page.goto('/'); const search = page.getByLabel('Спорт или название', { exact: true }); const city = page.getByLabel('Город', { exact: true });
  await search.fill('я'.repeat(201)); await page.getByRole('button', { name: 'Найти встречи', exact: true }).click(); await expect(search).toBeFocused(); await expect(search).toHaveAccessibleDescription(/не более 200/); await expect(page).toHaveURL('/');
  await search.fill('шахматы'); await city.fill('я'.repeat(121)); await page.getByRole('button', { name: 'Найти встречи', exact: true }).click(); await expect(city).toBeFocused(); await expect(city).toHaveAccessibleDescription(/не более 120/); await expect(search).toHaveValue('шахматы');
});

test('home refreshes nearest meetings with a new absolute bound and never invents personal results', async ({ page }) => {
  const queries: URL[] = []; await page.clock.install();
  await page.route('**/api/v1/events?*', async (route) => { queries.push(new URL(route.request().url())); await fulfillCase(route, 'emptyCatalog'); });
  await page.goto('/'); await expect(page.getByRole('heading', { name: 'Пока нет ближайших встреч' })).toBeVisible(); const first = queries.at(-1)!.searchParams.get('from');
  await page.clock.fastForward(60_000); await page.getByRole('button', { name: 'Обновить ближайшие встречи', exact: true }).click();
  await expect.poll(() => queries.at(-1)!.searchParams.get('from')).not.toBe(first); expect(queries.at(-1)?.searchParams.has('city')).toBe(false);
  await expect(page.getByText('У тебя пока нет встреч')).toHaveCount(0);
});

test('home returning to a visible tab updates the absolute bound after time has passed', async ({ page }) => {
  const queries: URL[] = []; await page.clock.install();
  await page.route('**/api/v1/events?*', async (route) => { queries.push(new URL(route.request().url())); await fulfillCase(route, 'listEventsSuccess'); });
  await page.goto('/'); await expect(page.getByRole('article')).toHaveCount(1); const first = queries.at(-1)!.searchParams.get('from')!;
  await page.clock.fastForward(60_000); await revisit(page);
  await expect.poll(() => queries.at(-1)!.searchParams.get('from')).not.toBe(first);
  expect(Date.parse(queries.at(-1)!.searchParams.get('from')!)).toBeGreaterThan(Date.parse(first));
  await expect(page.getByRole('link', { name: 'Все встречи →', exact: true })).toHaveAttribute('href', `/events?${new URLSearchParams({ from: queries.at(-1)!.searchParams.get('from')! })}`);
});
