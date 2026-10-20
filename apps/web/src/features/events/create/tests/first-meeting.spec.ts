import { expect, test, type Page } from '@playwright/test';
import { fulfillCase, guestFixtures, meFixture } from '../../../auth/tests/http-fixtures';

const toggleName = 'Что важно знать перед встречей';
const question = 'Какая подготовка нужна и какой будет темп?';
const me = { ...meFixture(), sessionExpiresAt: '2099-01-01T00:00:00Z' };
const conditions = (page: Page) => page.getByLabel('Условия участия', { exact: true });
async function participation(page: Page, chooseMode = true) {
  await page.goto('/events/new');
  await page.getByLabel('Название встречи (обязательно)', { exact: true }).fill('Вместе впервые');
  await page.getByLabel('Своё направление', { exact: true }).check();
  await page.getByLabel('Своё направление (обязательно)', { exact: true }).fill('Петанк');
  await page.getByLabel('Описание встречи (обязательно)').fill('Знакомимся с игрой');
  await page.getByLabel('Дата и время начала (обязательно)').fill('2030-11-07T10:00');
  await page.getByLabel('Город (обязательно)').fill('Красноярск');
  await page.getByLabel('Место встречи (обязательно)').fill('Вход в парк');
  await page.getByRole('button', { name: 'Далее: участие' }).click();
  if (chooseMode) await page.getByRole('radio', { name: 'Свободная запись', exact: false }).check();
}
async function expand(page: Page) { await page.getByRole('button', { name: toggleName, exact: true }).click(); }
async function authenticate(page: Page, account = me) {
  await page.route('**/api/v1/me', (route) => fulfillCase(route, 'getMeSuccess', { responseBody: account }));
}
async function expireAndLogin(page: Page, account = me) {
  await page.route('**/api/v1/me', (route) => fulfillCase(route, 'sessionExpired'));
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByRole('heading', { name: 'Войди снова, чтобы продолжить' })).toBeVisible();
  await authenticate(page, account);
  await page.route('**/api/v1/auth/login', (route) => fulfillCase(route, 'loginSuccess', { responseBody: account }));
  await page.getByRole('link', { name: 'Войти', exact: true }).last().click();
  await page.getByLabel('Email (обязательно)', { exact: true }).fill(account.email);
  await page.getByLabel('Пароль (обязательно)', { exact: true }).fill('valid-password-fixture');
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  await expect(page).toHaveURL('/events/new');
}
test.beforeEach(async ({ page }) => { await guestFixtures(page); await authenticate(page); });

test('closed by default; explicit double click appends once, escapes text and leaves a freely editable result', async ({ page }) => {
  let posts = 0; page.on('request', (r) => { if (r.method() === 'POST') posts++; });
  await participation(page);
  await expect(page.getByRole('button', { name: toggleName })).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByLabel(question, { exact: true })).toBeHidden();
  await conditions(page).fill('Мои условия');
  await expand(page);
  await expect(page.getByRole('button', { name: 'Добавить в условия' })).toBeDisabled();
  await expect(page.getByLabel(question, { exact: true })).toHaveValue('');
  await page.getByLabel(question, { exact: true }).fill('  Без опыта\n  <b>Спокойно</b>  ');
  await page.getByLabel('Что взять с собой?', { exact: true }).fill(' Вода ');
  await expect(page.getByRole('region', { name: 'Предпросмотр добавляемых условий' })).toContainText('<b>Спокойно</b>');
  await expect(page.locator('#first-meeting-questions b')).toHaveCount(0);
  await expect(conditions(page)).toHaveValue('Мои условия');
  await page.getByRole('button', { name: 'Добавить в условия' }).dblclick();
  const result = 'Мои условия\n\nПодготовка и темп: Без опыта\n  <b>Спокойно</b>\nЧто взять с собой: Вода';
  await expect(conditions(page)).toHaveValue(result);
  await expect(conditions(page)).toBeFocused();
  await expect(page.getByText('Текст добавлен в условия', { exact: true })).toBeVisible();
  await expect(page.getByLabel(question, { exact: true })).toHaveValue('');
  await conditions(page).fill(`${result}\nОтредактировано`);
  await page.getByRole('button', { name: 'Проверить встречу' }).click();
  await expect(page.getByRole('region', { name: 'Сводка встречи' })).toContainText('Отредактировано');
  expect(posts).toBe(0);
});

test('unapplied answers survive collapse and steps; review asks for an explicit choice', async ({ page }) => {
  await participation(page); await expand(page);
  await page.getByLabel(question, { exact: true }).fill('Спокойный темп');
  await expand(page);
  await page.getByRole('button', { name: 'Назад', exact: true }).click();
  await page.getByRole('button', { name: 'Далее: участие' }).click();
  await page.getByRole('button', { name: 'Проверить встречу' }).click();
  await expect(page.getByRole('alert')).toContainText('Ответы помощника ещё не добавлены');
  await expect(page.getByRole('alert')).toBeFocused();
  await expect(page.getByRole('heading', { name: 'Участие', exact: true })).toBeVisible();
  await expect(conditions(page)).toHaveValue('');
  await page.getByRole('button', { name: 'Добавить в условия' }).click();
  await expect(conditions(page)).toHaveValue('Подготовка и темп: Спокойный темп');
  await page.getByRole('button', { name: 'Проверить встречу' }).click();
  await expect(page.getByRole('heading', { name: 'Проверка', exact: true })).toBeVisible();
});

test('discard only removes helper answers and still validates participation', async ({ page }) => {
  await participation(page, false); await conditions(page).fill('Ручные условия'); await expand(page);
  await page.getByLabel(question, { exact: true }).fill('Удалить меня');
  await page.getByRole('button', { name: 'Проверить встречу' }).click();
  await page.getByRole('button', { name: 'Удалить ответы и продолжить' }).click();
  await expect(page.getByRole('radio', { name: 'Свободная запись', exact: false })).toBeFocused();
  await expect(conditions(page)).toHaveValue('Ручные условия');
  await expect(page.getByLabel(question, { exact: true })).toHaveValue('');
  await page.getByRole('radio', { name: 'По заявке', exact: false }).check();
  await page.getByRole('button', { name: 'Проверить встречу' }).click();
  await expect(page.getByRole('region', { name: 'Сводка встречи' })).toContainText('Ручные условия');
});

test('return from review cannot bypass unapplied answers through the basics step', async ({ page }) => {
  await participation(page);
  await page.getByRole('button', { name: 'Проверить встречу' }).click();
  await page.getByRole('button', { name: 'Изменить участие', exact: true }).click();
  await expand(page); await page.getByLabel(question, { exact: true }).fill('Новый ответ');
  await page.getByRole('button', { name: 'Назад', exact: true }).click();
  await page.getByRole('button', { name: 'Вернуться к проверке', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Ответы помощника ещё не добавлены');
  await expect(page.getByLabel(question, { exact: true })).toHaveValue('Новый ответ');
  await page.getByRole('button', { name: 'Удалить ответы и продолжить' }).click();
  await expect(page.getByRole('heading', { name: 'Проверка', exact: true })).toBeVisible();
});

test('overlong answers and conditions remain intact; correcting to 4000 allows adding', async ({ page }) => {
  await participation(page); await expand(page);
  const answer = page.getByLabel('Как узнать организатора на месте?', { exact: true });
  await answer.fill('🎾'.repeat(401));
  await expect(answer).toHaveAccessibleDescription(/Не больше 400 символов/);
  await expect(answer).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByRole('button', { name: 'Добавить в условия' })).toBeDisabled();
  await answer.fill('Анна');
  const block = 'Как узнать организатора: Анна';
  const manual = '🎾'.repeat(4001 - [...block].length - 2);
  await conditions(page).fill(manual);
  await expect(page.getByRole('alert')).toContainText('В условиях получится 4001 символов из 4000');
  await expect(conditions(page)).toHaveValue(manual);
  await expect(answer).toHaveValue('Анна');
  await conditions(page).fill([...manual].slice(1).join(''));
  await page.getByRole('button', { name: 'Добавить в условия' }).click();
  expect([...(await conditions(page).inputValue())]).toHaveLength(4000);
});

test('only contractual conditions are published; 422 and uncertain results retain text and lock helpers', async ({ page }) => {
  const bodies: Record<string, unknown>[] = [];
  let unknown = false;
  await page.route('**/api/v1/events', async (route) => {
    bodies.push(route.request().postDataJSON());
    if (unknown) return route.abort('failed');
    await fulfillCase(route, 'invalidCreateFields');
  });
  await participation(page); await expand(page);
  await page.getByLabel('Что взять с собой?', { exact: true }).fill('Вода');
  await page.getByRole('button', { name: 'Добавить в условия' }).click();
  await page.getByRole('button', { name: 'Проверить встречу' }).click();
  await page.getByRole('button', { name: 'Опубликовать встречу' }).click();
  await expect(page.getByLabel('Дата и время начала (обязательно)')).toBeFocused();
  expect(bodies[0].conditions).toBe('Что взять с собой: Вода');
  expect(Object.keys(bodies[0]).sort()).toEqual(['organizer', 'activityType', 'title', 'description', 'startsAt', 'timezone', 'city', 'locationText', 'conditions', 'joinMode'].sort());
  await page.getByRole('button', { name: 'Далее: участие' }).click();
  await expect(conditions(page)).toHaveValue('Что взять с собой: Вода');
  await expand(page); await page.getByLabel(question, { exact: true }).fill('Ещё ответ');
  await page.getByRole('button', { name: 'Проверить встречу' }).click();
  await page.getByRole('button', { name: 'Удалить ответы и продолжить' }).click();
  unknown = true;
  await page.getByRole('button', { name: 'Опубликовать встречу' }).click();
  await expect(page.getByRole('alert')).toContainText('Результат публикации неизвестен');
  await expireAndLogin(page);
  await expect(page.getByRole('button', { name: 'Опубликовать встречу' })).toBeDisabled();
  await expect(page.getByRole('region', { name: 'Сводка встречи' })).toContainText('Что взять с собой: Вода');
  expect(bodies).toHaveLength(2);
});

for (const otherAccount of [false, true]) {
  test(`expired helper draft is ${otherAccount ? 'cleared for a different account' : 'restored for the same account'}`, async ({ page }) => {
    await participation(page); await expand(page);
    await page.getByLabel(question, { exact: true }).fill('Личный ответ');
    expect(await page.evaluate(() => `${JSON.stringify(localStorage)} ${JSON.stringify(sessionStorage)}`)).not.toContain('Личный ответ');
    await expireAndLogin(page, otherAccount ? { ...me, account: { ...me.account, id: '00000001-0000-4000-8000-000000000099' } } : me);
    if (otherAccount) {
      await expect(page.getByLabel('Название встречи (обязательно)', { exact: true })).toHaveValue('');
    } else {
      await expand(page);
      await expect(page.getByLabel(question, { exact: true })).toHaveValue('Личный ответ');
      await expect(conditions(page)).toHaveValue('');
    }
  });
}

for (const width of [320, 390, 768, 1280]) {
  test(`helper keyboard and layout at ${width}px`, async ({ page }) => {
    const errors: string[] = []; page.on('pageerror', (e) => errors.push(e.message));
    await page.setViewportSize({ width, height: 900 });
    await participation(page);
    await page.getByRole('button', { name: toggleName }).focus();
    await page.keyboard.press('Enter');
    await page.keyboard.press('Tab');
    await expect(page.getByLabel(question, { exact: true })).toBeFocused();
    await page.keyboard.type('Без опыта, спокойный темп');
    await page.getByLabel('Что взять с собой?', { exact: true }).fill('Вода и удобная обувь');
    await page.getByRole('region', { name: 'Предпросмотр добавляемых условий' }).scrollIntoViewIfNeeded();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: `.artifacts/fe16/helper-${width}.png`, fullPage: true });
    expect(errors).toEqual([]);
  });
}
