import { expect, test, type Page } from '@playwright/test';
import type { components } from '../../../../shared/api/client';
import { guestFixtures, fulfillCase, httpCase, meFixture } from '../../../auth/tests/http-fixtures';
async function setup(page: Page, admin = true) {
  await guestFixtures(page); const me = { ...meFixture(), systemRole: admin ? 'ADMIN' as const : 'USER' as const, sessionExpiresAt: '2099-01-01T00:00:00Z' };
  await page.route('**/api/v1/me', (route) => fulfillCase(route, 'getMeSuccess', { responseBody: me }));
  await page.route('**/api/v1/admin/demo-state', (route) => fulfillCase(route, 'adminGetDemoStateSuccess'));
  return me;
}
test('reset needs exact confirmation and sends one fresh immutable command', async ({ page }) => {
  await setup(page); let reads = 0; const posts: components['schemas']['DemoResetInput'][] = [];
  await page.route('**/api/v1/admin/demo-state', (route) => { reads++; return fulfillCase(route, 'adminGetDemoStateSuccess', { responseBody: { ...(httpCase('adminGetDemoStateSuccess').responseBody as object), seedVersion: reads > 1 ? 'fresh-version' : 'old-version' } }); });
  await page.route('**/api/v1/admin/demo-reset', (route) => { const body = route.request().postDataJSON(); posts.push(body); return fulfillCase(route, 'adminResetDemoDataSuccess', { responseBody: { ...(httpCase('adminResetDemoDataSuccess').responseBody as object), resetId: body.resetId, seedVersion: body.expectedSeedVersion } }); });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/me'); await page.getByRole('button', { name: 'Восстановить демоданные', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('fresh-version');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: '.artifacts/fe14-15/reset-confirm-390.png', fullPage: true });
  const confirm = dialog.getByRole('button', { name: 'Сбросить базу', exact: true });
  await expect(confirm).toBeDisabled();
  await dialog.getByLabel('Для подтверждения введи СБРОСИТЬ', { exact: true }).fill(' СБРОСИТЬ'); await expect(confirm).toBeDisabled();
  await dialog.getByLabel('Для подтверждения введи СБРОСИТЬ', { exact: true }).fill('СБРОСИТЬ'); await confirm.click();
  await expect(page).toHaveURL('/login?returnTo=%2Fme');
  await expect(page.getByText(/Демоданные восстановлены. Войди заново/)).toBeVisible();
  expect(posts).toHaveLength(1); expect(posts[0]).toMatchObject({ expectedSeedVersion: 'fresh-version', confirmation: 'СБРОСИТЬ', expectedGeneration: '00000009-0000-4000-8000-000000000001' });
  expect(await page.evaluate(() => localStorage.getItem('ryadom.pending-demo-reset.v1'))).toBe(posts[0].resetId);
});
test('lost reset response survives reload and only matching receipt proves success', async ({ page }) => {
  await setup(page); let resetId = '', posts = 0;
  await page.route('**/api/v1/admin/demo-reset', (route) => { posts++; resetId = route.request().postDataJSON().resetId; return route.abort(); });
  await page.goto('/me'); await page.getByRole('button', { name: 'Восстановить демоданные', exact: true }).click();
  await page.getByLabel('Для подтверждения введи СБРОСИТЬ', { exact: true }).fill('СБРОСИТЬ'); await page.getByRole('button', { name: 'Сбросить базу', exact: true }).click();
  await expect(page.getByText(/Результат сброса не подтверждён/)).toBeVisible();
  await page.reload(); await expect(page.getByText(/Последняя квитанция пока не подтверждает/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Восстановить демоданные', exact: true })).toHaveCount(0);
  await page.route('**/api/v1/admin/demo-state', (route) => fulfillCase(route, 'demoStateAfterReset', { responseBody: { ...(httpCase('demoStateAfterReset').responseBody as components['schemas']['DemoState']), lastReset: { ...(httpCase('adminResetDemoDataSuccess').responseBody as components['schemas']['DemoResetReceipt']), resetId } } }));
  await page.getByRole('button', { name: 'Проверить последнюю квитанцию', exact: true }).click();
  await expect(page.getByText(/Квитанция сервера подтверждает/)).toBeVisible(); expect(posts).toBe(1);
});
test('USER and disabled demo mode have no reset control', async ({ page }) => {
  await setup(page, false); let reads = 0;
  await page.route('**/api/v1/admin/demo-state', (route) => { reads++; return fulfillCase(route, 'demoStateDisabled'); });
  await page.goto('/me'); await expect(page.getByRole('heading', { name: 'Твои встречи', exact: true })).toBeVisible();
  expect(reads).toBe(0); await expect(page.getByRole('button', { name: 'Восстановить демоданные', exact: true })).toHaveCount(0);
  await setup(page); await page.route('**/api/v1/admin/demo-state', (route) => fulfillCase(route, 'demoStateDisabled'));
  await page.reload(); await expect(page.getByRole('region', { name: 'Модерация', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Восстановить демоданные', exact: true })).toHaveCount(0);
});
test('stale reset requires new confirmation without substituting new versions', async ({ page }) => {
  await setup(page); let posts = 0;
  await page.route('**/api/v1/admin/demo-reset', (route) => { posts++; return fulfillCase(route, 'resetStaleGeneration'); });
  await page.goto('/me'); await page.getByRole('button', { name: 'Восстановить демоданные', exact: true }).click();
  await page.getByLabel('Для подтверждения введи СБРОСИТЬ', { exact: true }).fill('СБРОСИТЬ'); await page.getByRole('button', { name: 'Сбросить базу', exact: true }).click();
  await expect(page.getByText(/Состояние или версия сида изменились/)).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Восстановить демоданные', exact: true })).toHaveCount(0); expect(posts).toBe(1);
});
