import { test, expect, type Page } from '@playwright/test';
import type { components } from '../../../../shared/api/client';
import { guestFixtures, fulfillCase, httpCase, meFixture } from '../../../auth/tests/http-fixtures';
const id = '00000002-0000-4000-8000-000000000001';
const messageId = '00000005-0000-4000-8000-000000000001';
async function admin(page: Page) {
  await guestFixtures(page); const me = meFixture(); me.systemRole = 'ADMIN'; me.sessionExpiresAt = '2099-01-01T00:00:00Z';
  await page.route('**/api/v1/me', (route) => fulfillCase(route, 'getMeSuccess', { responseBody: me }));
}
test('moderation requires reason and uses the viewed message revision', async ({ page }) => {
  await admin(page); let removed = false, hidden = false; const bodies: unknown[] = [];
  await page.route(`**/api/v1/admin/events/${id}`, (route) => fulfillCase(route, removed ? 'adminUnpublishEventSuccess' : 'adminGetEventSuccess'));
  await page.route(`**/api/v1/admin/events/${id}/messages?*`, (route) => fulfillCase(route, 'adminListMessagesSuccess', { responseBody: { items: [hidden ? httpCase('adminHideMessageSuccess').responseBody : (httpCase('adminListMessagesSuccess').responseBody as components['schemas']['AdminMessagePage']).items[0]], nextCursor: null } }));
  await page.route(`**/api/v1/admin/messages/${messageId}/hide`, (route) => { bodies.push(route.request().postDataJSON()); hidden = true; return fulfillCase(route, 'adminHideMessageSuccess'); });
  await page.route(`**/api/v1/admin/events/${id}/unpublish`, (route) => { bodies.push(route.request().postDataJSON()); removed = true; return fulfillCase(route, 'adminUnpublishEventSuccess'); });
  await page.goto(`/admin/events/${id}`);
  await page.getByRole('button', { name: 'Скрыть сообщение', exact: true }).click();
  await expect(page.getByText('Сервер подтвердил скрытие сообщения.', { exact: true })).toBeVisible();
  expect(bodies[0]).toEqual({ expectedRevision: 0 });
  await page.getByRole('button', { name: 'Снять с публикации', exact: true }).click();
  await expect(page.getByLabel('Причина снятия (обязательно)', { exact: true })).toBeFocused();
  expect(bodies).toHaveLength(1);
  const row = httpCase('adminUnpublishEventSuccess').responseBody as components['schemas']['AdminEvent'];
  await page.getByLabel('Причина снятия (обязательно)', { exact: true }).fill(row.unpublication!.reason);
  await page.getByRole('button', { name: 'Снять с публикации', exact: true }).click();
  await expect(page.getByText('Сервер подтвердил снятие встречи с публикации.', { exact: true })).toBeVisible();
  expect(bodies[1]).toEqual({ reason: row.unpublication!.reason });
});
test('USER never starts administrative reads', async ({ page }) => {
  await guestFixtures(page); let reads = 0;
  await page.route('**/api/v1/me', (route) => fulfillCase(route, 'getMeSuccess'));
  await page.route('**/api/v1/admin/**', (route) => { reads++; return route.abort(); });
  await page.goto('/admin/events');
  await expect(page.getByRole('heading', { name: 'Нет доступа к разделу', exact: true })).toBeVisible();
  expect(reads).toBe(0);
});

test('activity rename conflict keeps input and never substitutes expectedName automatically', async ({ page }) => {
  await admin(page); const activity = httpCase('adminGetActivityTypeSuccess').responseBody as components['schemas']['AdminActivityType'];
  await page.route('**/api/v1/admin/activity-types?*', (route) => fulfillCase(route, 'adminListActivityTypesSuccess'));
  await page.route(`**/api/v1/admin/activity-types/${activity.id}`, async (route) => {
    if (route.request().method() === 'PATCH') { expect(route.request().postDataJSON()).toEqual({ name: 'Новое имя', expectedName: activity.name }); return route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: { code: 'ACTIVITY_TYPE_CHANGED', message: 'Changed', requestId: 'test', fieldErrors: {} } }) }); }
    return fulfillCase(route, 'adminGetActivityTypeSuccess');
  });
  await page.goto(`/admin/activity-types?id=${activity.id}`);
  await page.getByLabel('Имя направления', { exact: true }).fill('Новое имя');
  await page.getByRole('button', { name: 'Исправить имя', exact: true }).click();
  await expect(page.getByText(/Сведения изменились. Перечитай текущую версию/)).toBeVisible();
  await expect(page.getByLabel('Имя направления', { exact: true })).toHaveValue('Новое имя');
  await expect(page.getByRole('button', { name: 'Исправить имя', exact: true })).toBeDisabled();
});
test('activity approval sends expectedName and the corrected name together', async ({ page }) => {
  await admin(page); const activity = httpCase('adminGetActivityTypeSuccess').responseBody as components['schemas']['AdminActivityType']; let approved = false;
  await page.route('**/api/v1/admin/activity-types?*', (route) => fulfillCase(route, 'adminListActivityTypesSuccess'));
  await page.route(`**/api/v1/admin/activity-types/${activity.id}`, (route) => fulfillCase(route, 'adminGetActivityTypeSuccess', { responseBody: approved ? { ...activity, name: 'Новое имя', catalogStatus: 'APPROVED', canDecide: false } : activity }));
  await page.route(`**/api/v1/admin/activity-types/${activity.id}/decision`, (route) => { expect(route.request().postDataJSON()).toEqual({ decision: 'APPROVE', name: 'Новое имя', expectedName: activity.name }); approved = true; return fulfillCase(route, 'adminDecideActivityTypeSuccess', { responseBody: { ...activity, name: 'Новое имя', catalogStatus: 'APPROVED', canDecide: false } }); });
  await page.goto(`/admin/activity-types?id=${activity.id}`); await page.getByLabel('Имя направления', { exact: true }).fill('Новое имя');
  await page.getByRole('button', { name: 'Одобрить направление', exact: true }).click();
  await expect(page.getByText('Сервер подтвердил изменение направления.', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Одобрить направление', exact: true })).toHaveCount(0);
});

test('report duplicate returns a closed receipt without reopening it or asking a reason', async ({ page }) => {
  await guestFixtures(page); await page.route('**/api/v1/me', (route) => fulfillCase(route, 'getMeSuccess'));
  let posts = 0;
  await page.route(`**/api/v1/events/${id}/reports`, (route) => { posts++; expect(route.request().postData()).toBeNull(); return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ...(httpCase('reportEventSuccess').responseBody as object), status: 'DISMISSED', reviewedAt: '2026-11-02T10:00:00Z' }) }); });
  await page.goto(`/events/${id}`); await page.getByRole('button', { name: 'Пожаловаться на встречу', exact: true }).click();
  await expect(page.getByText(/Эта жалоба уже отклонена/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Пожаловаться на встречу', exact: true })).toHaveCount(0);
  expect(posts).toBe(1);
});
test('restoration uses viewed revision and keeps the selected message when it leaves the report filter', async ({ page }) => {
  await admin(page); let restored = false;
  const hidden = { ...(httpCase('adminHideMessageSuccess').responseBody as components['schemas']['AdminMessage']), openReportsCount: 1, reportsRevision: 4 };
  await page.route(`**/api/v1/admin/events/${id}`, (route) => fulfillCase(route, 'adminGetEventSuccess'));
  await page.route(`**/api/v1/admin/events/${id}/messages?*`, (route) => fulfillCase(route, 'adminListMessagesSuccess', { responseBody: { items: restored ? [] : [hidden], nextCursor: null } }));
  await page.route(`**/api/v1/admin/messages/${messageId}`, (route) => fulfillCase(route, 'adminHideMessageSuccess', { responseBody: { ...hidden, status: restored ? 'VISIBLE' : 'HIDDEN', openReportsCount: 0, moderationRevision: restored ? 2 : 1 } }));
  await page.route(`**/api/v1/admin/messages/${messageId}/restore`, (route) => { expect(route.request().postDataJSON()).toEqual({ expectedRevision: 1 }); restored = true; return fulfillCase(route, 'adminHideMessageSuccess', { responseBody: { ...hidden, status: 'VISIBLE', moderationRevision: 2 } }); });
  await page.goto(`/admin/events/${id}?messageReports=true`);
  await page.getByRole('button', { name: 'Восстановить сообщение', exact: true }).click();
  await expect(page.getByText('Сервер подтвердил восстановление сообщения.', { exact: true })).toBeVisible();
  await expect(page.getByText('Нужен ли свой инвентарь?', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Скрыть сообщение', exact: true })).toBeVisible();
});
test('report conflict locks dismissal until successful explicit reread', async ({ page }) => {
  await admin(page);
  await page.route(`**/api/v1/admin/events/${id}`, (route) => fulfillCase(route, 'adminGetEventSuccess', { responseBody: { ...(httpCase('adminGetEventSuccess').responseBody as object), openEventReportsCount: 2, eventReportsRevision: 7 } }));
  await page.route(`**/api/v1/admin/events/${id}/messages?*`, (route) => fulfillCase(route, 'adminListMessagesSuccess'));
  await page.route(`**/api/v1/admin/events/${id}/reports/dismiss`, (route) => { expect(route.request().postDataJSON()).toEqual({ expectedReportsRevision: 7 }); return route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: { code: 'REPORTS_CHANGED', message: 'Changed', requestId: 'test', fieldErrors: {} } }) }); });
  await page.goto(`/admin/events/${id}`); await page.getByRole('button', { name: 'Отклонить жалобы на встречу', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Отклонить жалобы на встречу', exact: true })).toBeDisabled();
  await expect(page.getByText(/Сведения изменились. Перечитай текущую версию/)).toBeVisible();
});

test('unknown moderation result never retries and failed reread keeps actions locked', async ({ page }) => {
  await admin(page); let posts = 0;
  await page.route(`**/api/v1/admin/events/${id}`, (route) => fulfillCase(route, 'adminGetEventSuccess'));
  await page.route(`**/api/v1/admin/events/${id}/messages?*`, (route) => fulfillCase(route, 'adminListMessagesSuccess'));
  await page.route(`**/api/v1/admin/events/${id}/unpublish`, (route) => { posts++; return route.abort(); });
  await page.goto(`/admin/events/${id}`);
  await page.getByLabel('Причина снятия (обязательно)', { exact: true }).fill('Проверка условий');
  await page.getByRole('button', { name: 'Снять с публикации', exact: true }).click();
  await expect(page.getByText(/Результат операции неизвестен/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Снять с публикации', exact: true })).toBeDisabled();
  await page.route(`**/api/v1/admin/events/${id}`, (route) => fulfillCase(route, 'internalError'));
  await page.getByRole('button', { name: 'Перечитать встречу', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Не удалось загрузить страницу', exact: true })).toBeVisible();
  expect(posts).toBe(1);
});
