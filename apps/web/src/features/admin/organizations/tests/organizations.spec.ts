import { expect, test } from '@playwright/test';
import type { components } from '../../../../shared/api/client';
import { fulfillCase, guestFixtures } from '../../../auth/tests/http-fixtures';
import { organizationFixture } from '../../../organizations/private/tests/fixtures';
import { adminFixtures, apiError, organizationId, reviewPath, revisitTab } from './fixtures';

for (const actor of ['guest', 'USER'] as const) test(`${actor} cannot request administrative organization data`, async ({ page }) => {
  if (actor === 'guest') await guestFixtures(page); else { const model = await adminFixtures(page); model.me.systemRole = 'USER'; }
  let requests = 0; page.on('request', (request) => { if (request.url().includes('/api/v1/admin/')) requests++; });
  for (const path of ['/admin/organizations?approvalState=PENDING', reviewPath]) {
    await page.goto(path);
    await expect(page.getByRole('heading', { name: actor === 'guest' ? 'Войди, чтобы проверить доступ' : 'Нет доступа к разделу' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Предоставить допуск' })).toHaveCount(0);
    if (actor === 'guest') await expect(page.locator('main').getByRole('link', { name: 'Войти', exact: true })).toHaveAttribute('href', `/login?returnTo=${encodeURIComponent(path)}`);
  }
  expect(requests).toBe(0);
});

test('failed getMe does not start admin reads', async ({ page }) => {
  const model = await adminFixtures(page);
  await page.route('**/api/v1/me', (route) => apiError(route, 500, 'INTERNAL_ERROR'));
  await page.goto(reviewPath); await expect(page.getByRole('heading', { name: 'Не удалось проверить доступ' })).toBeVisible();
  expect(model.reads).toBe(0);
});

test('list searches all profiles, applies URL filters, drops cursor and restores history', async ({ page }) => {
  const model = await adminFixtures(page);
  await page.route('**/api/v1/admin/organizations?*', async (route) => {
    const url = new URL(route.request().url()); model.queries.push(url);
    const state = url.searchParams.get('approvalState');
    const items = (['NOT_SUBMITTED', 'PENDING', 'APPROVED', 'REJECTED'] as const).filter((value) => !state || value === state).map((value, index) => ({ ...organizationFixture(value, `00000003-0000-4000-8000-00000000000${index + 1}`), name: `Клуб ${value}`, canPublish: false }));
    await fulfillCase(route, 'adminListOrganizationsSuccess', { responseBody: { items, nextCursor: null } });
  });
  await page.goto('/admin/organizations'); await expect(page.getByRole('article')).toHaveCount(4);
  await page.getByLabel('Поиск по профилю', { exact: true }).fill(' петанк ');
  await page.getByLabel('Допуск организации', { exact: true }).selectOption('PENDING');
  await page.getByRole('button', { name: 'Найти организации' }).click();
  await expect(page.getByRole('article')).toHaveCount(1);
  expect(model.queries.at(-1)?.searchParams.get('q')).toBe('петанк');
  expect(model.queries.at(-1)?.searchParams.get('approvalState')).toBe('PENDING');
  expect(model.queries.at(-1)?.searchParams.has('cursor')).toBe(false);
  const search = new URL(page.url()).search;
  await page.getByRole('link', { name: 'Открыть профиль' }).click();
  await expect(page.getByRole('link', { name: '← К списку организаций' })).toHaveAttribute('href', `/admin/organizations${search}`);
  await page.getByRole('link', { name: '← К списку организаций' }).click();
  await expect(page.getByLabel('Поиск по профилю', { exact: true })).toHaveValue('петанк');
  await page.getByRole('button', { name: 'Сбросить', exact: true }).click(); await expect(page.getByRole('article')).toHaveCount(4);
  await page.goBack(); await expect(page.getByLabel('Допуск организации', { exact: true })).toHaveValue('PENDING');
});

test('invalid filters and overlong search do not send a request', async ({ page }) => {
  const model = await adminFixtures(page);
  await page.goto('/admin/organizations?approvalState=HIDDEN'); await expect(page.getByRole('heading', { name: 'Проверь фильтры' })).toBeVisible(); expect(model.queries).toHaveLength(0);
  await page.getByRole('button', { name: 'Сбросить фильтры', exact: true }).click(); await expect(page.getByRole('article')).toHaveCount(1);
  const count = model.queries.length;
  await page.getByLabel('Поиск по профилю', { exact: true }).fill('я'.repeat(201)); await page.getByRole('button', { name: 'Найти организации' }).click();
  await expect(page.getByLabel('Поиск по профилю', { exact: true })).toBeFocused();
  await expect(page.getByLabel('Поиск по профилю', { exact: true })).toHaveAccessibleDescription(/не более 200/); expect(model.queries).toHaveLength(count);
});

test('loading, failure and empty result are distinct', async ({ page }) => {
  await adminFixtures(page); let release!: () => void; const held = new Promise<void>((resolve) => { release = resolve; }); let failed = true;
  await page.route('**/api/v1/admin/organizations?*', async (route) => { await held; if (failed) return apiError(route, 500, 'INTERNAL_ERROR'); await fulfillCase(route, 'adminListOrganizationsSuccess', { responseBody: { items: [], nextCursor: null } }); });
  await page.goto('/admin/organizations'); await expect(page.getByRole('heading', { name: 'Ищем организации' })).toBeVisible();
  release(); await expect(page.getByRole('heading', { name: 'Не удалось загрузить организации' })).toBeVisible();
  await expect(page.getByText('Организации не найдены', { exact: true })).toHaveCount(0);
  failed = false; await page.getByRole('button', { name: 'Повторить загрузку', exact: true }).click(); await expect(page.getByRole('heading', { name: 'Организации не найдены' })).toBeVisible();
});

test('pagination keeps server order, overlaps once and restarts invalid cursors', async ({ page }) => {
  const model = await adminFixtures(page); let mode = 'failed'; const cursors: (string | null)[] = [];
  const second = { ...model.organization, id: '00000003-0000-4000-8000-000000000002', application: { ...model.organization.application!, organizationId: '00000003-0000-4000-8000-000000000002' }, name: 'Вторая организация' };
  await page.route('**/api/v1/admin/organizations?*', async (route) => {
    const cursor = new URL(route.request().url()).searchParams.get('cursor'); cursors.push(cursor);
    if (cursor && mode !== 'ok') return apiError(route, mode === 'invalid' ? 400 : 500, mode === 'invalid' ? 'INVALID_CURSOR' : 'INTERNAL_ERROR');
    await fulfillCase(route, 'adminListOrganizationsSuccess', { responseBody: { items: cursor ? [second, { ...model.organization, name: 'Обновлённый клуб' }] : [model.organization], nextCursor: cursor ? 'next-2' : 'next-1' } });
  });
  await page.goto('/admin/organizations'); await expect(page.getByRole('article')).toHaveCount(1);
  await page.getByRole('button', { name: 'Показать ещё организации' }).click(); await expect(page.getByRole('heading', { name: 'Не удалось загрузить следующую страницу' })).toBeVisible(); await expect(page.getByRole('article')).toHaveCount(1);
  mode = 'ok'; await page.getByRole('button', { name: 'Повторить загрузку страницы' }).click(); await expect(page.getByRole('article')).toHaveCount(2); await expect(page.getByRole('article').first()).toContainText('Обновлённый клуб');
  mode = 'invalid'; await page.getByRole('button', { name: 'Показать ещё организации' }).click(); await page.getByRole('button', { name: 'Начать список заново' }).click(); await expect(page.getByRole('article')).toHaveCount(1); expect(cursors.at(-1)).toBeNull();
});

test('a forbidden next page hides previously loaded administrative profiles', async ({ page }) => {
  const model = await adminFixtures(page);
  await page.route('**/api/v1/admin/organizations?*', async (route) => {
    if (new URL(route.request().url()).searchParams.has('cursor')) return apiError(route, 403, 'FORBIDDEN');
    await fulfillCase(route, 'adminListOrganizationsSuccess', { responseBody: { items: [model.organization], nextCursor: 'next' } });
  });
  await page.goto('/admin/organizations'); await expect(page.getByRole('article')).toHaveCount(1);
  await page.getByRole('button', { name: 'Показать ещё организации' }).click(); await expect(page.getByRole('heading', { name: 'Нет доступа к списку' })).toBeVisible(); await expect(page.getByRole('article')).toHaveCount(0);
});

for (const state of ['NOT_SUBMITTED', 'APPROVED', 'REJECTED'] as const) test(`${state} has no decision controls and keeps related links`, async ({ page }) => {
  const model = await adminFixtures(page, state); model.organization.owner.isBlocked = true;
  await page.goto(reviewPath); await expect(page.getByRole('heading', { level: 1 })).toHaveText(model.organization.name);
  await expect(page.getByRole('button', { name: 'Предоставить допуск' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Отклонить', exact: true })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Встречи организации' })).toHaveAttribute('href', `/admin/events?organizationId=${organizationId}`);
  await expect(page.getByRole('link', { name: 'Анна', exact: true })).toHaveAttribute('href', `/people/${model.organization.owner.id}`);
  await expect(page.getByText('Аккаунт заблокирован. Состояние допуска организации не изменено.')).toBeVisible();
  if (state === 'NOT_SUBMITTED') await expect(page.getByText(/Заявка не отправлена\. Решение/)).toBeVisible();
  if (state === 'REJECTED') { await expect(page.getByText(/<b>Это текст причины.<\/b>/)).toBeVisible(); expect(await page.locator('main b').count()).toBe(0); }
  await expect(page.getByRole('link', { name: 'Публичная страница' })).toHaveCount(state === 'APPROVED' ? 1 : 0);
});

for (const status of [403, 404, 500]) test(`detail ${status} hides data and decisions`, async ({ page }) => {
  await adminFixtures(page);
  await page.route('**/api/v1/admin/organizations/*', (route) => apiError(route, status, status === 403 ? 'FORBIDDEN' : status === 404 ? 'NOT_FOUND' : 'INTERNAL_ERROR'));
  await page.goto(reviewPath); await expect(page.getByRole('heading', { level: 1 })).toHaveText(status === 403 ? 'Нет доступа к странице' : status === 404 ? 'Организация не найдена' : 'Не удалось загрузить страницу');
  await expect(page.getByRole('button', { name: 'Предоставить допуск' })).toHaveCount(0); await expect(page.locator('main')).not.toContainText('Клуб «Темп»');
});

test('invalid UUID does not read detail; mismatched application cannot leak profile', async ({ page }) => {
  const model = await adminFixtures(page);
  await page.goto('/admin/organizations/invalid'); await expect(page.getByRole('heading', { level: 1 })).toHaveText('Организация не найдена'); expect(model.reads).toBe(0);
  model.organization.application!.organizationId = '00000003-0000-4000-8000-000000000099';
  await page.goto(reviewPath); await expect(page.getByRole('heading', { level: 1 })).toHaveText('Не удалось загрузить страницу'); await expect(page.locator('main')).not.toContainText(model.organization.name);
});

test('approval waits for one confirmed POST and rereads the canonical profile', async ({ page }) => {
  const model = await adminFixtures(page); let release!: () => void; const held = new Promise<void>((resolve) => { release = resolve; });
  await page.route('**/api/v1/admin/applications/*/decision', async (route) => {
    model.bodies.push(route.request().postDataJSON()); await held;
    model.organization = { ...organizationFixture('APPROVED'), canPublish: false };
    await fulfillCase(route, 'adminDecideOrganizationSuccess', { responseBody: model.organization.application });
  });
  await page.goto(reviewPath); const button = page.getByRole('button', { name: 'Предоставить допуск', exact: true });
  await button.evaluate((element: HTMLButtonElement) => { element.click(); element.click(); });
  await expect.poll(() => model.bodies.length).toBe(1); await expect(button).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Отклонить', exact: true })).toBeDisabled();
  await expect(page.getByText(/Сервер подтвердил решение/)).toHaveCount(0);
  release(); await expect(page.getByText(/Сервер подтвердил решение/)).toBeVisible(); await expect(page.getByRole('link', { name: 'Публичная страница' })).toBeVisible();
  expect(model.bodies).toEqual([{ decision: 'APPROVE' }]); expect(model.reads).toBeGreaterThan(1);
  await expect(page.locator('main time').last()).toContainText('GMT+0');
});

test('rejection dialog traps focus, restores it and validates required reason before sending', async ({ page }) => {
  const model = await adminFixtures(page); await page.goto(reviewPath);
  const trigger = page.getByRole('button', { name: 'Отклонить', exact: true }); await trigger.click();
  const dialog = page.getByRole('dialog'); const reason = dialog.getByLabel('Причина отказа (обязательно)', { exact: true });
  await expect(reason).toBeFocused(); await page.keyboard.press('Shift+Tab'); await expect(dialog.getByRole('button', { name: 'Отмена' })).toBeFocused(); await page.keyboard.press('Tab'); await expect(reason).toBeFocused();
  await page.keyboard.press('Escape'); await expect(dialog).toBeHidden(); await expect(trigger).toBeFocused();
  await trigger.click(); await dialog.getByRole('button', { name: 'Подтвердить отказ' }).click(); await expect(reason).toBeFocused(); await expect(reason).toHaveAccessibleDescription(/Укажи причину/); expect(model.bodies).toHaveLength(0);
  await reason.fill('я'.repeat(2001)); await dialog.getByRole('button', { name: 'Подтвердить отказ' }).click(); await expect(reason).toHaveAccessibleDescription(/не более 2000/); expect(model.bodies).toHaveLength(0);
  await reason.fill('  Уточните деятельность.\n<b>Обычный текст</b>  '); await dialog.getByRole('button', { name: 'Подтвердить отказ' }).click();
  await expect(dialog).toBeHidden(); await expect(page.getByRole('heading', { name: 'Причина отказа' })).toBeVisible();
  expect(model.bodies).toEqual([{ decision: 'REJECT', reason: 'Уточните деятельность.\n<b>Обычный текст</b>' }]); await expect(page.locator('main b')).toHaveCount(0);
});

test('server reason validation preserves input, associates error and focuses the field', async ({ page }) => {
  const model = await adminFixtures(page);
  await page.route('**/api/v1/admin/applications/*/decision', async (route) => { model.bodies.push(route.request().postDataJSON()); await apiError(route, 422, 'VALIDATION_ERROR', { '/reason': ['Уточните причину отказа.'] }); });
  await page.goto(reviewPath); await page.getByRole('button', { name: 'Отклонить', exact: true }).click(); const reason = page.getByLabel('Причина отказа (обязательно)', { exact: true });
  await reason.fill('Есть замечания'); await page.getByRole('button', { name: 'Подтвердить отказ' }).click();
  await expect(reason).toHaveValue('Есть замечания'); await expect(reason).toBeFocused(); await expect(reason).toHaveAccessibleDescription(/Уточните причину/); expect(model.bodies).toHaveLength(1);
  await expect(page.getByText(/Сервер подтвердил решение/)).toHaveCount(0);
});

for (const action of ['APPROVE', 'REJECT'] as const) test(`${action} conflict rereads another administrator's decision without retry`, async ({ page }) => {
  const model = await adminFixtures(page);
  await page.route('**/api/v1/admin/applications/*/decision', async (route) => { model.bodies.push(route.request().postDataJSON()); model.organization = { ...organizationFixture(action === 'APPROVE' ? 'REJECTED' : 'APPROVED'), canPublish: false }; await apiError(route, 409, 'DECISION_CONFLICT'); });
  await page.goto(reviewPath);
  if (action === 'APPROVE') await page.getByRole('button', { name: 'Предоставить допуск' }).click(); else { await page.getByRole('button', { name: 'Отклонить', exact: true }).click(); await page.getByLabel('Причина отказа (обязательно)').fill('Моя причина'); await page.getByRole('button', { name: 'Подтвердить отказ' }).click(); }
  await expect(page.getByRole('alert')).toContainText('Решение уже принято с другими данными'); await expect(page.getByRole('button', { name: 'Предоставить допуск' })).toHaveCount(0);
  await expect(page.getByText(/Сервер подтвердил решение/)).toHaveCount(0); expect(model.bodies).toHaveLength(1); expect(model.reads).toBeGreaterThan(1);
});

test('lost response after saved decision only rereads and never claims success', async ({ page }) => {
  const model = await adminFixtures(page);
  await page.route('**/api/v1/admin/applications/*/decision', async (route) => { model.bodies.push(route.request().postDataJSON()); model.organization = { ...organizationFixture('APPROVED'), canPublish: false }; await route.abort('failed'); });
  await page.goto(reviewPath); await page.getByRole('button', { name: 'Предоставить допуск' }).click();
  await expect(page.getByText(/Ответ на решение не получен/)).toBeVisible(); await expect(page.getByRole('link', { name: 'Публичная страница' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Повторить то же решение' })).toHaveCount(0); await expect(page.getByText(/Сервер подтвердил решение/)).toHaveCount(0); expect(model.bodies).toHaveLength(1);
});

test('unknown unsaved rejection requires a fresh read then explicit identical retry', async ({ page }) => {
  const model = await adminFixtures(page); let first = true;
  await page.route('**/api/v1/admin/applications/*/decision', async (route) => {
    const input = route.request().postDataJSON() as components['schemas']['OrganizationDecisionInput']; model.bodies.push(input);
    if (first) { first = false; return apiError(route, 500, 'INTERNAL_ERROR'); }
    model.organization = { ...organizationFixture('REJECTED'), canPublish: false, application: { ...organizationFixture('REJECTED').application!, rejectionReason: input.decision === 'REJECT' ? input.reason : null } };
    await fulfillCase(route, 'adminDecideOrganizationSuccess', { responseBody: model.organization.application });
  });
  await page.goto(reviewPath); await page.getByRole('button', { name: 'Отклонить', exact: true }).click(); await page.getByLabel('Причина отказа (обязательно)').fill('Исходная причина'); await page.getByRole('button', { name: 'Подтвердить отказ' }).click();
  const retry = page.getByRole('button', { name: 'Повторить то же решение' }); await expect(retry).toBeDisabled(); expect(model.bodies).toHaveLength(1);
  await page.getByRole('button', { name: 'Проверить решение', exact: true }).click(); await expect(retry).toBeEnabled(); await retry.click();
  await expect(page.getByText(/Сервер подтвердил решение/)).toBeVisible(); expect(model.bodies).toEqual([{ decision: 'REJECT', reason: 'Исходная причина' }, { decision: 'REJECT', reason: 'Исходная причина' }]);
});

test('an explicit retry keeps progress visible and a forbidden retry cannot be offered again', async ({ page }) => {
  const model = await adminFixtures(page); let release!: () => void; const held = new Promise<void>((resolve) => { release = resolve; });
  await page.route('**/api/v1/admin/applications/*/decision', async (route) => {
    model.bodies.push(route.request().postDataJSON());
    if (model.bodies.length === 1) return apiError(route, 500, 'INTERNAL_ERROR');
    await held; await apiError(route, 403, 'FORBIDDEN');
  });
  await page.goto(reviewPath); await page.getByRole('button', { name: 'Предоставить допуск' }).click(); await page.getByRole('button', { name: 'Проверить решение', exact: true }).click();
  await page.getByRole('button', { name: 'Повторить то же решение' }).click(); await expect(page.getByText('Отправляем решение…', { exact: true })).toBeVisible(); await expect(page.getByRole('button', { name: 'Повторить то же решение' })).toBeDisabled();
  release(); await expect(page.getByRole('alert')).toContainText('Нет права принимать решение'); await expect(page.getByRole('button', { name: 'Повторить то же решение' })).toHaveCount(0); expect(model.bodies).toHaveLength(2);
});

test('a decision made elsewhere closes an open rejection dialog after refresh', async ({ page }) => {
  const model = await adminFixtures(page); await page.goto(reviewPath); await page.getByRole('button', { name: 'Отклонить', exact: true }).click(); await page.getByLabel('Причина отказа (обязательно)').fill('Ещё не отправлено');
  model.organization = { ...organizationFixture('APPROVED'), canPublish: false }; await revisitTab(page);
  await expect(page.getByRole('dialog')).toHaveCount(0); await expect(page.getByRole('link', { name: 'Публичная страница' })).toBeVisible(); await expect(page.getByRole('button', { name: 'Предоставить допуск' })).toHaveCount(0); expect(model.bodies).toHaveLength(0);
});

test('failed verification after unknown result cannot enable another decision', async ({ page }) => {
  const model = await adminFixtures(page); let failRead = false;
  await page.route('**/api/v1/admin/organizations/*', async (route) => {
    if (failRead) return apiError(route, 500, 'INTERNAL_ERROR');
    await fulfillCase(route, 'adminGetOrganizationSuccess', { responseBody: model.organization });
  });
  await page.route('**/api/v1/admin/applications/*/decision', async (route) => { model.bodies.push(route.request().postDataJSON()); failRead = true; await apiError(route, 500, 'INTERNAL_ERROR'); });
  await page.goto(reviewPath); await page.getByRole('button', { name: 'Предоставить допуск' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Не удалось загрузить страницу'); await expect(page.getByText(/Ответ на решение не получен/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Предоставить допуск' })).toHaveCount(0);
  failRead = false; await page.getByRole('button', { name: 'Повторить загрузку', exact: true }).click(); await expect(page.getByRole('button', { name: 'Повторить то же решение' })).toBeDisabled(); expect(model.bodies).toHaveLength(1);
});

test('a late decision receipt after session expiry never restores private data', async ({ page }) => {
  const model = await adminFixtures(page); let release!: () => void; const held = new Promise<void>((resolve) => { release = resolve; });
  await page.route('**/api/v1/admin/applications/*/decision', async (route) => { model.bodies.push(route.request().postDataJSON()); await held; await fulfillCase(route, 'adminDecideOrganizationSuccess', { responseBody: organizationFixture('APPROVED').application }).catch(() => undefined); });
  await page.goto(reviewPath); await page.getByRole('button', { name: 'Предоставить допуск' }).click(); await expect.poll(() => model.bodies.length).toBe(1);
  await page.route('**/api/v1/me', (route) => apiError(route, 401, 'SESSION_EXPIRED')); await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByRole('heading', { name: 'Войди, чтобы проверить доступ' })).toBeVisible(); release();
  await expect(page.getByText(/Сервер подтвердил решение/)).toHaveCount(0); await expect(page.locator('main')).not.toContainText(model.organization.name);
});

test('incorrect success receipt is treated as unknown even when the profile is final', async ({ page }) => {
  const model = await adminFixtures(page);
  await page.route('**/api/v1/admin/applications/*/decision', async (route) => { model.organization = { ...organizationFixture('APPROVED'), canPublish: false }; await fulfillCase(route, 'adminDecideOrganizationSuccess', { responseBody: { ...model.organization.application!, organizationId: '00000003-0000-4000-8000-000000000099' } }); });
  await page.goto(reviewPath); await page.getByRole('button', { name: 'Предоставить допуск' }).click(); await expect(page.getByText(/Ответ на решение не получен/)).toBeVisible(); await expect(page.getByText(/Сервер подтвердил решение/)).toHaveCount(0);
});

test('return to tab refreshes decision; a failed reread hides old data and actions', async ({ page }) => {
  const model = await adminFixtures(page); await page.goto(reviewPath); await expect(page.getByRole('button', { name: 'Предоставить допуск' })).toBeVisible();
  model.organization = { ...organizationFixture('REJECTED'), canPublish: false }; await revisitTab(page); await expect(page.getByRole('heading', { name: 'Причина отказа' })).toBeVisible(); await expect(page.getByRole('button', { name: 'Предоставить допуск' })).toHaveCount(0);
  await page.route('**/api/v1/admin/organizations/*', (route) => apiError(route, 500, 'INTERNAL_ERROR')); await page.getByRole('button', { name: 'Обновить профиль' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Не удалось загрузить страницу'); await expect(page.getByRole('heading', { name: 'Причина отказа' })).toHaveCount(0);
});

for (const code of ['CSRF_REJECTED', 'FORBIDDEN'] as const) test(`${code} decision is not a success`, async ({ page }) => {
  const model = await adminFixtures(page);
  await page.route('**/api/v1/admin/applications/*/decision', async (route) => { model.bodies.push(route.request().postDataJSON()); await apiError(route, 403, code); });
  await page.goto(reviewPath); await page.getByRole('button', { name: 'Предоставить допуск' }).click(); await expect(page.getByRole('alert')).toContainText(code === 'CSRF_REJECTED' ? 'Сервер не принял запрос' : 'Нет права'); await expect(page.getByText(/Сервер подтвердил решение/)).toHaveCount(0); expect(model.bodies).toHaveLength(1);
});

test('session expiration hides the rejection reason and clears administrative query cache', async ({ page }) => {
  await adminFixtures(page); await page.goto(reviewPath); await page.getByRole('button', { name: 'Отклонить', exact: true }).click(); await page.getByLabel('Причина отказа (обязательно)').fill('PRIVATE_REASON');
  await page.route('**/api/v1/me', (route) => apiError(route, 401, 'SESSION_EXPIRED'));
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByRole('heading', { name: 'Войди, чтобы проверить доступ' })).toBeVisible(); await expect(page.getByRole('dialog')).toHaveCount(0); await expect(page.locator('body')).not.toContainText('PRIVATE_REASON');
  expect(await page.evaluate(async () => { const modulePath = '/src/app/App.tsx'; const { queryClient } = await import(modulePath); return queryClient.getQueryCache().getAll().filter((query: { queryKey: unknown[] }) => query.queryKey.includes('admin-organization') || query.queryKey[0] === 'admin').length; })).toBe(0);
});

for (const width of [320, 390, 768, 1280]) test(`administrative organizations layout at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 }); const model = await adminFixtures(page); model.organization.description = 'Открытые тренировки для начинающих и опытных участников.\nЗнакомимся с разными видами спорта.';
  await page.goto('/admin/organizations'); await expect(page.getByRole('article')).toHaveCount(1); await page.screenshot({ path: `.artifacts/fe-07/list-${width}.png`, fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('link', { name: 'Открыть профиль' }).click(); await expect(page.getByRole('button', { name: 'Предоставить допуск' })).toBeVisible(); await page.screenshot({ path: `.artifacts/fe-07/review-${width}.png`, fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Отклонить', exact: true }).click(); await expect(page.getByRole('dialog')).toBeVisible(); await page.screenshot({ path: `.artifacts/fe-07/reject-${width}.png`, fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); await page.keyboard.press('Escape'); await expect(page.getByRole('button', { name: 'Отклонить', exact: true })).toBeFocused();
});
