import { expect, test, type Page } from '@playwright/test';
import { fulfillCase, guestFixtures, httpCase } from '../../../auth/tests/http-fixtures';
import type { components } from '../../../../shared/api/client';

const from = '2026-10-20T07:00:00Z';
const type = '00000007-0000-4000-8000-000000000005';
function eventsFixture(): components['schemas']['EventPage'] {
  return httpCase('listEventsSuccess').responseBody as components['schemas']['EventPage'];
}
function eventItem(id: number, title: string, changes?: Partial<components['schemas']['PublishedEventSummary']>) {
  return { ...eventsFixture().items[0], id: `00000002-0000-4000-8000-${String(id).padStart(12, '0')}`, title, ...changes };
}
async function assertNoOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}

test.beforeEach(async ({ page }) => { await guestFixtures(page); });

test('guest home reads real API lists, searches without forcing a city and links by approved type ID', async ({ page }) => {
  const requests: URL[] = [];
  page.on('request', (request) => { if (new URL(request.url()).pathname === '/api/v1/events') requests.push(new URL(request.url())); });
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Найди компанию');
  await expect(page.getByRole('article')).toHaveCount(1);
  await expect(page.getByRole('link', { name: 'Бег', exact: true })).toHaveAttribute('href', /activityTypeId=00000007-0000-4000-8000-000000000002/);
  await page.getByLabel('Спорт или название', { exact: true }).fill('шахматы');
  await page.getByRole('button', { name: 'Найти встречи', exact: true }).click();
  await expect(page).toHaveURL(/\/events\?/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Найти встречу');
  await expect.poll(() => requests.at(-1)?.searchParams.get('q')).toBe('шахматы');
  expect(requests.at(-1)?.searchParams.has('city')).toBe(false);
  expect(requests.at(-1)?.searchParams.get('from')).toBeTruthy();
});

test('signed-in home reads personal plans independently from the public catalog', async ({ page }) => {
  const requests: string[] = [];
  page.on('request', (request) => requests.push(new URL(request.url()).pathname));
  await page.route('**/api/v1/me', (route) => fulfillCase(route, 'getMeSuccess'));
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Мои встречи');
  await expect(page.getByRole('link', { name: 'Все мои встречи', exact: true })).toHaveAttribute('href', '/me/events');
  await expect(page.getByRole('heading', { name: 'Найти новую встречу' })).toBeVisible();
  await expect(page.getByRole('article')).toHaveCount(1);
  await expect(page.getByText('Пока нет предстоящих подтверждённых встреч.', { exact: false })).toBeVisible();
  expect(requests.some((path) => path.includes('participations'))).toBe(true);
  await expect(page.getByText('У тебя пока нет встреч')).toHaveCount(0);
});

test('mobile filters preserve unknown direction and dates on search, omit empty city and keep the panel open', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const requests: URL[] = [];
  await page.route('**/api/v1/events?*', async (route) => { requests.push(new URL(route.request().url())); await fulfillCase(route, 'searchFindsRejectedActivityType'); });
  const params = new URLSearchParams({ from, activityTypeId: type, joinMode: 'APPROVAL', dateFrom: '2026-11-07', dateTo: '2026-11-10', city: 'Красноярск' });
  await page.goto(`/events?${params}`);
  await expect(page.getByRole('button', { name: 'Фильтры', exact: true })).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByLabel('Направление', { exact: true })).toHaveValue(type);
  await expect(page.getByRole('option', { name: 'Направление из ссылки' })).toHaveCount(1);
  await expect(page.getByLabel('Последний день включительно')).toHaveValue('2026-11-09');
  await page.getByLabel('Что интересно?').fill('Сапбординг');
  await page.getByLabel('Город', { exact: true }).fill('');
  await page.getByRole('button', { name: 'Найти встречи', exact: true }).click();
  await expect.poll(() => requests.at(-1)?.searchParams.get('q')).toBe('Сапбординг');
  const query = requests.at(-1)!.searchParams;
  expect(query.has('city')).toBe(false);
  expect(query.get('dateTo')).toBe('2026-11-10'); expect(query.get('dateFrom')).toBe('2026-11-07');
  expect(query.get('activityTypeId')).toBe(type); expect(query.get('joinMode')).toBe('APPROVAL'); expect(query.get('from')).toBe(from);
  await expect(page.getByRole('button', { name: 'Фильтры', exact: true })).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByLabel('Режим записи', { exact: true })).toBeVisible();
});

test('local date range is sent without timezone conversion in a Los Angeles browser', async ({ page }) => {
  const requests: URL[] = [];
  await page.route('**/api/v1/events?*', async (route) => { requests.push(new URL(route.request().url())); await fulfillCase(route, 'eventsLocalDateIncludesPreviousUtcDay'); });
  await page.goto(`/events?${new URLSearchParams({ from })}`);
  await page.getByLabel('Первый день', { exact: true }).fill('2026-11-07');
  await page.getByRole('button', { name: 'Применить фильтры' }).click();
  await expect.poll(() => requests.at(-1)?.searchParams.get('dateTo')).toBe('2026-11-08');
  expect(requests.at(-1)?.searchParams.get('dateFrom')).toBe('2026-11-07');
  expect(requests.at(-1)?.searchParams.get('from')).toBe(from);
  await expect(page.locator('article time')).toContainText('7 ноября 2026 г. в 01:00 GMT+7');
  await page.getByLabel('Последний день включительно').fill('2026-11-09');
  await page.getByRole('button', { name: 'Применить фильтры' }).click();
  await expect.poll(() => requests.at(-1)?.searchParams.get('dateTo')).toBe('2026-11-10');
  await page.getByLabel('Первый день', { exact: true }).fill('2026-11-11');
  await page.getByRole('button', { name: 'Применить фильтры' }).click();
  await expect(page.getByRole('alert')).toContainText('Последний день не может быть раньше первого');
});

test('pagination keeps server order, deduplicates IDs across pages, and resets cursor after filter change', async ({ page }) => {
  const requests: URL[] = [];
  await page.route('**/api/v1/events?*', async (route) => {
    const url = new URL(route.request().url()); requests.push(url);
    const cursor = url.searchParams.get('cursor');
    await fulfillCase(route, 'listEventsSuccess', { responseBody: cursor ? { items: [eventItem(1, 'Первая обновлена'), eventItem(2, 'Вторая встреча')], nextCursor: null } : { items: [eventItem(1, 'Первая встреча')], nextCursor: 'opaque/+cursor==' } });
  });
  await page.goto(`/events?${new URLSearchParams({ from })}`);
  await expect(page.getByRole('article')).toHaveCount(1);
  await page.getByRole('button', { name: 'Показать ещё' }).click();
  await expect(page.getByRole('article')).toHaveCount(2);
  await expect(page.locator('article h3')).toHaveText(['Первая обновлена', 'Вторая встреча']);
  expect(requests.at(-1)?.searchParams.get('cursor')).toBe('opaque/+cursor==');
  await expect(page.getByRole('button', { name: 'Показать ещё' })).toHaveCount(0);
  await page.getByLabel('Город', { exact: true }).fill('Москва');
  await page.getByRole('button', { name: 'Найти встречи', exact: true }).click();
  await expect.poll(() => requests.at(-1)?.searchParams.get('city')).toBe('Москва');
  expect(requests.at(-1)?.searchParams.has('cursor')).toBe(false);
  expect(requests.at(-1)?.searchParams.get('from')).toBe(from);
  await expect(page.getByRole('article')).toHaveCount(1);
});

test('initial loading, failed first page and empty search have distinct states', async ({ page }) => {
  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  let ready = false;
  await page.route('**/api/v1/events?*', async (route) => { await held; await fulfillCase(route, ready ? 'emptyCatalog' : 'internalError'); });
  await page.goto(`/events?${new URLSearchParams({ from })}`);
  await expect(page.getByRole('heading', { name: 'Ищем встречи', exact: true })).toBeVisible();
  await expect(page.getByText('По этим условиям встреч пока нет')).toHaveCount(0);
  release();
  await expect(page.getByRole('heading', { name: 'Не удалось загрузить встречи', exact: true })).toBeVisible();
  ready = true;
  await page.getByRole('button', { name: 'Повторить загрузку', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'По этим условиям встреч пока нет' })).toBeVisible();
});

test('failed next page retains previous cards; invalid cursor explicitly restarts the first page', async ({ page }) => {
  let nextAttempt = 0;
  let restarted = false;
  await page.route('**/api/v1/events?*', async (route) => {
    const cursor = new URL(route.request().url()).searchParams.get('cursor');
    if (cursor) { nextAttempt++; await fulfillCase(route, nextAttempt === 1 ? 'internalError' : 'invalidCursor'); }
    else await fulfillCase(route, 'listEventsSuccess', { responseBody: { items: [eventItem(restarted ? 2 : 1, restarted ? 'Свежий поиск' : 'Сохранённая встреча')], nextCursor: restarted ? null : 'opaque-first' } });
  });
  await page.goto(`/events?${new URLSearchParams({ from })}`);
  await page.getByRole('button', { name: 'Показать ещё' }).click();
  await expect(page.getByRole('alert')).toContainText('Уже загруженные встречи сохранены');
  await expect(page.locator('article h3')).toHaveText(['Сохранённая встреча']);
  await page.getByRole('button', { name: 'Повторить загрузку', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Выдачу нужно обновить' })).toBeVisible();
  restarted = true;
  await page.getByRole('button', { name: 'Начать поиск заново' }).click();
  await expect(page.locator('article h3')).toHaveText(['Свежий поиск']);
  expect(nextAttempt).toBe(2);
});

test('directions can fail or be empty without blocking search', async ({ page }) => {
  let fail = true;
  await page.route('**/api/v1/activity-types', (route) => fail ? route.abort('failed') : fulfillCase(route, 'noApprovedActivityTypes'));
  await page.goto('/events');
  await expect(page.getByText('Не удалось загрузить направления. Другие фильтры доступны.')).toBeVisible();
  await expect(page.getByRole('article')).toHaveCount(1);
  fail = false;
  await page.getByRole('button', { name: 'Повторить загрузку направлений' }).click();
  await expect(page.getByText('В списке пока нет направлений. Можно искать по названию.')).toBeVisible();
  await page.getByLabel('Что интересно?').fill('бег');
  await page.getByRole('button', { name: 'Найти встречи', exact: true }).click();
  await expect(page).toHaveURL(/q=/);
});

test('malformed URL blocks the feed until reset; externally supplied cursor is not trusted', async ({ page }) => {
  const requests: URL[] = [];
  page.on('request', (request) => { if (new URL(request.url()).pathname === '/api/v1/events') requests.push(new URL(request.url())); });
  await page.goto('/events?dateFrom=2026-02-30');
  await expect(page.getByRole('heading', { name: 'Проверь фильтры в ссылке' })).toBeVisible();
  expect(requests).toHaveLength(0);
  await page.getByRole('button', { name: 'Сбросить фильтры', exact: true }).last().click();
  await expect(page.getByRole('article')).toHaveCount(1);
  await page.goto(`/events?${new URLSearchParams({ from, cursor: 'foreign-scope' })}`);
  await expect(page).not.toHaveURL(/cursor=/);
  expect(requests.every((url) => !url.searchParams.has('cursor'))).toBe(true);
});

test('opening a card and returning restores exact catalog filters', async ({ page }) => {
  const params = new URLSearchParams({ from, city: 'Красноярск', joinMode: 'APPROVAL' });
  await page.goto(`/events?${params}`);
  const url = page.url();
  await page.getByRole('link', { name: 'Открыть встречу', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Первое знакомство с петанком');
  await page.getByRole('link', { name: '← К найденным встречам' }).click();
  await expect(page).toHaveURL(url);
  await expect(page.getByLabel('Город', { exact: true })).toHaveValue('Красноярск');
  await expect(page.getByLabel('Режим записи', { exact: true })).toHaveValue('APPROVAL');
});

for (const width of [320, 390, 768, 1280]) {
  test(`home and catalog layout, safe text and organizer variants at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const payload = { items: [
      eventItem(1, 'Первое знакомство с петанком', { startsAt: '2026-11-06T18:00:00Z' }),
      eventItem(2, 'Шахматы без спешки — для всех, кто хочет попробовать', { joinMode: 'OPEN', organizer: { type: 'ORGANIZATION', organization: { id: '00000003-0000-4000-8000-000000000001', name: 'Шахматный клуб «Ход конём»' }, ownerIsBlocked: true } }),
      eventItem(3, '<script>это название</script>', { locationText: 'Длинное описание места встречи у центрального входа, рядом с остановкой и пешеходной дорожкой.' }),
    ], nextCursor: null } satisfies components['schemas']['EventPage'];
    await page.route('**/api/v1/events?*', (route) => fulfillCase(route, 'listEventsSuccess', { responseBody: payload }));
    await page.goto('/');
    await expect(page.getByRole('article')).toHaveCount(3);
    await page.evaluate(() => document.fonts.ready);
    await assertNoOverflow(page);
    await page.screenshot({ path: `.artifacts/fe-03/home-${width}.png`, fullPage: true });
    await page.goto(`/events?${new URLSearchParams({ from, joinMode: 'OPEN' })}`);
    if (width <= 600) await expect(page.getByRole('button', { name: 'Фильтры', exact: true })).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByRole('article')).toHaveCount(3);
    await expect(page.getByRole('heading', { name: '<script>это название</script>' })).toBeVisible();
    await expect(page.getByText('Организатор временно недоступен', { exact: true })).toBeVisible();
    await assertNoOverflow(page);
    await page.screenshot({ path: `.artifacts/fe-03/catalog-${width}.png`, fullPage: true });
    expect(errors).toEqual([]);
  });
}
