import { QueryClient } from '@tanstack/react-query';

export function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      // Features explicitly reconcile uncertain results; mutations never retry themselves.
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
}
