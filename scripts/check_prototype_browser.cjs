// Browser checks of the HTML design only: fictional tab-memory data, no product API.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('@playwright/test');

(async () => {
  const base = process.env.PROTOTYPE_BASE_URL || 'http://127.0.0.1:4173/design/prototype/';
  const output = path.resolve('.artifacts/prototype-update');
  fs.mkdirSync(output, { recursive: true });
  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH });
  try {
    const context = await browser.newContext({ locale: 'ru-RU', timezoneId: 'America/Los_Angeles' });
    const page = await context.newPage();
    page.setDefaultTimeout(10_000);
    const errors = [], failed = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('response', (response) => { if (response.status() >= 400) failed.push(response.url()); });
    const open = async (route) => { await page.goto(base + '#' + route); await page.locator('h1').waitFor(); };
    const imagesReady = async () => {
      await page.locator('img').evaluateAll(async (images) => {
        for (const image of images) image.loading = 'eager';
        await Promise.race([
          Promise.all(images.map((image) => image.decode())),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Artwork did not decode within 10 seconds')), 10_000)),
        ]);
      });
    };
    for (const width of [320, 390, 768, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      for (const [route, name] of [['/events', 'catalog'], ['/orgs', 'organizations'], ['/events/tennis', 'event']]) {
        await open(route); await imagesReady();
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${name} ${width}: overflow`);
        assert.equal(await page.locator('[data-action="org-join"]').count(), 0);
        await page.screenshot({ path: path.join(output, `${name}-${width}.png`), fullPage: true });
        if (name === 'catalog' && width === 1280) {
          await page.screenshot({ path: path.join(output, 'catalog-desktop.png') });
        }
      }
      console.log(`PASS: changed prototype screens at ${width}px`);
    }
    await open('/orgs');
    assert.equal(await page.locator('.org-card').count(), 5);
    assert.equal(await page.getByText('Шахматный кружок «Ход»', { exact: true }).count(), 0);
    await page.getByRole('link', { name: /Открыть организацию/ }).first().click();
    await page.getByRole('heading', { name: 'Темп', exact: true }).waitFor();
    await open('/events/new');
    await page.getByRole('button', { name: 'Войти', exact: true }).last().click();
    await page.locator('[data-action="choose-profile"][data-id="alex"]').click();
    await page.locator('[name=title]').fill('Проверяем обложку вместе');
    await page.locator('[name=sport]').selectOption({ label: 'Бег' });
    await page.locator('textarea[name=description]').fill('Вымышленная встреча для проверки макета.');
    await page.locator('[name=date]').fill('2030-11-01');
    await page.locator('[name=time]').fill('10:00');
    await page.locator('[name=city]').fill('Красноярск');
    await page.locator('[name=place]').fill('Вход в парк');
    await page.locator('[data-form=create] button[type=submit]').click();
    await page.getByRole('group', { name: 'Обложка встречи', exact: true }).waitFor();
    await page.getByRole('radio', { name: 'Маршрут, синий', exact: true }).check();
    await page.locator('[name=conditions]').fill('Вода и удобная обувь.');
    await page.locator('#toast').waitFor({ state: 'hidden' });
    await page.evaluate(() => document.activeElement?.blur());
    for (const width of [320, 390, 768, 1280]) {
      await page.setViewportSize({ width, height: 900 }); await imagesReady();
      await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `picker ${width}: overflow`);
      assert.ok(await page.locator('.art-option img').evaluateAll((images) => images.every((image) => {
        const { width, height } = image.getBoundingClientRect();
        return Math.abs(width / height - 8 / 3) < 0.05;
      })), `picker ${width}: preserve uncropped scene proportions`);
      await page.screenshot({ path: path.join(output, `picker-${width}.png`), fullPage: true });
    }
    await page.locator('[data-form=create] button[type=submit]').click();
    assert.ok((await page.locator('.preview-summary img').getAttribute('src')).endsWith('/stride-blue.svg'));
    await page.getByRole('button', { name: 'Назад', exact: true }).click();
    assert.equal(await page.getByRole('radio', { name: 'Маршрут, синий', exact: true }).isChecked(), true);
    await page.getByRole('button', { name: 'Назад', exact: true }).click();
    await page.locator('[name=sport]').selectOption({ label: 'Шахматы' });
    await page.locator('[data-form=create] button[type=submit]').click();
    assert.equal(await page.getByRole('radio', { name: 'Партия', exact: true }).isChecked(), true);
    await page.getByRole('radio', { name: 'Фигуры', exact: true }).check();
    await page.locator('[data-form=create] button[type=submit]').click();
    assert.ok((await page.locator('.preview-summary img').getAttribute('src')).endsWith('/chess-alt.svg'));
    await page.getByRole('button', { name: 'Опубликовать встречу' }).click();
    await page.getByRole('heading', { name: 'Проверяем обложку вместе', exact: true }).waitFor();
    await imagesReady();
    assert.ok((await page.locator('.detail-art img').getAttribute('src')).endsWith('/chess-alt.svg'));
    // All prepared SVGs, including scenes without a seeded event, get browser decoding and visual contact sheets.
    const files = fs.readdirSync(path.resolve('design/prototype/assets/event-art')).filter((file) => file.endsWith('.svg')).sort();
    for (let start = 0; start < files.length; start += 8) {
      const group = files.slice(start, start + 8);
      const file = `art-${start / 8}.html`;
      fs.writeFileSync(path.join(output, file), `<meta charset="utf-8"><style>body{font:16px sans-serif;margin:16px;display:grid;grid-template-columns:repeat(2,400px);gap:16px}figure{margin:0}img{display:block;width:400px;height:150px}figcaption{padding:6px}</style>${group.map((name) => `<figure><img src="/design/prototype/assets/event-art/${name}"><figcaption>${name}</figcaption></figure>`).join('')}`);
      await page.goto(new URL(`../../.artifacts/prototype-update/${file}`, base).href);
      await page.setViewportSize({ width: 864, height: 900 }); await imagesReady();
      await page.screenshot({ path: path.join(output, `art-${start / 8}.png`), fullPage: true });
    }
    assert.deepEqual(errors, []); assert.deepEqual(failed, []);
    await context.close();
    console.log(`PASS: prototype-only organization discovery, responsive catalog/event/picker at 320/390/768/1280, preserved/reset cover choice, local creation, ${files.length} decoded SVG assets; no browser errors or missing resources.`);
  } finally { await browser.close(); }
})().catch((error) => { console.error(error.message); process.exitCode = 1; });
