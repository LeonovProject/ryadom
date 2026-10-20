import { expect, test, type Page } from '@playwright/test';
import { fulfillCase, guestFixtures, httpCase, meFixture } from './http-fixtures';
import type { components } from '../../../shared/api/client';

const password = 'Ryadom-Alex-2026!';
async function fillLogin(page: Page, value = password) {
  await page.locator('input[name=email]').fill('alex@example.test');
  await page.locator('input[name=password]').fill(value);
}
async function fillRegistration(page: Page) {
  await page.locator('input[name=displayName]').fill('Алексей');
  await page.locator('input[name=email]').fill('new@example.test');
  await page.locator('input[name=password]').fill(password);
  await page.locator('input[name=confirmation]').fill(password);
}
async function setPersonalCache(page: Page) {
  await page.evaluate(async () => {
    const modulePath = '/src/app/App.tsx';
    const { queryClient } = await import(modulePath);
    queryClient.setQueryData(['private-test'], 'old-account-only');
  });
}
async function personalCache(page: Page) {
  return page.evaluate(async () => {
    const modulePath = '/src/app/App.tsx';
    const { queryClient } = await import(modulePath);
    return queryClient.getQueryData(['private-test']);
  });
}

test.beforeEach(async ({ page }) => { await guestFixtures(page); });

test('login sends one unchanged password, waits for success, clears old cache and follows returnTo', async ({ page }) => {
  let me: components['schemas']['Me'] | null = null;
  let count = 0;
  let body: unknown;
  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  await page.route('**/api/v1/me', (route) => me ? fulfillCase(route, 'getMeSuccess', { responseBody: me }) : fulfillCase(route, 'authenticationRequired'));
  await page.route('**/api/v1/auth/login', async (route) => {
    count++; body = route.request().postDataJSON();
    await held;
    me = httpCase('loginSuccess').responseBody as components['schemas']['Me'];
    await fulfillCase(route, 'loginSuccess');
  });
  await page.goto('/login?returnTo=%2Fme');
  const original = '  spaces stay here  ';
  await fillLogin(page, original);
  await setPersonalCache(page);
  await page.locator('form').evaluate((form: HTMLFormElement) => { form.requestSubmit(); form.requestSubmit(); });
  await expect(page.getByRole('button', { name: 'Входим…' })).toBeDisabled();
  await expect(page).toHaveURL('/login?returnTo=%2Fme');
  release();
  await expect(page).toHaveURL('/me');
  await expect(page.getByRole('heading', { name: 'Алексей', exact: true })).toBeVisible();
  expect(count).toBe(1);
  expect(body).toEqual({ email: 'alex@example.test', password: original });
  expect(await personalCache(page)).toBeUndefined();
  expect(await page.evaluate(() => `${JSON.stringify(localStorage)} ${JSON.stringify(sessionStorage)}`)).not.toContain(original);
});

test('registration preselects an avatar, sends one atomic DTO and defaults to home', async ({ page }) => {
  let body: unknown;
  let count = 0;
  await page.route('**/api/v1/auth/register', async (route) => { count++; body = route.request().postDataJSON(); await fulfillCase(route, 'registerSuccess'); });
  await page.goto('/register?returnTo=https%3A%2F%2Foutside.test');
  await fillRegistration(page);
  const avatar = page.getByRole('radio', { name: 'Спутник', exact: true });
  await expect(avatar).toBeChecked();
  await expect(page.getByRole('group', { name: 'Выберите аватар', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Создать профиль', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Создать профиль', exact: true }).click();
  await expect(page).toHaveURL('/');
  expect(count).toBe(1);
  expect(body).toEqual({ displayName: 'Алексей', email: 'new@example.test', password, presetId: 'ryadom-companion' });
  await expect(page.getByRole('link', { name: 'Личный профиль: Алексей' })).toBeVisible();
});

test('safe returnTo survives form switching; passwords do not', async ({ page }) => {
  await page.goto('/login?returnTo=%2Fevents%2Fexample%3Ftab%3Ddiscussion');
  await fillLogin(page);
  await expect(page.locator('input[name=password]')).toHaveAttribute('autocomplete', 'current-password');
  await page.getByRole('button', { name: 'Показать пароль', exact: true }).click();
  await expect(page.locator('input[name=password]')).toHaveAttribute('type', 'text');
  await page.getByRole('link', { name: 'Создать профиль', exact: true }).click();
  await expect(page).toHaveURL('/register?returnTo=%2Fevents%2Fexample%3Ftab%3Ddiscussion');
  await expect(page.locator('input[name=password]')).toHaveValue('');
  await expect(page.locator('input[name=password]')).toHaveAttribute('autocomplete', 'new-password');
  await expect(page.getByRole('link', { name: 'Войти', exact: true }).last()).toHaveAttribute('href', '/login?returnTo=%2Fevents%2Fexample%3Ftab%3Ddiscussion');
});

for (const [name, message] of [['loginInvalidCredentials', 'Неверный email или пароль.'], ['loginBlockedAccount', 'Аккаунт заблокирован.']] as const) {
  test(`login handles ${name} without successful navigation`, async ({ page }) => {
    let count = 0;
    await page.route('**/api/v1/auth/login', async (route) => { count++; await fulfillCase(route, name); });
    await page.goto('/login');
    await fillLogin(page);
    await page.getByRole('button', { name: 'Войти', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText(message);
    await expect(page).toHaveURL('/login');
    expect(count).toBe(1);
  });
}

test('rate limit waits for Retry-After and never retries automatically', async ({ page }) => {
  await page.clock.install();
  let count = 0;
  await page.route('**/api/v1/auth/login', async (route) => { count++; await fulfillCase(route, 'loginRateLimited', { headers: { 'Retry-After': '2' } }); });
  await page.goto('/login'); await fillLogin(page);
  const submit = page.getByRole('button', { name: 'Войти', exact: true });
  await submit.click();
  await expect(submit).toBeDisabled();
  await page.clock.fastForward(2100);
  await expect(submit).toBeEnabled();
  expect(count).toBe(1);
  await submit.click();
  await expect(submit).toBeDisabled();
  expect(count).toBe(2);
});

test('empty and failed preset catalogs block only registration and preserve fields on reload', async ({ page }) => {
  let attempts = 0;
  await page.route('**/api/v1/avatar-presets', async (route) => {
    attempts++;
    if (attempts === 1) await route.abort('failed');
    else await fulfillCase(route, attempts === 2 ? 'listAvatarPresetsSuccess' : 'avatarPresetsPopulated');
  });
  await page.goto('/register'); await fillRegistration(page);
  await expect(page.getByRole('heading', { name: 'Не удалось загрузить аватары' })).toBeVisible();
  await page.getByRole('button', { name: 'Повторить загрузку', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Регистрация пока недоступна: нет готовых аватарок' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Создать профиль', exact: true })).toBeDisabled();
  await expect(page.getByRole('link', { name: 'Войти', exact: true }).last()).toBeVisible();
  await page.getByRole('button', { name: 'Обновить каталог', exact: true }).click();
  await expect(page.getByRole('radio', { name: 'Спутник', exact: true })).toBeChecked();
  await expect(page.locator('input[name=displayName]')).toHaveValue('Алексей');
  await expect(page.locator('input[name=email]')).toHaveValue('new@example.test');
});

test('422 on the selected preset requires an explicit new selection', async ({ page }) => {
  await page.route('**/api/v1/auth/register', (route) => fulfillCase(route, 'registerUnknownPreset'));
  await page.goto('/register'); await fillRegistration(page);
  await page.getByRole('radio', { name: 'Спутник', exact: true }).check();
  await page.getByRole('button', { name: 'Создать профиль', exact: true }).click();
  await expect(page.getByText('Выбранный вариант недоступен. Выбери доступный аватар явно.')).toBeVisible();
  await expect(page.getByRole('radio', { name: 'Спутник', exact: true })).not.toBeChecked();
  await expect(page.locator('input[name=displayName]')).toHaveValue('Алексей');
  await expect(page.getByRole('button', { name: 'Создать профиль', exact: true })).toBeDisabled();
  await page.getByRole('radio', { name: 'Спутник', exact: true }).check();
  await expect(page.getByRole('button', { name: 'Создать профиль', exact: true })).toBeEnabled();
});

test('EMAIL_TAKEN remains an error and offers explicit login', async ({ page }) => {
  await page.route('**/api/v1/auth/register', (route) => fulfillCase(route, 'registerEmailTaken'));
  await page.goto('/register'); await fillRegistration(page);
  await page.getByRole('radio', { name: 'Спутник', exact: true }).check();
  await page.getByRole('button', { name: 'Создать профиль', exact: true }).click();
  await expect(page.locator('input[name=email]')).toBeFocused();
  await expect(page.getByRole('alert')).toContainText('Этот email уже используется.');
  await expect(page.getByRole('link', { name: 'Войти с этим email' })).toBeVisible();
  await expect(page).toHaveURL('/register');
});

test('lost registration response is not retried or proven by getMe for another account', async ({ page }) => {
  let count = 0;
  await page.route('**/api/v1/auth/register', async (route) => { count++; await route.abort('failed'); });
  await page.goto('/register'); await fillRegistration(page);
  await page.getByRole('radio', { name: 'Спутник', exact: true }).check();
  await page.getByRole('button', { name: 'Создать профиль', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Результат операции неизвестен');
  await expect(page.getByRole('button', { name: 'Создать профиль', exact: true })).toBeDisabled();
  await page.route('**/api/v1/me', (route) => fulfillCase(route, 'getMeSuccess'));
  await page.getByRole('button', { name: 'Проверить текущий вход' }).click();
  await expect(page.getByRole('heading', { name: 'Ты уже вошёл' })).toBeVisible();
  await expect(page.getByText('Анна', { exact: true }).last()).toBeVisible();
  await expect(page).toHaveURL('/register');
  expect(count).toBe(1);
});

test('existing session is explicit and a rejected new login preserves the actor and cache', async ({ page }) => {
  await page.route('**/api/v1/me', (route) => fulfillCase(route, 'getMeSuccess'));
  await page.route('**/api/v1/auth/login', (route) => fulfillCase(route, 'loginBlockedAccount'));
  await page.goto('/login?returnTo=%2Fme');
  await expect(page.getByRole('heading', { name: 'Ты уже вошёл' })).toBeVisible();
  await setPersonalCache(page);
  await page.evaluate(async () => {
    const modulePath = '/src/shared/api/client.ts';
    const { api } = await import(modulePath);
    await api.POST('/auth/login', { body: { email: 'blocked@example.test', password: 'irrelevant' } });
  });
  expect(await personalCache(page)).toBe('old-account-only');
  await expect(page.getByRole('link', { name: 'Личный профиль: Анна' })).toBeVisible();
  await page.getByRole('link', { name: 'Продолжить', exact: true }).click();
  await expect(page).toHaveURL('/me');
  await expect(page.getByRole('heading', { name: 'Твои организации' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Модерация', exact: true })).toHaveCount(0);
});

for (const fixture of ['sessionExpired', 'getMeAccountBlocked']) {
  test(`${fixture} clears private UI/cache and leaves guest browsing available`, async ({ page }) => {
    let revoked = false;
    await page.route('**/api/v1/me', (route) => fulfillCase(route, revoked ? fixture : 'getMeSuccess'));
    await page.goto('/me');
    await expect(page.getByRole('heading', { name: 'Анна', exact: true })).toBeVisible();
    await setPersonalCache(page);
    revoked = true;
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(page.getByRole('heading', { name: 'Войди, чтобы открыть личный профиль' })).toBeVisible();
    await expect(page.getByRole('status')).toContainText(fixture === 'sessionExpired' ? 'Сессия завершилась' : 'Аккаунт заблокирован');
    expect(await personalCache(page)).toBeUndefined();
    await page.getByRole('link', { name: 'Найти встречу', exact: true }).click();
    await expect(page).toHaveURL(/\/events(?:\?|$)/);
    await expect(page.getByRole('heading', { name: 'Найти встречу', exact: true })).toBeVisible();
  });
}

test('logout only clears the profile and cache after 204', async ({ page }) => {
  let loggedOut = false;
  let attempts = 0;
  await page.route('**/api/v1/me', (route) => fulfillCase(route, loggedOut ? 'authenticationRequired' : 'getMeSuccess'));
  await page.route('**/api/v1/auth/logout', async (route) => {
    attempts++;
    if (attempts === 1) await route.abort('failed');
    else { loggedOut = true; await fulfillCase(route, 'logoutSuccess'); }
  });
  await page.goto('/me');
  await expect(page.getByRole('heading', { name: 'Анна', exact: true })).toBeVisible();
  await setPersonalCache(page);
  await page.getByRole('button', { name: 'Выйти', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Не удалось подтвердить выход');
  await expect(page.getByRole('heading', { name: 'Анна', exact: true })).toBeVisible();
  expect(await personalCache(page)).toBe('old-account-only');
  await page.getByRole('button', { name: 'Выйти', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Войди, чтобы открыть личный профиль' })).toBeVisible();
  expect(await personalCache(page)).toBeUndefined();
  expect(attempts).toBe(2);
});

for (const width of [320, 390, 768, 1280]) {
  test(`auth and private profile layout at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/register'); await fillRegistration(page);
    await page.getByRole('radio', { name: 'Спутник', exact: true }).check();
    await expect(page.getByRole('button', { name: 'Создать профиль', exact: true })).toBeEnabled();
    await page.evaluate(() => document.fonts.ready);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `.artifacts/fe-02/register-${width}.png`, fullPage: true });
    const me = meFixture();
    me.systemRole = 'ADMIN';
    me.account.displayName = 'Александра '.repeat(10).trim();
    await page.route('**/api/v1/me', (route) => fulfillCase(route, 'getMeSuccess', { responseBody: me }));
    await page.goto('/me');
    await expect(page.getByRole('region', { name: 'Модерация', exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `.artifacts/fe-02/profile-${width}.png`, fullPage: true });
  });
}
