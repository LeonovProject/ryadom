const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const { chromium, expect } = require('@playwright/test');

(async () => {
  const base = process.argv[2], origin = new URL(base);
  assert.equal(origin.hostname, 'ryadom-demo.test');
  assert.equal(origin.protocol, 'http:');
  // Local DNS mapping only: browser requests, Origin and cookies remain actual HTTP.
  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || '/usr/bin/google-chrome', args: ['--no-proxy-server', '--host-resolver-rules=MAP ryadom-demo.test 127.0.0.1'] });
  try {
    const context = await browser.newContext(), page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(base + '/login');
    await page.getByLabel(/^Email/).fill('alex@example.test');
    await page.getByLabel(/^Пароль/).fill('Ryadom-Alex-2026!');
    await page.getByRole('button', { name: 'Войти', exact: true }).click();
    await expect(page).toHaveURL(base + '/');
    const cookie = (await context.cookies()).find(item => item.name === 'ryadom_session');
    assert(cookie && !cookie.secure && cookie.httpOnly && cookie.sameSite === 'Lax' && cookie.path === '/api/v1');
    await page.reload();
    const me = await page.evaluate(async () => { const response = await fetch('/api/v1/me'); return { status: response.status, data: await response.json() }; });
    assert.equal(me.status, 200); assert.equal(me.data.email, 'alex@example.test');
    const rejected = await context.request.post(`http://127.0.0.1:${origin.port}/api/v1/auth/logout`, { headers: { Host: origin.host, Origin: 'http://foreign.example' } });
    assert.equal(rejected.status(), 403); assert.equal((await rejected.json()).error.code, 'CSRF_REJECTED');
    const logout = await page.evaluate(async () => (await fetch('/api/v1/auth/logout', { method: 'POST' })).status);
    assert.equal(logout, 204);
    assert(!(await context.cookies()).some(item => item.name === 'ryadom_session'));
    await page.goto(base + '/api/docs'); await expect(page).toHaveURL(base + '/api/docs/');
    await expect(page.locator('.opblock')).toHaveCount(60);
    const schema = await page.evaluate(async () => (await fetch('/api/openapi.yaml')).text());
    assert.equal(schema, await fs.readFile('packages/contracts/openapi.yaml', 'utf8'));
    assert.deepEqual(errors, []);
    console.log('PASS real HTTP browser: non-loopback origin, login, non-Secure HttpOnly cookie, reload, foreign Origin denied, logout, Swagger 60 and exact schema');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
