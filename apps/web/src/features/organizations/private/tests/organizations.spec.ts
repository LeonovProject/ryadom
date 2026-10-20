import { expect, test } from '@playwright/test';
import type { components } from '../../../../shared/api/client';
import { fulfillCase, guestFixtures, httpCase } from '../../../auth/tests/http-fixtures';
import { apiError, cabinetPath, fillOrganization, organizationFixture, organizationFixtures, organizationId, revisitTab } from './fixtures';

test('guests cannot read any private organization API and keep safe returnTo', async ({ page }) => {
  await guestFixtures(page); let privateReads = 0;
  page.on('request', (request) => { if (new URL(request.url()).pathname.startsWith('/api/v1/me/organizations')) privateReads++; });
  for (const path of ['/me/organizations', '/organizations/new', cabinetPath]) {
    await page.goto(path);
    await expect(page.getByRole('heading', { name: 'Войди, чтобы открыть свои организации' })).toBeVisible();
    await expect(page.getByRole('textbox')).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Войти', exact: true }).last()).toHaveAttribute('href', `/login?returnTo=${encodeURIComponent(path)}`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
  }
  expect(privateReads).toBe(0);
});

test('list shows all four states and only approved organization can create a meeting', async ({ page }) => {
  await organizationFixtures(page);
  const items = (['NOT_SUBMITTED', 'PENDING', 'APPROVED', 'REJECTED'] as const).map((state, index) => ({ ...organizationFixture(state, `00000003-0000-4000-8000-00000000000${index + 1}`), name: `Клуб ${index + 1}` }));
  await page.route('**/api/v1/me/organizations?*', (route) => fulfillCase(route, 'listMyOrganizationsSuccess', { responseBody: { items, nextCursor: null } }));
  await page.goto('/me/organizations');
  await expect(page.getByRole('article')).toHaveCount(4);
  await expect(page.getByRole('link', { name: 'Создать встречу', exact: true })).toHaveCount(1);
  await expect(page.getByRole('link', { name: 'Создать встречу', exact: true })).toHaveAttribute('href', `/events/new?organization=${items[2].id}`);
  await expect(page.getByRole('article').last()).toContainText('<b>Это текст причины.</b>');
  await page.getByRole('link', { name: 'Открыть кабинет', exact: true }).first().click();
  await expect(page).toHaveURL(cabinetPath);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Клуб «Темп»');
});

test('loading, failed list and empty list are distinct; a read-only retry succeeds', async ({ page }) => {
  await organizationFixtures(page);
  let release!: () => void; const held = new Promise<void>((resolve) => { release = resolve; });
  let failed = true;
  await page.route('**/api/v1/me/organizations?*', async (route) => { await held; if (failed) await apiError(route, 500, 'INTERNAL_ERROR'); else await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [], nextCursor: null }) }); });
  await page.goto('/me/organizations');
  await expect(page.getByRole('heading', { name: 'Загружаем свои организации' })).toBeVisible();
  release(); await expect(page.getByRole('heading', { name: 'Не удалось загрузить организации' })).toBeVisible();
  await expect(page.getByText('Пока нет своих организаций', { exact: true })).toHaveCount(0);
  failed = false; await page.getByRole('button', { name: 'Повторить загрузку', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Пока нет своих организаций' })).toBeVisible();
});

test('organization pagination retains server order, deduplicates across pages and restarts invalid cursors', async ({ page }) => {
  await organizationFixtures(page); let mode: 'ok' | 'failure' | 'invalid' = 'failure'; const cursors: (string | null)[] = [];
  const first = organizationFixture(); const second = { ...first, id: '00000003-0000-4000-8000-000000000002', name: 'Клуб второй страницы' };
  await page.route('**/api/v1/me/organizations?*', async (route) => {
    const cursor = new URL(route.request().url()).searchParams.get('cursor'); cursors.push(cursor);
    if (cursor && mode !== 'ok') return apiError(route, mode === 'invalid' ? 400 : 500, mode === 'invalid' ? 'INVALID_CURSOR' : 'INTERNAL_ERROR');
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: cursor ? [second, { ...first, name: 'Обновлённое имя' }] : [first], nextCursor: cursor ? 'next-2' : 'next-1' }) });
  });
  await page.goto('/me/organizations'); await expect(page.getByRole('article')).toHaveCount(1);
  await page.getByRole('button', { name: 'Показать ещё организации' }).click();
  await expect(page.getByRole('heading', { name: 'Не удалось загрузить следующую страницу' })).toBeVisible();
  await expect(page.getByRole('article')).toHaveCount(1);
  mode = 'ok'; await page.getByRole('button', { name: 'Повторить загрузку', exact: true }).click();
  await expect(page.getByRole('article')).toHaveCount(2);
  await expect(page.getByRole('article').first()).toContainText('Обновлённое имя');
  mode = 'invalid'; await page.getByRole('button', { name: 'Показать ещё организации' }).click();
  await expect(page.getByRole('heading', { name: 'Список нужно обновить' })).toBeVisible();
  await page.getByRole('button', { name: 'Начать список заново' }).click();
  await expect(page.getByRole('article')).toHaveCount(1); expect(cursors.at(-1)).toBeNull();
});

test('a private list response belonging to another owner is not displayed even to ADMIN', async ({ page }) => {
  const model = await organizationFixtures(page); model.me.systemRole = 'ADMIN';
  await page.route('**/api/v1/me/organizations?*', (route) => fulfillCase(route, 'listMyOrganizationsSuccess', { responseBody: { items: [{ ...model.organization, name: 'SECRET_CLUB', owner: { ...model.organization.owner, id: '00000001-0000-4000-8000-000000000099' } }], nextCursor: null } }));
  await page.goto('/me/organizations');
  await expect(page.getByRole('heading', { name: 'Не удалось загрузить организации' })).toBeVisible();
  await expect(page.locator('main')).not.toContainText('SECRET_CLUB');
});

test('creating the profile sends one DTO, waits for 201 and never submits its application automatically', async ({ page }) => {
  const model = await organizationFixtures(page);
  let release!: () => void; const held = new Promise<void>((resolve) => { release = resolve; });
  await page.route('**/api/v1/organizations', async (route) => { model.createBodies.push(route.request().postDataJSON()); model.organization = { ...model.organization, ...route.request().postDataJSON() }; await held; await fulfillCase(route, 'createOrganizationSuccess', { responseBody: model.organization }); });
  await page.goto('/organizations/new'); await fillOrganization(page);
  await page.getByRole('form', { name: 'Создание организации' }).evaluate((form: HTMLFormElement) => { form.requestSubmit(); form.requestSubmit(); });
  await expect.poll(() => model.createBodies.length).toBe(1);
  await expect(page.getByRole('button', { name: 'Создаём профиль…' })).toBeDisabled();
  await expect(page).toHaveURL('/organizations/new');
  expect(model.createBodies[0]).toEqual({ name: 'Клуб любителей петанка', description: 'Знакомимся с правилами.\n<b>Без разметки</b>', sportInterests: 'Петанк, шахматы и бег' });
  release(); await expect(page).toHaveURL(cabinetPath);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Клуб любителей петанка');
  await expect(page.getByRole('button', { name: 'Отправить на проверку' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Публичная страница' })).toHaveCount(0);
  expect(model.submissions).toBe(0);
});

test('client and server field errors keep values and focus the matching field', async ({ page }) => {
  const model = await organizationFixtures(page);
  await page.route('**/api/v1/organizations', (route) => apiError(route, 422, 'VALIDATION_ERROR', { '/sportInterests': ['Уточните спортивные интересы.'] }));
  await page.goto('/organizations/new');
  await page.getByRole('button', { name: 'Создать профиль организации' }).click();
  await expect(page.getByLabel('Название организации (обязательно)', { exact: true })).toBeFocused();
  await fillOrganization(page); await page.getByRole('button', { name: 'Создать профиль организации' }).click();
  await expect(page.getByLabel('Спортивные интересы (обязательно)', { exact: true })).toBeFocused();
  await expect(page.getByLabel('Спортивные интересы (обязательно)', { exact: true })).toHaveAccessibleDescription(/Уточните спортивные интересы/);
  await expect(page.getByLabel('Название организации (обязательно)', { exact: true })).toHaveValue('Клуб любителей петанка'); expect(model.submissions).toBe(0);
});

for (const failure of ['network', 'server', 'timeout'] as const) {
  test(`uncertain create ${failure} result is retained and cannot be replayed or proven by a name`, async ({ page }) => {
    const model = await organizationFixtures(page); let calls = 0;
    if (failure === 'timeout') await page.clock.install();
    await page.route('**/api/v1/organizations', async (route) => { calls++; if (failure === 'network') await route.abort('failed'); else if (failure === 'server') await apiError(route, 500, 'INTERNAL_ERROR'); });
    await page.goto('/organizations/new'); await fillOrganization(page);
    await page.getByRole('button', { name: 'Создать профиль организации' }).click();
    await expect.poll(() => calls).toBe(1);
    if (failure === 'timeout') await page.clock.fastForward(16_000);
    await expect(page.getByRole('alert')).toContainText('Результат создания неизвестен');
    await page.getByRole('form', { name: 'Создание организации' }).evaluate((form: HTMLFormElement) => { form.requestSubmit(); form.requestSubmit(); });
    await revisitTab(page);
    await expect(page.getByRole('button', { name: 'Создать профиль организации' })).toBeDisabled();
    expect(calls).toBe(1); expect(model.submissions).toBe(0);
    await expect(page.getByRole('alert')).toContainText('Совпадение названия не подтверждает');
  });
}

test('creation form warns on leaving; Escape restores focus and confirmed exit discards it', async ({ page }) => {
  await organizationFixtures(page); await page.goto('/organizations/new'); await fillOrganization(page);
  const exit = page.getByRole('link', { name: 'Вернуться к своим организациям' });
  await exit.click(); await expect(page.getByRole('dialog', { name: 'Покинуть форму?' })).toBeVisible();
  await page.keyboard.press('Escape'); await expect(exit).toBeFocused();
  await expect(page.getByLabel('Название организации (обязательно)', { exact: true })).toHaveValue('Клуб любителей петанка');
  await exit.click(); await page.getByRole('button', { name: 'Уйти из формы' }).click();
  await expect(page).toHaveURL('/me/organizations');
  await page.getByRole('link', { name: 'Создать организацию', exact: true }).click();
  await expect(page.getByLabel('Название организации (обязательно)', { exact: true })).toHaveValue('');
});

for (const sameAccount of [true, false]) {
  test(`expired creation draft ${sameAccount ? 'returns to the same account with POST still locked' : 'is erased for another account'}`, async ({ page }) => {
    const model = await organizationFixtures(page); let calls = 0;
    await page.route('**/api/v1/organizations', () => { calls++; });
    await page.goto('/organizations/new'); await fillOrganization(page);
    await page.getByRole('button', { name: 'Создать профиль организации' }).click(); await expect.poll(() => calls).toBe(1);
    await page.route('**/api/v1/me', (route) => fulfillCase(route, 'sessionExpired')); await revisitTab(page);
    await expect(page.getByRole('heading', { name: 'Войди, чтобы открыть свои организации' })).toBeVisible();
    await expect(page.getByRole('textbox')).toHaveCount(0);
    const me = sameAccount ? model.me : { ...model.me, account: { ...model.me.account, id: '00000001-0000-4000-8000-000000000099' } };
    await page.route('**/api/v1/me', (route) => fulfillCase(route, 'getMeSuccess', { responseBody: me }));
    await page.route('**/api/v1/auth/login', (route) => fulfillCase(route, 'loginSuccess', { responseBody: me }));
    await page.getByRole('link', { name: 'Войти', exact: true }).last().click();
    await page.getByLabel('Email (обязательно)', { exact: true }).fill(me.email); await page.getByLabel('Пароль (обязательно)', { exact: true }).fill('valid-password-fixture');
    await page.getByRole('button', { name: 'Войти', exact: true }).click();
    await expect(page).toHaveURL('/organizations/new');
    await expect(page.getByLabel('Название организации (обязательно)', { exact: true })).toHaveValue(sameAccount ? 'Клуб любителей петанка' : '');
    if (sameAccount) await expect(page.getByRole('button', { name: 'Создать профиль организации' })).toBeDisabled();
    expect(calls).toBe(1);
  });
}

for (const state of ['NOT_SUBMITTED', 'PENDING', 'APPROVED', 'REJECTED'] as const) {
  test(`cabinet ${state} keeps approval distinct and offers only supported actions`, async ({ page }) => {
    await organizationFixtures(page, state); await page.goto(cabinetPath);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Клуб «Темп»');
    await expect(page.getByRole('button', { name: 'Отправить на проверку' })).toHaveCount(state === 'NOT_SUBMITTED' ? 1 : 0);
    await expect(page.getByRole('link', { name: 'Публичная страница' })).toHaveCount(state === 'APPROVED' ? 1 : 0);
    await expect(page.getByRole('link', { name: 'Создать встречу от организации' })).toHaveCount(state === 'APPROVED' ? 1 : 0);
    if (state === 'REJECTED') { await expect(page.getByRole('heading', { name: 'Причина отказа' })).toBeVisible(); await expect(page.locator('main')).toContainText('<b>Это текст причины.</b>'); }
    await expect(page.getByRole('button', { name: /Редактировать|Повторно подать/ })).toHaveCount(0);
  });
}

test('submitting waits for a receipt, sends no body and rereads real state without publishing', async ({ page }) => {
  const model = await organizationFixtures(page); let calls = 0; let body: string | null = 'unset';
  let release!: () => void; const held = new Promise<void>((resolve) => { release = resolve; });
  await page.route(`**/api/v1/organizations/${organizationId}/application`, async (route) => { calls++; body = route.request().postData(); await held; model.organization = organizationFixture('PENDING'); await fulfillCase(route, 'submitOrganizationSuccess'); });
  await page.goto(cabinetPath);
  await page.getByRole('button', { name: 'Отправить на проверку' }).dblclick();
  await expect.poll(() => calls).toBe(1); await expect(page.getByRole('button', { name: 'Отправляем…' })).toBeDisabled();
  await expect(page.getByRole('region', { name: 'Допуск организации' })).toContainText('Профиль создан и доступен только тебе');
  expect(body).toBeNull(); release();
  await expect(page.getByRole('region', { name: 'Допуск организации' })).toContainText('Заявка на проверке');
  await expect(page.getByRole('button', { name: 'Отправить на проверку' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Публичная страница' })).toHaveCount(0); expect(calls).toBe(1);
});

test('a 200 repeated rejected application never becomes a new pending application', async ({ page }) => {
  const model = await organizationFixtures(page);
  await page.route(`**/api/v1/organizations/${organizationId}/application`, async (route) => { model.organization = organizationFixture('REJECTED'); await fulfillCase(route, 'repeatOrganizationSubmission', { responseBody: model.organization.application }); });
  await page.goto(cabinetPath); await page.getByRole('button', { name: 'Отправить на проверку' }).click();
  await expect(page.getByRole('region', { name: 'Допуск организации' })).toContainText('Повторной подачи и нового рассмотрения нет');
  await expect(page.getByRole('heading', { name: 'Причина отказа' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Отправить на проверку' })).toHaveCount(0);
});

test('lost submission with existing application rereads it but never claims the lost request succeeded', async ({ page }) => {
  const model = await organizationFixtures(page); let calls = 0;
  await page.route(`**/api/v1/organizations/${organizationId}/application`, async (route) => { calls++; model.organization = organizationFixture('PENDING'); await route.abort('failed'); });
  await page.goto(cabinetPath); await page.getByRole('button', { name: 'Отправить на проверку' }).click();
  await expect(page.getByRole('region', { name: 'Допуск организации' })).toContainText('Ответ на отправку не получен');
  await expect(page.getByRole('region', { name: 'Допуск организации' })).toContainText('Заявка на проверке');
  await expect(page.getByRole('button', { name: 'Повторить отправку' })).toHaveCount(0); expect(calls).toBe(1);
});

test('lost submission with no application requires an explicit read before an explicit idempotent repeat', async ({ page }) => {
  const model = await organizationFixtures(page); let calls = 0;
  await page.route(`**/api/v1/organizations/${organizationId}/application`, async (route) => { calls++; if (calls === 1) await route.abort('failed'); else { model.organization = organizationFixture('PENDING'); await fulfillCase(route, 'submitOrganizationSuccess'); } });
  await page.goto(cabinetPath); await page.getByRole('button', { name: 'Отправить на проверку' }).click();
  await expect(page.getByRole('button', { name: 'Повторить отправку' })).toBeDisabled();
  await page.getByRole('button', { name: 'Проверить заявку', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Повторить отправку' })).toBeEnabled(); expect(calls).toBe(1);
  await page.getByRole('button', { name: 'Повторить отправку' }).click();
  await expect(page.getByRole('region', { name: 'Допуск организации' })).toContainText('Заявка на проверке'); expect(calls).toBe(2);
});

test('404 clears previously loaded private data and prevents events reads; invalid IDs skip detail API', async ({ page }) => {
  const model = await organizationFixtures(page, 'REJECTED'); let missing = false; let details = 0;
  await page.route('**/api/v1/me/organizations/*', async (route) => { details++; if (missing) await apiError(route, 404, 'NOT_FOUND'); else await fulfillCase(route, 'getMyOrganizationSuccess', { responseBody: model.organization }); });
  await page.goto(cabinetPath); await expect(page.getByRole('heading', { name: 'Причина отказа' })).toBeVisible();
  missing = true; await page.getByRole('button', { name: 'Обновить сведения', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Кабинет организации не найден');
  await expect(page.locator('main')).not.toContainText('Это текст причины');
  const count = model.eventsQueries.length;
  await page.goto('/me/organizations/not-an-id'); await expect(page.getByRole('heading', { level: 1 })).toHaveText('Кабинет организации не найден');
  expect(details).toBe(2); expect(model.eventsQueries).toHaveLength(count);
});

for (const mismatch of ['owner', 'organization', 'application'] as const) {
  test(`mismatched private ${mismatch} cannot expose a cabinet, even when the actor is ADMIN`, async ({ page }) => {
    const model = await organizationFixtures(page, 'PENDING'); model.me.systemRole = 'ADMIN';
    const wrong = structuredClone(model.organization); wrong.name = 'SECRET_ORGANIZATION';
    if (mismatch === 'owner') wrong.owner.id = '00000001-0000-4000-8000-000000000099';
    if (mismatch === 'organization') wrong.id = '00000003-0000-4000-8000-000000000099';
    if (mismatch === 'application') wrong.application!.organizationId = '00000003-0000-4000-8000-000000000099';
    await page.route('**/api/v1/me/organizations/*', (route) => fulfillCase(route, 'getMyOrganizationSuccess', { responseBody: wrong }));
    await page.goto(cabinetPath); await expect(page.getByRole('heading', { level: 1 })).toHaveText('Не удалось загрузить страницу');
    await expect(page.locator('main')).not.toContainText('SECRET_ORGANIZATION'); expect(model.eventsQueries).toHaveLength(0);
  });
}

test('NOT_SUBMITTED without canSubmit never offers a send action', async ({ page }) => {
  const model = await organizationFixtures(page); model.organization.canSubmit = false;
  await page.goto(cabinetPath);
  await expect(page.getByRole('region', { name: 'Допуск организации' })).toContainText('Отправка заявки сейчас недоступна');
  await expect(page.getByRole('button', { name: 'Отправить на проверку' })).toHaveCount(0);
  expect(model.submissions).toBe(0);
});

test('approval on returning to the tab refreshes getMe before creating as the organization', async ({ page }) => {
  const model = await organizationFixtures(page, 'PENDING'); await page.goto(cabinetPath);
  await expect(page.getByRole('region', { name: 'Допуск организации' })).toContainText('Заявка на проверке');
  model.organization = organizationFixture('APPROVED');
  let meReads = 0;
  await page.route('**/api/v1/me', (route) => { meReads++; model.me.organizations[0] = { id: organizationId, name: model.organization.name, approvalState: 'APPROVED', canPublish: true }; return fulfillCase(route, 'getMeSuccess', { responseBody: model.me }); });
  await revisitTab(page);
  await page.getByRole('link', { name: 'Создать встречу от организации' }).click();
  await expect(page).toHaveURL(`/events/new?organization=${organizationId}`);
  await expect(page.getByLabel('От чьего имени (обязательно)')).toHaveValue(organizationId); expect(meReads).toBeGreaterThan(0);
});

test('organization events use the private filtered list; unavailable entries never reveal injected closed fields', async ({ page }) => {
  const model = await organizationFixtures(page, 'APPROVED');
  const summary = (httpCase('listMyEventsSuccess').responseBody as components['schemas']['OwnedEventPage']).items[0];
  const event = summary.event as components['schemas']['PublishedEventSummary'];
  const own = { event: { ...event, organizer: { type: 'ORGANIZATION', organization: { id: organizationId, name: 'Клуб «Темп»' }, ownerIsBlocked: false } }, canManageParticipants: true };
  await page.route('**/api/v1/me/events?*', (route) => { model.eventsQueries.push(new URL(route.request().url())); return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [own, { event: { id: '00000002-0000-4000-8000-000000000099', title: 'Снятая встреча', publicationStatus: 'UNPUBLISHED', locationText: 'SECRET_LOCATION', startsAt: 'SECRET_TIME' }, canManageParticipants: true }], nextCursor: null }) }); });
  await page.goto(cabinetPath); const section = page.getByRole('region', { name: 'Встречи организации' });
  await expect(section.getByRole('article')).toHaveCount(2);
  await expect(section).not.toContainText('SECRET_');
  await expect(section.locator('time')).toHaveCount(1);
  await expect(section.getByRole('link', { name: 'Участники и заявки', exact: true })).toHaveCount(1);
  expect(model.eventsQueries.at(-1)?.searchParams.get('organizationId')).toBe(organizationId);
  expect(model.eventsQueries.at(-1)?.searchParams.has('from')).toBe(false);
});

test('blocked session removes the private cabinet and cache', async ({ page }) => {
  await organizationFixtures(page, 'REJECTED'); await page.goto(cabinetPath);
  await expect(page.getByRole('heading', { name: 'Причина отказа' })).toBeVisible();
  await page.route('**/api/v1/me', (route) => fulfillCase(route, 'getMeAccountBlocked')); await revisitTab(page);
  await expect(page.getByRole('heading', { name: 'Войди, чтобы открыть свои организации' })).toBeVisible();
  await expect(page.locator('main')).not.toContainText('Это текст причины');
  await expect(page.getByRole('region', { name: 'Встречи организации' })).toHaveCount(0);
  expect(await page.evaluate(async () => {
    const modulePath = '/src/app/App.tsx'; const { queryClient } = await import(modulePath);
    return queryClient.getQueryCache().getAll().filter((query: { queryKey: readonly unknown[] }) => query.queryKey[0] === 'private' || query.queryKey.includes('private-organization')).length;
  })).toBe(0);
});

test('organization event pagination keeps previous entries on failure and resets an invalid cursor', async ({ page }) => {
  await organizationFixtures(page, 'APPROVED'); let mode: 'failure' | 'ok' | 'invalid' = 'failure';
  const summary = (httpCase('listMyEventsSuccess').responseBody as components['schemas']['OwnedEventPage']).items[0];
  const published = summary.event as components['schemas']['PublishedEventSummary'];
  const event = { ...published, organizer: { type: 'ORGANIZATION', organization: { id: organizationId, name: 'Клуб «Темп»' }, ownerIsBlocked: false } };
  const cursors: (string | null)[] = [];
  await page.route('**/api/v1/me/events?*', async (route) => {
    const cursor = new URL(route.request().url()).searchParams.get('cursor'); cursors.push(cursor);
    if (cursor && mode !== 'ok') return apiError(route, mode === 'failure' ? 500 : 400, mode === 'failure' ? 'INTERNAL_ERROR' : 'INVALID_CURSOR');
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [{ event: cursor ? { ...event, id: '00000002-0000-4000-8000-000000000099', title: 'Вторая встреча' } : event, canManageParticipants: true }], nextCursor: cursor ? 'next-2' : 'next-1' }) });
  });
  await page.goto(cabinetPath); const section = page.getByRole('region', { name: 'Встречи организации' });
  await expect(section.getByRole('article')).toHaveCount(1);
  await section.getByRole('button', { name: 'Показать ещё встречи' }).click();
  await expect(section.getByRole('heading', { name: 'Не удалось догрузить встречи' })).toBeVisible();
  await expect(section.getByRole('article')).toHaveCount(1);
  mode = 'ok'; await section.getByRole('button', { name: 'Повторить догрузку' }).click();
  await expect(section.getByRole('article')).toHaveCount(2);
  mode = 'invalid'; await section.getByRole('button', { name: 'Показать ещё встречи' }).click();
  await expect(section.getByRole('heading', { name: 'Список встреч нужно обновить' })).toBeVisible();
  await section.getByRole('button', { name: 'Начать встречи заново' }).click();
  await expect(section.getByRole('article')).toHaveCount(1); expect(cursors.at(-1)).toBeNull();
});

for (const width of [320, 390, 768, 1280]) {
  test(`organization list, create form and rejected cabinet layout at ${width}px`, async ({ page }) => {
    const errors: string[] = []; page.on('pageerror', (error) => errors.push(error.message));
    await organizationFixtures(page, 'REJECTED'); await page.setViewportSize({ width, height: 900 });
    for (const [path, file] of [['/me/organizations', 'list'], ['/organizations/new', 'create'], [cabinetPath, 'cabinet']]) {
      await page.goto(path);
      if (file === 'list') await expect(page.getByRole('article')).toHaveCount(1);
      if (file === 'create') await fillOrganization(page);
      if (file === 'cabinet') await expect(page.getByRole('heading', { name: 'Причина отказа' })).toBeVisible();
      await page.evaluate(() => document.fonts.ready);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: `.artifacts/fe-06/${file}-${width}.png`, fullPage: true });
    }
    expect(errors).toEqual([]);
  });
}
