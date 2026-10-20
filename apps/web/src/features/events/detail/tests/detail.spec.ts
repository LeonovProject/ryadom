import { expect, test, type Page } from '@playwright/test';
import { fulfillCase, guestFixtures, httpCase, meFixture } from '../../../auth/tests/http-fixtures';
import type { components } from '../../../../shared/api/client';

const eventId = '00000002-0000-4000-8000-000000000001';
const personId = '00000001-0000-4000-8000-000000000001';
const organizationId = '00000003-0000-4000-8000-000000000001';
const eventPath = `/events/${eventId}`;
const personPath = `/people/${personId}`;
const organizationPath = `/organizations/${organizationId}`;
function published(): components['schemas']['PublishedEventDetail'] { return httpCase('getEventSuccess').responseBody as components['schemas']['PublishedEventDetail']; }

async function setMe(page: Page, role: 'USER' | 'ADMIN' = 'USER') {
  const me = meFixture(); me.systemRole = role;
  await page.route('**/api/v1/me', (route) => fulfillCase(route, 'getMeSuccess', { responseBody: me }));
  return me;
}

async function returnToTab(page: Page) {
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    document.dispatchEvent(new Event('visibilitychange', { bubbles: true }));
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    document.dispatchEvent(new Event('visibilitychange', { bubbles: true }));
  });
}

test.beforeEach(async ({ page }) => { await guestFixtures(page); });

test('published detail shows local time, content, organizer and confirmed count without business mutations', async ({ page }) => {
  const methods: string[] = [];
  page.on('request', (request) => { if (request.url().includes('/api/v1/')) methods.push(request.method()); });
  await page.route(`**/api/v1/events/${eventId}`, (route) => fulfillCase(route, 'getEventSuccess', { responseBody: { ...published(), startsAt: '2026-11-06T18:00:00Z', conditions: '' } }));
  await page.goto(eventPath);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Первое знакомство с петанком');
  await expect(page).toHaveTitle('Первое знакомство с петанком — Рядом');
  await expect(page.locator('time')).toHaveText('7 ноября 2026 г. в 01:00 GMT+7');
  await expect(page.getByText('Зона встречи: Asia/Krasnoyarsk')).toBeVisible();
  await expect(page.getByText('Организатор не указал дополнительных требований к подготовке и инвентарю.')).toBeVisible();
  await expect(page.getByText('Подтверждённых участников:', { exact: false })).toContainText('2');
  await expect(page.getByRole('link', { name: 'Открыть профиль', exact: true })).toHaveAttribute('href', '/people/00000001-0000-4000-8000-000000000002');
  await expect(page.getByRole('button', { name: 'Присоединиться' })).toHaveCount(0);
  await expect(page.getByRole('textbox')).toHaveCount(0);
  expect(methods.every((method) => method === 'GET')).toBe(true);
});

for (const fixture of ['unpublishedForParticipant', 'unpublishedForAuthor']) {
  test(`unavailable detail ${fixture} renders only its allowed variant`, async ({ page }) => {
    await setMe(page);
    const data = httpCase(fixture).responseBody as components['schemas']['UnavailableEventDetail'];
    await page.route(`**/api/v1/events/${eventId}`, (route) => fulfillCase(route, fixture, { responseBody: { ...data, city: 'SECRET_CITY', locationText: 'SECRET_PLACE', description: 'SECRET_DESCRIPTION', coverUrl: '/secret-cover.svg', startsAt: '2026-11-07T05:00:00Z' } }));
    const images: string[] = [];
    page.on('request', (request) => { if (request.url().includes('secret-cover')) images.push(request.url()); });
    await page.goto(eventPath);
    await expect(page.getByRole('heading', { name: 'Публикация недоступна' })).toBeVisible();
    await expect(page.locator('main')).not.toContainText('SECRET_');
    await expect(page.locator('main time')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Когда и где' })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'О встрече', exact: true })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Участники и заявки', exact: true })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Открыть модерацию' })).toHaveCount(0);
    if (data.unpublishReason) await expect(page.getByText(data.unpublishReason, { exact: true })).toBeVisible();
    else { await expect(page.getByRole('heading', { name: 'Причина снятия' })).toHaveCount(0); await expect(page.getByText('Заявка отправлена', { exact: true })).toBeVisible(); }
    expect(images).toEqual([]);
  });
}

test('published to unavailable replaces cached details, then 404 removes the previous title and reason', async ({ page }) => {
  await setMe(page);
  let state: 'published' | 'unpublished' | 'missing' = 'published';
  await page.route(`**/api/v1/events/${eventId}`, (route) => fulfillCase(route, state === 'published' ? 'getEventSuccess' : state === 'unpublished' ? 'unpublishedForAuthor' : 'unpublishedForStranger'));
  await page.goto(eventPath);
  await expect(page.getByRole('heading', { name: 'Когда и где' })).toBeVisible();
  state = 'unpublished';
  await returnToTab(page);
  await expect(page.getByRole('heading', { name: 'Публикация недоступна' })).toBeVisible();
  await expect(page.getByText('У входа в парк', { exact: true })).toHaveCount(0);
  state = 'missing';
  await returnToTab(page);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Встреча не найдена');
  await expect(page.locator('main')).not.toContainText('Первое знакомство');
  await expect(page.locator('main')).not.toContainText('некорректные условия');
});

test('server start boundary preserves pending application and author read access', async ({ page }) => {
  await setMe(page);
  await page.route(`**/api/v1/events/${eventId}`, (route) => fulfillCase(route, 'pendingApplicationAfterStartUnchanged'));
  await page.goto(eventPath);
  await expect(page.getByText('Заявка отправлена', { exact: true })).toBeVisible();
  await expect(page.getByText('Заявка не рассмотрена до начала встречи.')).toBeVisible();
  await expect(page.getByText('Встреча уже началась. Запись и решения по заявкам закрыты.')).toBeVisible();
  await page.route(`**/api/v1/events/${eventId}`, (route) => fulfillCase(route, 'authorAtExactStartCanReadParticipants'));
  await page.getByRole('button', { name: 'Обновить сведения' }).click();
  await expect(page.getByRole('link', { name: 'Участники и заявки', exact: true })).toHaveAttribute('href', `${eventPath}/manage`);
  await expect(page.getByRole('button', { name: 'Принять', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Отклонить', exact: true })).toHaveCount(0);
});

test('activity review is only shown for author capabilities; ADMIN does not gain participant management', async ({ page }) => {
  await setMe(page);
  await page.route(`**/api/v1/events/${eventId}`, (route) => fulfillCase(route, 'rejectedActivityTypeVisibleToEventAuthor'));
  await page.goto(eventPath);
  await expect(page.getByRole('heading', { name: 'Направление в общем списке' })).toBeVisible();
  await expect(page.getByText('Не включаем этот вариант в общий справочник.')).toBeVisible();
  await setMe(page, 'ADMIN');
  await page.route(`**/api/v1/events/${eventId}`, (route) => fulfillCase(route, 'getEventSuccess'));
  await returnToTab(page);
  await expect(page.getByRole('link', { name: 'Открыть модерацию' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Участники и заявки', exact: true })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Направление в общем списке' })).toHaveCount(0);
  await expect(page.getByText('Не включаем этот вариант в общий справочник.')).toHaveCount(0);
});

test('event loading, server failure and explicit retry never show a fake success', async ({ page }) => {
  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  let success = false;
  await page.route(`**/api/v1/events/${eventId}`, async (route) => {
    await held;
    if (success) await fulfillCase(route, 'getEventSuccess');
    else await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'SERVICE_UNAVAILABLE', message: 'Unavailable', requestId: 'fixture', fieldErrors: {} } }) });
  });
  await page.goto(eventPath);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Открываем встречу');
  release();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Не удалось загрузить страницу');
  await expect(page.getByText('У входа в парк', { exact: true })).toHaveCount(0);
  success = true;
  await page.getByRole('button', { name: 'Повторить загрузку' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Первое знакомство с петанком');
});

test('403 on optional-session detail clears personal cache and still allows a guest read', async ({ page }) => {
  let blocked = false;
  let guest = false;
  await setMe(page);
  await page.route(`**/api/v1/events/${eventId}`, async (route) => {
    if (blocked && !guest) { guest = true; await fulfillCase(route, 'getEventAccountBlocked'); }
    else await fulfillCase(route, 'getEventSuccess');
  });
  await page.goto(eventPath);
  await expect(page.getByRole('link', { name: 'Личный профиль: Анна' })).toBeVisible();
  await page.evaluate(async () => { const modulePath = '/src/app/App.tsx'; const { queryClient } = await import(modulePath); queryClient.setQueryData(['private-detail-test'], 'private'); });
  blocked = true;
  await page.getByRole('button', { name: 'Обновить сведения' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Аккаунт заблокирован' })).toBeVisible();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Первое знакомство с петанком');
  expect(await page.evaluate(async () => { const modulePath = '/src/app/App.tsx'; const { queryClient } = await import(modulePath); return queryClient.getQueryData(['private-detail-test']); })).toBeUndefined();
  await expect(page.getByRole('link', { name: 'Личный профиль: Анна' })).toHaveCount(0);
});

test('public person requests only authored public events and ignores unrelated private properties', async ({ page }) => {
  const queries: URL[] = [];
  await page.route(`**/api/v1/accounts/${personId}`, (route) => fulfillCase(route, 'publicProfileWithPreset', { responseBody: { ...(httpCase('publicProfileWithPreset').responseBody as object), email: 'PRIVATE_EMAIL', systemRole: 'ADMIN', moderationStatus: 'PRIVATE_REVIEW' } }));
  await page.route('**/api/v1/events?*', async (route) => { queries.push(new URL(route.request().url())); await fulfillCase(route, 'emptyCatalog'); });
  await page.goto(personPath);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Алексей');
  await expect(page.getByRole('heading', { name: 'Пока нет опубликованных встреч' })).toBeVisible();
  expect(queries.at(-1)?.searchParams.get('organizerAccountId')).toBe(personId);
  expect(queries.at(-1)?.searchParams.has('organizationId')).toBe(false);
  expect(queries.at(-1)?.searchParams.has('from')).toBe(false);
  await expect(page.locator('main')).not.toContainText('PRIVATE_');
  await expect(page.getByRole('link', { name: 'Личный кабинет', exact: true })).toHaveCount(0);
});

test('blocked public account stays visible; own profile links to private account', async ({ page }) => {
  await page.route(`**/api/v1/accounts/${personId}`, (route) => fulfillCase(route, 'getAccountSuccess', { responseBody: { id: personId, displayName: 'Алексей', avatarUrl: '/missing-person-image.svg', isBlocked: true } }));
  await page.goto(personPath);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Алексей');
  await expect(page.getByText('Аккаунт заблокирован', { exact: true })).toBeVisible();
  const me = await setMe(page);
  await page.route(`**/api/v1/accounts/${me.account.id}`, (route) => fulfillCase(route, 'getAccountSuccess', { responseBody: me.account }));
  await page.goto(`/people/${me.account.id}`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Анна');
  await expect(page.getByRole('link', { name: 'Личный кабинет', exact: true })).toHaveAttribute('href', '/me');
  await expect(page.getByRole('article')).toHaveCount(1);
});

test('organization page uses organizationId, shows owner block separately and exposes cabinet only to owner', async ({ page }) => {
  await setMe(page);
  const queries: URL[] = [];
  await page.route(`**/api/v1/organizations/${organizationId}`, (route) => fulfillCase(route, 'getOrganizationSuccess', { responseBody: { ...(httpCase('getOrganizationSuccess').responseBody as object), ownerIsBlocked: true, rejectionReason: 'PRIVATE_REASON' } }));
  await page.route('**/api/v1/events?*', async (route) => { queries.push(new URL(route.request().url())); await fulfillCase(route, 'listEventsSuccess'); });
  await page.goto(organizationPath);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Клуб «Темп»');
  await expect(page.getByText('Допущена к публикации', { exact: true })).toBeVisible();
  await expect(page.getByText('Организатор временно недоступен.', { exact: false })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Кабинет организации', exact: true })).toHaveAttribute('href', `/me/organizations/${organizationId}`);
  expect(queries.at(-1)?.searchParams.get('organizationId')).toBe(organizationId);
  expect(queries.at(-1)?.searchParams.has('organizerAccountId')).toBe(false);
  expect(queries.at(-1)?.searchParams.has('from')).toBe(false);
  await expect(page.locator('main')).not.toContainText('PRIVATE_REASON');
  await page.route('**/api/v1/me', (route) => fulfillCase(route, 'authenticationRequired'));
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByRole('link', { name: 'Кабинет организации', exact: true })).toHaveCount(0);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Клуб «Темп»');
});

test('organization 404 never loads its events, even when the actor owns a private application', async ({ page }) => {
  await setMe(page);
  let eventRequests = 0;
  await page.route(`**/api/v1/organizations/${organizationId}`, (route) => route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: { code: 'NOT_FOUND', message: 'Not found', requestId: 'fixture', fieldErrors: {} } }) }));
  await page.route('**/api/v1/events?*', (route) => { eventRequests++; return fulfillCase(route, 'listEventsSuccess'); });
  await page.goto(organizationPath);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Организация не найдена');
  await expect(page.getByRole('link', { name: 'Кабинет организации' })).toHaveCount(0);
  expect(eventRequests).toBe(0);
});

test('changing person route discards old profile on 404', async ({ page }) => {
  const otherId = '00000001-0000-4000-8000-000000000099';
  await page.route(`**/api/v1/accounts/${otherId}`, (route) => route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: { code: 'NOT_FOUND', message: 'Not found', requestId: 'fixture', fieldErrors: {} } }) }));
  await page.goto(personPath);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Алексей');
  await page.evaluate((target) => { history.pushState(null, '', target); window.dispatchEvent(new PopStateEvent('popstate')); }, `/people/${otherId}`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Профиль не найден');
  await expect(page.locator('main')).not.toContainText('Алексей');
});

test('a late profile response cannot replace the person opened after it', async ({ page }) => {
  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  let completed!: () => void;
  const oldDone = new Promise<void>((resolve) => { completed = resolve; });
  await page.route(`**/api/v1/accounts/${personId}`, async (route) => { await held; await fulfillCase(route, 'publicProfileWithPreset').catch(() => {}); completed(); });
  const annaId = '00000001-0000-4000-8000-000000000002';
  await page.route(`**/api/v1/accounts/${annaId}`, (route) => fulfillCase(route, 'getAccountSuccess', { responseBody: { id: annaId, displayName: 'Анна', avatarUrl: null, isBlocked: false } }));
  await page.goto(personPath);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Открываем профиль');
  await page.getByRole('link', { name: '← К встречам' }).click();
  await page.getByRole('link', { name: 'Организатор Анна' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Анна');
  release();
  await oldDone;
  await expect(page).toHaveURL(`/people/${annaId}`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Анна');
  await expect(page).toHaveTitle('Анна — Рядом');
});

test('keyboard focus survives replacing the loading heading after navigation', async ({ page }) => {
  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  await page.route(`**/api/v1/events/${eventId}`, async (route) => { await held; await fulfillCase(route, 'getEventSuccess'); });
  await page.goto('/events');
  const open = page.getByRole('link', { name: 'Открыть встречу', exact: true });
  await open.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Открываем встречу');
  await expect(page.getByRole('heading', { level: 1 })).toBeFocused();
  release();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Первое знакомство с петанком');
  await expect(page.getByRole('heading', { level: 1 })).toBeFocused();
});

test('malformed IDs skip API reads and a mismatched resource ID is never displayed', async ({ page }) => {
  let requests = 0;
  await page.route('**/api/v1/accounts/*', (route) => { requests++; return fulfillCase(route, 'getAccountSuccess', { responseBody: { id: '00000001-0000-4000-8000-000000000099', displayName: 'Другой человек', avatarUrl: null, isBlocked: false } }); });
  await page.goto('/people/not-a-uuid');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Профиль не найден');
  expect(requests).toBe(0);
  await page.goto(personPath);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Не удалось загрузить страницу');
  await expect(page.locator('main')).not.toContainText('Другой человек');
});

test('UUID case does not turn the matching resource into a false mismatch', async ({ page }) => {
  const id = 'abcdefab-1234-4000-8000-000000000001';
  await page.route(`**/api/v1/accounts/${id.toUpperCase()}`, (route) => fulfillCase(route, 'getAccountSuccess', { responseBody: { id, displayName: 'Алексей', avatarUrl: null, isBlocked: false } }));
  await page.goto(`/people/${id.toUpperCase()}`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Алексей');
});

for (const width of [320, 390, 768, 1280]) {
  test(`detail and public profiles layout at ${width}px`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.setViewportSize({ width, height: 900 });
    await page.route(`**/api/v1/events/${eventId}`, (route) => fulfillCase(route, 'getEventSuccess', { responseBody: { ...published(), title: 'Вечерняя встреча для тех, кто впервые пробует петанк', description: 'Знакомимся с правилами и играем вместе.\nНикакого опыта не требуется. <b>Это обычный текст.</b>', coverUrl: '/missing-cover.svg', organizer: { type: 'ORGANIZATION', organization: { id: organizationId, name: 'Спортивное сообщество «Движение рядом»' }, ownerIsBlocked: true } } }));
    for (const [path, title, file] of [[eventPath, 'Вечерняя встреча для тех, кто впервые пробует петанк', 'event'], [personPath, 'Алексей', 'person'], [organizationPath, 'Клуб «Темп»', 'organization']] as const) {
      await page.goto(path);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(title);
      if (file === 'event') await expect(page.locator('main img[src="/missing-cover.svg"]')).toHaveCount(0);
      else await expect(page.getByRole('article')).toHaveCount(1);
      await page.evaluate(() => document.fonts.ready);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: `.artifacts/fe-04/${file}-${width}.png`, fullPage: true });
    }
    expect(errors).toEqual([]);
  });
}

for (const organizer of ['PERSONAL', 'ORGANIZATION'] as const) {
  test(`organizer profile returns to its event and filtered catalog (${organizer})`, async ({ page }) => {
    const event = published();
    if (organizer === 'ORGANIZATION') event.organizer = { type: 'ORGANIZATION', organization: { id: organizationId, name: 'Клуб «Темп»' }, ownerIsBlocked: false };
    await page.route(`**/api/v1/events/${eventId}`, (route) => fulfillCase(route, 'getEventSuccess', { responseBody: event }));
    const search = new URLSearchParams({ from: '2026-10-20T00:00:00Z', city: 'Красноярск', joinMode: 'OPEN' });
    const catalog = `/events?${search}`;
    await page.goto(catalog);
    const open = page.getByRole('link', { name: 'Открыть встречу', exact: true });
    await open.click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(event.title);
    await page.getByRole('link', { name: organizer === 'PERSONAL' ? 'Открыть профиль' : 'Открыть страницу организации', exact: true }).click();
    const back = page.getByRole('link', { name: '← К встрече', exact: true });
    await expect(back).toHaveAttribute('href', eventPath);
    await back.click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(event.title);
    await page.getByRole('link', { name: '← К найденным встречам', exact: true }).click();
    await expect(page).toHaveURL(catalog);
    await expect(open).toBeFocused();
    await expect(page.getByLabel('Город', { exact: true })).toHaveValue('Красноярск');
  });
}
