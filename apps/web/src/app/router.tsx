import { parsePeriod } from '@expanses/core';
import { createRootRoute, createRoute, createRouter, redirect } from '@tanstack/react-router';
import { AccountsPage } from '../features/accounts/AccountsPage';
import { BackupPage } from '../features/backup/BackupPage';
import { EventDetailPage } from '../features/events/EventDetailPage';
import { EventsPage } from '../features/events/EventsPage';
import { BudgetPage } from '../features/budget/BudgetPage';
import { CalculatorsPage } from '../features/calculators/CalculatorsPage';
import { ImportPage } from '../features/import/ImportPage';
import { ReviewPage } from '../features/review/ReviewPage';
import { CardDetailPage } from '../features/cards/CardDetailPage';
import { CardsPage } from '../features/cards/CardsPage';
import { RecommendPage } from '../features/cards/RecommendPage';
import { CategoriesPage } from '../features/categories/CategoriesPage';
import { DashboardPage } from '../features/dashboard/DashboardPage';
import { MerchantsPage } from '../features/merchants/MerchantsPage';
import { AddAccountPage } from '../features/ownables/AddAccountPage';
import { AssetDetailPage } from '../features/networth/AssetDetailPage';
import { AssetsPage } from '../features/networth/AssetsPage';
import { GoalsPage } from '../features/goals/GoalsPage';
import { DebtsPage } from '../features/debts/DebtsPage';
import { LoanDetailPage } from '../features/loans/LoanDetailPage';
import { LoansPage } from '../features/loans/LoansPage';
import { CoretaxPage } from '../features/coretax/CoretaxPage';
import { OverviewPage } from '../features/networth/OverviewPage';
import { TradesPage } from '../features/networth/TradesPage';
import { BillFormPage, EditBillRoute } from '../features/bills/BillFormPage';
import { BillRoute } from '../features/bills/BillPage';
import { RecurringPage } from '../features/bills/RecurringPage';
import { TransactionsPage } from '../features/transactions/TransactionsPage';
import { SettingsPage } from '../features/workspaces/SettingsPage';
import { Layout } from './Layout';

export interface CardSearch {
  tab?: 'statement' | 'points' | 'rules' | 'card';
}

export interface TransactionsSearch {
  account?: string;
  /** The period on show, despite the name: a month, `2026-W38`, `2026-Q3`, `2026`, `all`, or `from..to`. */
  month?: string;
  /** Which way the same month is shown: the list, which carries the chart, or the table. */
  view?: 'list' | 'table';
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
      // Any period: a month as before, or a week, quarter, year, all time or two dates.
      month: typeof search.month === 'string' && parsePeriod(search.month) ? search.month : undefined,
      view: search.view === 'table' || search.view === 'list' ? search.view : undefined,
    }),
  }),
  // Spending was its own page; the chart it held now leads the transactions it adds up.
  createRoute({
    getParentRoute: () => rootRoute,
    path: '/spending',
    beforeLoad: () => {
      throw redirect({ to: '/transactions', search: { view: 'list' } });
    },
  }),
  createRoute({ getParentRoute: () => rootRoute, path: '/budget', component: BudgetPage }),
  createRoute({ getParentRoute: () => rootRoute, path: '/bills', component: RecurringPage }),
  createRoute({ getParentRoute: () => rootRoute, path: '/bills/new', component: () => <BillFormPage /> }),
  createRoute({ getParentRoute: () => rootRoute, path: '/bills/$billId', component: BillRoute }),
  createRoute({ getParentRoute: () => rootRoute, path: '/bills/$billId/edit', component: EditBillRoute }),
  createRoute({ getParentRoute: () => rootRoute, path: '/events', component: EventsPage }),
  createRoute({ getParentRoute: () => rootRoute, path: '/events/$eventId', component: EventDetailPage }),
  createRoute({ getParentRoute: () => rootRoute, path: '/calculators', component: CalculatorsPage }),
  // Before /accounts only for reading: a route is ranked by how specific its path is, never by where it sits here.
  createRoute({ getParentRoute: () => rootRoute, path: '/accounts/new', component: AddAccountPage }),
  createRoute({ getParentRoute: () => rootRoute, path: '/accounts', component: AccountsPage }),
  createRoute({ getParentRoute: () => rootRoute, path: '/categories', component: CategoriesPage }),
  createRoute({ getParentRoute: () => rootRoute, path: '/cards', component: CardsPage }),
  createRoute({ getParentRoute: () => rootRoute, path: '/cards/merchants', component: MerchantsPage }),
  createRoute({
    getParentRoute: () => rootRoute,
    path: '/cards/$cardId',
    component: CardDetailPage,
    validateSearch: (search: Record<string, unknown>): CardSearch => ({
      tab: typeof search.tab === 'string' && ['statement', 'points', 'rules', 'card'].includes(search.tab) ? (search.tab as CardSearch['tab']) : undefined,
    }),
  }),
  createRoute({ getParentRoute: () => rootRoute, path: '/net-worth', component: OverviewPage }),
  createRoute({ getParentRoute: () => rootRoute, path: '/net-worth/assets', component: AssetsPage }),
  createRoute({ getParentRoute: () => rootRoute, path: '/net-worth/assets/$accountId', component: AssetDetailPage }),
  createRoute({ getParentRoute: () => rootRoute, path: '/net-worth/trades', component: TradesPage }),
  createRoute({ getParentRoute: () => rootRoute, path: '/goals', component: GoalsPage }),
  createRoute({ getParentRoute: () => rootRoute, path: '/net-worth/debts', component: DebtsPage }),
  createRoute({ getParentRoute: () => rootRoute, path: '/net-worth/loans', component: LoansPage }),
  createRoute({ getParentRoute: () => rootRoute, path: '/net-worth/loans/$accountId', component: LoanDetailPage }),
  createRoute({ getParentRoute: () => rootRoute, path: '/tax-report', component: CoretaxPage }),
  createRoute({ getParentRoute: () => rootRoute, path: '/recommend', component: RecommendPage }),
  createRoute({ getParentRoute: () => rootRoute, path: '/import', component: ImportPage }),
  createRoute({ getParentRoute: () => rootRoute, path: '/review', component: ReviewPage }),
  createRoute({ getParentRoute: () => rootRoute, path: '/backup', component: BackupPage }),
  createRoute({ getParentRoute: () => rootRoute, path: '/settings', component: SettingsPage }),
]);

export const router = createRouter({ routeTree });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
