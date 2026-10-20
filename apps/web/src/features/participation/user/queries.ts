import { useCallback, useEffect, useState } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { api, type components, type operations } from '../../../shared/api/client';
import { sessionEpoch } from '../../../shared/api/session-boundary';
import { OperationFailure, operationFailure, requestSignal, sameId } from '../../../shared/api/operation';
import { useSession } from '../../auth/SessionProvider';

export type ParticipationQuery = NonNullable<operations['listMyParticipations']['parameters']['query']>;
export type PrivateRow = { event: components['schemas']['EventSummary']; participation: components['schemas']['Participation'] | null; canManage: boolean };
export type PrivatePage = { items: PrivateRow[]; nextCursor: string | null; referenceTime: string | null };
export function useRefreshToken() {
  const [token, setToken] = useState(0);
  const refresh = useCallback(() => setToken((value) => value + 1), []);
  useEffect(() => {
    const focus = () => { if (document.visibilityState === 'visible') refresh(); };
    window.addEventListener('focus', focus); document.addEventListener('visibilitychange', focus);
    return () => { window.removeEventListener('focus', focus); document.removeEventListener('visibilitychange', focus); };
  }, [refresh]);
  return { token, refresh };
}
export async function readParticipations(query: ParticipationQuery, signal: AbortSignal) {
  const result = await api.GET('/me/participations', { params: { query }, querySerializer: { array: { style: 'form', explode: false } }, signal: requestSignal(signal), cache: 'no-store' });
  if (!result.data || result.response.status !== 200) throw operationFailure(result);
  const page = result.data;
  if (query.eventWindow && (!page.referenceTime || !Number.isFinite(Date.parse(page.referenceTime)))) throw new OperationFailure(502);
  if (query.referenceTime && Date.parse(page.referenceTime!) !== Date.parse(query.referenceTime)) throw new OperationFailure(502);
  if (!query.eventWindow && page.referenceTime !== null) throw new OperationFailure(502);
  if (new Set(page.items.map((item) => item.participation.id.toLowerCase())).size !== page.items.length) throw new OperationFailure(502);
  if (page.items.some((item) => !sameId(item.participation.eventId, item.event.id) || query.eventWindow && item.event.publicationStatus !== 'PUBLISHED' || query.status && !query.status.includes(item.participation.status))) throw new OperationFailure(502);
  return page;
}
export function usePrivateEvents(query: ParticipationQuery, created: boolean, organizationId: string | undefined, token: number) {
  useSession();
  return useInfiniteQuery({
    queryKey: ['private-events', sessionEpoch(), created, query, organizationId, token],
    initialPageParam: {} as { cursor?: string; referenceTime?: string },
    queryFn: async ({ pageParam, signal }): Promise<PrivatePage> => {
      if (created) {
        const result = await api.GET('/me/events', { params: { query: { limit: 12, organizationId, cursor: pageParam.cursor } }, signal: requestSignal(signal), cache: 'no-store' });
        if (!result.data || result.response.status !== 200) throw operationFailure(result);
        return { ...result.data, referenceTime: null, items: result.data.items.map((item) => ({ event: item.event, participation: null, canManage: item.canManageParticipants })) };
      }
      const result = await readParticipations({ ...query, ...pageParam }, signal);
      return { ...result, items: result.items.map((item) => ({ event: item.event, participation: item.participation, canManage: false })) };
    },
    getNextPageParam: (last, _pages, previous, params) => {
      if (!last.nextCursor || last.nextCursor === previous.cursor || params.some((item) => item.cursor === last.nextCursor)) return undefined;
      return { cursor: last.nextCursor, ...(last.referenceTime ? { referenceTime: last.referenceTime } : {}) };
    },
    gcTime: 0, refetchOnWindowFocus: false, refetchOnMount: 'always',
  });
}
export function privateRows(pages: PrivatePage[]) {
  const rows = new Map<string, PrivateRow>();
  for (const page of pages) for (const row of page.items) rows.set(row.event.id.toLowerCase(), row);
  return [...rows.values()];
}
