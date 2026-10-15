import { QueryClient } from '@tanstack/react-query';

/**
 * The app's query client. Every query and mutation reads or writes this phone's own database, never the network, so
 * none of them waits for a connection: `networkMode: 'always'`. With the library's default ('online') a phone that goes
 * offline pauses every re-read, so a record saved offline (a shared event's "Not sent yet" row, its share in the
 * header) never showed until the connection came back (shared events end to end, finding E2E-1).
 */
export function createAppQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { staleTime: Infinity, retry: false, refetchOnWindowFocus: false, networkMode: 'always' },
      mutations: { networkMode: 'always' },
    },
  });
}
