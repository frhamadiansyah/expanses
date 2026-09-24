import { parsePeriod } from '@expanses/core';
import { createRootRoute, createRoute, createRouter, redirect } from '@tanstack/react-router';
import { AccountsPage } from '../features/accounts/AccountsPage';
import { AddPocketPage } from '../features/accounts/AddPocketPage';
import { MovePage } from '../features/accounts/MovePage';
import { PocketsPage } from '../features/accounts/PocketsPage';
import { BackupPage } from '../features/backup/BackupPage';
import { CoverPage } from '../features/events/CoverPage';
import { EventDetailPage } from '../features/events/EventDetailPage';
import { EventsPage } from '../features/events/EventsPage';
import { EditItemRoute, NewItemRoute } from '../features/events/ItemFormPage';
import { ItemPage } from '../features/events/ItemPage';
import { PickPurchasePage } from '../features/events/PickPurchasePage';
import { PlanPage } from '../features/events/PlanPage';
import { BudgetPage } from '../features/budget/BudgetPage';
import { CalculatorsPage } from '../features/calculators/CalculatorsPage';
import { EducationFundPage } from '../features/calculators/EducationFundPage';
import { EmergencyFundPage } from '../features/calculators/EmergencyFundPage';
import { LifeCoverPage } from '../features/calculators/LifeCoverPage';
import { RetirementFundPage } from '../features/calculators/RetirementFundPage';
import { ImportPage } from '../features/import/ImportPage';
import { ReviewPage } from '../features/review/ReviewPage';
import { CardDetailPage } from '../features/cards/CardDetailPage';
import { CardsPage } from '../features/cards/CardsPage';
import { RecommendPage } from '../features/cards/RecommendPage';
import { CategoriesPage } from '../features/categories/CategoriesPage';
import { KitPage } from '../features/design/KitPage';
import { MerchantsPage } from '../features/merchants/MerchantsPage';
import { AddAccountPage } from '../features/ownables/AddAccountPage';
import { AddAssetPage } from '../features/ownables/AddAssetPage';
import { AddDebtPage } from '../features/ownables/AddDebtPage';
import { AssetDetailPage } from '../features/networth/AssetDetailPage';
import { AssetSettingsRoute } from '../features/networth/AssetSettingsPage';
import { AssetsPage } from '../features/networth/AssetsPage';
import { AttentionPage } from '../features/networth/AttentionPage';
import { FinancialHealthPage } from '../features/networth/FinancialHealthPage';
import { GoalsPage } from '../features/goals/GoalsPage';
import { GoalRoute } from '../features/goals/GoalPage';
import { LendBorrowPage } from '../features/debts/LendBorrowPage';
import { LoanDetailPage } from '../features/loans/LoanDetailPage';
import { DebtsPage } from '../features/loans/DebtsPage';
import { CoretaxPage } from '../features/coretax/CoretaxPage';
import { OverviewPage } from '../features/networth/OverviewPage';
import { TradesPage } from '../features/networth/TradesPage';
import { BillFormPage, EditBillRoute } from '../features/bills/BillFormPage';
import { BillRoute } from '../features/bills/BillPage';
import { RecurringPage } from '../features/bills/RecurringPage';
import { EditTransactionRoute, NewTransactionRoute } from '../features/transactions/FormPage';
import { ReceiptRoute } from '../features/transactions/ReceiptPage';
import { TransactionsPage } from '../features/transactions/TransactionsPage';
import { AddHoldingPage } from '../features/investments/AddHoldingPage';
import { BrokerPage } from '../features/investments/BrokerPage';
import { InvestmentsPage } from '../features/investments/InvestmentsPage';
import { SecurityPage } from '../features/investments/SecurityPage';
import { SecurityPricePage } from '../features/investments/SecurityPricePage';
import { DeveloperSettingsPage } from '../features/workspaces/DeveloperSettingsPage';
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

export interface LendBorrowSearch {
  /** One person, when Lend & borrow is opened from their row on Debts. */
  person?: string;
}

const lendBorrowSearch = (search: Record<string, unknown>): LendBorrowSearch =>
  typeof search.person === 'string' && search.person !== '' ? { person: search.person } : {};

export interface EventPlanSearch {
  /** The workspace tab the plan was opened from, so it keeps reading in it. */
  ws?: string;
}

/** The event screen itself: the same tab, plus the item "Buy it now" arrived from, which seeds the Add spending card. */
export interface EventSearch extends EventPlanSearch {
  buy?: string;
}

/** Choosing and reading a receipt: the item being answered is carried through both screens so Cancel knows the way back. */
export interface EventLinkSearch extends EventPlanSearch {
  item?: string;
}

const text = (value: unknown) => (typeof value === 'string' && value ? value : undefined);

const planSearch = (search: Record<string, unknown>): EventPlanSearch => ({ ws: text(search.ws) });
const eventSearch = (search: Record<string, unknown>): EventSearch => ({ ws: text(search.ws), buy: text(search.buy) });
const linkSearch = (search: Record<string, unknown>): EventLinkSearch => ({ ws: text(search.ws), item: text(search.item) });

const rootRoute = createRootRoute({ component: Layout });

const cardsRoute = createRoute({ getParentRoute: () => rootRoute, path: '/cards', component: CardsPage });

const routeTree = rootRoute.addChildren([
  /*
   * The Dashboard and the Net worth overview were one subject drawn twice, so they are one page now: the home route
   * hands over to it, and old links, bookmarks and the PWA's own start page land where they always did.
   */
  createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    beforeLoad: () => {
      throw redirect({ to: '/net-worth' });
    },
  }),
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
  // The card as a screen. "new" is a static segment, so it beats `$transactionId` below however the two are
  // ordered here — asserted in `add-transaction.spec.ts` rather than trusted, since being wrong about it means
  // opening a receipt for a transaction called "new".
  createRoute({ getParentRoute: () => rootRoute, path: '/transactions/new', component: NewTransactionRoute }),
  // One transaction, whole.
  createRoute({ getParentRoute: () => rootRoute, path: '/transactions/$transactionId', component: ReceiptRoute }),
  // The card again, on one transaction — what the edit sheet's ⋯ reaches for what a sheet cannot hold.
  createRoute({ getParentRoute: () => rootRoute, path: '/transactions/$transactionId/edit', component: EditTransactionRoute }),
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
  createRoute({ getParentRoute: () => rootRoute, path: '/events/$eventId', component: EventDetailPage, validateSearch: eventSearch }),
  // The plan and its items: six screens, every one of them a real route, so a desktop reaches each by URL and by
  // keyboard exactly as a phone reaches it by thumb. No nav.ts entry — these hang off an event, and /events is in
  // MORE_GROUPS already. "link" is a static segment, so it outranks `$itemId` however they are ordered here.
  createRoute({ getParentRoute: () => rootRoute, path: '/events/$eventId/plan', component: PlanPage, validateSearch: planSearch }),
  createRoute({ getParentRoute: () => rootRoute, path: '/events/$eventId/plan/new', component: NewItemRoute, validateSearch: planSearch }),
  createRoute({ getParentRoute: () => rootRoute, path: '/events/$eventId/plan/link', component: PickPurchasePage, validateSearch: linkSearch }),
  createRoute({ getParentRoute: () => rootRoute, path: '/events/$eventId/plan/link/$transactionId', component: CoverPage, validateSearch: linkSearch }),
  createRoute({ getParentRoute: () => rootRoute, path: '/events/$eventId/plan/$itemId', component: ItemPage, validateSearch: planSearch }),
  createRoute({ getParentRoute: () => rootRoute, path: '/events/$eventId/plan/$itemId/edit', component: EditItemRoute, validateSearch: planSearch }),
  createRoute({ getParentRoute: () => rootRoute, path: '/calculators', component: CalculatorsPage }),
  // Each calculator is its own page, so the catalogue chooses and the page answers (one to a screen, not four).
  createRoute({ getParentRoute: () => rootRoute, path: '/calculators/emergency', component: EmergencyFundPage }),
  createRoute({ getParentRoute: () => rootRoute, path: '/calculators/education', component: EducationFundPage }),
  createRoute({ getParentRoute: () => rootRoute, path: '/calculators/retirement', component: RetirementFundPage }),
  createRoute({ getParentRoute: () => rootRoute, path: '/calculators/life-cover', component: LifeCoverPage }),
  // Before /accounts only for reading: a route is ranked by how specific its path is, never by where it sits here.
  createRoute({ getParentRoute: () => rootRoute, path: '/accounts/new', component: AddAccountPage }),
  createRoute({ getParentRoute: () => rootRoute, path: '/accounts', component: AccountsPage }),
  createRoute({ getParentRoute: () => rootRoute, path: '/accounts/$accountId', component: PocketsPage }),
  createRoute({ getParentRoute: () => rootRoute, path: '/accounts/$accountId/pocket', component: AddPocketPage }),
  createRoute({ getParentRoute: () => rootRoute, path: '/accounts/$accountId/move', component: MovePage }),
  createRoute({ getParentRoute: () => rootRoute, path: '/categories', component: CategoriesPage }),
  // The wallet and an open card are one screen: a card's page is a child of the wallet, so the stack stays mounted
  // and the card itself can rise out of it to the top, as in Apple Wallet. A deep link opens straight into it.
  cardsRoute.addChildren([
    createRoute({ getParentRoute: () => cardsRoute, path: '/', component: () => null }),
    createRoute({
      getParentRoute: () => cardsRoute,
      path: '$cardId',
      component: CardDetailPage,
      validateSearch: (search: Record<string, unknown>): CardSearch => ({
        tab: typeof search.tab === 'string' && ['statement', 'points', 'rules', 'card'].includes(search.tab) ? (search.tab as CardSearch['tab']) : undefined,
      }),
    }),
  ]),
  // A static segment, so it outranks the wallet's `$cardId` however the two are nested.
  createRoute({ getParentRoute: () => rootRoute, path: '/cards/merchants', component: MerchantsPage }),
  createRoute({ getParentRoute: () => rootRoute, path: '/net-worth', component: OverviewPage }),
  // The ratios, on a screen of their own: Net worth's corner glyph opens it.
  createRoute({ getParentRoute: () => rootRoute, path: '/net-worth/health', component: FinancialHealthPage }),
  // And what is waiting, behind the corner that counts it.
  createRoute({ getParentRoute: () => rootRoute, path: '/net-worth/attention', component: AttentionPage }),
  createRoute({ getParentRoute: () => rootRoute, path: '/net-worth/assets', component: AssetsPage }),
  // The Assets page's Investments group, read by stock and by broker.
  createRoute({ getParentRoute: () => rootRoute, path: '/net-worth/investments', component: InvestmentsPage }),
  createRoute({
    getParentRoute: () => rootRoute,
    path: '/net-worth/investments/new',
    component: AddHoldingPage,
    validateSearch: (search: Record<string, unknown>): { link?: string } => ({ link: typeof search.link === 'string' ? search.link : undefined }),
  }),
  createRoute({ getParentRoute: () => rootRoute, path: '/net-worth/investments/security/$securityId', component: SecurityPage }),
  createRoute({ getParentRoute: () => rootRoute, path: '/net-worth/investments/security/$securityId/price', component: SecurityPricePage }),
  // The static `none` outranks `$accountId`: holdings kept with no broker named.
  createRoute({ getParentRoute: () => rootRoute, path: '/net-worth/investments/broker/none', component: () => <BrokerPage none /> }),
  createRoute({ getParentRoute: () => rootRoute, path: '/net-worth/investments/broker/$accountId', component: () => <BrokerPage /> }),
  // "new" is a static segment, which outranks the `$accountId` below it however they are ordered here.
  createRoute({ getParentRoute: () => rootRoute, path: '/net-worth/assets/new', component: AddAssetPage }),
  createRoute({ getParentRoute: () => rootRoute, path: '/net-worth/assets/$accountId', component: AssetDetailPage }),
  // An asset's settings, behind its gear: they used to sit at the bottom of the asset's own page.
  createRoute({ getParentRoute: () => rootRoute, path: '/net-worth/assets/$accountId/settings', component: AssetSettingsRoute }),
  createRoute({ getParentRoute: () => rootRoute, path: '/net-worth/trades', component: TradesPage }),
  createRoute({ getParentRoute: () => rootRoute, path: '/goals', component: GoalsPage }),
  // One goal on its own page: the list reads them as a set, and a goal that was a card among cards is a page now.
  createRoute({ getParentRoute: () => rootRoute, path: '/goals/$goalId', component: GoalRoute }),
  // Lend & borrow: money between you and people, both ways. It was drawn at /net-worth/debts under that name
  // while "Debts" meant only people; Debts is now everything owed, so the old address hands over, search and all.
  createRoute({ getParentRoute: () => rootRoute, path: '/net-worth/lend-borrow', component: LendBorrowPage, validateSearch: lendBorrowSearch }),
  createRoute({
    getParentRoute: () => rootRoute,
    path: '/net-worth/debts',
    validateSearch: lendBorrowSearch,
    beforeLoad: ({ search }) => {
      throw redirect({ to: '/net-worth/lend-borrow', search, replace: true });
    },
  }),
  // The debt picker stands on its own path: a debt is a card, a loan or money owed to a person, and each of them
  // lands somewhere different.
  createRoute({ getParentRoute: () => rootRoute, path: '/debts/new', component: AddDebtPage }),
  // Debts — everything owed — keeps the address the Loans page had, so a loan's own page stays where it was.
  createRoute({ getParentRoute: () => rootRoute, path: '/net-worth/loans', component: DebtsPage }),
  createRoute({ getParentRoute: () => rootRoute, path: '/net-worth/loans/$accountId', component: LoanDetailPage }),
  createRoute({ getParentRoute: () => rootRoute, path: '/tax-report', component: CoretaxPage }),
  createRoute({ getParentRoute: () => rootRoute, path: '/recommend', component: RecommendPage }),
  createRoute({ getParentRoute: () => rootRoute, path: '/import', component: ImportPage }),
  createRoute({ getParentRoute: () => rootRoute, path: '/review', component: ReviewPage }),
  createRoute({ getParentRoute: () => rootRoute, path: '/backup', component: BackupPage }),
  createRoute({ getParentRoute: () => rootRoute, path: '/settings', component: SettingsPage }),
  // Linked from nowhere: the owner reaches it by its address, to switch on what the app cannot sell yet.
  createRoute({ getParentRoute: () => rootRoute, path: '/settings/developer', component: DeveloperSettingsPage }),
  // The design kit's specimen sheet. Deliberately not in `nav.ts`: it is a place to look at the primitives
  // before the routes adopt them, not a screen anyone navigates to.
  createRoute({ getParentRoute: () => rootRoute, path: '/design-kit', component: KitPage }),
]);

export const router = createRouter({ routeTree });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
