// Short real FE-11 acceptance on BE-P2; run only against a disposable seeded database.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium, expect } = require('@playwright/test');
const accounts = require('../../../../../demo-accounts.json');
(async () => {
  const base = process.env.FE_P3_BASE_URL;
  assert(base && new URL(base).hostname === '127.0.0.1', 'explicit disposable loopback base required');
  assert(process.env.FE_P3_DISPOSABLE === 'true', 'mutates only an explicitly disposable test database');
  const output = path.resolve('.artifacts/fe-p3/runtime'); await fs.mkdir(output, { recursive: true });
  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || '/usr/bin/google-chrome', headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'ru-RU' });
  const guest = await browser.newContext();
  try {
    const page = await context.newPage(), errors = [], posts = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('request', (request) => { if (request.method() === 'POST' && !request.url().includes('/auth/')) posts.push(request.url()); });
    const marina = accounts.find((item) => item.key === 'marina');
    await page.goto(`${base}/login?returnTo=${encodeURIComponent('/admin/events')}`);
    await page.getByLabel(/^Email/).fill(marina.email); await page.getByLabel(/^Пароль/).fill(marina.password); await page.getByRole('button', { name: 'Войти', exact: true }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Модерация встреч');
    if (process.env.FE_P3_VERIFY_ONLY === 'true') {
      await page.getByLabel('Поиск встреч', { exact: true }).fill('Шахматы');
      await page.getByRole('button', { name: 'Найти встречи', exact: true }).click();
      await expect(page).toHaveURL(/q=/);
      await page.goBack(); await expect(page.getByLabel('Поиск встреч', { exact: true })).toHaveValue('');
      const stored = await context.request.get(`${base}/api/v1/admin/events?publicationStatus=UNPUBLISHED&limit=100`);
      assert.equal(stored.status(), 200);
      const event = (await stored.json()).items.find((item) => item.unpublication?.reason === 'Проверка FE-P3 в отдельной тестовой базе.');
      assert(event);
      await page.goto(`${base}/admin/events/${event.id}`);
      await expect(page.getByText('Снято с публикации', { exact: true })).toBeVisible();
      await expect(page.getByText(/Причина снятия: Проверка FE-P3/)).toBeVisible();
      assert.equal((await guest.request.get(`${base}/api/v1/events/${event.id}`)).status(), 404);
      assert.deepEqual(posts, []); assert.deepEqual(errors, []);
      console.log('PASS final image: URL/back search synchronization and saved unpublication read through UI/API; no business POST.');
      return;
    }
    const response = await context.request.get(`${base}/api/v1/admin/events?publicationStatus=PUBLISHED&limit=100`);
    assert.equal(response.status(), 200);
    let chosen, message;
    for (const item of (await response.json()).items) {
      const reply = await context.request.get(`${base}/api/v1/admin/events/${item.id}/messages?limit=100`);
      assert.equal(reply.status(), 200);
      const visible = (await reply.json()).items.find((entry) => entry.status === 'VISIBLE');
      if (visible) { chosen = item; message = visible; break; }
    }
    assert(chosen && message, 'standard seed must contain a published event and visible message');
    await page.goto(`${base}/admin/events/${chosen.id}`);
    const card = page.getByRole('article').filter({ hasText: message.body });
    await card.getByRole('button', { name: 'Скрыть сообщение', exact: true }).click();
    await expect(page.getByText('Сервер подтвердил скрытие сообщения.', { exact: true })).toBeVisible();
    await expect(card.getByText('Скрыто', { exact: true })).toBeVisible();
    const publicMessages = await guest.request.get(`${base}/api/v1/events/${chosen.id}/messages?limit=100`);
    assert.equal(publicMessages.status(), 200);
    const hidden = (await publicMessages.json()).items.find((item) => item.id === message.id);
    assert(hidden && hidden.status === 'HIDDEN' && !('body' in hidden));
    await page.screenshot({ path: path.join(output, 'message-hidden-1280.png'), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByLabel('Причина снятия (обязательно)', { exact: true }).fill('Проверка FE-P3 в отдельной тестовой базе.');
    await page.getByRole('button', { name: 'Снять с публикации', exact: true }).click();
    await expect(page.getByText('Сервер подтвердил снятие встречи с публикации.', { exact: true })).toBeVisible();
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.screenshot({ path: path.join(output, 'unpublished-390.png'), fullPage: true });
    const missing = await guest.request.get(`${base}/api/v1/events/${chosen.id}`);
    assert.equal(missing.status(), 404);
    assert.equal(posts.filter((url) => url.endsWith('/hide')).length, 1);
    assert.equal(posts.filter((url) => url.endsWith('/unpublish')).length, 1);
    assert.equal(posts.length, 2); assert.deepEqual(errors, []);
    await page.goto(`${base}/admin/activity-types`);
    await expect(page.getByRole('heading', { name: 'Направления не загрузились', exact: true })).toBeVisible();
    console.log('PASS FE-11: real production Compose UI hide by revision and unpublish with reason; guest HIDDEN has no body and unpublished returns 404; desktop/mobile, exactly two business POST. FE-12/13 await BE-10/11.');
  } finally {
    await context.request.post(`${base}/api/v1/auth/logout`, { headers: { Origin: base } }).catch(() => undefined);
    await guest.close(); await context.close(); await browser.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
