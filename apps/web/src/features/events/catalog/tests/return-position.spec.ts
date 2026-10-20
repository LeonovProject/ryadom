import { expect, test, type Page } from '@playwright/test';
import type { components } from '../../../../shared/api/client';
import { fulfillCase, guestFixtures, httpCase } from '../../../auth/tests/http-fixtures';

const from = '2026-10-20T07:00:00Z';
const catalog = `/events?${new URLSearchParams({ from, city: 'Красноярск', joinMode: 'OPEN' })}`;
const id = (index: number) => `00000002-0000-4000-8000-${String(index).padStart(12, '0')}`;
async function fixtures(page: Page) {
  await guestFixtures(page);
  const first = (httpCase('listEventsSuccess').responseBody as components['schemas']['EventPage']).items[0];
  const model = { omit: 0, fail: false, empty: false, hold: false, longTitles: false, release: () => {}, reads: [] as URL[] };
  await page.route('**/api/v1/events?*', async (route) => {
    const url = new URL(route.request().url()); model.reads.push(url);
    if (model.hold) await new Promise<void>((resolve) => { model.release = resolve; });
    if (model.fail) return fulfillCase(route, 'internalError');
    const next = url.searchParams.has('cursor');
    const items = model.empty ? [] : Array.from({ length: next ? 8 : 12 }, (_, offset) => offset + (next ? 13 : 1)).filter((index) => index !== model.omit).map((index) => ({ ...first, id: id(index), title: model.longTitles && index < 17 ? `Встреча ${index}: знакомство с разными спортивными направлениями для начинающих, любителей и опытных участников` : `Встреча ${index}`, joinMode: 'OPEN' as const }));
    await fulfillCase(route, 'listEventsSuccess', { responseBody: { items, nextCursor: next || model.empty ? null : 'second-page' } }).catch(() => undefined);
  });
  return model;
}
async function openSeventeenth(page: Page, link: 'title' | 'action' = 'action') {
  await page.goto(catalog); await page.evaluate(() => document.fonts.ready);
  await expect(page.getByRole('article')).toHaveCount(12); await page.getByRole('button', { name: 'Показать ещё' }).click();
  await expect(page.getByRole('article')).toHaveCount(20);
  const card = page.getByRole('article').filter({ has: page.getByRole('heading', { name: 'Встреча 17', exact: true }) });
  const target = link === 'title' ? card.getByRole('link', { name: 'Встреча 17', exact: true }) : card.getByRole('link', { name: 'Открыть встречу', exact: true });
  await target.scrollIntoViewIfNeeded();
  const offset = (await card.boundingBox())!.y;
  await target.click(); await expect(page).toHaveURL(`/events/${id(17)}`); await expect(page.getByRole('link', { name: '← К найденным встречам' })).toBeVisible();
  return { offset, card, target };
}

for (const width of [390, 1280]) for (const method of ['back-link', 'browser-back'] as const) test(`restores refreshed second-page position and focus via ${method} at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 }); const model = await fixtures(page);
  const saved = await openSeventeenth(page, method === 'browser-back' ? 'title' : 'action'); const reads = model.reads.length;
  if (method === 'browser-back') await page.goBack(); else await page.getByRole('link', { name: '← К найденным встречам' }).click();
  await expect(page).toHaveURL(catalog); await expect(page.getByRole('article')).toHaveCount(20);
  await expect(saved.target).toBeFocused(); await expect(saved.target).toBeInViewport();
  await expect.poll(async () => Math.abs((await saved.card.boundingBox())!.y - saved.offset)).toBeLessThan(5);
  expect(model.reads.length).toBeGreaterThan(reads); expect(model.reads.at(-1)?.searchParams.get('cursor')).toBe('second-page');
  await expect(page.getByLabel('Город', { exact: true })).toHaveValue('Красноярск');
  await page.screenshot({ path: `.artifacts/fe-03-return/${method}-${width}.png` });
});

test('restores an anchor relative to the viewport even if earlier cards change their height', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); const model = await fixtures(page);
  const saved = await openSeventeenth(page); model.longTitles = true;
  await page.getByRole('link', { name: '← К найденным встречам' }).click(); await expect(saved.target).toBeFocused();
  await expect(saved.target).toBeInViewport(); await expect.poll(async () => Math.abs((await saved.card.boundingBox())!.y - saved.offset)).toBeLessThan(5);
});

for (const empty of [false, true]) test(`a removed card falls back to fresh results without resurrecting old content (empty=${empty})`, async ({ page }) => {
  const model = await fixtures(page); await openSeventeenth(page); model.omit = 17; model.empty = empty;
  await page.getByRole('link', { name: '← К найденным встречам' }).click(); const heading = page.getByRole('heading', { name: 'Встречи по выбранным условиям', exact: true });
  await expect(heading).toBeFocused(); await expect(heading).toBeInViewport(); await expect(page.getByRole('heading', { name: 'Встреча 17', exact: true })).toHaveCount(0);
  if (empty) await expect(page.getByRole('heading', { name: 'По этим условиям встреч пока нет', exact: true })).toBeVisible();
});

test('waits for the canonical reread before restoring a cached card', async ({ page }) => {
  const model = await fixtures(page); const saved = await openSeventeenth(page); model.hold = true; const before = model.reads.length;
  await page.getByRole('link', { name: '← К найденным встречам' }).click(); await expect.poll(() => model.reads.length).toBeGreaterThan(before);
  await expect(page.getByRole('heading', { level: 1 })).toBeFocused(); await expect(saved.target).not.toBeFocused();
  model.hold = false; model.release(); await expect(saved.target).toBeFocused(); await expect(saved.target).toBeInViewport();
});

test('a filter focused during a slow return never loses focus to the saved card', async ({ page }) => {
  const model = await fixtures(page); const saved = await openSeventeenth(page); model.hold = true; const before = model.reads.length;
  await page.getByRole('link', { name: '← К найденным встречам' }).click(); await expect.poll(() => model.reads.length).toBeGreaterThan(before);
  const field = page.getByLabel('Что интересно?'); await field.fill('новый интерес'); model.hold = false; model.release();
  await expect(page.getByRole('status').filter({ hasText: 'Показано встреч: 20' })).not.toContainText('Обновляем');
  await expect(field).toBeFocused(); await expect(field).toHaveValue('новый интерес'); await expect(saved.target).not.toBeFocused();
});

test('a failed reread hides old cards; retry cannot restore a publication removed meanwhile', async ({ page }) => {
  const model = await fixtures(page); await openSeventeenth(page); model.fail = true;
  await page.getByRole('link', { name: '← К найденным встречам' }).click(); await expect(page.getByRole('heading', { name: 'Не удалось обновить встречи' })).toBeVisible(); await expect(page.getByRole('article')).toHaveCount(0);
  model.fail = false; model.omit = 17; await page.getByRole('button', { name: 'Повторить загрузку', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Встреча 17', exact: true })).toHaveCount(0); await expect(page.getByRole('article')).toHaveCount(12);
});

test('changing filters during a pending return drops the bookmark and the old cursor scope', async ({ page }) => {
  const model = await fixtures(page); await openSeventeenth(page); model.hold = true; const before = model.reads.length;
  await page.getByRole('link', { name: '← К найденным встречам' }).click(); await expect.poll(() => model.reads.length).toBeGreaterThan(before);
  await page.getByLabel('Город', { exact: true }).fill('Москва'); model.hold = false; await page.getByRole('button', { name: 'Найти встречи', exact: true }).click(); model.release();
  await expect.poll(() => model.reads.at(-1)?.searchParams.get('city')).toBe('Москва'); await expect(page.getByRole('article')).toHaveCount(12);
  expect(model.reads.at(-1)?.searchParams.has('cursor')).toBe(false); await expect(page.getByRole('heading', { name: 'Встреча 17', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Найти встречи', exact: true })).toBeFocused();
});

test('a changed session discards the old return position and does not fetch former extra pages', async ({ page }) => {
  const model = await fixtures(page); await openSeventeenth(page);
  await page.route('**/api/v1/me', (route) => fulfillCase(route, 'getMeSuccess')); await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByRole('link', { name: 'Личный профиль: Анна' })).toBeVisible(); const before = model.reads.length;
  await page.getByRole('link', { name: '← К найденным встречам' }).click(); await expect(page.getByRole('article')).toHaveCount(12); await expect(page.getByRole('heading', { level: 1 })).toBeFocused();
  expect(model.reads.slice(before).every((url) => !url.searchParams.has('cursor'))).toBe(true);
});

test('keyboard return restores a visible focus ring to the original title link', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await fixtures(page);
  await page.goto(catalog); await page.getByRole('button', { name: 'Показать ещё' }).click();
  const target = page.getByRole('link', { name: 'Встреча 17', exact: true }); await target.focus(); await page.keyboard.press('Enter');
  await expect(page).toHaveURL(`/events/${id(17)}`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Первое знакомство с петанком');
  const back = page.getByRole('link', { name: '← К найденным встречам' }); await back.focus(); await expect(back).toBeFocused(); await page.keyboard.press('Enter');
  await expect(target).toBeFocused(); await expect(target).toBeInViewport();
  expect(await target.evaluate((element) => getComputedStyle(element).outlineStyle)).toBe('solid');
  expect(await target.evaluate((element) => parseFloat(getComputedStyle(element).outlineWidth))).toBeGreaterThanOrEqual(3);
});

test('the bookmark is consumed once and a subsequent refresh does not pull focus back', async ({ page }) => {
  const model = await fixtures(page); const saved = await openSeventeenth(page);
  await page.getByRole('link', { name: '← К найденным встречам' }).click(); await expect(saved.target).toBeFocused();
  const before = model.reads.length; const update = page.getByRole('button', { name: 'Обновить', exact: true }); await update.click();
  await expect.poll(() => model.reads.length).toBeGreaterThan(before); await expect(page.getByRole('article')).toHaveCount(12);
  await expect(update).toBeFocused(); await expect(saved.target).toHaveCount(0);
});

test('a document reload does not persist the bookmark or request discarded cursor pages', async ({ page }) => {
  const model = await fixtures(page); await openSeventeenth(page); await page.reload();
  await expect(page.getByRole('link', { name: '← К найденным встречам' })).toBeVisible(); const before = model.reads.length;
  await page.getByRole('link', { name: '← К найденным встречам' }).click(); await expect(page).toHaveURL(catalog); await expect(page.getByRole('article')).toHaveCount(12);
  await expect(page.getByRole('heading', { level: 1 })).toBeFocused(); expect(model.reads.slice(before).every((url) => !url.searchParams.has('cursor'))).toBe(true);
});
