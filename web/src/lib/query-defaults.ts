import type { QueryClientConfig } from '@tanstack/react-query';

/** Shared React Query defaults and per-domain stale times. */
export const QUERY_STALE = {
  default: 30_000,
  systemConfig: 5 * 60_000,
  deviceCatalog: 60_000,
  approvalQueue: 10_000,
  faultWorkbench: 10_000,
  chatList: 5_000,
  analytics: 60_000
} as const;

export const queryClientConfig: QueryClientConfig = {
  defaultOptions: {
    queries: {
      staleTime: QUERY_STALE.default,
      retry: 1,
      refetchOnWindowFocus: false
    },
    mutations: {
      retry: 0
    }
  }
};

export function invalidateOpsQueues(queryClient: { invalidateQueries: (opts: { queryKey: string[] }) => unknown }) {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: ['admin', 'reservations'] }),
    queryClient.invalidateQueries({ queryKey: ['admin', 'faults'] }),
    queryClient.invalidateQueries({ queryKey: ['admin', 'returns'] }),
    queryClient.invalidateQueries({ queryKey: ['notifications'] })
  ]);
}
