// Read-only smoke of a shipped web image with deliberately unavailable API.
// This verifies delivery/error states, not BE-03 filtering or database behavior.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium, expect } = require('@playwright/test');

(async () => {
  const base = process.env.CATALOG_RUNTIME_BASE_URL || 'http://127.0.0.1:4186';
  const output = path.resolve('.artifacts/fe-03-continuation/runtime');
  fs.mkdirSync(output, { recursive: true });
  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH, headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'ru-RU' });
    const page = await context.newPage();
    const errors = [], mutations = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('request', (request) => { if (!['GET', 'HEAD'].includes(request.method())) mutations.push(request.method()); });
    page.on('console', (message) => { if (message.text().includes('violates the following Content Security Policy')) errors.push(message.text()); });

    await page.goto(`${base}/events?city=${encodeURIComponent('Красноярск')}&dateFrom=2026-11-07`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Найти встречу');
    await expect(page.getByRole('heading', { name: 'Не удалось загрузить встречи', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'По этим условиям встреч пока нет', exact: true })).toHaveCount(0);
    await expect(page.getByRole('article')).toHaveCount(0);
    await expect(page.getByLabel('Город', { exact: true })).toHaveValue('Красноярск');
    await expect(page.getByLabel('Первый день', { exact: true })).toBeVisible();
    await page.screenshot({ path: path.join(output, 'catalog-unavailable-390.png'), fullPage: true });
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Не удалось загрузить встречи', exact: true })).toBeVisible();
    await page.goto(base);
    await expect(page.getByRole('heading', { name: 'Не удалось загрузить встречи', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Пока нет ближайших встреч', exact: true })).toHaveCount(0);
    await page.screenshot({ path: path.join(output, 'home-unavailable-390.png'), fullPage: true });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);

    await page.goto(`${base}/demo?returnTo=%2Fevents`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Демонстрационные аккаунты');
    await page.getByRole('link', { name: 'Подставить данные: Алексей', exact: true }).click();
    const gate = page.getByRole('button', { name: 'Открыть форму', exact: true });
    await page.getByLabel(/^Email/).or(gate).first().waitFor();
    if (await gate.isVisible()) await gate.click();
    await expect(page.getByLabel(/^Email/)).toHaveValue('alex@example.test');
    const download = await context.request.get(`${base}/demo/accounts.txt`);
    assert.equal(download.status(), 200); assert.match(await download.text(), /alex@example\.test/);
    const preset = await context.request.get(`${base}/assets/avatars/presets/ryadom-companion.svg`);
    assert.equal(preset.status(), 200); assert.match(preset.headers()['content-type'], /image\/svg\+xml/);
    const schema = await context.request.get(`${base}/api/openapi.yaml`);
    assert.equal(schema.status(), 200); assert.equal(await schema.text(), fs.readFileSync('packages/contracts/openapi.yaml', 'utf8'));
    assert.deepEqual(errors, []); assert.deepEqual(mutations, []);
    await context.close();
    console.log('PASS: production web image, unavailable API is an error, direct URL/reload, mobile layout, demo prefill/download, preset and unchanged OpenAPI; no POST or browser/CSP errors');
  } finally { await browser.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
