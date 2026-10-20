import { test, expect, type Page } from '@playwright/test';
import { guestFixtures, fulfillCase, httpCase, meFixture } from '../../../auth/tests/http-fixtures';
import type { components } from '../../../../shared/api/client';
const id = '00000002-0000-4000-8000-000000000001';
const path = `/events/${id}`;
const published = () => httpCase('getEventSuccess').responseBody as components['schemas']['PublishedEventDetail'];
const me = () => ({ ...meFixture(), sessionExpiresAt: '2099-01-01T00:00:00Z' });
async function setup(page: Page) {
  await guestFixtures(page);
  await page.route('**/api/v1/me', (route) => fulfillCase(route, 'getMeSuccess', { responseBody: me() }));
  await page.route('**/api/v1/me/participations?*', (route) => fulfillCase(route, 'myUpcomingEmptyStillHasReferenceTime'));
}
async function joinFixture(page: Page, mode: 'OPEN' | 'APPROVAL', fail = false) {
  await setup(page);
  let participation: components['schemas']['Participation'] | null = null, posts = 0;
  await page.route(`**/api/v1/events/${id}`, (route) => fulfillCase(route, 'getEventSuccess', { responseBody: { ...published(), joinMode: mode, myParticipation: participation, capabilities: { ...published().capabilities, canJoin: !participation, joinBlockedReason: participation ? 'ALREADY_PARTICIPATING' : null } } }));
  await page.route(`**/api/v1/events/${id}/participations`, async (route) => {
    posts++;
    if (fail) return route.abort();
    participation = { ...(httpCase('joinFreeEvent').responseBody as components['schemas']['Participation']), accountId: me().account.id, status: mode === 'OPEN' ? 'CONFIRMED' : 'PENDING' };
    await fulfillCase(route, 'joinEventSuccess', { responseBody: participation });
  });
  return () => posts;
}
for (const mode of ['OPEN', 'APPROVAL'] as const) test(`join ${mode} has one POST and shows canonical status`, async ({ page }) => {
  const posts = await joinFixture(page, mode);
  await page.goto(path);
  await page.getByRole('button', { name: mode === 'OPEN' ? 'Присоединиться' : 'Подать заявку', exact: true }).click();
  await expect(page.getByText(mode === 'OPEN' ? 'Ты участвуешь' : 'Заявка отправлена', { exact: true })).toBeVisible();
  expect(posts()).toBe(1);
});
test('uncertain join never replays and a failed read cannot unlock it', async ({ page }) => {
  const posts = await joinFixture(page, 'OPEN', true);
  await page.goto(path); await page.getByRole('button', { name: 'Присоединиться', exact: true }).click();
  await expect(page.getByText(/Результат записи неизвестен/)).toBeVisible();
  await page.route(`**/api/v1/events/${id}`, (route) => fulfillCase(route, 'internalError'));
  await page.getByRole('button', { name: 'Проверить текущую запись', exact: true }).click();
  await expect(page.getByText(/Повторная отправка остаётся заблокированной/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Присоединиться', exact: true })).toHaveCount(0);
  expect(posts()).toBe(1);
});
test('personal home shares server referenceTime and preserves server ordering', async ({ page }) => {
  await setup(page); const reads: URL[] = [];
  await page.route('**/api/v1/me/participations?*', (route) => {
    const url = new URL(route.request().url()); reads.push(url);
    return fulfillCase(route, url.searchParams.get('eventWindow') === 'UPCOMING' ? 'myUpcomingFirstPageKeepsReferenceTime' : 'myStartedTodayIncludesExactStart');
  });
  await page.setViewportSize({ width: 390, height: 844 }); await page.goto('/');
  await expect(page.getByRole('region', { name: 'Ближайшие личные встречи' })).toContainText('Совместная тренировка 6');
  await expect(page.getByRole('region', { name: 'Начались сегодня' })).toContainText('Совместная тренировка 4');
  expect(reads[0].searchParams.get('referenceTime')).toBeNull();
  expect(reads[1].searchParams.get('referenceTime')).toBe('2026-11-01T09:00:00Z');
  expect(reads[0].searchParams.get('status')).toBe('CONFIRMED');
  await expect(page.getByRole('navigation', { name: 'Быстрые переходы' }).getByRole('link', { name: 'Мои встречи', exact: true })).toBeVisible();
  const first = page.getByRole('region', { name: 'Ближайшие личные встречи' }).getByRole('article').first();
  await expect(first).toBeInViewport();
});
test('my list windows and limited unavailable records stay separate', async ({ page }) => {
  await setup(page); const reads: URL[] = [];
  await page.route('**/api/v1/me/participations?*', (route) => { const url = new URL(route.request().url()); reads.push(url); return fulfillCase(route, url.searchParams.get('eventWindow') === 'STARTED' ? 'myStartedNewestFirst' : url.searchParams.has('eventWindow') ? 'myUpcomingFirstPageKeepsReferenceTime' : 'myAllConfirmedIncludesUnavailable'); });
  await page.goto('/me/events');
  await expect(page.getByRole('heading', { name: 'Предстоящие встречи', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Начавшиеся', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Начавшиеся встречи', exact: true })).toBeVisible();
  await expect(page.getByRole('article').first()).toContainText('Совместная тренировка');
  expect(reads.at(-1)?.searchParams.get('eventWindow')).toBe('STARTED');
  await page.getByRole('link', { name: 'Все записи', exact: true }).click();
  await expect(page.getByText('Снято с публикации', { exact: true })).toBeVisible();
  expect(reads.at(-1)?.searchParams.has('eventWindow')).toBe(false);
  expect(reads.at(-1)?.searchParams.has('referenceTime')).toBe(false);
});

async function authorFixture(page: Page, canDecide = true) {
  await setup(page);
  await page.route(`**/api/v1/events/${id}`, (route) => fulfillCase(route, 'getEventSuccess', { responseBody: { ...published(), capabilities: { ...published().capabilities, canManageParticipants: true, canDecideParticipations: canDecide, joinBlockedReason: canDecide ? 'ALREADY_ORGANIZER' : 'EVENT_STARTED' } } }));
  const row = (httpCase('listEventParticipationsSuccess').responseBody as components['schemas']['ParticipantPage']).items[0];
  await page.route(`**/api/v1/events/${id}/participations?*`, (route) => fulfillCase(route, 'listEventParticipationsSuccess', { responseBody: { items: row.status === 'PENDING' ? [row] : [], nextCursor: null } }));
  return row;
}
for (const decision of ['ACCEPT', 'REJECT'] as const) test(`author decision ${decision} waits for the server and rereads`, async ({ page }) => {
  const row = await authorFixture(page); let posts = 0;
  await page.route('**/api/v1/participations/*/decision', async (route) => { posts++; expect(route.request().postDataJSON()).toEqual({ decision }); row.status = decision === 'ACCEPT' ? 'CONFIRMED' : 'REJECTED'; await fulfillCase(route, 'decideParticipationSuccess', { responseBody: row }); });
  await page.goto(`${path}/manage`);
  await page.getByRole('button', { name: decision === 'ACCEPT' ? 'Принять' : 'Отклонить', exact: true }).click();
  await expect(page.getByText(decision === 'ACCEPT' ? 'Принятие подтверждено сервером.' : 'Отказ подтверждён сервером.', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Принять', exact: true })).toHaveCount(0);
  expect(posts).toBe(1);
});
test('author can read after start but cannot decide; ADMIN without authorship cannot read the roster', async ({ page }) => {
  await authorFixture(page, false);
  await page.goto(`${path}/manage`);
  await expect(page.getByRole('link', { name: 'Алексей', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Принять', exact: true })).toHaveCount(0);
  const admin = me(); admin.systemRole = 'ADMIN';
  await page.route('**/api/v1/me', (route) => fulfillCase(route, 'getMeSuccess', { responseBody: admin }));
  await page.route(`**/api/v1/events/${id}`, (route) => fulfillCase(route, 'getEventSuccess'));
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Состав доступен автору встречи', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Алексей', exact: true })).toHaveCount(0);
});
