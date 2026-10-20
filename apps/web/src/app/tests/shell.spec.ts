import { expect, test } from '@playwright/test';
import { screenRoutes } from '../routes';
import { guestFixtures } from '../../features/auth/tests/http-fixtures';

test.beforeEach(async ({ page }) => { await guestFixtures(page); });

test('unimplemented routes remain explicit placeholders; unknown URLs get 404', async ({ page }) => {
  const requests: string[] = [];
  page.on('request', (request) => { if (new URL(request.url()).pathname.startsWith('/api/v1/')) requests.push(request.url()); });
  for (const route of screenRoutes.filter((route) => !['/', '/events', '/events/new', '/login', '/register', '/me', '/me/events', '/events/:eventId/manage', '/events/:eventId', '/people/:accountId', '/organizations/:organizationId', '/organizations/new', '/me/organizations', '/me/organizations/:organizationId', '/admin/organizations', '/admin/organizations/:organizationId'].includes(route.path))) {
    await page.goto(route.path.replace(/:[^/]+/g, 'example'));
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(route.title);
    await expect(page.getByRole('heading', { name: 'Раздел готовится' })).toBeVisible();
    await expect(page).toHaveTitle(route.path === '/' ? 'Рядом — компания для спорта' : `${route.title} — Рядом`);
  }
  await page.goto('/missing');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Страница не найдена');
  await page.getByRole('link', { name: 'На главную', exact: true }).click();
  await expect(page).toHaveURL('/');
  expect(requests.every((url) => ['/api/v1/me', '/api/v1/events', '/api/v1/activity-types'].includes(new URL(url).pathname))).toBe(true);
});

for (const width of [320, 390, 768, 1280]) {
  test(`layout, fonts and navigation at ${width}px`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/dev/ui');
    await page.evaluate(() => document.fonts.ready);
    await expect(page.getByRole('heading', { name: 'Общие компоненты' })).toBeVisible();
    await expect(page.locator('time')).toContainText('07:00 GMT+7');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(await page.evaluate(() => document.fonts.check('400 16px "Open Sans"') && document.fonts.check('700 32px Montserrat'))).toBe(true);
    if (width <= 600) {
      await expect(page.getByRole('navigation', { name: 'Основная навигация', exact: true })).toBeHidden();
      await page.getByRole('button', { name: 'Меню', exact: true }).click();
      await expect(page.getByRole('navigation', { name: 'Основная навигация', exact: true })).toBeVisible();
      await page.screenshot({ path: `.artifacts/fe-01/menu-${width}.png` });
      await page.getByRole('link', { name: 'Найти встречу', exact: true }).focus();
      await page.keyboard.press('Escape');
      await expect(page.getByRole('button', { name: 'Меню', exact: true })).toBeFocused();
      await page.getByRole('button', { name: 'Меню', exact: true }).click();
    }
    await page.getByRole('link', { name: 'Найти встречу', exact: true }).click();
    await expect(page.getByRole('heading', { level: 1 })).toBeFocused();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Найти встречу');
    await page.goBack();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Общие компоненты');
    await page.screenshot({ path: `.artifacts/fe-01/gallery-${width}.png`, fullPage: true });
    expect(errors).toEqual([]);
  });
}

test('dialog traps keyboard focus, closes on Escape and restores focus', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/dev/ui');
  const trigger = page.getByRole('button', { name: 'Открыть диалог' });
  await trigger.click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toHaveAccessibleName('Пример диалога');
  await expect(dialog.getByLabel('Текст для проверки')).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(dialog.getByRole('button', { name: 'Закрыть' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(dialog.getByLabel('Текст для проверки')).toBeFocused();
  await page.screenshot({ path: '.artifacts/fe-01/dialog-390.png' });
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
  await trigger.click();
  await dialog.getByRole('button', { name: 'Закрыть' }).click();
  await expect(trigger).toBeFocused();
});

test('skip link, field error associations and explicit state transitions', async ({ page }) => {
  await page.goto('/dev/ui');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Общие компоненты');
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'К содержимому' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('main')).toBeFocused();
  const email = page.getByLabel('Email (обязательно)', { exact: true });
  await expect(email).toHaveAttribute('aria-invalid', 'true');
  await expect(email).toHaveAccessibleDescription('Укажи email в формате name@example.ru.');
  await page.getByRole('button', { name: 'Ошибка', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Не удалось загрузить данные');
  await page.getByRole('button', { name: 'Повторить пример' }).click();
  await expect(page.getByRole('status')).toContainText('Загружаем данные');
  await page.getByRole('button', { name: 'Нет доступа', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Нет доступа' })).toBeVisible();
});
