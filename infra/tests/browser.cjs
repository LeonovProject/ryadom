/* Browser smoke of the real web image; no HTTP fixtures or product mutations. */
const path = require('node:path');
const fs = require('node:fs');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || '@playwright/test');
(async () => {
  const base = process.env.OPS_BASE_URL || 'http://127.0.0.1:8080';
  const output = process.env.OPS_BROWSER_OUTPUT || path.resolve('.artifacts/ops-01');
  fs.mkdirSync(output, { recursive: true });
  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH, headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'ru-RU' });
    const page = await context.newPage();
    const external = [], mutations = [], errors = [];
    page.on('request', request => {
      if (new URL(request.url()).origin !== new URL(base).origin) external.push(request.url());
      if (!['GET', 'HEAD'].includes(request.method())) mutations.push(request.method());
    });
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.text().includes('violates the following Content Security Policy')) errors.push(message.text()); });
    await page.goto(base + '/api/docs/');
    await page.locator('.swagger-ui .information-container').waitFor();
    await page.locator('.swagger-ui .opblock').first().waitFor();
    if (await page.locator('.opblock').count() !== 60) throw new Error('OpenAPI operation count differs');
    if (await page.getByRole('button', { name: /try it out/i }).count()) throw new Error('Mutations enabled in documentation');
    if (!(await page.locator('.info').innerText()).includes('0.13.0')) throw new Error('Wrong API version');
    await page.screenshot({ path: path.join(output, 'docs-desktop.png'), fullPage: true });
    await page.reload();
    await page.locator('.swagger-ui .opblock').first().waitFor();
    await page.goto(base + '/login');
    const gate = page.getByRole('button', { name: 'Открыть форму', exact: true });
    const email = page.getByLabel('Email', { exact: false });
    async function waitForForm() {
      await email.or(gate).first().waitFor();
      if (await gate.isVisible()) await gate.click();
      await email.waitFor();
    }
    await waitForForm();
    await page.getByRole('button', { name: 'Войти', exact: true }).waitFor();
    await page.screenshot({ path: path.join(output, 'login-desktop.png'), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload();
    await waitForForm();
    if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)) throw new Error('Mobile horizontal overflow');
    await page.screenshot({ path: path.join(output, 'login-mobile.png'), fullPage: true });
    if (external.length || mutations.length || errors.length) throw new Error(JSON.stringify({ external, mutations, errors }));
    console.log('PASS: real image, 60 documented operations, reload, local resources, read-only docs, login desktop/mobile, no browser errors');
    await context.close();
  } finally { await browser.close(); }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
