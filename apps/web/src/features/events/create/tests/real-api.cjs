// FE-05 preparation with real sessions/directions. Does NOT claim S1 without BE-04.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const accounts = require('../../../../../demo-accounts.json');
const { chromium, expect } = require('@playwright/test');

(async () => {
  const base = process.env.FE_P1_BASE_URL || 'http://127.0.0.1:4188';
  const output = path.resolve('.artifacts/fe-p1/create-real');
  await fs.mkdir(output, { recursive: true });
  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || '/usr/bin/google-chrome', headless: true });
  const context = await browser.newContext({ locale: 'ru-RU', timezoneId: 'Pacific/Honolulu' });
  const errors = [], businessPosts = [];
  context.on('page', (page) => {
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('request', (request) => { if (request.method() === 'POST' && !/\/auth\/(login|logout)$/.test(request.url())) businessPosts.push(request.url()); });
  });
  try {
    const page = await context.newPage();
    await page.goto(`${base}/events/new`);
    await expect(page.getByRole('heading', { name: 'Сначала войди в Рядом', exact: true })).toBeVisible();
    await page.getByRole('link', { name: 'Войти', exact: true }).last().click();
    const anna = accounts.find((account) => account.email === 'anna@example.test');
    await page.getByLabel(/^Email/).fill(anna.email);
    await page.getByLabel(/^Пароль/).fill(anna.password);
    await page.getByRole('button', { name: 'Войти', exact: true }).click();
    await expect(page).toHaveURL(`${base}/events/new`);
    const meResponse = await context.request.get(`${base}/api/v1/me`);
    assert.equal(meResponse.status(), 200);
    const me = await meResponse.json();
    const typesResponse = await context.request.get(`${base}/api/v1/activity-types`);
    assert.equal(typesResponse.status(), 200);
    const direction = (await typesResponse.json()).items[0];
    assert(direction);
    const organization = me.organizations.find((item) => item.approvalState === 'APPROVED' && item.canPublish);
    assert(organization);
    for (const width of [320, 390, 768, 1280]) {
      const form = await context.newPage();
      await form.setViewportSize({ width, height: 900 });
      const organizational = width === 1280;
      await form.goto(`${base}/events/new${organizational ? `?organization=${organization.id}` : ''}`);
      await expect(form.getByLabel('От чьего имени (обязательно)')).toHaveValue(organizational ? organization.id : '');
      await form.getByLabel('Название встречи (обязательно)', { exact: true }).fill('Проверка формы FE-P1');
      await form.getByLabel('Выбери направление', { exact: true }).selectOption(direction.id);
      await form.getByLabel('Описание встречи (обязательно)').fill('Знакомство со спортом без специальной подготовки.');
      await form.getByLabel('Дата и время начала (обязательно)').fill('2030-11-07T01:00');
      await form.getByLabel('Часовая зона встречи (обязательно)').fill('Asia/Krasnoyarsk');
      await form.getByLabel('Город (обязательно)').fill('Красноярск');
      await form.getByLabel('Место встречи (обязательно)').fill('У входа в парк');
      await form.getByRole('button', { name: 'Далее: участие', exact: true }).click();
      await form.getByRole('radio', { name: organizational ? 'По заявке' : 'Свободная запись', exact: false }).check();
      await form.getByLabel('Условия участия', { exact: true }).fill('Возьми удобную обувь.');
      await form.getByRole('button', { name: 'Проверить встречу', exact: true }).click();
      await expect(form.getByRole('region', { name: 'Сводка встречи' })).toContainText('7 ноября 2030 г. в 01:00 GMT+7');
      await expect(form.getByRole('region', { name: 'Сводка встречи' })).toContainText(direction.name);
      await form.getByRole('button', { name: 'Изменить дату и время', exact: true }).click();
      await expect(form.getByLabel('Дата и время начала (обязательно)')).toBeFocused();
      await form.getByRole('button', { name: 'Вернуться к проверке', exact: true }).click();
      await expect(form.getByRole('button', { name: 'Опубликовать встречу', exact: true })).toBeEnabled();
      assert(await form.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await form.screenshot({ path: path.join(output, `review-${width}.png`), fullPage: true });
      await form.getByRole('link', { name: 'Выйти к встречам', exact: true }).click();
      await expect(form.getByRole('dialog')).toBeVisible();
      await form.close();
    }
    assert.deepEqual(errors, []); assert.deepEqual(businessPosts, []);
    console.log('PASS FE-05 preparation: real login/returnTo, Me/eligible author/directions, four widths, zoned review/edit/focus and leave prompt. No create POST; S1 requires BE-04.');
  } finally {
    await context.request.post(`${base}/api/v1/auth/logout`, { headers: { Origin: base } }).catch(() => undefined);
    await context.close(); await browser.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
