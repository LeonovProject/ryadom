// Short shipped-image check against accepted BE-P1. BE-07/08 acceptance stays with integration.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium, expect } = require('@playwright/test');
const accounts = require('../../../../../demo-accounts.json');
(async () => {
  const base = process.env.FE_P2_BASE_URL || 'http://127.0.0.1:4189';
  const output = path.resolve('.artifacts/fe-p2/runtime'); await fs.mkdir(output, { recursive: true });
  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || '/usr/bin/google-chrome', headless: true });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, timezoneId: 'Pacific/Honolulu', locale: 'ru-RU' });
  try {
    const page = await context.newPage(), errors = [], businessPosts = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('request', (request) => { if (request.method() === 'POST' && !/\/auth\/(login|logout)$/.test(request.url())) businessPosts.push(request.url()); });
    await page.goto(`${base}/me/events?tab=created`);
    await expect(page.getByRole('heading', { name: 'Войди, чтобы открыть свои встречи', exact: true })).toBeVisible();
    await page.getByRole('main').getByRole('link', { name: 'Войти', exact: true }).click();
    const anna = accounts.find((item) => item.email === 'anna@example.test');
    await page.getByLabel(/^Email/).fill(anna.email); await page.getByLabel(/^Пароль/).fill(anna.password);
    await page.getByRole('button', { name: 'Войти', exact: true }).click();
    await expect(page).toHaveURL(`${base}/me/events?tab=created`);
    await expect(page.getByRole('article').first()).toBeVisible();
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.screenshot({ path: path.join(output, 'created-390.png'), fullPage: true });
    const response = await context.request.get(`${base}/api/v1/me/events?limit=100`);
    assert.equal(response.status(), 200);
    const event = (await response.json()).items.find((item) => item.event.publicationStatus === 'PUBLISHED').event;
    await page.goto(`${base}/events/${event.id}`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(event.title);
    await expect(page.getByRole('heading', { name: 'Обсуждение сейчас недоступно', exact: true })).toBeVisible();
    await expect(page.getByText('Пока нет сообщений. Можно задать первый вопрос.', { exact: true })).toHaveCount(0);
    await page.screenshot({ path: path.join(output, 'detail-390.png'), fullPage: true });
    await page.getByRole('link', { name: 'Участники и заявки', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Состав сейчас недоступен', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Принять', exact: true })).toHaveCount(0);
    await page.goto(base);
    await expect(page.getByRole('heading', { name: 'Не удалось загрузить личные планы', exact: true })).toBeVisible();
    await expect(page.getByText('Пока нет предстоящих подтверждённых встреч.', { exact: false })).toHaveCount(0);
    await page.screenshot({ path: path.join(output, 'home-390.png'), fullPage: true });
    assert.deepEqual(errors, []); assert.deepEqual(businessPosts, []);
    console.log('PASS: production Compose web, real login/returnTo/created list, mobile routes, honest BE-07/08 error states, no business POST or browser errors. S3-S5 not accepted.');
  } finally {
    await context.request.post(`${base}/api/v1/auth/logout`, { headers: { Origin: base } }).catch(() => undefined);
    await context.close(); await browser.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
