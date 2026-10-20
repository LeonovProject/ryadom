import type { Page } from '@playwright/test';
import type { components } from '../../../../shared/api/client';
import { fulfillCase, guestFixtures, meFixture } from '../../../auth/tests/http-fixtures';
import { organizationFixture, organizationId } from '../../../organizations/private/tests/fixtures';

export { apiError, organizationId, revisitTab } from '../../../organizations/private/tests/fixtures';
export const reviewPath = `/admin/organizations/${organizationId}`;
export async function adminFixtures(page: Page, state: components['schemas']['ApprovalState'] = 'PENDING') {
  await guestFixtures(page);
  const model = {
    me: { ...meFixture(), systemRole: 'ADMIN' as components['schemas']['Me']['systemRole'], sessionExpiresAt: '2099-01-01T00:00:00Z' },
    organization: { ...organizationFixture(state), canPublish: false, canSubmit: false },
    queries: [] as URL[], bodies: [] as components['schemas']['OrganizationDecisionInput'][], reads: 0,
  };
  model.me.account = { ...model.me.account, id: '00000001-0000-4000-8000-000000000003', displayName: 'Администратор' };
  model.me.organizations = [];
  await page.route('**/api/v1/me', (route) => fulfillCase(route, 'getMeSuccess', { responseBody: model.me }));
  await page.route('**/api/v1/admin/organizations?*', async (route) => {
    const url = new URL(route.request().url()); model.queries.push(url);
    const state = url.searchParams.get('approvalState');
    await fulfillCase(route, 'adminListOrganizationsSuccess', { responseBody: { items: !state || model.organization.approvalState === state ? [model.organization] : [], nextCursor: null } });
  });
  await page.route('**/api/v1/admin/organizations/*', async (route) => { model.reads++; await fulfillCase(route, 'adminGetOrganizationSuccess', { responseBody: model.organization }); });
  await page.route('**/api/v1/admin/applications/*/decision', async (route) => {
    const input = route.request().postDataJSON() as components['schemas']['OrganizationDecisionInput']; model.bodies.push(input);
    const state = input.decision === 'APPROVE' ? 'APPROVED' : 'REJECTED';
    const application = { ...model.organization.application!, status: state as 'APPROVED' | 'REJECTED', reviewedAt: '2026-11-02T09:00:00Z', reviewedBy: model.me.account.id, rejectionReason: input.decision === 'REJECT' ? input.reason : null };
    model.organization = { ...model.organization, approvalState: state, application };
    await fulfillCase(route, 'adminDecideOrganizationSuccess', { responseBody: application });
  });
  return model;
}
