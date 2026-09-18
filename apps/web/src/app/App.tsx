import { setActiveBook } from '@expanses/db';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { useMemo, useState } from 'react';
import type { AppDb } from '../db/bootstrap';
import { type AppState, AppContext } from './context';
import { router } from './router';

export function App({ app }: { app: AppDb }) {
  const [queryClient] = useState(
    () => new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false, refetchOnWindowFocus: false } } }),
  );
  // The open workspace is state rather than something read once at startup, so choosing another one re-reads
  // every book-scoped screen without reloading the app.
  const [bookId, setBookId] = useState(app.ws.bookId);
  const value = useMemo<AppState>(
    () => ({
      ...app,
      ws: { ...app.ws, bookId },
      switchBook: async (next) => {
        await setActiveBook(app.database, app.ws, next);
        setBookId(next);
        // Removed, not invalidated: an invalidated query keeps showing its old data while it refetches, and that
        // data is another workspace's money.
        queryClient.removeQueries();
      },
    }),
    [app, bookId, queryClient],
  );
  return (
    <AppContext.Provider value={value}>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </AppContext.Provider>
  );
}
