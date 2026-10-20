import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { fulfillCase, guestFixtures } from './http-fixtures';

const catalog = JSON.parse(fs.readFileSync(path.resolve('packages/contracts/avatar-presets.json'), 'utf8')) as {
  items: { id: string; label: string; imageUrl: string }[];
};
test.beforeEach(async ({ page }) => {
  await guestFixtures(page);
  await page.route('**/api/v1/avatar-presets', (route) => fulfillCase(route, 'avatarPresetsPopulated', { responseBody: catalog }));
  await page.route('**/assets/avatars/presets/*.svg', (route) => route.fulfill({
    contentType: 'image/svg+xml', path: path.resolve(`packages/contracts/avatar-presets/${new URL(route.request().url()).pathname.split('/').at(-1)}`),
  }));
});

for (const random of [0, 0.9999]) {
  test(`random initial choice ${random} remains stable after typing, manual selection and catalogue reload`, async ({ page }) => {
    await page.addInitScript((value) => { Math.random = () => value; }, random);
    await page.goto('/register');
    const expected = catalog.items[random === 0 ? 0 : catalog.items.length - 1];
    await expect(page.getByRole('radio', { name: expected.label, exact: true })).toBeChecked();
    await page.getByLabel('Имя (обязательно)', { exact: true }).fill('Новый участник');
    await expect(page.getByRole('radio', { name: expected.label, exact: true })).toBeChecked();
    await page.getByRole('radio', { name: 'Пожарная', exact: true }).check();
    await page.getByRole('button', { name: 'Обновить готовые аватары', exact: true }).click();
    await expect(page.getByRole('radio', { name: 'Пожарная', exact: true })).toBeChecked();
    await expect(page.locator('input[name=presetId]:checked')).toHaveCount(1);
    await expect(page.getByRole('group', { name: 'Выберите аватар', exact: true })).toBeVisible();
    await expect(page.getByText(/аватар.*обязательно/)).toHaveCount(0);
  });
}

for (const width of [320, 390, 768, 1280]) {
  test(`all user avatars load and fit at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/register');
    const group = page.getByRole('group', { name: 'Выберите аватар', exact: true });
    await expect(group.getByRole('radio')).toHaveCount(7);
    await expect.poll(() => group.locator('img').evaluateAll((images) => images.every((image) => (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth > 0))).toBe(true);
    await expect(page.locator('input[name=presetId]:checked')).toHaveCount(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await group.screenshot({ path: `.artifacts/avatars/registration-${width}.png` });
  });
}
