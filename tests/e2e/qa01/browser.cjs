// Independent QA-01: actual shipped forms/API, no request interception or mocks.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium, expect } = require('@playwright/test');

(async () => {
  const [base, output, phase] = process.argv.slice(2);
  assert(new URL(base).hostname === '127.0.0.1' && new URL(base).protocol === 'https:');
  assert(['before', 'persist', 'after'].includes(phase));
  await fs.mkdir(output, { recursive: true });
  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || '/usr/bin/google-chrome', headless: true });
  const contexts = [], errors = [], mutations = [], widths = new Set();
  async function visitor(width = 1280) {
    widths.add(width);
    const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width, height: 950 }, locale: 'ru-RU', timezoneId: 'Pacific/Honolulu' });
    contexts.push(context); const page = await context.newPage();
    page.on('pageerror', e => errors.push(e.message));
    page.on('request', r => { if (['POST', 'PATCH'].includes(r.method()) && !r.url().includes('/auth/')) mutations.push(new URL(r.url()).pathname); });
    return { context, page };
  }
  async function actor(name, cap, width) {
    const a = await visitor(width); await a.page.goto(base + '/login');
    await a.page.getByLabel(/^Email/).fill(name + '@example.test');
    await a.page.getByLabel(/^Пароль/).fill('Ryadom-' + cap + '-2026!');
    await a.page.getByRole('button', { name: 'Войти', exact: true }).click();
    await expect(a.page).toHaveURL(base + '/'); return a;
  }
  async function api(a, method, url, data, code = 200) {
    const response = await a.context.request.fetch(base + '/api/v1' + url, { method, data, headers: { Origin: base } });
    assert.equal(response.status(), code, url + ': ' + await response.text());
    return response.json();
  }
  async function screenshot(a, name, fullPage = true) {
    assert(await a.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'horizontal overflow: ' + name);
    await a.page.screenshot({ path: path.join(output, phase + '-' + name), fullPage });
  }
  async function show(a, event) {
    await a.page.goto(base + '/events/' + event.id);
    await expect(a.page.getByRole('heading', { name: event.title, exact: true })).toBeVisible();
  }
  async function publish(a, title, mode, org) {
    await a.page.goto(base + '/events/new' + (org ? '?organization=' + org : ''));
    await a.page.getByLabel(/^Название встречи/).fill(title);
    await a.page.getByRole('radio', { name: 'Своё направление', exact: true }).check();
    await a.page.getByLabel(/^Своё направление/).fill('Спорт QA ' + title);
    await a.page.getByLabel(/^Описание встречи/).fill('Приглашаем новичков и опытных участников заниматься вместе.');
    await a.page.getByLabel(/^Дата и время начала/).fill(new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 16));
    await a.page.getByLabel(/^Часовая зона встречи/).fill('UTC');
    await a.page.getByLabel(/^Город/).fill('Красноярск');
    await a.page.getByLabel(/^Место встречи/).fill('Вход в парк у остановки');
    await a.page.getByRole('button', { name: 'Далее: участие', exact: true }).click();
    await a.page.getByRole('radio', { name: mode === 'OPEN' ? /Свободная запись/ : /По заявке/ }).check();
    await a.page.getByLabel(/^Условия участия/).fill('Вода и удобная обувь, можно прийти впервые.');
    await a.page.getByRole('button', { name: 'Проверить встречу', exact: true }).click();
    await a.page.getByRole('button', { name: 'Опубликовать встречу', exact: true }).click();
    await a.page.waitForURL(/\/events\/[0-9a-f-]{36}$/);
    const id = new URL(a.page.url()).pathname.split('/').at(-1);
    return api(a, 'GET', '/events/' + id);
  }
  async function org(a, name) {
    await a.page.goto(base + '/organizations/new');
    await a.page.getByLabel(/^Название организации/).fill(name);
    await a.page.getByLabel(/^Деятельность/).fill('Совместные занятия спортом для начинающих и старшего поколения.');
    await a.page.getByLabel(/^Спортивные интересы/).fill('Зарядка, бег и шахматы');
    await a.page.getByRole('button', { name: 'Создать профиль организации', exact: true }).click();
    await a.page.waitForURL(/\/me\/organizations\/[0-9a-f-]{36}$/);
    const id = new URL(a.page.url()).pathname.split('/').at(-1);
    await a.page.getByRole('button', { name: 'Отправить на проверку', exact: true }).click();
    await expect(a.page.getByText('Заявка на проверке. Публичная страница и публикация встреч появятся после допуска администратора.', { exact: true })).toBeVisible();
    return id;
  }
  try {
    const owner = await actor('anna', 'Anna', 1280), member = await actor('alex', 'Alex', 390);
    const other = await actor('dasha', 'Dasha', 320), admin = await actor('marina', 'Marina', 768);
    const guest = await visitor(320);
    if (phase === 'persist') {
      const state = JSON.parse(await fs.readFile(path.join(output, 'qa-state.json'), 'utf8'));
      await show(member, state.personal);
      await expect(member.page.getByText('Ты участвуешь', { exact: true })).toBeVisible();
      const orgDetail = await api(guest, 'GET', '/organizations/' + state.orgId); assert.equal(orgDetail.id, state.orgId);
      const participants = await api(owner, 'GET', '/events/' + state.club.id + '/participations');
      assert.deepEqual(participants.items.map(p => p.status).sort(), ['CONFIRMED', 'REJECTED']);
      const msg = await api(admin, 'GET', '/admin/messages/' + state.questionId); assert.equal(msg.status, 'HIDDEN');
      const removed = await api(member, 'GET', '/events/' + state.club.id); assert.equal(removed.publicationStatus, 'UNPUBLISHED');
      console.log('PASS QA independent persisted S1-S6, org approval, decisions, hidden text and removed publication'); return;
    }
    const tag = phase + '-' + Date.now();
    // A1/DEC-11: registration requires explicit avatar; no automatic business action.
    const fresh = await visitor(390); await fresh.page.goto(base + '/register');
    await fresh.page.locator('input[name=displayName]').fill('Новый участник QA');
    await fresh.page.locator('input[name=email]').fill('qa-' + tag + '@example.test');
    await fresh.page.locator('input[name=password]').fill('QA-Registration-2026!');
    await fresh.page.locator('input[name=confirmation]').fill('QA-Registration-2026!');
    await expect(fresh.page.getByRole('radio').first()).not.toBeChecked();
    await expect(fresh.page.getByRole('button', { name: 'Создать профиль', exact: true })).toBeDisabled();
    await fresh.page.getByRole('radio').first().focus();
    await fresh.page.keyboard.press('Space');
    await expect(fresh.page.getByRole('radio').first()).toBeChecked();
    await screenshot(fresh, 'registration-390.png');
    await fresh.page.getByRole('button', { name: 'Создать профиль', exact: true }).click();
    await expect(fresh.page).toHaveURL(base + '/');
    const me = await api(fresh, 'GET', '/me'); assert.equal(me.systemRole, 'USER');
    const publicMe = await api(guest, 'GET', '/accounts/' + me.account.id); assert(!('email' in publicMe));
    const cookie = (await fresh.context.cookies()).find(c => c.name === 'ryadom_session');
    assert(cookie && cookie.httpOnly && cookie.secure && cookie.sameSite === 'Lax' && cookie.path === '/api/v1');
    // S1: actual new sport without a code change, found by another person.
    const personal = await publish(owner, 'Личная встреча QA ' + tag, 'OPEN');
    await member.page.goto(base + '/events?q=' + encodeURIComponent(personal.title));
    await member.page.getByRole('link', { name: personal.title, exact: true }).click();
    await expect(member.page.getByText('Зона встречи: UTC', { exact: true })).toBeVisible();
    await expect(member.page.getByText('Вода и удобная обувь, можно прийти впервые.', { exact: true })).toBeVisible();
    // S5 before S3: an unregistered-in-event user asks; organizer replies inside the service.
    const question = 'Можно впервые без подготовки? ' + tag;
    await member.page.getByLabel('Твой вопрос или ответ', { exact: true }).fill(question);
    await member.page.getByRole('button', { name: 'Отправить сообщение', exact: true }).click();
    await expect(member.page.getByText(question, { exact: true })).toBeVisible();
    await show(owner, personal);
    await owner.page.getByLabel('Твой вопрос или ответ', { exact: true }).fill('Да, встретим у входа и поможем.');
    await owner.page.getByRole('button', { name: 'Отправить сообщение', exact: true }).click();
    await expect(owner.page.getByText('Да, встретим у входа и поможем.', { exact: true })).toBeVisible();
    await member.page.getByRole('button', { name: 'Обновить обсуждение', exact: true }).click();
    await expect(member.page.getByText('Да, встретим у входа и поможем.', { exact: true })).toBeVisible();
    await member.page.getByRole('button', { name: 'Присоединиться', exact: true }).click();
    await expect(member.page.getByText('Ты участвуешь', { exact: true })).toBeVisible();
    await owner.page.goto(base + '/events/' + personal.id + '/manage?status=CONFIRMED');
    await expect(owner.page.getByRole('article')).toHaveCount(1);
    // S2: before approval private; after approval immediate organization publication.
    const orgId = await org(owner, 'Клуб QA ' + tag);
    await api(guest, 'GET', '/organizations/' + orgId, undefined, 404);
    await admin.page.goto(base + '/admin/organizations');
    await admin.page.getByLabel('Поиск по профилю', { exact: true }).fill('Клуб QA ' + tag);
    await admin.page.getByRole('button', { name: 'Найти организации', exact: true }).click();
    await expect(admin.page.getByRole('article')).toHaveCount(1);
    await admin.page.getByRole('link', { name: 'Открыть профиль', exact: true }).click();
    await expect(admin.page).toHaveURL(url => url.pathname === '/admin/organizations/' + orgId);
    await admin.page.getByRole('button', { name: 'Предоставить допуск', exact: true }).click();
    await expect(admin.page.getByRole('link', { name: 'Публичная страница', exact: true })).toBeVisible();
    const club = await publish(owner, 'Встреча клуба QA ' + tag, 'APPROVAL', orgId);
    await guest.page.goto(base + '/organizations/' + orgId);
    await expect(guest.page.getByRole('link', { name: club.title, exact: true })).toBeVisible();
    const refused = await org(owner, 'Отказ клуба QA ' + tag);
    await admin.page.goto(base + '/admin/organizations/' + refused);
    await admin.page.getByRole('button', { name: 'Отклонить', exact: true }).click();
    await admin.page.getByLabel(/^Причина отказа/).fill('Уточните спортивные интересы клуба.');
    await admin.page.getByRole('button', { name: 'Подтвердить отказ', exact: true }).click();
    await expect(admin.page.getByRole('heading', { name: 'Причина отказа', exact: true })).toBeVisible();
    await owner.page.reload();
    await expect(owner.page.getByText('Уточните спортивные интересы клуба.', { exact: true })).toBeVisible();
    await expect(owner.page.getByRole('link', { name: 'Создать встречу от организации', exact: true })).toHaveCount(0);
    await api(guest, 'GET', '/organizations/' + refused, undefined, 404);
    // S4: two applications, independent views and both decisions.
    for (const who of [member, other]) {
      await show(who, club); await who.page.getByRole('button', { name: 'Подать заявку', exact: true }).click();
      await expect(who.page.getByText('Заявка отправлена', { exact: true })).toBeVisible();
    }
    const rows = (await api(owner, 'GET', '/events/' + club.id + '/participations')).items;
    assert(rows.every(p => p.status === 'PENDING'));
    await owner.page.goto(base + '/events/' + club.id + '/manage');
    await owner.page.getByRole('article').filter({ hasText: 'Алексей' }).getByRole('button', { name: 'Принять', exact: true }).click();
    await expect(owner.page.getByText('Принятие подтверждено сервером.', { exact: true })).toBeVisible();
    await owner.page.getByRole('article').filter({ hasText: 'Дарья' }).getByRole('button', { name: 'Отклонить', exact: true }).click();
    await expect(owner.page.getByText('Отказ подтверждён сервером.', { exact: true })).toBeVisible();
    await show(member, club); await expect(member.page.getByText('Ты участвуешь', { exact: true })).toBeVisible();
    await show(other, club); await expect(other.page.getByText('Заявка отклонена', { exact: true })).toBeVisible();
    await api(admin, 'GET', '/events/' + club.id + '/participations', undefined, 404);
    await member.page.goto(base + '/me/events');
    await expect(member.page.getByRole('heading', { name: 'Предстоящие встречи', exact: true })).toBeVisible();
    // DEC-18: real >20-message history, latest first on server, earlier prepended without viewport jump.
    for (let n = 0; n < 24; n++) await api(owner, 'POST', '/events/' + personal.id + '/messages', { body: 'Лента QA ' + n + ' ' + tag }, 201);
    await show(member, personal);
    const feed = member.page.getByRole('region', { name: 'Обсуждение встречи' });
    await expect(feed.locator('[data-message-id]')).toHaveCount(20);
    const earlier = feed.getByRole('button', { name: 'Ранние сообщения', exact: true });
    await earlier.scrollIntoViewIfNeeded();
    const first = feed.locator('[data-message-id]').first(), firstId = await first.getAttribute('data-message-id');
    const top = (await first.boundingBox()).y;
    await earlier.click(); await expect(feed.locator('[data-message-id]')).toHaveCount(26);
    const oldTop = (await feed.locator(`[data-message-id="${firstId}"]`).boundingBox()).y;
    assert(Math.abs(top - oldTop) < 5, 'earlier-message load must preserve scroll anchor');
    await expect(feed.getByText(question, { exact: true })).toBeVisible();
    // A3: one hidden original, public omission; the event/other messages remain.
    const all = await api(admin, 'GET', '/admin/events/' + personal.id + '/messages?limit=100');
    const target = all.items.find(m => m.body === question);
    await admin.page.goto(base + '/admin/events');
    await admin.page.getByLabel('Поиск встреч', { exact: true }).fill(personal.title);
    await admin.page.getByRole('button', { name: 'Найти встречи', exact: true }).click();
    await expect(admin.page.getByRole('article')).toHaveCount(1);
    await admin.page.getByRole('link', { name: personal.title, exact: true }).click();
    await expect(admin.page).toHaveURL(base + '/admin/events/' + personal.id);
    await admin.page.getByRole('article').filter({ hasText: question }).getByRole('button', { name: 'Скрыть сообщение', exact: true }).click();
    await expect(admin.page.getByText('Сервер подтвердил скрытие сообщения.', { exact: true })).toBeVisible();
    const hidden = (await api(guest, 'GET', '/events/' + personal.id + '/messages?limit=100')).items.find(m => m.id === target.id);
    assert.equal(hidden.status, 'HIDDEN'); assert(!('body' in hidden));
    await show(member, personal); await member.page.getByRole('button', { name: 'Ранние сообщения', exact: true }).click();
    await expect(member.page.getByText('Да, встретим у входа и поможем.', { exact: true })).toBeVisible();
    // S6, author reason and direct-call enforcement for both join modes.
    await admin.page.goto(base + '/admin/events/' + club.id);
    await admin.page.getByRole('link', { name: 'Все встречи организации', exact: true }).click();
    await expect(admin.page.getByRole('article')).toHaveCount(1);
    await admin.page.getByRole('link', { name: club.title, exact: true }).click();
    await expect(admin.page.getByRole('link', { name: 'Создатель: Анна', exact: true })).toHaveAttribute('href', '/people/' + (await api(owner, 'GET', '/me')).account.id);
    await admin.page.getByLabel('Причина снятия (обязательно)', { exact: true }).fill('Изменились условия площадки.');
    await admin.page.getByRole('button', { name: 'Снять с публикации', exact: true }).click();
    await expect(admin.page.getByText('Сервер подтвердил снятие встречи с публикации.', { exact: true })).toBeVisible();
    await show(owner, club); await expect(owner.page.getByText('Изменились условия площадки.', { exact: true })).toBeVisible();
    await show(member, club); await expect(member.page.getByRole('heading', { name: 'Публикация недоступна', exact: true })).toBeVisible();
    await api(guest, 'GET', '/events/' + club.id, undefined, 404);
    await api(fresh, 'POST', '/events/' + club.id + '/participations', undefined, 404);
    await api(member, 'POST', '/events/' + club.id + '/participations', undefined, 409);
    await api(fresh, 'POST', '/events/' + club.id + '/messages', { body: 'Не должно сохраниться' }, 404);
    await api(member, 'POST', '/events/' + club.id + '/messages', { body: 'Не должно сохраниться' }, 409);
    const catalogue = await api(guest, 'GET', '/events?q=' + encodeURIComponent(club.title));
    assert(!catalogue.items.some(e => e.id === club.id));
    await screenshot(member, 'unpublished-390.png');
    await owner.page.goto(base + '/events/' + club.id + '/manage?status=ALL');
    await expect(owner.page.getByRole('article')).toHaveCount(2);
    await expect(owner.page.getByRole('button', { name: 'Принять', exact: true })).toHaveCount(0);
    await expect(owner.page.getByRole('article').filter({ hasText: 'Алексей' })).toContainText('Участие подтверждено');
    await expect(owner.page.getByRole('article').filter({ hasText: 'Алексей' })).not.toContainText('Ты участвуешь');
    await screenshot(owner, 'retained-roster-1280.png');
    for (const width of [320, 390, 768, 1280]) {
      await guest.page.setViewportSize({ width, height: 950 });
      await guest.page.goto(base + '/events'); await expect(guest.page.getByRole('heading', { name: 'Найти встречу', exact: true })).toBeVisible();
      await screenshot(guest, 'catalog-' + width + '.png', false);
    }
    assert.equal(mutations.filter(u => u === '/api/v1/events').length, 2);
    assert.equal(mutations.filter(u => u === '/api/v1/organizations').length, 2);
    assert.equal(mutations.filter(u => u.endsWith('/application')).length, 2);
    assert.equal(mutations.filter(u => u.endsWith('/unpublish')).length, 1);
    await fs.writeFile(path.join(output, phase === 'before' ? 'qa-state.json' : 'qa-state-after.json'), JSON.stringify({ personal, club, orgId, questionId: target.id }));
    console.log('PASS QA independent ' + phase + ': registration/preset/keyboard, actual S1-S6/A1-A6, both organization/participation decisions, long discussion/scroll anchor, direct unavailable actions, retained roster and four widths');
  } finally {
    await Promise.all(contexts.map(c => c.close())); await browser.close();
    assert.deepEqual(errors, [], 'browser errors');
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
