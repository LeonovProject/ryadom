// FE-04, real BE-02/03 through the production Compose proxy. No HTTP fixtures.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const accounts = require('../../../../../demo-accounts.json');
const { chromium, expect } = require('@playwright/test');

(async () => {
  const base = process.env.FE_P1_BASE_URL || 'http://127.0.0.1:4188';
  const output = path.resolve('.artifacts/fe-p1/detail-real');
  await fs.mkdir(output, { recursive: true });
  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || '/usr/bin/google-chrome', headless: true });
  let author;
  try {
    const guest = await browser.newContext({ locale: 'ru-RU', timezoneId: 'Pacific/Honolulu', viewport: { width: 390, height: 900 } });
    author = await browser.newContext({ locale: 'ru-RU', timezoneId: 'Pacific/Honolulu', viewport: { width: 1280, height: 900 } });
    const response = await guest.request.get(`${base}/api/v1/events?from=2020-01-01T00:00:00Z&limit=100`);
    assert.equal(response.status(), 200);
    const all = (await response.json()).items;
    const event = all.find((item) => item.organizer.type === 'PERSONAL');
    assert(event);
    const page = await guest.newPage(), errors = [], businessPosts = [];
    for (const context of [guest, author]) context.on('page', (p) => {
      p.on('pageerror', (error) => errors.push(error.message));
      p.on('request', (request) => { if (request.method() === 'POST' && !/\/auth\/(login|logout)$/.test(request.url())) businessPosts.push(request.url()); });
    });
    page.on('pageerror', (error) => errors.push(error.message));
    const catalog = `/events?${new URLSearchParams({ from: '2020-01-01T00:00:00Z', q: event.title })}`;
    await page.goto(base + catalog);
    await page.getByRole('link', { name: 'Открыть встречу', exact: true }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(event.title);
    await expect(page.getByText(`Зона встречи: ${event.timezone}`, { exact: true })).toBeVisible();
    await page.getByRole('link', { name: 'Открыть профиль', exact: true }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(event.organizer.account.displayName);
    const publicAccount = await guest.request.get(`${base}/api/v1/accounts/${event.organizer.account.id}`);
    assert.equal(publicAccount.status(), 200);
    const account = await publicAccount.json();
    assert(!('email' in account)); assert(!('systemRole' in account));
    await expect(page.getByRole('article').first()).toBeVisible();
    await page.screenshot({ path: path.join(output, 'person-390.png'), fullPage: true });
    await page.getByRole('link', { name: '← К встрече', exact: true }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(event.title);
    await page.getByRole('link', { name: '← К найденным встречам', exact: true }).click();
    await expect(page).toHaveURL(base + catalog);
    await expect(page.getByRole('link', { name: 'Открыть встречу', exact: true })).toBeFocused();

    const authorPage = await author.newPage();
    const anna = accounts.find((account) => account.email === 'anna@example.test');
    assert(anna);
    await authorPage.goto(`${base}/login`);
    await authorPage.getByLabel(/^Email/).fill(anna.email);
    await authorPage.getByLabel(/^Пароль/).fill(anna.password);
    await authorPage.getByRole('button', { name: 'Войти', exact: true }).click();
    await expect(authorPage.getByRole('link', { name: 'Личный профиль: Анна', exact: true })).toBeVisible();
    const mineResponse = await author.request.get(`${base}/api/v1/me/events?limit=100`);
    assert.equal(mineResponse.status(), 200);
    const mine = (await mineResponse.json()).items.map((item) => item.event);
    const published = mine.find((item) => item.publicationStatus === 'PUBLISHED');
    const unavailable = mine.find((item) => item.publicationStatus === 'UNPUBLISHED');
    assert(published && unavailable);
    await authorPage.goto(`${base}/events/${published.id}`);
    await expect(authorPage.getByRole('heading', { level: 1 })).toHaveText(published.title);
    await expect(authorPage.getByRole('link', { name: 'Участники и заявки', exact: true })).toBeVisible();
    await expect(authorPage.getByRole('heading', { name: 'Направление в общем списке', exact: true })).toBeVisible();
    await authorPage.screenshot({ path: path.join(output, 'author-1280.png'), fullPage: true });
    await authorPage.setViewportSize({ width: 390, height: 900 });
    await authorPage.goto(`${base}/events/${unavailable.id}`);
    await expect(authorPage.getByRole('heading', { name: 'Публикация недоступна', exact: true })).toBeVisible();
    await expect(authorPage.getByRole('heading', { name: 'Причина снятия', exact: true })).toBeVisible();
    await expect(authorPage.locator('main time')).toHaveCount(0);
    await expect(authorPage.getByRole('heading', { name: 'Когда и где', exact: true })).toHaveCount(0);
    await authorPage.screenshot({ path: path.join(output, 'unavailable-390.png'), fullPage: true });
    await page.goto(`${base}/events/${unavailable.id}`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Встреча не найдена');
    await expect(page.locator('main')).not.toContainText(unavailable.title);
    const organizationEvent = all.find((item) => item.organizer.type === 'ORGANIZATION');
    assert(organizationEvent);
    const organization = await guest.request.get(`${base}/api/v1/organizations/${organizationEvent.organizer.organization.id}`);
    // BE-05 is outside the starting snapshot; do not count an unimplemented route as public-profile acceptance.
    console.log(`Organization read HTTP ${organization.status()}; full organization acceptance requires BE-05.`);
    assert.deepEqual(errors, []); assert.deepEqual(businessPosts, []);
    console.log('PASS FE-04: real public/author/404/limited detail, event-zone display, account privacy, organizer/back path and separate guest session; no business POST');
    await guest.close();
  } finally {
    if (author) { await author.request.post(`${base}/api/v1/auth/logout`, { headers: { Origin: base } }).catch(() => undefined); await author.close(); }
    await browser.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
