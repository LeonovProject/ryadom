// Run only against a disposable, initially seeded Compose project.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium, expect } = require('@playwright/test');
const accounts = require('../../../../../demo-accounts.json');
(async () => {
  assert.equal(process.env.FE16_DISPOSABLE, 'true', 'Set FE16_DISPOSABLE=true for your isolated test DB only');
  const base = process.env.FE16_BASE_URL;
  assert(base && new URL(base).hostname === '127.0.0.1', 'Explicit local disposable base URL required');
  const output = path.resolve('.artifacts/fe16/runtime'); await fs.mkdir(output, { recursive: true });
  const stateFile = path.join(output, 'created.json');
  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || '/usr/bin/google-chrome', headless: true });
  const author = await browser.newContext({ locale: 'ru-RU', timezoneId: 'Pacific/Honolulu' });
  const reader = await browser.newContext({ locale: 'ru-RU' });
  const errors = [];
  for (const context of [author, reader]) context.on('page', (page) => page.on('pageerror', (error) => errors.push(error.message)));
  try {
    let created;
    if (process.env.FE16_READ_ONLY === 'true') {
      created = JSON.parse(await fs.readFile(stateFile, 'utf8'));
    } else {
      const page = await author.newPage(), posts = [];
      page.on('request', (r) => { if (r.method() === 'POST' && new URL(r.url()).pathname === '/api/v1/events') posts.push(r.postDataJSON()); });
      await page.goto(`${base}/login?returnTo=%2Fevents%2Fnew`);
      const anna = accounts.find((item) => item.key === 'anna');
      await page.getByLabel(/^Email/).fill(anna.email); await page.getByLabel(/^Пароль/).fill(anna.password);
      await page.getByRole('button', { name: 'Войти', exact: true }).click();
      await expect(page).toHaveURL(`${base}/events/new`);
      const types = await author.request.get(`${base}/api/v1/activity-types`); assert.equal(types.status(), 200);
      const direction = (await types.json()).items[0]; assert(direction);
      const title = `Первая встреча FE-16 ${Date.now()}`;
      await page.getByLabel('Название встречи (обязательно)', { exact: true }).fill(title);
      await page.getByLabel('Выбери направление', { exact: true }).selectOption(direction.id);
      await page.getByLabel('Описание встречи (обязательно)').fill('Покажем правила игры и познакомимся');
      await page.getByLabel('Дата и время начала (обязательно)').fill('2030-11-07T10:00');
      await page.getByLabel('Город (обязательно)').fill('Красноярск');
      await page.getByLabel('Место встречи (обязательно)').fill('Вход в парк, у большой карты');
      await page.getByRole('button', { name: 'Далее: участие' }).click();
      await page.getByRole('radio', { name: 'Свободная запись', exact: false }).check();
      await page.getByLabel('Условия участия', { exact: true }).fill('Участие бесплатное.');
      await page.getByRole('button', { name: 'Что важно знать перед встречей', exact: true }).click();
      await page.getByLabel('Какая подготовка нужна и какой будет темп?', { exact: true }).fill('Без опыта, спокойный темп');
      await page.getByLabel('Что взять с собой?', { exact: true }).fill('Вода и удобная обувь');
      await page.getByLabel('Как узнать организатора на месте?', { exact: true }).fill('Анна с красной лентой');
      await page.getByLabel('Что будет в начале встречи?', { exact: true }).fill('Знакомство и объяснение <правил>');
      await page.getByRole('button', { name: 'Добавить в условия' }).dblclick();
      const conditions = 'Участие бесплатное.\n\nПодготовка и темп: Без опыта, спокойный темп\nЧто взять с собой: Вода и удобная обувь\nКак узнать организатора: Анна с красной лентой\nВ начале встречи: Знакомство и объяснение <правил>';
      await expect(page.getByLabel('Условия участия', { exact: true })).toHaveValue(conditions);
      assert.equal(posts.length, 0);
      await page.getByRole('button', { name: 'Проверить встречу' }).click();
      await expect(page.getByRole('region', { name: 'Сводка встречи' })).toContainText('<правил>');
      const response = page.waitForResponse((r) => new URL(r.url()).pathname === '/api/v1/events' && r.request().method() === 'POST');
      await page.getByRole('button', { name: 'Опубликовать встречу' }).click();
      const result = await response; assert.equal(result.status(), 201);
      created = { id: (await result.json()).id, title, conditions };
      await expect(page).toHaveURL(`${base}/events/${created.id}`);
      assert.equal(posts.length, 1); assert.equal(posts[0].conditions, conditions);
      assert.deepEqual(Object.keys(posts[0]).sort(), ['organizer', 'activityType', 'title', 'description', 'startsAt', 'timezone', 'city', 'locationText', 'conditions', 'joinMode'].sort());
      await fs.writeFile(stateFile, JSON.stringify(created, null, 2));
      await page.goto(`${base}/events/new`);
      await expect(page.getByLabel('Название встречи (обязательно)', { exact: true })).toHaveValue('');
    }
    const response = await reader.request.get(`${base}/api/v1/events/${created.id}`);
    assert.equal(response.status(), 200);
    const fresh = await response.json(); assert.equal(fresh.conditions, created.conditions); assert.equal(fresh.title, created.title);
    const page = await reader.newPage(); await page.goto(`${base}/events/${created.id}`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(created.title);
    await expect(page.locator('main')).toContainText(created.conditions);
    await page.reload(); await expect(page.locator('main')).toContainText(created.conditions);
    await page.screenshot({ path: path.join(output, process.env.FE16_READ_ONLY === 'true' ? 'reader-after-recreate.png' : 'reader.png'), fullPage: true });
    assert.deepEqual(errors, []);
    console.log(`PASS FE-16 ${process.env.FE16_READ_ONLY === 'true' ? 'persistence after recreate' : 'real UI create (one 201 POST, contract fields, cleared draft)'}: independent guest GET/page/reload retains exact conditions.`);
  } finally {
    await author.request.post(`${base}/api/v1/auth/logout`, { headers: { Origin: base } }).catch(() => undefined);
    await author.close(); await reader.close(); await browser.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
