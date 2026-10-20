import { useInfiniteQuery } from '@tanstack/react-query';
import { api, type components } from '../../../shared/api/client';
import { sessionEpoch } from '../../../shared/api/session-boundary';
import { ResourceFailure } from '../../../shared/api/resource-query';
import { sameId, verifyOwner } from './api';

export class OrganizationListFailure extends ResourceFailure {
  constructor(status: number, readonly invalidCursor = false) { super(status); }
}
export const organizationListKey = (ownerId: string) => ['private', sessionEpoch(), 'organizations', ownerId] as const;
export const organizationEventsKey = (ownerId: string, id: string) => ['private', sessionEpoch(), 'organization-events', ownerId, id] as const;
export function useOrganizations(ownerId: string) {
  return useInfiniteQuery({
    queryKey: organizationListKey(ownerId), initialPageParam: undefined as string | undefined,
    queryFn: async ({ signal, pageParam }) => {
      const result = await api.GET('/me/organizations', { params: { query: { limit: 12, cursor: pageParam } }, signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]), cache: 'no-store' });
      if (!result.data || result.response.status !== 200) throw new OrganizationListFailure(result.response.status, result.error?.error.code === 'INVALID_CURSOR');
      if (result.data.nextCursor && result.data.nextCursor === pageParam) throw new OrganizationListFailure(400, true);
      for (const item of result.data.items) verifyOwner(item, ownerId);
      if (new Set(result.data.items.map((item) => item.id)).size !== result.data.items.length) throw new OrganizationListFailure(502);
      return result.data;
    },
    getNextPageParam: (last, _pages, _lastParam, params) => last.nextCursor && !params.includes(last.nextCursor) ? last.nextCursor : undefined,
    staleTime: 0, refetchOnMount: 'always', refetchOnWindowFocus: 'always',
  });
}
export function useOrganizationEvents(ownerId: string, organizationId: string) {
  return useInfiniteQuery({
    queryKey: organizationEventsKey(ownerId, organizationId), initialPageParam: undefined as string | undefined,
    queryFn: async ({ signal, pageParam }) => {
      const result = await api.GET('/me/events', { params: { query: { organizationId, limit: 6, cursor: pageParam } }, signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]), cache: 'no-store' });
      if (!result.data || result.response.status !== 200) throw new OrganizationListFailure(result.response.status, result.error?.error.code === 'INVALID_CURSOR');
      if (result.data.nextCursor && result.data.nextCursor === pageParam) throw new OrganizationListFailure(400, true);
      if (new Set(result.data.items.map((entry) => entry.event.id)).size !== result.data.items.length) throw new OrganizationListFailure(502);
      for (const { event } of result.data.items) {
        if (event.publicationStatus === 'PUBLISHED' && (event.organizer.type !== 'ORGANIZATION' || !sameId(event.organizer.organization.id, organizationId))) throw new OrganizationListFailure(502);
      }
      return result.data;
    },
    getNextPageParam: (last, _pages, _lastParam, params) => last.nextCursor && !params.includes(last.nextCursor) ? last.nextCursor : undefined,
    staleTime: 0, refetchOnMount: 'always', refetchOnWindowFocus: 'always',
  });
}
export function uniqueOrganizations(pages: components['schemas']['OrganizationPage'][]) {
  const items = new Map<string, components['schemas']['PrivateOrganization']>();
  for (const page of pages) for (const item of page.items) items.set(item.id, item);
  return [...items.values()];
}
export function uniqueOrganizationEvents(pages: components['schemas']['OwnedEventPage'][]) {
  const items = new Map<string, components['schemas']['OwnedEventEntry']>();
  for (const page of pages) for (const entry of page.items) items.set(entry.event.id, entry);
  return [...items.values()];
}
