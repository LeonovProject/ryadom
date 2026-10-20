import { api, type components } from '../../../shared/api/client';
import { serverFieldErrors, type EventErrors } from './validation';

export class CreateEventFailure extends Error {
  constructor(readonly code: components['schemas']['Error']['code'] | 'UNKNOWN_RESULT', readonly fields: EventErrors = {}) { super(code); }
}
export async function publishEvent(input: components['schemas']['CreateEventInput'], signal: AbortSignal) {
  const result = await api.POST('/events', { body: input, signal });
  if (result.response.status === 201 && result.data && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(result.data.id) && result.data.publicationStatus === 'PUBLISHED') return result.data;
  // A failure after a possible commit is not permission to replay a creation request.
  if (result.response.status >= 400 && result.response.status < 500 && result.error) {
    throw new CreateEventFailure(result.error.error.code, serverFieldErrors(result.error.error.fieldErrors));
  }
  throw new CreateEventFailure('UNKNOWN_RESULT');
}
