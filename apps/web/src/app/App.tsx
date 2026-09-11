import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { useState } from 'react';
import type { AppDb } from '../db/bootstrap';
import { AppContext } from './context';
import { router } from './router';

export function App({ app }: { app: AppDb }) {
  const [queryClient] = useState(
    () => new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false, refetchOnWindowFocus: false } } }),
  );
  return (
    <AppContext.Provider value={app}>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </AppContext.Provider>
  );
}
