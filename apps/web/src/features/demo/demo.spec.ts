import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fulfillCase, guestFixtures, meFixture } from '../auth/tests/http-fixtures';
import type { DemoAccount } from './demo-access';

const accounts: DemoAccount[] = JSON.parse(readFileSync(resolve('apps/web/demo-accounts.json'), 'utf8'));

test.skip(process.env.VITE_DEMO_ACCESS !== 'true', 'Public demo access is disabled by default; run with VITE_DEMO_ACCESS=true.');

test.beforeEach(async ({ page }) => { await guestFixtures(page); });

test('demo page and direct download contain the same six public identities', async ({ page }) => {
  await page.goto('/demo');
  await expect(page.getByRole('heading', { name: 'Демонстрационные аккаунты' })).toBeVisible();
  for (const account of accounts) {
    await expect(page.getByRole('heading', { name: account.name, exact: true })).toBeVisible();
    await expect(page.getByText(account.email, { exact: true })).toBeVisible();
  }
  const direct = await page.request.get('/demo/accounts.txt');
  expect(direct.status()).toBe(200);
  expect(direct.headers()['content-type']).toContain('text/plain');
  expect(direct.headers()['content-disposition']).toContain('attachment');
  const text = await direct.text();
  for (const account of accounts) {
    expect(text).toContain(account.email); expect(text).toContain(account.password); expect(text).toContain(account.description);
  }
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Скачать аккаунты и описания (.txt)' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('ryadom-demo-accounts.txt');
  expect(readFileSync((await download.path())!, 'utf8')).toBe(text);
});

test('page choice fills credentials without login, retains safe returnTo and requires explicit submit', async ({ page }) => {
  let requests = 0;
  let body: unknown;
  await page.route('**/api/v1/auth/login', async (route) => { requests++; body = route.request().postDataJSON(); await fulfillCase(route, 'loginSuccess'); });
  await page.goto('/demo?returnTo=%2Fme');
  await page.getByRole('link', { name: 'Подставить данные: Алексей', exact: true }).click();
  await expect(page).toHaveURL('/login?returnTo=%2Fme');
  await expect(page.locator('input[name=email]')).toHaveValue('alex@example.test');
  await expect(page.locator('input[name=password]')).toHaveValue('Ryadom-Alex-2026!');
  expect(requests).toBe(0);
  const edited = 'An-edited-password-2026!';
  await page.locator('input[name=password]').fill(edited);
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  await expect(page).toHaveURL('/me');
  expect(requests).toBe(1);
  expect(body).toEqual({ email: 'alex@example.test', password: edited });
});

test('login picker works by keyboard and blocked identity is checked by API', async ({ page }) => {
  let requests = 0;
  await page.route('**/api/v1/auth/login', async (route) => { requests++; expect(route.request().postDataJSON().email).toBe('blocked@example.test'); await fulfillCase(route, 'loginBlockedAccount'); });
  await page.goto('/login');
  await page.locator('summary').focus();
  await page.keyboard.press('Enter');
  const choice = page.getByRole('button', { name: 'Подставить данные: Борис', exact: true });
  await choice.focus(); await page.keyboard.press('Enter');
  await expect(page.locator('input[name=email]')).toBeFocused();
  await expect(page.getByRole('status')).toContainText('Подставлены данные: Борис');
  expect(requests).toBe(0);
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Аккаунт заблокирован.');
  expect(requests).toBe(1);
});

test('picker cannot override rate limit or trigger another request', async ({ page }) => {
  let count = 0;
  await page.route('**/api/v1/auth/login', async (route) => { count++; await fulfillCase(route, 'loginRateLimited', { headers: { 'Retry-After': '60' } }); });
  await page.goto('/login'); await page.locator('summary').click();
  await page.getByRole('button', { name: 'Подставить данные: Алексей', exact: true }).click();
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Подставить данные: Анна', exact: true })).toBeDisabled();
  expect(count).toBe(1);
});

test('choosing a demo identity never replaces the current authenticated account', async ({ page }) => {
  await page.route('**/api/v1/me', (route) => fulfillCase(route, 'getMeSuccess', { responseBody: meFixture() }));
  let count = 0;
  page.on('request', (request) => { if (request.url().endsWith('/auth/login')) count++; });
  await page.goto('/demo');
  await page.getByRole('link', { name: 'Подставить данные: Марина', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Ты уже вошёл' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Выйти и сменить аккаунт' })).toBeVisible();
  await expect(page.locator('input[name=email]')).toHaveCount(0);
  expect(count).toBe(0);
});

for (const width of [320, 390, 768, 1280]) {
  test(`demo page and picker fit ${width}px with visible actions`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/demo');
    await expect(page.getByRole('link', { name: 'Подставить данные: Алексей', exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `.artifacts/demo-access/demo-${width}.png`, fullPage: true });
    await page.goto('/login'); await page.locator('summary').click();
    await expect(page.getByRole('button', { name: 'Подставить данные: Борис', exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `.artifacts/demo-access/login-${width}.png`, fullPage: true });
  });
}
