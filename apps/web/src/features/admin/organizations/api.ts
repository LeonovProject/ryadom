import { api, type components } from '../../../shared/api/client';
import { ResourceFailure } from '../../../shared/api/resource-query';

type Organization = components['schemas']['PrivateOrganization'];
export const sameId = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
export function verifyOrganization(item: Organization) {
  const app = item.application;
  if (item.approvalState === 'NOT_SUBMITTED' ? app !== null : !app || !sameId(app.organizationId, item.id) || app.status !== item.approvalState) throw new ResourceFailure(502);
}
export async function readOrganization(id: string, signal: AbortSignal) {
  const result = await api.GET('/admin/organizations/{organizationId}', { params: { path: { organizationId: id } }, signal, cache: 'no-store' });
  if (!result.data || result.response.status !== 200) throw new ResourceFailure(result.response.status);
  if (!sameId(result.data.id, id)) throw new ResourceFailure(502);
  verifyOrganization(result.data);
  return result.data;
}
export class DecisionFailure extends Error {
  constructor(readonly code: components['schemas']['Error']['code'] | 'UNKNOWN_RESULT', readonly fields: Record<string, string[]> = {}, readonly status = 0) { super(code); }
}
export async function decideOrganization(application: components['schemas']['OrganizationApplication'], input: components['schemas']['OrganizationDecisionInput'], signal: AbortSignal) {
  const result = await api.POST('/admin/applications/{applicationId}/decision', { params: { path: { applicationId: application.id } }, body: input, signal });
  if (!result.data || result.response.status !== 200) {
    throw result.response.status >= 400 && result.response.status < 500 && result.error
      ? new DecisionFailure(result.error.error.code, result.error.error.fieldErrors, result.response.status)
      : new DecisionFailure('UNKNOWN_RESULT');
  }
  const app = result.data;
  if (!sameId(app.id, application.id) || !sameId(app.organizationId, application.organizationId)
    || app.status !== (input.decision === 'APPROVE' ? 'APPROVED' : 'REJECTED')
    || (input.decision === 'REJECT' && app.rejectionReason !== input.reason)
    || !app.reviewedAt || !app.reviewedBy) throw new DecisionFailure('UNKNOWN_RESULT');
  return app;
}
