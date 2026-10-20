// Short read-only shipped-image check on accepted BE-P2. Never sends reset/status requests.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium, expect } = require('@playwright/test');
const accounts = require('../../../../../demo-accounts.json');
(async () => {
  const base = process.env.FE_ADMIN_BASE_URL || 'http://127.0.0.1:4192';
  const output = path.resolve('.artifacts/fe14-15/runtime'); await fs.mkdir(output, { recursive: true });
  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || '/usr/bin/google-chrome', headless: true });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'ru-RU' });
  try {
    const page = await context.newPage(), errors = [], writes = [];
    page.on('pageerror', (error) => errors.push(error.message));
    // Abort product mutations, even if a UI regression attempted one during this read-only check.
    await context.route('**/api/v1/**', (route) => {
      const request = route.request();
      if (!['GET', 'HEAD'].includes(request.method()) && !new URL(request.url()).pathname.startsWith('/api/v1/auth/')) { writes.push(request.url()); return route.abort(); }
      return route.continue();
    });
    const marina = accounts.find((item) => item.key === 'marina');
    await page.goto(`${base}/login?returnTo=%2Fme`);
    await page.getByLabel(/^Email/).fill(marina.email); await page.getByLabel(/^Пароль/).fill(marina.password); await page.getByRole('button', { name: 'Войти', exact: true }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Личный профиль');
    const demo = await context.request.get(`${base}/api/v1/admin/demo-state`); assert.equal(demo.status(), 404);
    await expect(page.getByRole('button', { name: 'Восстановить демоданные', exact: true })).toHaveCount(0);
    await page.getByRole('link', { name: 'Аккаунты', exact: true }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Модерация аккаунтов');
    await expect(page.getByRole('heading', { name: 'Аккаунты не загрузились', exact: true })).toBeVisible();
    await expect(page.getByText('По этим условиям аккаунтов нет.', { exact: true })).toHaveCount(0);
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.screenshot({ path: path.join(output, 'accounts-unavailable-390.png'), fullPage: true });
    await page.reload(); await expect(page.getByRole('heading', { name: 'Аккаунты не загрузились', exact: true })).toBeVisible();
    assert.deepEqual(writes, []); assert.deepEqual(errors, []);
    console.log('PASS: production image, real ADMIN login/profile/account route/reload/mobile, BE-12 disabled state and honest missing BE-13 error. No reset/status request; real acceptance remains pending.');
  } finally {
    await context.request.post(`${base}/api/v1/auth/logout`, { headers: { Origin: base } }).catch(() => undefined);
    await context.close(); await browser.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
