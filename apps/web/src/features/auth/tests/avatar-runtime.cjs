// One real registration; run only against an explicit local disposable DB.
const assert = require('node:assert/strict');
const { chromium, expect } = require('@playwright/test');
(async () => {
  const base = process.env.AVATAR_BASE_URL;
  assert.equal(process.env.AVATAR_DISPOSABLE, 'true');
  assert(base && new URL(base).hostname === '127.0.0.1');
  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || '/usr/bin/google-chrome' });
  const context = await browser.newContext();
  try {
    const page = await context.newPage(); let posts = 0;
    page.on('request', (r) => { if (r.method() === 'POST' && r.url().endsWith('/auth/register')) posts++; });
    await page.addInitScript(() => { Math.random = () => 0.9999; });
    await page.goto(`${base}/register`);
    await expect(page.getByRole('radio', { name: 'Волшебник', exact: true })).toBeChecked();
    await page.getByLabel('Имя (обязательно)', { exact: true }).fill('Проверка новых аватаров');
    await page.getByLabel('Email (обязательно)', { exact: true }).fill(`avatar-${Date.now()}@example.test`);
    await page.getByLabel('Пароль (обязательно)', { exact: true }).fill('avatar-runtime-password');
    await page.getByLabel('Повтори пароль (обязательно)', { exact: true }).fill('avatar-runtime-password');
    const response = page.waitForResponse((r) => r.url().endsWith('/auth/register') && r.request().method() === 'POST');
    await page.getByRole('button', { name: 'Создать профиль', exact: true }).click();
    const result = await response; assert.equal(result.status(), 201);
    const me = await result.json(); assert.equal(me.account.avatarUrl, '/assets/avatars/presets/wizard.svg');
    const catalog = await (await context.request.get(`${base}/api/v1/avatar-presets`)).json(); assert.equal(catalog.items.length, 7);
    for (const item of catalog.items) {
      const image = await context.request.get(`${base}${item.imageUrl}`);
      assert.equal(image.status(), 200); assert.match(await image.text(), /<svg/);
    }
    const guest = await browser.newContext();
    try {
      const profile = await (await guest.request.get(`${base}/api/v1/accounts/${me.account.id}`)).json();
      assert.equal(profile.avatarUrl, '/assets/avatars/presets/wizard.svg');
    } finally { await guest.close(); }
    assert.equal(posts, 1);
    console.log('PASS: 7 real catalog SVGs served; random preselection saved by one 201 register; guest profile exposes the selected avatar.');
  } finally {
    await context.request.post(`${base}/api/v1/auth/logout`, { headers: { Origin: base } }).catch(() => undefined);
    await context.close(); await browser.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
