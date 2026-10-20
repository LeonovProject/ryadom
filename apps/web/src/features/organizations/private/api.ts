import { api, type components } from '../../../shared/api/client';
import { ResourceFailure } from '../../../shared/api/resource-query';

export const isUUID = (id: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
export const sameId = (first: string, second: string) => first.toLowerCase() === second.toLowerCase();
export function verifyOwner(organization: components['schemas']['PrivateOrganization'], ownerId: string) {
  if (!sameId(organization.owner.id, ownerId)) throw new ResourceFailure(502);
  if (organization.application && !sameId(organization.application.organizationId, organization.id)) throw new ResourceFailure(502);
}
export async function readOrganization(id: string, ownerId: string, signal: AbortSignal) {
  const result = await api.GET('/me/organizations/{organizationId}', { params: { path: { organizationId: id } }, signal, cache: 'no-store' });
  if (!result.data || result.response.status !== 200) throw new ResourceFailure(result.response.status);
  if (!sameId(result.data.id, id)) throw new ResourceFailure(502);
  verifyOwner(result.data, ownerId);
  return result.data;
}

export class OrganizationWriteFailure extends Error {
  constructor(readonly code: components['schemas']['Error']['code'] | 'UNKNOWN_RESULT', readonly fields: Record<string, string[]> = {}, readonly status = 0) { super(code); }
}
function writeFailure(response: Response, payload?: components['schemas']['ErrorResponse']) {
  return response.status >= 400 && response.status < 500 && payload
    ? new OrganizationWriteFailure(payload.error.code, payload.error.fieldErrors, response.status)
    : new OrganizationWriteFailure('UNKNOWN_RESULT');
}
export async function createOrganization(input: components['schemas']['CreateOrganizationInput'], ownerId: string, signal: AbortSignal) {
  const result = await api.POST('/organizations', { body: input, signal });
  if (result.response.status !== 201 || !result.data) throw writeFailure(result.response, result.error);
  if (!isUUID(result.data.id) || !sameId(result.data.owner.id, ownerId)) throw new OrganizationWriteFailure('UNKNOWN_RESULT');
  return result.data;
}
export async function submitOrganization(id: string, signal: AbortSignal) {
  // No body, identity, decision or reason is sent. Existing applications are not reopened.
  const result = await api.POST('/organizations/{organizationId}/application', { params: { path: { organizationId: id } }, signal });
  if ((result.response.status !== 201 && result.response.status !== 200) || !result.data) throw writeFailure(result.response, result.error);
  if (!sameId(result.data.organizationId, id)) throw new OrganizationWriteFailure('UNKNOWN_RESULT');
  return { application: result.data, repeated: result.response.status === 200 };
}
