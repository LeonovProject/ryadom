import { expect, test, type Page } from '@playwright/test';
import type { components } from '../../../../shared/api/client';
import { fulfillCase, guestFixtures, httpCase, meFixture } from '../../../auth/tests/http-fixtures';
type Account = components['schemas']['AdminAccount'];
const initial = () => (httpCase('adminListAccountsSuccess').responseBody as components['schemas']['AdminAccountPage']).items[0];
async function setup(page: Page, account = initial()) {
  await guestFixtures(page); const me = { ...meFixture(), systemRole: 'ADMIN' as const, sessionExpiresAt: '2099-01-01T00:00:00Z' };
  await page.route('**/api/v1/me', (route) => fulfillCase(route, 'getMeSuccess', { responseBody: me }));
  await page.route('**/api/v1/admin/accounts?*', (route) => fulfillCase(route, 'adminListAccountsSuccess', { responseBody: { items: [account], nextCursor: null } }));
  await page.route(`**/api/v1/admin/accounts/${account.account.id}`, (route) => fulfillCase(route, 'adminGetAccountSuccess', { responseBody: account }));
  return account;
}
for (const target of ['BLOCKED', 'ACTIVE'] as const) test(`explicit ${target} uses the viewed revision and checks server confirmation`, async ({ page }) => {
  let account = await setup(page, target === 'BLOCKED' ? initial() : httpCase('adminBlockAccountSuccess').responseBody as Account); const previous = structuredClone(account); let patches = 0;
  await page.route(`**/api/v1/admin/accounts/${account.account.id}`, (route) => fulfillCase(route, 'adminGetAccountSuccess', { responseBody: account }));
  await page.route(`**/api/v1/admin/accounts/${account.account.id}/status`, (route) => { patches++; expect(route.request().postDataJSON()).toEqual({ status: target, expectedRevision: previous.revision }); account = httpCase(target === 'BLOCKED' ? 'adminBlockAccountSuccess' : 'adminUnblockAccountSuccess').responseBody as Account; return fulfillCase(route, target === 'BLOCKED' ? 'adminBlockAccountSuccess' : 'adminUnblockAccountSuccess'); });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/admin/accounts?id=${account.account.id}`);
  await page.getByRole('button', { name: target === 'BLOCKED' ? 'Заблокировать пользователя' : 'Разблокировать пользователя', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('Алексей'); expect(patches).toBe(0);
  await page.getByRole('button', { name: 'Подтвердить изменение статуса', exact: true }).click();
  await expect(page.getByText(target === 'BLOCKED' ? /Сервер подтвердил блокировку/ : /Сервер подтвердил разблокировку/)).toBeVisible();
  await expect(page.getByRole('region', { name: 'Выбранный аккаунт' })).toContainText(target === 'BLOCKED' ? 'Статус: Заблокирован' : 'Статус: Активен');
  expect(patches).toBe(1); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: `.artifacts/fe14-15/account-${target}-390.png`, fullPage: true });
});
test('revision conflict rereads facts but keeps mutation locked until explicit check', async ({ page }) => {
  const account = await setup(page); let patches = 0;
  await page.route(`**/api/v1/admin/accounts/${account.account.id}/status`, (route) => { patches++; return fulfillCase(route, 'adminAccountRevisionConflict'); });
  await page.goto(`/admin/accounts?id=${account.account.id}`); await page.getByRole('button', { name: 'Заблокировать пользователя', exact: true }).click();
  await page.getByRole('button', { name: 'Подтвердить изменение статуса', exact: true }).click();
  await expect(page.getByText(/Версия аккаунта изменилась/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Заблокировать пользователя', exact: true })).toBeDisabled(); expect(patches).toBe(1);
  await page.getByRole('button', { name: 'Проверить текущее состояние аккаунта', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Заблокировать пользователя', exact: true })).toBeEnabled(); expect(patches).toBe(1);
});
test('unknown PATCH never replays and ADMIN cannot be targeted', async ({ page }) => {
  const account = await setup(page); let patches = 0;
  await page.route(`**/api/v1/admin/accounts/${account.account.id}/status`, (route) => { patches++; return route.abort(); });
  await page.goto(`/admin/accounts?id=${account.account.id}`); await page.getByRole('button', { name: 'Заблокировать пользователя', exact: true }).click();
  await page.getByRole('button', { name: 'Подтвердить изменение статуса', exact: true }).click();
  await expect(page.getByText(/Результат действия не подтверждён/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Заблокировать пользователя', exact: true })).toBeDisabled(); expect(patches).toBe(1);
  await page.route(`**/api/v1/admin/accounts/${account.account.id}`, (route) => fulfillCase(route, 'adminGetAccountSuccess', { responseBody: { ...account, systemRole: 'ADMIN' } }));
  await page.reload(); await expect(page.getByText('Администратора нельзя заблокировать этим действием.', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Заблокировать пользователя', exact: true })).toHaveCount(0);
});
test('USER never reads the private account list', async ({ page }) => {
  await guestFixtures(page); await page.route('**/api/v1/me', (route) => fulfillCase(route, 'getMeSuccess')); let reads = 0;
  await page.route('**/api/v1/admin/accounts**', (route) => { reads++; return route.abort(); });
  await page.goto('/admin/accounts'); await expect(page.getByRole('heading', { name: 'Нет доступа к разделу', exact: true })).toBeVisible(); expect(reads).toBe(0);
});
