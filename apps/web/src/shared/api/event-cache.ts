import type { QueryClient } from '@tanstack/react-query';
import { sessionEpoch } from './session-boundary';

export async function refreshEventData(client: QueryClient, eventId: string) {
  const epoch = sessionEpoch();
  await Promise.all([
    client.invalidateQueries({ queryKey: ['resource', epoch, 'event', eventId] }),
    client.invalidateQueries({ queryKey: ['private-events', epoch] }),
    client.invalidateQueries({ queryKey: ['personal-plans', epoch] }),
    client.invalidateQueries({ queryKey: ['participants', epoch, eventId] }),
  ]);
}
