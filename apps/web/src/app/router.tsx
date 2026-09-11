import { createRootRoute, createRoute, createRouter } from '@tanstack/react-router';
import { AccountsPage } from '../features/accounts/AccountsPage';
import { CategoriesPage } from '../features/categories/CategoriesPage';
import { DashboardPage } from '../features/dashboard/DashboardPage';
import { SpendingPage } from '../features/spending/SpendingPage';
import { TransactionsPage } from '../features/transactions/TransactionsPage';
import { Layout } from './Layout';

export interface TransactionsSearch {
  account?: string;
  month?: string;
}

const rootRoute = createRootRoute({ component: Layout });

const routeTree = rootRoute.addChildren([
  createRoute({ getParentRoute: () => rootRoute, path: '/', component: DashboardPage }),
  createRoute({
    getParentRoute: () => rootRoute,
    path: '/transactions',
    component: TransactionsPage,
    validateSearch: (search: Record<string, unknown>): TransactionsSearch => ({
      account: typeof search.account === 'string' ? search.account : undefined,
      month: typeof search.month === 'string' && /^\d{4}-\d{2}$/.test(search.month) ? search.month : undefined,
    }),
  }),
  createRoute({ getParentRoute: () => rootRoute, path: '/spending', component: SpendingPage }),
  createRoute({ getParentRoute: () => rootRoute, path: '/accounts', component: AccountsPage }),
  createRoute({ getParentRoute: () => rootRoute, path: '/categories', component: CategoriesPage }),
]);

export const router = createRouter({ routeTree });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
