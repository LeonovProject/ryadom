// FE-03 against the shipped web and real BE-03. No interception or fixture data.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium, expect } = require('@playwright/test');

(async () => {
  const base = process.env.FE_P1_BASE_URL || 'http://127.0.0.1:4188';
  const output = path.resolve('.artifacts/fe-p1/catalog-real');
  await fs.mkdir(output, { recursive: true });
  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || '/usr/bin/google-chrome', headless: true });
  try {
    const context = await browser.newContext({ locale: 'ru-RU', timezoneId: 'Pacific/Honolulu' });
    const page = await context.newPage();
    const errors = [], mutations = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('request', (request) => { if (!['GET', 'HEAD'].includes(request.method())) mutations.push(request.method()); });
    const get = async (query) => {
      const response = await context.request.get(`${base}/api/v1/events?${new URLSearchParams(query)}`);
      assert.equal(response.status(), 200);
      return response.json();
    };
    const from = '2020-01-01T00:00:00Z';
    const all = (await get({ from, limit: '100' })).items;
    assert(all.length > 12, 'isolated standard seed must exercise real pagination');
    const types = await context.request.get(`${base}/api/v1/activity-types`);
    assert.equal(types.status(), 200);
    assert((await types.json()).items.length > 0);
    const target = all.find((item) => item.joinMode === 'OPEN');
    for (const width of [320, 390, 768, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`${base}/events?${new URLSearchParams({ from })}`);
      await expect(page.getByRole('article')).toHaveCount(12);
      await page.getByRole('button', { name: 'Показать ещё', exact: true }).click();
      await expect(page.getByRole('article')).toHaveCount(all.length);
      assert.deepEqual(await page.getByRole('article').evaluateAll((cards) => cards.map((card) => card.dataset.eventId)), all.map((item) => item.id));
      const card = page.locator(`[data-event-id="${target.id}"]`);
      await card.getByRole('link', { name: 'Открыть встречу', exact: true }).click();
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(target.title);
      await page.getByRole('link', { name: '← К найденным встречам', exact: true }).click();
      await expect(card.getByRole('link', { name: 'Открыть встречу', exact: true })).toBeFocused();
      await expect(page.getByRole('article')).toHaveCount(all.length);
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await page.screenshot({ path: path.join(output, `catalog-${width}.png`), fullPage: true });
    }
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: target.timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(target.startsAt));
    const date = ['year', 'month', 'day'].map((type) => parts.find((part) => part.type === type).value).join('-');
    // A lower-only calendar window must survive a text search unchanged.
    await page.goto(`${base}/events?${new URLSearchParams({ from, dateFrom: date, joinMode: 'OPEN' })}`);
    await page.getByLabel('Что интересно?', { exact: true }).fill(target.title);
    await page.getByRole('button', { name: 'Найти встречи', exact: true }).click();
    await expect(page.getByRole('article')).toHaveCount(1);
    assert.equal(new URL(page.url()).searchParams.get('dateFrom'), date);
    assert.equal(new URL(page.url()).searchParams.has('dateTo'), false);
    await expect(page.getByRole('article')).toContainText(target.title);
    await page.reload();
    await expect(page.getByRole('article')).toHaveCount(1);
    await page.getByLabel('Что интересно?', { exact: true }).fill('несуществующая встреча FE-P1');
    await page.getByRole('button', { name: 'Найти встречи', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'По этим условиям встреч пока нет', exact: true })).toBeVisible();
    await expect(page.getByRole('article')).toHaveCount(0);
    await page.goto(base);
    await expect(page.getByRole('list', { name: 'Направления', exact: true })).toBeVisible();
    await expect(page.getByRole('article').first()).toBeVisible();
    assert.deepEqual(errors, []); assert.deepEqual(mutations, []);
    await context.close();
    console.log('PASS FE-03: real container API, directions, four widths, ordered pagination, fresh return/focus, local calendar window, URL/reload, empty search, home; no mutations');
  } finally { await browser.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
