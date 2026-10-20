import { api } from '../../../shared/api/client';
import { ResourceFailure } from '../../../shared/api/resource-query';

export async function readEvent(eventId: string, signal: AbortSignal) {
  const result = await api.GET('/events/{eventId}', { params: { path: { eventId } }, signal, cache: 'no-store' });
  if (!result.data || result.response.status !== 200) throw new ResourceFailure(result.response.status);
  if (result.data.id.toLowerCase() !== eventId.toLowerCase()) throw new ResourceFailure(502);
  return result.data;
}
