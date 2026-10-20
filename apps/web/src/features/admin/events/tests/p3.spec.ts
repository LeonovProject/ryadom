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
