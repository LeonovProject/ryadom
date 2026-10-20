import { expect, test, type Page } from '@playwright/test';
import { fulfillCase, guestFixtures, httpCase, meFixture } from '../../../auth/tests/http-fixtures';
import type { components } from '../../../../shared/api/client';

const orgId = '00000003-0000-4000-8000-000000000001';
const eventId = '00000002-0000-4000-8000-000000000088';
const activityId = '00000007-0000-4000-8000-000000000001';
const listedActivityId = '00000007-0000-4000-8000-000000000002';
const title = 'Первый петанк в парке';
type Me = components['schemas']['Me'];
function meData(): Me { return { ...meFixture(), sessionExpiresAt: '2099-01-01T00:00:00Z' }; }
async function signedIn(page: Page, me = meData()) {
  await page.route('**/api/v1/me', (route) => fulfillCase(route, 'getMeSuccess', { responseBody: me }));
  return me;
}
async function basics(page: Page, custom = true) {
  await expect(page.getByRole('heading', { name: 'О встрече', exact: true })).toBeVisible();
  await page.getByLabel('Название встречи (обязательно)', { exact: true }).fill(title);
  if (custom) {
    await page.getByLabel('Своё направление', { exact: true }).check();
    await page.getByLabel('Своё направление (обязательно)', { exact: true }).fill('Петанк на траве');
  } else { await page.getByLabel('Выбери направление', { exact: true }).selectOption(listedActivityId); }
  await page.getByLabel('Описание встречи (обязательно)').fill('Покажем правила.\n<b>Текст без разметки</b>');
  await page.getByLabel('Дата и время начала (обязательно)').fill('2030-11-07T01:00');
  await page.getByLabel('Часовая зона встречи (обязательно)').fill('Asia/Krasnoyarsk');
  await page.getByLabel('Город (обязательно)').fill('Красноярск');
  await page.getByLabel('Место встречи (обязательно)').fill('У входа в парк');
}
async function review(page: Page, mode: 'OPEN' | 'APPROVAL' = 'OPEN') {
  await page.getByRole('button', { name: 'Далее: участие' }).click();
  await page.getByRole('radio', { name: mode === 'OPEN' ? 'Свободная запись' : 'По заявке', exact: false }).check();
  await page.getByLabel('Условия участия', { exact: true }).fill('Можно без опыта.');
  await page.getByRole('button', { name: 'Проверить встречу' }).click();
  await expect(page.getByRole('heading', { name: 'Проверка', exact: true })).toBeVisible();
}
async function relogin(page: Page, me: Me) {
  await signedIn(page, me);
  await page.route('**/api/v1/auth/login', (route) => fulfillCase(route, 'loginSuccess', { responseBody: me }));
  await page.getByRole('link', { name: 'Войти', exact: true }).last().click();
  await page.getByLabel('Email (обязательно)', { exact: true }).fill(me.email);
  await page.getByLabel('Пароль (обязательно)', { exact: true }).fill('valid-password-fixture');
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  await expect(page).toHaveURL('/events/new');
}

test.beforeEach(async ({ page }) => { await guestFixtures(page); });

test('guest and failed session cannot fill or publish; login preserves the destination', async ({ page }) => {
  let posts = 0;
  page.on('request', (request) => { if (request.method() === 'POST') posts++; });
  await page.goto(`/events/new?organization=${orgId}`);
  await expect(page.getByRole('heading', { name: 'Сначала войди в Рядом' })).toBeVisible();
  await expect(page.getByRole('textbox')).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Войти', exact: true }).last()).toHaveAttribute('href', `/login?returnTo=${encodeURIComponent(`/events/new?organization=${orgId}`)}`);
  await page.route('**/api/v1/me', (route) => route.fulfill({ status: 503, body: '{}' }));
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Не удалось проверить вход' })).toBeVisible();
  await expect(page.getByRole('textbox')).toHaveCount(0);
  expect(posts).toBe(0);
});

test('one personal create request uses the event zone, requires 201, and opens the server resource', async ({ page }) => {
  const me = await signedIn(page);
  const posts: components['schemas']['CreateEventInput'][] = [];
  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  let created: components['schemas']['PublishedEventDetail'];
  await page.route('**/api/v1/events', async (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    const body = route.request().postDataJSON() as components['schemas']['CreateEventInput']; posts.push(body);
    created = { ...(httpCase('createEventSuccess').responseBody as components['schemas']['PublishedEventDetail']), ...body, id: eventId,
      activityType: { id: activityId, name: 'Петанк на траве' }, organizer: { type: 'PERSONAL', account: me.account } };
    await held;
    await fulfillCase(route, 'createEventSuccess', { responseBody: created });
  });
  await page.route(`**/api/v1/events/${eventId}`, (route) => fulfillCase(route, 'getEventSuccess', { responseBody: created }));
  await page.goto('/events/new'); await basics(page); await review(page);
  await expect(page.getByRole('region', { name: 'Сводка встречи' })).toContainText('7 ноября 2030 г. в 01:00 GMT+7');
  await expect(page.getByRole('region', { name: 'Сводка встречи' })).toContainText('<b>Текст без разметки</b>');
  await page.getByRole('button', { name: 'Опубликовать встречу' }).dblclick();
  await expect.poll(() => posts.length).toBe(1);
  await expect(page).toHaveURL('/events/new');
  await expect(page.getByRole('button', { name: 'Публикуем…' })).toBeDisabled();
  expect(posts[0]).toMatchObject({ organizer: { type: 'PERSONAL' }, activityType: { name: 'Петанк на траве' }, startsAt: '2030-11-06T18:00:00.000Z', timezone: 'Asia/Krasnoyarsk', joinMode: 'OPEN' });
  expect(Object.keys(posts[0]).sort()).toEqual(['organizer', 'activityType', 'title', 'description', 'startsAt', 'timezone', 'city', 'locationText', 'conditions', 'joinMode'].sort());
  release();
  await expect(page).toHaveURL(`/events/${eventId}`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(title);
  await expect(page.getByRole('link', { name: 'Участники и заявки', exact: true })).toBeVisible();
  await page.getByRole('link', { name: '← К найденным встречам' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(posts).toHaveLength(1);
});

test('approved organization is preselected and APPROVAL uses an existing activity ID', async ({ page }) => {
  const me = await signedIn(page); const posts: unknown[] = [];
  await page.route('**/api/v1/events', async (route) => { posts.push(route.request().postDataJSON()); await fulfillCase(route, 'invalidCreateFields'); });
  await page.goto(`/events/new?organization=${orgId}`);
  await expect(page.getByLabel('От чьего имени (обязательно)')).toHaveValue(orgId);
  await basics(page, false); await review(page, 'APPROVAL');
  await expect(page.getByRole('region', { name: 'Сводка встречи' })).toContainText(me.organizations[0].name);
  await page.getByRole('button', { name: 'Опубликовать встречу' }).click();
  await expect.poll(() => posts.length).toBe(1);
  expect(posts[0]).toMatchObject({ organizer: { type: 'ORGANIZATION', organizationId: orgId }, activityType: { id: listedActivityId }, joinMode: 'APPROVAL' });
  await expect(page.getByLabel('Дата и время начала (обязательно)')).toBeFocused();
  await expect(page.getByLabel('Название встречи (обязательно)', { exact: true })).toHaveValue(title);
});

test('missing or unapproved organization from navigation never falls back silently to personal', async ({ page }) => {
  const me = meData(); me.organizations[0] = { ...me.organizations[0], approvalState: 'PENDING', canPublish: false };
  await signedIn(page, me);
  await page.goto(`/events/new?organization=${orgId}`); await basics(page);
  await expect(page.getByLabel('От чьего имени (обязательно)')).toHaveValue(orgId);
  await expect(page.getByRole('link', { name: 'Открыть кабинет организации' })).toHaveAttribute('href', `/me/organizations/${orgId}`);
  await page.getByRole('button', { name: 'Далее: участие' }).click();
  await expect(page.getByLabel('От чьего имени (обязательно)')).toBeFocused();
  await page.getByLabel('От чьего имени (обязательно)').selectOption('');
  await page.getByRole('button', { name: 'Далее: участие' }).click();
  await expect(page.getByRole('heading', { name: 'Участие', exact: true })).toBeVisible();
});

test('required fields and missing participation mode focus the first error; back retains values', async ({ page }) => {
  await signedIn(page); await page.goto('/events/new');
  await page.getByRole('button', { name: 'Далее: участие' }).click();
  await expect(page.getByLabel('Название встречи (обязательно)', { exact: true })).toBeFocused();
  await basics(page); await page.getByRole('button', { name: 'Далее: участие' }).click();
  await page.getByRole('button', { name: 'Проверить встречу' }).click();
  await expect(page.getByRole('radio', { name: 'Свободная запись', exact: false })).toBeFocused();
  await page.getByRole('radio', { name: 'По заявке', exact: false }).check();
  await page.getByRole('button', { name: 'Назад', exact: true }).click();
  await expect(page.getByLabel('Название встречи (обязательно)', { exact: true })).toHaveValue(title);
  await page.getByRole('button', { name: 'Далее: участие' }).click();
  await expect(page.getByRole('radio', { name: 'По заявке', exact: false })).toBeChecked();
});

test('unavailable activity catalogue still permits a custom direction', async ({ page }) => {
  await signedIn(page);
  await page.route('**/api/v1/activity-types', (route) => route.fulfill({ status: 503, body: '{}' }));
  await page.goto('/events/new');
  await expect(page.getByText('Не удалось загрузить список. Можно указать своё направление.')).toBeVisible();
  await basics(page); await review(page);
  await expect(page.getByRole('region', { name: 'Сводка встречи' })).toContainText('Петанк на траве');
});

test('seasonal gaps, repeated times and invalid zones are rejected without POST', async ({ page }) => {
  await signedIn(page); let posts = 0;
  page.on('request', (request) => { if (request.method() === 'POST') posts++; });
  await page.goto('/events/new'); await basics(page);
  await page.getByLabel('Часовая зона встречи (обязательно)').fill('Europe/Berlin');
  for (const [value, message] of [['2030-03-31T02:30', 'не существует'], ['2030-10-27T02:30', 'повторяется']]) {
    await page.getByLabel('Дата и время начала (обязательно)').fill(value);
    await page.getByRole('button', { name: 'Далее: участие' }).click();
    await expect(page.getByLabel('Дата и время начала (обязательно)')).toHaveAccessibleDescription(new RegExp(message));
  }
  await page.getByLabel('Часовая зона встречи (обязательно)').fill('Unknown/Zone');
  await page.getByRole('button', { name: 'Далее: участие' }).click();
  await expect(page.locator('main')).toContainText('Укажи существующую IANA-зону');
  expect(posts).toBe(0);
});

test('422 retains the complete draft and requires explicit corrected submission', async ({ page }) => {
  await signedIn(page); let calls = 0;
  await page.route('**/api/v1/events', async (route) => { calls++; await fulfillCase(route, 'invalidCreateFields'); });
  await page.goto('/events/new'); await basics(page); await review(page, 'APPROVAL');
  await page.getByRole('button', { name: 'Опубликовать встречу' }).click();
  await expect(page.getByLabel('Дата и время начала (обязательно)')).toBeFocused();
  await expect(page.getByLabel('Дата и время начала (обязательно)')).toHaveAccessibleDescription(/Дата должна быть в будущем/);
  await expect(page.getByLabel('Описание встречи (обязательно)')).toHaveValue('Покажем правила.\n<b>Текст без разметки</b>');
  await page.getByLabel('Дата и время начала (обязательно)').fill('2030-11-08T01:00');
  await page.getByRole('button', { name: 'Далее: участие' }).click();
  await expect(page.getByRole('radio', { name: 'По заявке', exact: false })).toBeChecked();
  await expect(page.getByLabel('Условия участия', { exact: true })).toHaveValue('Можно без опыта.');
  expect(calls).toBe(1);
});

test('409 refreshes organization permission and keeps the selected author and text', async ({ page }) => {
  const me = await signedIn(page); let calls = 0;
  await page.route('**/api/v1/events', async (route) => { calls++; me.organizations[0] = { ...me.organizations[0], canPublish: false, approvalState: 'REJECTED' }; await fulfillCase(route, 'organizationNotApproved'); });
  await page.goto(`/events/new?organization=${orgId}`); await basics(page); await review(page);
  await page.getByRole('button', { name: 'Опубликовать встречу' }).click();
  await expect(page.getByRole('alert')).toContainText('Допуск организации изменился');
  await expect(page.getByLabel('От чьего имени (обязательно)')).toHaveValue(orgId);
  await expect(page.getByLabel('Название встречи (обязательно)', { exact: true })).toHaveValue(title);
  await expect(page.getByRole('option', { name: /публикация недоступна/ })).toBeDisabled();
  expect(calls).toBe(1);
});

for (const failure of ['network', 'server', 'timeout'] as const) {
  test(`unknown ${failure} result locks publication, never retries and is not proven by getMe`, async ({ page }) => {
    await signedIn(page); let calls = 0;
    if (failure === 'timeout') await page.clock.install();
    await page.route('**/api/v1/events', async (route) => {
      calls++;
      if (failure === 'network') await route.abort('failed');
      else if (failure === 'server') await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: { code: 'INTERNAL_ERROR', message: 'failure', requestId: 'fixture', fieldErrors: {} } }) });
      // Timeout deliberately leaves the response pending until AbortSignal ends the read.
    });
    await page.goto('/events/new'); await basics(page); await review(page);
    await page.getByRole('button', { name: 'Опубликовать встречу' }).click();
    await expect.poll(() => calls).toBe(1);
    if (failure === 'timeout') await page.clock.fastForward(16_000);
    await expect(page.getByRole('alert')).toContainText('Результат публикации неизвестен');
    await expect(page.getByRole('button', { name: 'Опубликовать встречу' })).toBeDisabled();
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(page.getByRole('button', { name: 'Опубликовать встречу' })).toBeDisabled();
    await page.getByRole('form', { name: 'Создание встречи' }).evaluate((form: HTMLFormElement) => { form.requestSubmit(); form.requestSubmit(); });
    expect(calls).toBe(1);
    await expect(page).toHaveURL('/events/new');
    await expect(page.getByRole('status')).toContainText('Совпадение названия не подтверждает');
  });
}

test('expiry hides the draft, reauthentication by the same account restores it without publishing', async ({ page }) => {
  const me = await signedIn(page); let posts = 0;
  page.on('request', (request) => { if (new URL(request.url()).pathname === '/api/v1/events' && request.method() === 'POST') posts++; });
  await page.goto('/events/new'); await basics(page); await review(page, 'APPROVAL');
  expect(await page.evaluate(() => `${JSON.stringify(localStorage)} ${JSON.stringify(sessionStorage)}`)).not.toContain(title);
  await page.route('**/api/v1/me', (route) => fulfillCase(route, 'sessionExpired'));
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByRole('heading', { name: 'Войди снова, чтобы продолжить' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Сводка встречи' })).toHaveCount(0);
  await expect(page.locator('main')).not.toContainText(title);
  await relogin(page, me);
  await expect(page.getByRole('region', { name: 'Сводка встречи' })).toContainText(title);
  await expect(page.getByText('Форма восстановлена из памяти этой вкладки. Она не сохранена на сервере.')).toBeVisible();
  expect(posts).toBe(0);
});

test('losing the session during POST keeps an uncertain draft locked after same-account login', async ({ page }) => {
  const me = await signedIn(page); let calls = 0;
  await page.route('**/api/v1/events', () => { calls++; });
  await page.goto('/events/new'); await basics(page); await review(page);
  await page.getByRole('button', { name: 'Опубликовать встречу' }).click();
  await expect.poll(() => calls).toBe(1);
  await page.route('**/api/v1/me', (route) => fulfillCase(route, 'sessionExpired'));
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByRole('heading', { name: 'Войди снова, чтобы продолжить' })).toBeVisible();
  await relogin(page, me);
  await expect(page.getByRole('region', { name: 'Сводка встречи' })).toContainText(title);
  await expect(page.getByRole('button', { name: 'Опубликовать встречу' })).toBeDisabled();
  await expect(page.getByRole('status')).toContainText('Повторная отправка заблокирована');
  expect(calls).toBe(1);
});

test('a 403 CSRF rejection retains the draft without success or replay', async ({ page }) => {
  await signedIn(page); let calls = 0;
  await page.route('**/api/v1/events', async (route) => { calls++; await route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ error: { code: 'CSRF_REJECTED', message: 'Origin rejected', requestId: 'fixture', fieldErrors: {} } }) }); });
  await page.goto('/events/new'); await basics(page); await review(page);
  await page.getByRole('button', { name: 'Опубликовать встречу' }).click();
  await expect(page.getByRole('alert')).toContainText('Сервер не принял запрос с этой страницы');
  await expect(page.getByRole('region', { name: 'Сводка встречи' })).toContainText(title);
  await expect(page).toHaveURL('/events/new'); expect(calls).toBe(1);
});

test('an unknown organization link blocks step one and remains explicitly selected', async ({ page }) => {
  await signedIn(page);
  const other = '00000003-0000-4000-8000-000000000099';
  await page.goto(`/events/new?organization=${other}`); await basics(page);
  await page.getByRole('button', { name: 'Далее: участие' }).click();
  await expect(page.getByLabel('От чьего имени (обязательно)')).toHaveValue(other);
  await expect(page.getByLabel('От чьего имени (обязательно)')).toHaveAccessibleDescription(/только от своей допущенной организации/);
  await expect(page.getByRole('link', { name: 'Открыть кабинет организации' })).toHaveCount(0);
});

test('another account never receives the expired draft and destroys it for subsequent logins', async ({ page }) => {
  const me = await signedIn(page);
  await page.goto('/events/new'); await basics(page);
  await page.route('**/api/v1/me', (route) => fulfillCase(route, 'sessionExpired'));
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByRole('heading', { name: 'Войди снова, чтобы продолжить' })).toBeVisible();
  const other = { ...me, account: { ...me.account, id: '00000001-0000-4000-8000-000000000099', displayName: 'Другой участник' } };
  await relogin(page, other);
  await expect(page.getByLabel('Название встречи (обязательно)', { exact: true })).toHaveValue('');
  await signedIn(page, me); await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByLabel('От чьего имени (обязательно)')).toContainText(me.account.displayName);
  await expect(page.getByLabel('Название встречи (обязательно)', { exact: true })).toHaveValue('');
});

test('blocked account removes the private draft and does not restore it on unblock', async ({ page }) => {
  const me = await signedIn(page); await page.goto('/events/new'); await basics(page);
  await page.route('**/api/v1/me', (route) => fulfillCase(route, 'getMeAccountBlocked'));
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByRole('textbox')).toHaveCount(0);
  await signedIn(page, me); await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByLabel('Название встречи (обязательно)', { exact: true })).toHaveValue('');
});

test('leaving dirty form requires a keyboard-accessible decision; confirmed leave discards it', async ({ page }) => {
  await signedIn(page); await page.goto('/events/new');
  await page.getByLabel('Название встречи (обязательно)', { exact: true }).fill(title);
  const exit = page.getByRole('link', { name: 'Выйти к встречам', exact: true });
  await exit.click();
  await expect(page.getByRole('dialog', { name: 'Покинуть форму?' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(exit).toBeFocused();
  await expect(page.getByLabel('Название встречи (обязательно)', { exact: true })).toHaveValue(title);
  await exit.click(); await page.getByRole('button', { name: 'Уйти из формы' }).click();
  await expect(page).toHaveURL(/\/events(?:\?|$)/);
  await page.goto('/events/new');
  await expect(page.getByLabel('Название встречи (обязательно)', { exact: true })).toHaveValue('');
});

test('browser reload warns about data loss and does not pretend to persist a draft', async ({ page }) => {
  await signedIn(page); await page.goto('/events/new');
  await page.getByLabel('Название встречи (обязательно)', { exact: true }).fill(title);
  let dialogs = 0;
  page.on('dialog', async (dialog) => { expect(dialog.type()).toBe('beforeunload'); dialogs++; await dialog.accept(); });
  await page.reload();
  await expect(page.getByLabel('Название встречи (обязательно)', { exact: true })).toHaveValue('');
  expect(dialogs).toBe(1);
});

for (const width of [320, 390, 768, 1280]) {
  test(`creation steps and focus at ${width}px`, async ({ page }) => {
    const errors: string[] = []; page.on('pageerror', (error) => errors.push(error.message));
    await signedIn(page); await page.setViewportSize({ width, height: 900 });
    await page.goto('/events/new'); await basics(page);
    const activityBounds = await page.getByLabel('Своё направление (обязательно)', { exact: true }).boundingBox();
    expect(activityBounds?.width).toBeGreaterThan(150);
    for (const step of [0, 1, 2]) {
      if (step === 1) { await page.getByRole('button', { name: 'Далее: участие' }).click(); await expect(page.getByRole('heading', { name: 'Участие', exact: true })).toBeFocused(); await page.getByRole('radio', { name: 'По заявке', exact: false }).check(); }
      if (step === 2) await page.getByRole('button', { name: 'Проверить встречу' }).click();
      if (step === 2) await expect(page.getByRole('heading', { name: 'Проверка', exact: true })).toBeFocused();
      await page.evaluate(() => document.fonts.ready);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: `.artifacts/fe-05/step-${step + 1}-${width}.png`, fullPage: true });
    }
    expect(errors).toEqual([]);
  });
}

for (const width of [390, 1280]) test(`review edits preserve the form and require another explicit publish at ${width}px`, async ({ page }) => {
  await signedIn(page);
  await page.setViewportSize({ width, height: 900 });
  const posts: components['schemas']['CreateEventInput'][] = [];
  await page.route('**/api/v1/events', (route) => { posts.push(route.request().postDataJSON()); return fulfillCase(route, 'invalidCreateFields'); });
  await page.goto('/events/new'); await basics(page); await review(page);
  await page.getByRole('button', { name: 'Изменить дату и время', exact: true }).click();
  await expect(page.getByLabel('Дата и время начала (обязательно)')).toBeFocused();
  await page.getByLabel('Дата и время начала (обязательно)').fill('2031-11-07T01:00');
  await page.getByRole('button', { name: 'Вернуться к проверке', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Проверка', exact: true })).toBeFocused();
  await expect(page.getByRole('region', { name: 'Сводка встречи' })).toContainText('7 ноября 2031 г. в 01:00 GMT+7');
  await page.getByRole('button', { name: 'Изменить описание и место', exact: true }).click();
  await expect(page.getByLabel('Название встречи (обязательно)', { exact: true })).toBeFocused();
  await page.getByLabel('Название встречи (обязательно)', { exact: true }).fill('Обновлённая встреча');
  await page.getByLabel('Город (обязательно)').fill('');
  await page.getByRole('button', { name: 'Вернуться к проверке', exact: true }).click();
  await expect(page.getByLabel('Город (обязательно)')).toBeFocused();
  await expect(page.getByLabel('Город (обязательно)')).toHaveAttribute('aria-invalid', 'true');
  await page.getByLabel('Город (обязательно)').fill('Москва');
  await page.getByRole('button', { name: 'Вернуться к проверке', exact: true }).click();
  await page.getByRole('button', { name: 'Изменить участие', exact: true }).click();
  await expect(page.locator('#event-joinMode')).toBeFocused();
  await page.getByRole('radio', { name: 'По заявке', exact: false }).check();
  await page.getByLabel('Условия участия', { exact: true }).fill('Возьми удобную обувь.');
  await page.getByRole('button', { name: 'Вернуться к проверке', exact: true }).click();
  const summary = page.getByRole('region', { name: 'Сводка встречи' });
  await expect(summary).toContainText('Обновлённая встреча');
  await expect(summary).toContainText('Москва');
  await expect(summary).toContainText('По заявке');
  await expect(summary).toContainText('Возьми удобную обувь.');
  await expect(summary).toContainText('Покажем правила.');
  expect(posts).toHaveLength(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: `.artifacts/fe-p1/create-review-${width}.png`, fullPage: true });
  await page.getByRole('button', { name: 'Опубликовать встречу', exact: true }).click();
  await expect.poll(() => posts.length).toBe(1);
  expect(posts[0]).toMatchObject({ title: 'Обновлённая встреча', city: 'Москва', startsAt: '2031-11-06T18:00:00.000Z', timezone: 'Asia/Krasnoyarsk', joinMode: 'APPROVAL', conditions: 'Возьми удобную обувь.' });
});

test('a failed direction refresh offers only the retained choice, without stale new choices', async ({ page }) => {
  await signedIn(page);
  await page.goto('/events/new'); await basics(page, false);
  const choices = page.getByLabel('Выбери направление', { exact: true });
  await expect(choices.locator('option')).toHaveCount(3);
  await page.route('**/api/v1/activity-types', (route) => fulfillCase(route, 'internalError'));
  await page.getByRole('button', { name: 'Обновить направления', exact: true }).click();
  await expect(page.getByText('Не удалось загрузить список. Можно указать своё направление.', { exact: true })).toBeVisible();
  await expect(choices).toHaveValue(listedActivityId);
  await expect(choices.locator('option')).toHaveCount(2);
  await page.getByRole('button', { name: 'Далее: участие', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Участие', exact: true })).toBeVisible();
});
