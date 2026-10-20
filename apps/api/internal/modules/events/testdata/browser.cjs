/* Real BE-03/FE-03/04 integration. No request interception or HTTP fixtures. */
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || '@playwright/test');

(async () => {
  const [base, output] = process.argv.slice(2);
  assert(base && output, 'base URL and screenshot folder are required');
  await fs.mkdir(output, { recursive: true });
  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || '/usr/bin/google-chrome', headless: true });
  const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1280, height: 1000 }, timezoneId: 'Pacific/Honolulu' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const catalogue = await context.request.get(base+'/api/v1/events?limit=100');
  assert.equal(catalogue.status(), 200);
  const all = (await catalogue.json()).items;
  const open = all.find((item) => item.title === 'Пробежка для знакомства');
  assert(open);
  try {
    await page.goto(base+'/');
    await page.getByRole('list', { name: 'Направления', exact: true }).getByRole('link', { name: 'Бег', exact: true }).waitFor();
    await page.getByRole('link', { name: /Пробежка для знакомства/ }).first().waitFor();
    await page.screenshot({ path: path.join(output, 'home-desktop.png'), fullPage: true });
    for (const width of [320, 390, 768, 1280]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.goto(base+'/events?from=2020-01-01T00%3A00%3A00Z&q='+encodeURIComponent('Пробежка для знакомства'));
      await page.getByRole('link', { name: /Пробежка для знакомства/ }).first().waitFor();
      await page.getByRole('heading', { name: 'Найти встречу', exact: true }).waitFor();
      assert.equal(await page.getByText('Встречи не загрузились', { exact: true }).count(), 0);
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'catalogue horizontal overflow');
      assert(new URL(page.url()).searchParams.get('q') === 'Пробежка для знакомства');
      await page.screenshot({ path: path.join(output, `catalog-${width}.png`), fullPage: true });
    }
    await page.getByRole('link', { name: /Пробежка для знакомства/ }).first().click();
    await page.getByRole('heading', { name: 'Пробежка для знакомства', exact: true }).waitFor();
    await page.getByText('Зона встречи: Asia/Krasnoyarsk', { exact: true }).waitFor();
    await page.getByRole('heading', { name: 'Что нужно для участия', exact: true }).waitFor();
    await page.screenshot({ path: path.join(output, 'detail-desktop.png'), fullPage: true });
    await page.reload();
    await page.getByRole('heading', { name: 'Пробежка для знакомства', exact: true }).waitFor();
    await page.getByRole('link', { name: '← К найденным встречам', exact: true }).click();
    await page.getByRole('heading', { name: 'Найти встречу', exact: true }).waitFor();
    await page.goto(base+'/login?returnTo='+encodeURIComponent('/events/'+open.id));
    await page.getByLabel(/^Email/).fill('anna@example.test');
    await page.getByLabel(/^Пароль/).fill('Ryadom-Anna-2026!');
    await page.getByRole('button', { name: 'Войти', exact: true }).click();
    await page.getByRole('heading', { name: 'Пробежка для знакомства', exact: true }).waitFor();
    await page.getByRole('link', { name: 'Участники и заявки', exact: true }).waitFor();
    await page.getByRole('heading', { name: 'Направление в общем списке', exact: true }).waitFor();
    const mine = await context.request.get(base+'/api/v1/me/events?limit=100');
    assert.equal(mine.status(), 200);
    const unpublished = (await mine.json()).items.find((entry) => entry.event.publicationStatus === 'UNPUBLISHED').event;
    await page.setViewportSize({ width: 390, height: 1000 });
    await page.goto(base+'/events/'+unpublished.id);
    await page.getByRole('heading', { name: 'Публикация недоступна', exact: true }).waitFor();
    await page.getByRole('heading', { name: 'Причина снятия', exact: true }).waitFor();
    assert.equal(await page.getByRole('heading', { name: 'Когда и где', exact: true }).count(), 0);
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'unavailable detail horizontal overflow');
    await page.screenshot({ path: path.join(output, 'unavailable-mobile.png'), fullPage: true });
    assert.deepEqual(errors, []);
    console.log('PASS: real home/catalogue at 320/390/768/1280, zoned event detail, refresh/back navigation, author session and limited unpublished card');
  } finally {
    await browser.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
