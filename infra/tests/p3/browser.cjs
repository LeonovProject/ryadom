// Real combined UI/API; accept.py creates and destroys this dedicated database.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium, expect } = require('@playwright/test');

(async () => {
  const [base, output, phase] = process.argv.slice(2);
  assert(new URL(base).hostname === '127.0.0.1' && new URL(base).protocol === 'https:');
  assert(['moderate', 'reset', 'receipt'].includes(phase));
  await fs.mkdir(output, { recursive: true });
  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || '/usr/bin/google-chrome', headless: true });
  const actors = [], errors = [], mutations = [];
  async function actor(name, cap, width = 1280) {
    const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width, height: 950 }, locale: 'ru-RU', timezoneId: 'Pacific/Honolulu' });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', req => { if (['POST', 'PATCH'].includes(req.method()) && !req.url().includes('/auth/')) mutations.push(new URL(req.url()).pathname); });
    const who = { context, page, name, cap }; actors.push(who);
    await login(who); return who;
  }
  async function login(who) {
    await who.page.goto(base + '/login?returnTo=%2Fme');
    await who.page.getByLabel(/^Email/).fill(who.name + '@example.test');
    await who.page.getByLabel(/^Пароль/).fill('Ryadom-' + who.cap + '-2026!');
    await who.page.getByRole('button', { name: 'Войти', exact: true }).click();
    await expect(who.page).toHaveURL(base + '/me');
  }
  async function api(who, method, route, data, expected = 200) {
    const response = await who.context.request.fetch(base + '/api/v1' + route, { method, data, headers: { Origin: base } });
    assert.equal(response.status(), expected, route + ': ' + await response.text());
    return response.json();
  }
  async function screenshot(who, name) {
    assert(await who.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'horizontal overflow: ' + name);
    await who.page.screenshot({ path: path.join(output, name), fullPage: true });
  }
  try {
    const admin = await actor('marina', 'Marina', 1280);
    if (phase === 'receipt') {
      const saved = JSON.parse(await fs.readFile(path.join(output, 'receipt.json'), 'utf8'));
      const state = await api(admin, 'GET', '/admin/demo-state');
      assert.deepEqual(state.lastReset, saved.receipt);
      assert.equal((await admin.context.request.get(base + '/api/v1/events/' + saved.eventId)).status(), 404);
      await admin.page.evaluate(id => localStorage.setItem('ryadom.pending-demo-reset.v1', id), saved.receipt.resetId);
      await admin.page.reload();
      await expect(admin.page.getByText(/Квитанция сервера подтверждает: демоданные восстановлены/)).toBeVisible();
      await screenshot(admin, 'receipt-after-restart-1280.png');
      assert.deepEqual(mutations, []);
      console.log('PASS P3 persisted receipt after second down/up, old event absent, UI recovery without reset replay');
      return;
    }
    const owner = await actor('anna', 'Anna', 390), member = await actor('alex', 'Alex', 320);
    if (phase === 'reset') {
      const saved = JSON.parse(await fs.readFile(path.join(output, 'moderation.json'), 'utf8'));
      const account = await api(admin, 'GET', '/admin/accounts/' + saved.accountId);
      assert.equal(account.status, 'ACTIVE');
      const message = await api(admin, 'GET', '/admin/messages/' + saved.messageId);
      assert.equal(message.status, 'VISIBLE'); assert.equal(message.openReportsCount, 0);
      await admin.page.goto(base + '/admin/events/' + saved.eventId);
      await expect(admin.page.getByText('Снято с публикации', { exact: true })).toBeVisible();
      assert.equal((await api(admin, 'GET', '/admin/activity-types/' + saved.activityId)).name, saved.activityName);
      const before = await api(admin, 'GET', '/admin/demo-state');
      const originalOwner = (await api(owner, 'GET', '/me')).account.id;
      await admin.page.setViewportSize({ width: 390, height: 844 });
      await admin.page.goto(base + '/me');
      await admin.page.getByRole('button', { name: 'Восстановить демоданные', exact: true }).click();
      const dialog = admin.page.getByRole('dialog');
      await expect(dialog.getByRole('button', { name: 'Сбросить базу', exact: true })).toBeDisabled();
      await dialog.getByLabel('Для подтверждения введи СБРОСИТЬ', { exact: true }).fill('СБРОСИТЬ');
      await screenshot(admin, 'reset-confirmation-390.png');
      await dialog.getByRole('button', { name: 'Сбросить базу', exact: true }).click();
      await expect(admin.page).toHaveURL(base + '/login?returnTo=%2Fme');
      const resetId = await admin.page.evaluate(() => localStorage.getItem('ryadom.pending-demo-reset.v1'));
      assert(resetId);
      for (const who of [owner, member]) assert.equal((await who.context.request.get(base + '/api/v1/me')).status(), 401);
      await login(admin);
      await expect(admin.page.getByText(/Квитанция сервера подтверждает: демоданные восстановлены/)).toBeVisible();
      const after = await api(admin, 'GET', '/admin/demo-state');
      assert.equal(after.lastReset.resetId, resetId); assert.equal(after.lastReset.previousGeneration, before.generation);
      assert.notEqual(after.generation, before.generation);
      await login(owner); assert.notEqual((await api(owner, 'GET', '/me')).account.id, originalOwner);
      assert.equal(mutations.filter(url => url.endsWith('/admin/demo-reset')).length, 1);
      assert.equal(mutations.length, 1);
      await fs.writeFile(path.join(output, 'receipt.json'), JSON.stringify({ receipt: after.lastReset, eventId: saved.eventId }));
      console.log('PASS P3 moderation survives down/up; actual reset form, one POST, all sessions revoked, receipt recovered after login and fresh seed IDs');
      return;
    }
    const member2 = await actor('alex', 'Alex', 768);
    const tag = Date.now();
    const event = await api(owner, 'POST', '/events', { organizer: { type: 'PERSONAL' }, activityType: { name: 'Проверка спорта ' + tag }, title: 'Общая модерация ' + tag,
      description: 'Интеграционная встреча для проверки модерации.', startsAt: new Date(Date.now() + 86400000).toISOString(), timezone: 'Asia/Krasnoyarsk', city: 'Красноярск', locationText: 'Вход в парк', conditions: 'Можно без опыта.', joinMode: 'OPEN' }, 201);
    const activityId = event.activityType.id, activityName = 'Исправленный спорт ' + tag;
    await admin.page.goto(base + '/admin/activity-types?id=' + activityId);
    const editor = admin.page.getByRole('region', { name: 'Проверка направления' });
    await editor.getByLabel('Имя направления', { exact: true }).fill(activityName);
    await editor.getByRole('button', { name: 'Одобрить направление', exact: true }).click();
    await expect(editor.getByText('Сервер подтвердил изменение направления.', { exact: true })).toBeVisible();
    assert.equal((await api(member, 'GET', '/events/' + event.id)).activityType.name, activityName);
    await editor.getByLabel('Имя направления', { exact: true }).fill(activityName + ' после правки');
    await editor.getByRole('button', { name: 'Исправить имя', exact: true }).click();
    await expect(editor.getByRole('heading', { name: activityName + ' после правки', exact: true })).toBeVisible();
    await screenshot(admin, 'activity-approved-1280.png');
    const question = await api(owner, 'POST', '/events/' + event.id + '/messages', { body: 'Можно прийти впервые? ' + tag }, 201);
    await member.page.goto(base + '/events/' + event.id);
    await member.page.getByRole('button', { name: 'Пожаловаться на встречу', exact: true }).click();
    await expect(member.page.getByText('Жалоба сохранена. Контент не скрывается автоматически.', { exact: true })).toBeVisible();
    await member.page.getByRole('listitem').filter({ hasText: question.body }).getByRole('button', { name: 'Пожаловаться на сообщение', exact: true }).click();
    await expect(member.page.getByText('Жалоба сохранена. Контент не скрывается автоматически.', { exact: true })).toHaveCount(2);
    await admin.page.goto(base + '/admin/events/' + event.id);
    const message = admin.page.getByRole('article').filter({ hasText: question.body });
    await expect(admin.page.getByText('На встречу: 1 · На сообщения: 1', { exact: true })).toBeVisible();
    await admin.page.getByRole('button', { name: 'Отклонить жалобы на встречу', exact: true }).click();
    await expect(admin.page.getByText('Сервер подтвердил отклонение прямых жалоб на встречу.', { exact: true })).toBeVisible();
    await message.getByRole('button', { name: 'Скрыть сообщение', exact: true }).click();
    await expect(message.getByText('Скрыто', { exact: true })).toBeVisible();
    await member.page.reload();
    await expect(member.page.getByText(question.body, { exact: true })).toHaveCount(0);
    await expect(member.page.getByText('Сообщение скрыто модератором.', { exact: true })).toBeVisible();
    await message.getByRole('button', { name: 'Восстановить сообщение', exact: true }).click();
    await expect(message.getByText('Видимо', { exact: true })).toBeVisible();
    await member.page.reload(); await expect(member.page.getByText(question.body, { exact: true })).toBeVisible();
    await member.page.getByRole('listitem').filter({ hasText: question.body }).getByRole('button', { name: 'Пожаловаться на сообщение', exact: true }).click();
    await expect(member.page.getByText('Эта жалоба уже рассмотрена. Повтор не открывает её заново.', { exact: true })).toBeVisible();
    await screenshot(member, 'restored-discussion-320.png');
    // New reporter gives a fresh report; the UI dismisses its actual revision.
    await api(member2, 'POST', '/messages/' + question.id + '/reports'); // same account, closed repeat
    const other = await actor('dasha', 'Dasha', 390);
    await api(other, 'POST', '/messages/' + question.id + '/reports', undefined, 201);
    await admin.page.reload();
    await message.getByRole('button', { name: 'Отклонить жалобы на сообщение', exact: true }).click();
    await expect(message.getByText('Сервер подтвердил отклонение жалоб на сообщение.', { exact: true })).toBeVisible();
    await admin.page.getByLabel('Причина снятия (обязательно)', { exact: true }).fill('Интеграционная проверка правил публикации.');
    await admin.page.getByRole('button', { name: 'Снять с публикации', exact: true }).click();
    await expect(admin.page.getByText('Сервер подтвердил снятие встречи с публикации.', { exact: true })).toBeVisible();
    const accountId = (await api(member, 'GET', '/me')).account.id;
    await admin.page.goto(base + '/admin/accounts?id=' + accountId);
    const panel = admin.page.getByRole('region', { name: 'Выбранный аккаунт' });
    await panel.getByRole('button', { name: 'Заблокировать пользователя', exact: true }).click();
    await admin.page.getByRole('dialog').getByRole('button', { name: 'Подтвердить изменение статуса', exact: true }).click();
    await expect(panel.getByText('Сервер подтвердил блокировку. Прежние сессии пользователя завершены.', { exact: true })).toBeVisible();
    for (const who of [member, member2]) { const response = await who.context.request.get(base + '/api/v1/me'); assert.equal(response.status(), 403); assert.equal((await response.json()).error.code, 'ACCOUNT_BLOCKED'); }
    await admin.page.setViewportSize({ width: 390, height: 844 }); await screenshot(admin, 'blocked-account-390.png');
    await panel.getByRole('button', { name: 'Разблокировать пользователя', exact: true }).click();
    await admin.page.getByRole('dialog').getByRole('button', { name: 'Подтвердить изменение статуса', exact: true }).click();
    await expect(panel.getByText('Сервер подтвердил разблокировку. Пользователю нужен новый вход; старые сессии не восстановлены.', { exact: true })).toBeVisible();
    for (const who of [member, member2]) assert.equal((await who.context.request.get(base + '/api/v1/me')).status(), 401);
    await login(member); assert.equal((await api(member, 'GET', '/me')).account.id, accountId);
    await fs.writeFile(path.join(output, 'moderation.json'), JSON.stringify({ accountId, eventId: event.id, messageId: question.id, activityId, activityName: activityName + ' после правки' }));
    assert.equal(mutations.filter(url => url.endsWith('/status')).length, 2);
    assert.equal(mutations.filter(url => url.endsWith('/hide')).length, 1);
    assert.equal(mutations.filter(url => url.endsWith('/restore')).length, 1);
    assert.equal(mutations.filter(url => url.endsWith('/unpublish')).length, 1);
    console.log('PASS P3 UI: activity approval/rename, both reports, dismiss/hide/restore, closed repeat, unpublish, block/unblock and two revoked sessions');
  } finally {
    await Promise.all(actors.map(who => who.context.close())); await browser.close();
    assert.deepEqual(errors, [], 'browser errors');
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
