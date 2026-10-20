import { useQuery } from '@tanstack/react-query';
import { useSession } from '../../features/auth/SessionProvider';
import { sessionEpoch } from './session-boundary';

export class ResourceFailure extends Error {
  constructor(readonly status: number) { super(`Resource request failed: ${status}`); }
}

export function useResourceQuery<T>(kind: string, id: string, read: (id: string, signal: AbortSignal) => Promise<T>) {
  useSession();
  const validId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
  return useQuery({
    queryKey: ['resource', sessionEpoch(), kind, id],
    queryFn: ({ signal }) => {
      if (!validId) throw new ResourceFailure(404);
      return read(id, AbortSignal.any([signal, AbortSignal.timeout(15_000)]));
    },
    staleTime: 0,
    refetchOnMount: 'always',
    // Refetching on return also re-evaluates publication and current permissions.
    refetchOnWindowFocus: 'always',
  });
}
