import { useInfiniteQuery } from '@tanstack/react-query';
import { api, type components } from '../../../shared/api/client';
import { ResourceFailure } from '../../../shared/api/resource-query';
import { sessionEpoch } from '../../../shared/api/session-boundary';
import { verifyOrganization } from './api';
import { readFilters } from './filters';

export class ListFailure extends ResourceFailure {
  constructor(status: number, readonly invalidCursor = false) { super(status); }
}
export function useAdminOrganizations(search: string) {
  let filters: ReturnType<typeof readFilters> = {};
  let filterError: Error | undefined;
  try { filters = readFilters(search); } catch (error) { filterError = error as Error; }
  const queryKey = ['admin', sessionEpoch(), 'organizations', filters] as const;
  const query = useInfiniteQuery({
    queryKey, initialPageParam: undefined as string | undefined, enabled: !filterError,
    queryFn: async ({ signal, pageParam }) => {
      const result = await api.GET('/admin/organizations', { params: { query: { ...filters, limit: 12, cursor: pageParam } }, signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]), cache: 'no-store' });
      if (!result.data || result.response.status !== 200) throw new ListFailure(result.response.status, result.error?.error.code === 'INVALID_CURSOR');
      if (result.data.nextCursor && result.data.nextCursor === pageParam) throw new ListFailure(400, true);
      if (new Set(result.data.items.map((item) => item.id.toLowerCase())).size !== result.data.items.length) throw new ListFailure(502);
      for (const item of result.data.items) {
        verifyOrganization(item);
        if (filters.approvalState && item.approvalState !== filters.approvalState) throw new ListFailure(502);
      }
      return result.data;
    },
    getNextPageParam: (last, _pages, _last, params) => last.nextCursor && !params.includes(last.nextCursor) ? last.nextCursor : undefined,
    staleTime: 0, refetchOnMount: 'always', refetchOnWindowFocus: 'always',
  });
  return { query, queryKey, filterError };
}
export function uniqueOrganizations(pages: components['schemas']['OrganizationPage'][]) {
  const items = new Map<string, components['schemas']['PrivateOrganization']>();
  for (const page of pages) for (const item of page.items) items.set(item.id.toLowerCase(), item);
  return [...items.values()];
}
