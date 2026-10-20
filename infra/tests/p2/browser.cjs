// Combined P2: no mocked routes. Mutations run only in accept.py's disposable DB.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium, expect } = require('@playwright/test');

(async () => {
  const [base, output, mode] = process.argv.slice(2);
  await fs.mkdir(output, { recursive: true });
  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || '/usr/bin/google-chrome', headless: true });
  const errors = [], posts = [], contexts = [];
  async function actor(name, cap, width = 1280) {
    const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width, height: 950 }, timezoneId: 'Pacific/Honolulu', locale: 'ru-RU' });
    contexts.push(context);
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', req => { if (req.method() === 'POST') posts.push(new URL(req.url()).pathname); });
    await page.goto(base + '/login?returnTo=%2Fme');
    await page.getByLabel(/^Email/).fill(name + '@example.test');
    await page.getByLabel(/^Пароль/).fill('Ryadom-' + cap + '-2026!');
    await page.getByRole('button', { name: 'Войти', exact: true }).click();
    await expect(page).toHaveURL(base + '/me');
    return { page, context };
  }
  async function api(who, method, route, data, expected = 200) {
    const response = await who.context.request.fetch(base + '/api/v1' + route, { method, data, headers: { Origin: base } });
    assert.equal(response.status(), expected, route + ': ' + await response.text());
    return response.json();
  }
  async function show(who, event) {
    await who.page.goto(base + '/events/' + event.id);
    await expect(who.page.getByRole('heading', { name: event.title, exact: true })).toBeVisible();
  }
  try {
    const owner = await actor('anna', 'Anna'), member = await actor('alex', 'Alex', 390);
    const other = await actor('dasha', 'Dasha', 320), admin = await actor('marina', 'Marina', 768);
    if (mode === 'persist') {
      const saved = JSON.parse(await fs.readFile(path.join(output, 'state.json'), 'utf8'));
      await show(member, saved.open);
      await expect(member.page.getByText('Ты участвуешь', { exact: true })).toBeVisible();
      await expect(member.page.getByText('Сообщение скрыто модератором.', { exact: true })).toBeVisible();
      await show(member, saved.approval);
      await expect(member.page.getByRole('heading', { name: 'Публикация недоступна', exact: true })).toBeVisible();
      const roster = await api(owner, 'GET', '/events/' + saved.approval.id + '/participations');
      assert.deepEqual(roster.items.map(row => row.status).sort(), ['CONFIRMED', 'REJECTED']);
      console.log('PASS P2 persistence: actual UI and decisions/hidden message/unpublication after down/up, same volume');
      return;
    }
    const tag = Date.now();
    async function event(title, joinMode) {
      return api(owner, 'POST', '/events', { organizer: { type: 'PERSONAL' }, activityType: { name: 'Совместная прогулка P2' }, title,
        description: 'Доступная спортивная встреча для знакомства.', startsAt: new Date(Date.now() + 3600000).toISOString(),
        timezone: 'Asia/Krasnoyarsk', city: 'Красноярск', locationText: 'Вход в парк', conditions: 'Удобная обувь, можно без опыта.', joinMode }, 201);
    }
    const open = await event('Прогулка P2 ' + tag, 'OPEN');
    const approval = await event('Командная встреча P2 ' + tag, 'APPROVAL');
    // S5: a person who has not joined asks through the real form.
    await show(other, open);
    const question = 'Можно прийти без опыта? ' + tag;
    await other.page.getByLabel('Твой вопрос или ответ', { exact: true }).fill(question);
    await other.page.getByRole('button', { name: 'Отправить сообщение', exact: true }).click();
    await expect(other.page.getByText('Сообщение сохранено сервером.', { exact: true })).toBeVisible();
    await expect(other.page.getByText(question, { exact: true })).toBeVisible();
    await show(owner, open);
    await expect(owner.page.getByText(question, { exact: true })).toBeVisible();
    const answer = 'Да, приходите, встретим у входа. ' + tag;
    await owner.page.getByLabel('Твой вопрос или ответ', { exact: true }).fill(answer);
    await owner.page.getByRole('button', { name: 'Отправить сообщение', exact: true }).click();
    await expect(owner.page.getByText(answer, { exact: true })).toBeVisible();
    await other.page.getByRole('button', { name: 'Обновить обсуждение', exact: true }).click();
    await expect(other.page.getByText(answer, { exact: true })).toBeVisible();
    // S3 and personal home: one explicit join, real canonical response.
    await show(member, open);
    await member.page.getByRole('button', { name: 'Присоединиться', exact: true }).click();
    await expect(member.page.getByText('Ты участвуешь', { exact: true })).toBeVisible();
    await member.page.goto(base + '/');
    await expect(member.page.getByRole('region', { name: 'Ближайшие личные встречи' }).getByRole('link', { name: open.title, exact: true })).toBeVisible();
    await member.page.screenshot({ path: path.join(output, 'personal-home-390.png'), fullPage: true });
    // S4: two independent applicants, both decisions through organizer UI.
    for (const who of [member, other]) {
      await show(who, approval);
      await who.page.getByRole('button', { name: 'Подать заявку', exact: true }).click();
      await expect(who.page.getByText('Заявка отправлена', { exact: true })).toBeVisible();
    }
    const rows = await api(owner, 'GET', '/events/' + approval.id + '/participations');
    const accepted = rows.items.find(row => row.account.displayName === 'Алексей');
    const rejected = rows.items.find(row => row.id !== accepted.id);
    await owner.page.goto(base + '/events/' + approval.id + '/manage');
    await owner.page.getByRole('article').filter({ hasText: accepted.account.displayName }).getByRole('button', { name: 'Принять', exact: true }).click();
    await expect(owner.page.getByText('Принятие подтверждено сервером.', { exact: true })).toBeVisible();
    await owner.page.getByRole('article').filter({ hasText: rejected.account.displayName }).getByRole('button', { name: 'Отклонить', exact: true }).click();
    await expect(owner.page.getByText('Отказ подтверждён сервером.', { exact: true })).toBeVisible();
    await owner.page.getByRole('link', { name: 'Все записи', exact: true }).click();
    await expect(owner.page.getByRole('article')).toHaveCount(2);
    await owner.page.screenshot({ path: path.join(output, 'organizer-roster-1280.png'), fullPage: true });
    await show(member, approval);
    await expect(member.page.getByText('Ты участвуешь', { exact: true })).toBeVisible();
    await show(other, approval);
    await expect(other.page.getByText('Заявка отклонена', { exact: true })).toBeVisible();
    await expect(other.page.getByRole('button', { name: 'Подать заявку', exact: true })).toHaveCount(0);
    // Private roster does not become an ADMIN privilege.
    await api(admin, 'GET', '/events/' + approval.id + '/participations', undefined, 404);
    // A3/S6 API is ready; FE administrative screens are a later packet.
    const messages = await api(admin, 'GET', '/admin/events/' + open.id + '/messages');
    const message = messages.items.find(row => row.body === question);
    await api(admin, 'POST', '/admin/messages/' + message.id + '/hide', { expectedRevision: message.moderationRevision });
    await show(other, open);
    await expect(other.page.getByText('Сообщение скрыто модератором.', { exact: true })).toBeVisible();
    await expect(other.page.getByText(question, { exact: true })).toHaveCount(0);
    await other.page.screenshot({ path: path.join(output, 'discussion-hidden-320.png'), fullPage: true });
    await api(admin, 'POST', '/admin/events/' + approval.id + '/unpublish', { reason: 'Проверка снятия публикации P2' });
    await show(member, approval);
    await expect(member.page.getByRole('heading', { name: 'Публикация недоступна', exact: true })).toBeVisible();
    await expect(member.page.getByRole('button', { name: 'Подать заявку', exact: true })).toHaveCount(0);
    await expect(member.page.getByLabel('Твой вопрос или ответ', { exact: true })).toHaveCount(0);
    await member.page.goto(base + '/me/events?view=all');
    const unavailable = member.page.getByRole('article').filter({ hasText: approval.title });
    await expect(unavailable).toContainText('Снято с публикации');
    await expect(unavailable).toContainText('Ты участвуешь');
    await expect(unavailable.locator('time')).toHaveCount(0);
    await member.page.screenshot({ path: path.join(output, 'my-meetings-390.png'), fullPage: true });
    for (const who of [owner, member, other, admin]) assert(await who.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'horizontal overflow');
    assert.equal(posts.filter(url => /\/events\/[^/]+\/participations$/.test(url)).length, 3, 'unexpected join retry');
    assert.equal(posts.filter(url => /\/participations\/[^/]+\/decision$/.test(url)).length, 2, 'unexpected decision retry');
    assert.equal(posts.filter(url => /\/events\/[^/]+\/messages$/.test(url)).length, 2, 'unexpected message retry');
    await fs.writeFile(path.join(output, 'state.json'), JSON.stringify({ open, approval }));
    console.log('PASS P2 UI: real OPEN/APPROVAL, both decisions, personal home, question/answer before join, hidden body, unavailable event and no automatic POST retries');
  } finally {
    assert.deepEqual(errors, [], 'browser errors');
    await Promise.all(contexts.map(context => context.close()));
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
