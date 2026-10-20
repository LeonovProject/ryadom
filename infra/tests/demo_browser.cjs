// Demo access in the shipped web image, using actual seed/API/DB and sessions.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || '@playwright/test');

(async () => {
  const base = process.env.OPS_BASE_URL || 'http://127.0.0.1:8080';
  const output = process.env.OPS_BROWSER_OUTPUT || path.resolve('.artifacts/demo-access/container');
  const accounts = JSON.parse(fs.readFileSync(path.resolve('apps/web/demo-accounts.json'), 'utf8'));
  fs.mkdirSync(output, { recursive: true });
  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH, headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'ru-RU' });
    const page = await context.newPage();
    page.setDefaultTimeout(15_000);
    if (process.env.OPS_DEMO_ACCESS === 'false') {
      const download = await context.request.get(base + '/demo/accounts.txt');
      assert.equal(download.status(), 404);
      await page.goto(base + '/demo');
      await page.getByRole('heading', { name: 'Страница не найдена', exact: true }).waitFor();
      await page.goto(base + '/login');
      await page.getByRole('form', { name: 'Вход', exact: true }).waitFor();
      assert.equal(await page.locator('summary').count(), 0);
      assert.equal(await page.getByRole('link', { name: 'Демоаккаунты', exact: true }).count(), 0);
      assert.equal(await page.locator('input[name=email]').inputValue(), '');
      console.log('PASS: disabled container has 404 download, no demo page/picker/link; ordinary login form remains available');
      await context.close();
      return;
    }
    const errors = [], posts = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('request', (request) => { if (request.method() === 'POST') posts.push(new URL(request.url()).pathname); });
    await page.goto(base + '/demo');
    await page.getByRole('heading', { name: 'Демонстрационные аккаунты' }).waitFor();
    const direct = await context.request.get(base + '/demo/accounts.txt');
    assert.equal(direct.status(), 200);
    assert.match(direct.headers()['content-type'], /text\/plain.*utf-8/i);
    assert.match(direct.headers()['content-disposition'], /attachment/);
    assert.equal(direct.headers()['cache-control'], 'no-store');
    const text = await direct.text();
    for (const account of accounts) {
      assert.ok(text.includes(account.email)); assert.ok(text.includes(account.password)); assert.ok(text.includes(account.description));
    }
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('link', { name: 'Скачать аккаунты и описания (.txt)' }).click();
    const download = await downloadPromise;
    assert.equal(fs.readFileSync(await download.path(), 'utf8'), text);
    assert.equal(download.suggestedFilename(), 'ryadom-demo-accounts.txt');
    await page.screenshot({ path: path.join(output, 'demo-desktop.png'), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: path.join(output, 'demo-mobile.png'), fullPage: true });

    for (const account of accounts) {
      await page.goto(base + '/demo?returnTo=%2Fme');
      const before = posts.length;
      await page.getByRole('link', { name: `Подставить данные: ${account.name}`, exact: true }).click();
      await page.waitForURL(base + '/login?returnTo=%2Fme');
      assert.equal(await page.locator('input[name=email]').inputValue(), account.email);
      assert.equal(await page.locator('input[name=password]').inputValue(), account.password);
      assert.equal(posts.length, before, 'Selecting an identity must not authenticate');
      if (account.key === 'alex') {
        await page.locator('summary').click();
        await page.screenshot({ path: path.join(output, 'login-mobile.png'), fullPage: true });
      }
      await page.getByRole('button', { name: 'Войти', exact: true }).click();
      if (account.key === 'blocked') {
        await page.getByRole('alert').filter({ hasText: 'Аккаунт заблокирован.' }).waitFor();
        assert.equal(new URL(page.url()).pathname, '/login');
        assert.equal((await context.request.get(base + '/api/v1/me')).status(), 401);
      } else {
        await page.waitForURL(base + '/me');
        await page.getByRole('heading', { name: account.name, exact: true }).waitFor();
        const me = await (await context.request.get(base + '/api/v1/me')).json();
        assert.equal(me.email, account.email);
        assert.equal(me.systemRole, account.key === 'marina' ? 'ADMIN' : 'USER');
        const cookie = (await context.cookies()).find((item) => item.name === 'ryadom_session');
        assert.ok(cookie?.httpOnly && cookie.path === '/api/v1' && cookie.sameSite === 'Lax');
        assert.ok(!(await page.evaluate(() => document.cookie)).includes('ryadom_session'));
        await page.getByRole('button', { name: 'Выйти', exact: true }).click();
        await page.getByRole('heading', { name: 'Войди, чтобы открыть личный профиль' }).waitFor();
      }
      assert.equal(posts.length, before + (account.key === 'blocked' ? 1 : 2), 'No automatic duplicate mutations');
    }
    assert.deepEqual(errors, []);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.goto(base + '/demo');
    await page.evaluate(() => { document.documentElement.style.zoom = '2'; });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    console.log('PASS: real container download, five seed logins/logout, ADMIN role, blocked-account rejection, explicit submit, HttpOnly sessions and narrow/200% layout; no mocked API or DB reset');
    await context.close();
  } finally { await browser.close(); }
})().catch((error) => { console.error(error.message); process.exitCode = 1; });
