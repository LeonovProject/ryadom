import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useSession } from '../../auth/SessionProvider';
import { sessionEpoch } from '../../../shared/api/session-boundary';
import { api, type components } from '../../../shared/api/client';
import type { EventQuery } from './filters';

export class CatalogFailure extends Error {
  constructor(readonly code: 'INVALID_CURSOR' | 'LOAD_FAILED') { super(code); }
}

export function useActivityTypes() {
  useSession(); // Public observers reconnect when the session boundary clears the cache.
  return useQuery({
    queryKey: ['public', 'activity-types', sessionEpoch()],
    queryFn: async ({ signal }) => {
      const result = await api.GET('/activity-types', { signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]), cache: 'no-store' });
      if (!result.data || result.response.status !== 200) throw new CatalogFailure('LOAD_FAILED');
      if (new Set(result.data.items.map((item) => item.id.toLowerCase())).size !== result.data.items.length) throw new CatalogFailure('LOAD_FAILED');
      return result.data.items;
    },
    staleTime: 30_000,
  });
}

export function useEventFeed(query: EventQuery, enabled = true) {
  useSession();
  return useInfiniteQuery({
    queryKey: ['public', 'events', sessionEpoch(), query],
    initialPageParam: undefined as string | undefined,
    enabled,
    queryFn: async ({ pageParam, signal }) => {
      const result = await api.GET('/events', { params: { query: { ...query, cursor: pageParam } }, signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]), cache: 'no-store' });
      if (!result.data || result.response.status !== 200) throw new CatalogFailure(result.error?.error.code === 'INVALID_CURSOR' ? 'INVALID_CURSOR' : 'LOAD_FAILED');
      if (result.data.nextCursor && result.data.nextCursor === pageParam) throw new CatalogFailure('INVALID_CURSOR');
      if (new Set(result.data.items.map((item) => item.id.toLowerCase())).size !== result.data.items.length) throw new CatalogFailure('LOAD_FAILED');
      if (result.data.items.some((item) => item.publicationStatus !== 'PUBLISHED')) throw new CatalogFailure('LOAD_FAILED');
      return result.data;
    },
    getNextPageParam: (lastPage, _pages, _lastParam, params) => lastPage.nextCursor && !params.includes(lastPage.nextCursor) ? lastPage.nextCursor : undefined,
    staleTime: 30_000,
    refetchOnMount: 'always',
    refetchOnWindowFocus: 'always',
  });
}

export function uniqueEvents(pages: components['schemas']['EventPage'][]): components['schemas']['PublishedEventSummary'][] {
  const events = new Map<string, components['schemas']['PublishedEventSummary']>();
  // Preserve server order; a fresh occurrence updates the card without duplicating it.
  for (const page of pages) for (const event of page.items) events.set(event.id.toLowerCase(), event);
  return [...events.values()];
}
