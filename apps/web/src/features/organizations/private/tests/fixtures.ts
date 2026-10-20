import { type Page, type Route } from '@playwright/test';
import type { components } from '../../../../shared/api/client';
import { fulfillCase, guestFixtures, httpCase, meFixture } from '../../../auth/tests/http-fixtures';

export const organizationId = '00000003-0000-4000-8000-000000000001';
export const cabinetPath = `/me/organizations/${organizationId}`;
export function organizationFixture(state: components['schemas']['ApprovalState'] = 'NOT_SUBMITTED', id = organizationId): components['schemas']['PrivateOrganization'] {
  const organization = httpCase('createOrganizationSuccess').responseBody as components['schemas']['PrivateOrganization'];
  const application = httpCase('submitOrganizationSuccess').responseBody as components['schemas']['OrganizationApplication'];
  return { ...organization, id, approvalState: state, canSubmit: state === 'NOT_SUBMITTED', canPublish: state === 'APPROVED',
    application: state === 'NOT_SUBMITTED' ? null : { ...application, organizationId: id, status: state, reviewedAt: state === 'PENDING' ? null : '2026-11-02T09:00:00Z', reviewedBy: state === 'PENDING' ? null : '00000001-0000-4000-8000-000000000003', rejectionReason: state === 'REJECTED' ? 'Уточните описание спортивной деятельности.\n<b>Это текст причины.</b>' : null } };
}
export async function apiError(route: Route, status: number, code: components['schemas']['Error']['code'], fieldErrors: Record<string, string[]> = {}) {
  await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify({ error: { code, message: 'Fixture error', requestId: 'fixture', fieldErrors } }) });
}
export async function organizationFixtures(page: Page, state: components['schemas']['ApprovalState'] = 'NOT_SUBMITTED') {
  await guestFixtures(page);
  const model = { organization: organizationFixture(state), me: { ...meFixture(), sessionExpiresAt: '2099-01-01T00:00:00Z' }, createBodies: [] as unknown[], submissions: 0, eventsQueries: [] as URL[] };
  const syncMe = () => { model.me.organizations = [{ id: model.organization.id, name: model.organization.name, approvalState: model.organization.approvalState, canPublish: model.organization.canPublish }]; };
  syncMe();
  await page.route('**/api/v1/me', (route) => fulfillCase(route, 'getMeSuccess', { responseBody: model.me }));
  await page.route('**/api/v1/me/organizations?*', (route) => fulfillCase(route, 'listMyOrganizationsSuccess', { responseBody: { items: [model.organization], nextCursor: null } }));
  await page.route('**/api/v1/me/organizations/*', (route) => fulfillCase(route, 'getMyOrganizationSuccess', { responseBody: model.organization }));
  await page.route('**/api/v1/me/events?*', (route) => { model.eventsQueries.push(new URL(route.request().url())); return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [], nextCursor: null }) }); });
  await page.route('**/api/v1/organizations', async (route) => {
    model.createBodies.push(route.request().postDataJSON());
    model.organization = { ...organizationFixture(), ...route.request().postDataJSON() }; syncMe();
    await fulfillCase(route, 'createOrganizationSuccess', { responseBody: model.organization });
  });
  await page.route(`**/api/v1/organizations/${organizationId}/application`, async (route) => {
    model.submissions++; model.organization = { ...organizationFixture('PENDING'), name: model.organization.name }; syncMe();
    await fulfillCase(route, 'submitOrganizationSuccess', { responseBody: model.organization.application });
  });
  return model;
}
export async function fillOrganization(page: Page) {
  await page.getByLabel('Название организации (обязательно)', { exact: true }).fill('Клуб любителей петанка');
  await page.getByLabel('Деятельность (обязательно)', { exact: true }).fill('Знакомимся с правилами.\n<b>Без разметки</b>');
  await page.getByLabel('Спортивные интересы (обязательно)', { exact: true }).fill('Петанк, шахматы и бег');
}
export async function revisitTab(page: Page) {
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' }); document.dispatchEvent(new Event('visibilitychange', { bubbles: true }));
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' }); document.dispatchEvent(new Event('visibilitychange', { bubbles: true }));
  });
}
