import { parsePeriod } from '@expanses/core';
import { createRootRoute, createRoute, createRouter, redirect } from '@tanstack/react-router';
import { AddPocketPage } from '../features/accounts/AddPocketPage';
import { MovePage } from '../features/accounts/MovePage';
import { AccountPage } from '../features/accounts/AccountPage';
import { BackupPage } from '../features/backup/BackupPage';
import { ICloudRestorePage } from '../features/backup/icloud/ICloudRestorePage';
import { CoverPage } from '../features/events/CoverPage';
import { EventDetailPage } from '../features/events/EventDetailPage';
import { EventsPage } from '../features/events/EventsPage';
import { EditItemRoute, NewItemRoute } from '../features/events/ItemFormPage';
import { ItemPage } from '../features/events/ItemPage';
import { PickPurchasePage } from '../features/events/PickPurchasePage';
import { EventCategoriesPage } from '../features/events/EventCategoriesPage';
import { PeoplePage } from '../features/events/PeoplePage';
import { PlanPage } from '../features/events/PlanPage';
import { BudgetPage } from '../features/budget/BudgetPage';
import { budgetSearch } from '../features/budget/budget-search';
import { EditBudgetsPage } from '../features/budget/EditBudgetsPage';
import { CalculatorsPage } from '../features/calculators/CalculatorsPage';
import { EducationFundPage } from '../features/calculators/EducationFundPage';
import { EmergencyFundPage } from '../features/calculators/EmergencyFundPage';
import { LifeCoverPage } from '../features/calculators/LifeCoverPage';
import { RetirementFundPage } from '../features/calculators/RetirementFundPage';
import { CaptureSettingsPage } from '../features/capture/CaptureSettingsPage';
import { SourcePage } from '../features/capture/SourcePage';
import { ImportPage } from '../features/import/ImportPage';
import { ReviewPage } from '../features/review/ReviewPage';
import { fromSearch } from './from-search';
import { CardDetailPage } from '../features/cards/CardDetailPage';
import { CardPointsCheckPage, CardPointsPage, CardPurchasesPage } from '../features/cards/CardPointsPage';
import { EarnRulesPage, SpendBonusesPage } from '../features/cards/CardRulesPages';
import { CardProductPage, CardSettingsPage } from '../features/cards/CardSettingsPage';
import { CardStatementPage } from '../features/cards/CardStatementPage';
import { WalletPage } from '../features/wallet/WalletPage';
import { WalletReorderPage } from '../features/wallet/WalletReorderPage';
import { ProgrammePage } from '../features/cards/ProgrammePage';
import { PointsPage } from '../features/cards/PointsPage';
import { RecommendPage } from '../features/cards/RecommendPage';
import { CheckStatementPage, checkSearch } from '../features/statement-check/CheckStatementPage';
import { PickCardPage, sharedStatementSearch } from '../features/statement-check/PickCardPage';
import { CategoriesPage } from '../features/categories/CategoriesPage';
import { CategoryPage } from '../features/categories/CategoryPage';
import { SetsPage } from '../features/categories/SetsPage';
import { KitPage } from '../features/design/KitPage';
import { MerchantsPage } from '../features/merchants/MerchantsPage';
import { AddAccountPage } from '../features/ownables/AddAccountPage';
import { IncomePage } from '../features/investments/IncomePage';
import { AllTradesPage } from '../features/investments/AllTradesPage';
import { AddAssetPage } from '../features/ownables/AddAssetPage';
import { addAssetSearch } from '../features/ownables/add-asset-search';
import { AddDebtPage } from '../features/ownables/AddDebtPage';
import { AssetDetailPage } from '../features/networth/AssetDetailPage';
import { AssetSettingsRoute } from '../features/networth/AssetSettingsPage';
import { EditAssetRoute } from '../features/networth/EditAssetPage';
import { AssetsPage } from '../features/networth/AssetsPage';
import { AttentionPage } from '../features/networth/AttentionPage';
import { FinancialHealthPage } from '../features/networth/FinancialHealthPage';
import { HealthSettingsPage } from '../features/networth/HealthSettingsPage';
import { GoalsPage } from '../features/goals/GoalsPage';
import { GoalRoute } from '../features/goals/GoalPage';
import { EditGoalRoute, NewGoalRoute } from '../features/goals/GoalForm';
import { LendBorrowPage } from '../features/debts/LendBorrowPage';
import { LoanPage } from '../features/debts/LoanPage';
import { NewDebtPage } from '../features/debts/NewDebtPage';
import { PersonPage } from '../features/debts/PersonPage';
import { LoanDetailPage } from '../features/loans/LoanDetailPage';
import { DebtsPage } from '../features/loans/DebtsPage';
import { CoretaxPage } from '../features/coretax/CoretaxPage';
import { OverviewPage } from '../features/networth/OverviewPage';
import { UpdatePricesPage } from '../features/prices/UpdatePricesPage';
import { BillFormPage, EditBillRoute } from '../features/bills/BillFormPage';
import { BillRoute } from '../features/bills/BillPage';
import { RecurringPage } from '../features/bills/RecurringPage';
import { YearlyBillsPage } from '../features/bills/YearlyBillsPage';
import { DuplicateTransactionRoute, EditTransactionRoute, NewTransactionRoute } from '../features/transactions/FormPage';
import { newTransactionSearch } from '../features/transactions/new-search';
import { MoneyFlowPage, moneyFlowSearch } from '../features/transactions/MoneyFlow';
import { ReceiptRoute } from '../features/transactions/ReceiptPage';
import { TransactionsPage } from '../features/transactions/TransactionsPage';
import { AddHoldingPage } from '../features/investments/AddHoldingPage';
import { BrokerPage } from '../features/investments/BrokerPage';
import { SecurityPage } from '../features/investments/SecurityPage';
import { SecurityPricePage } from '../features/investments/SecurityPricePage';
import { DeveloperSettingsPage } from '../features/workspaces/DeveloperSettingsPage';
import { WorkspacePage } from '../features/workspaces/WorkspacePage';
import { AccountMenuPage } from '../features/account/AccountMenuPage';
import { JoinPage } from '../features/sharing/JoinPage';
import { SharedItemPage } from '../features/networth/SharedItemPage';
import { Layout } from './Layout';

/** The card page's old tabs, still read from a link made before they became pages of their own. */
export interface CardSearch {
  tab?: 'statement' | 'points' | 'rules' | 'card';
}

/** Where each old tab's content lives now: the statement, this statement's points, and the card's settings. */
const TAB_PAGES = {
  statement: '/cards/$cardId/statement',
  points: '/cards/$cardId/points',
  rules: '/cards/$cardId/settings',
  card: '/cards/$cardId/settings',
} as const;

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
  /** The side the phone opens on: set by the way back from New receivable and New payable. */
  side?: 'owed' | 'owe';
}

const lendBorrowSearch = (search: Record<string, unknown>): LendBorrowSearch => ({
  ...(typeof search.person === 'string' && search.person !== '' ? { person: search.person } : {}),
  ...(search.side === 'owed' || search.side === 'owe' ? { side: search.side } : {}),
});

export interface EventPlanSearch {
  /** The workspace tab the plan was opened from, so it keeps reading in it. */
  ws?: string;
}

/** The event screen itself: the same tab. "Buy it now" opens the Add screen now, so there is no item to carry here. */
export type EventSearch = EventPlanSearch;

/** Choosing and reading a receipt: the item being answered is carried through both screens so Cancel knows the way back. */
export interface EventLinkSearch extends EventPlanSearch {
  item?: string;
}

const text = (value: unknown) => (typeof value === 'string' && value ? value : undefined);

const planSearch = (search: Record<string, unknown>): EventPlanSearch => ({ ws: text(search.ws) });
const eventSearch = (search: Record<string, unknown>): EventSearch => ({ ws: text(search.ws) });
const linkSearch = (search: Record<string, unknown>): EventLinkSearch => ({ ws: text(search.ws), item: text(search.item) });

/** The Categories list's tab, in the address so the way back from an income category lands on Income. */
/** What the holding's page opens on arrival (`?do=buy` and the rest): the sheet its own round button would open. */
export type AssetSearch = { do?: 'buy' | 'sell' | 'income' | 'units' };
const ASSET_DOS = ['buy', 'sell', 'income', 'units'] as const;
const assetSearch = (search: Record<string, unknown>): AssetSearch =>
  ASSET_DOS.includes(search.do as AssetSearch['do'] & string) ? { do: search.do as AssetSearch['do'] } : {};

const categoriesSearch = (search: Record<string, unknown>): { kind?: 'income' } => (search.kind === 'income' ? { kind: 'income' } : {});

const rootRoute = createRootRoute({ component: Layout });

/*
 * Wallet, and a card or an account opened from it, are one screen: the card's page and the account's page are children
 * of a layout with no path of its own, so the stack stays mounted at `/wallet` and the card itself can rise out of it
 * to the top, as in Apple Wallet — while each page keeps the address it always had. A deep link opens straight into it.
 */
const walletRoute = createRoute({ getParentRoute: () => rootRoute, id: '_wallet', component: WalletPage });

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
  createRoute({ getParentRoute: () => rootRoute, path: '/transactions/new', component: NewTransactionRoute, validateSearch: newTransactionSearch }),
  // The Money flow box, on a screen of its own and sideways: "flow" is static too, so it beats `$transactionId`.
  createRoute({ getParentRoute: () => rootRoute, path: '/transactions/flow', component: MoneyFlowPage, validateSearch: moneyFlowSearch }),
  // One transaction, whole.
  createRoute({ getParentRoute: () => rootRoute, path: '/transactions/$transactionId', component: ReceiptRoute }),
  // The card again, on one transaction — a phone's Edit, from the receipt or the row's swipe.
  createRoute({ getParentRoute: () => rootRoute, path: '/transactions/$transactionId/edit', component: EditTransactionRoute }),
  // The Add screen again, started from one transaction: Duplicate on a row's swipe, the receipt and the desktop's editor.
  createRoute({ getParentRoute: () => rootRoute, path: '/transactions/$transactionId/duplicate', component: DuplicateTransactionRoute }),
  // Spending was its own page; the chart it held now leads the transactions it adds up.
  createRoute({
    getParentRoute: () => rootRoute,
    path: '/spending',
    beforeLoad: () => {
      throw redirect({ to: '/transactions', search: { view: 'list' } });
    },
  }),
  createRoute({ getParentRoute: () => rootRoute, path: '/budget', component: BudgetPage, validateSearch: budgetSearch }),
  createRoute({ getParentRoute: () => rootRoute, path: '/budget/edit', component: EditBudgetsPage, validateSearch: budgetSearch }),
  createRoute({ getParentRoute: () => rootRoute, path: '/bills', component: RecurringPage, validateSearch: fromSearch }),
  createRoute({ getParentRoute: () => rootRoute, path: '/bills/yearly', component: YearlyBillsPage, validateSearch: fromSearch }),
  createRoute({ getParentRoute: () => rootRoute, path: '/bills/new', component: () => <BillFormPage /> }),
  createRoute({ getParentRoute: () => rootRoute, path: '/bills/$billId', component: BillRoute, validateSearch: fromSearch }),
  createRoute({ getParentRoute: () => rootRoute, path: '/bills/$billId/edit', component: EditBillRoute }),
  createRoute({ getParentRoute: () => rootRoute, path: '/events', component: EventsPage }),
  createRoute({ getParentRoute: () => rootRoute, path: '/events/$eventId', component: EventDetailPage, validateSearch: eventSearch }),
  // The plan and its items: six screens, every one of them a real route, so a desktop reaches each by URL and by
  // keyboard exactly as a phone reaches it by thumb. No nav.ts entry — these hang off an event, and /events is in
  // MORE_GROUPS already. "link" is a static segment, so it outranks `$itemId` however they are ordered here.
  // A shared event's people (shared events §6): invite, add a name, a new phone, remove.
  createRoute({ getParentRoute: () => rootRoute, path: '/events/$eventId/people', component: PeoplePage }),
  createRoute({ getParentRoute: () => rootRoute, path: '/events/$eventId/categories', component: EventCategoriesPage }),
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
  // The Accounts page and the Cards tab are Wallet now (owner, 23 Oct): an old link or bookmark lands there.
  createRoute({
    getParentRoute: () => rootRoute,
    path: '/accounts',
    beforeLoad: () => {
      throw redirect({ to: '/wallet', replace: true });
    },
  }),
  createRoute({
    getParentRoute: () => rootRoute,
    path: '/cards',
    beforeLoad: () => {
      throw redirect({ to: '/wallet', replace: true });
    },
  }),
  createRoute({ getParentRoute: () => rootRoute, path: '/accounts/$accountId/pocket', component: AddPocketPage }),
  createRoute({ getParentRoute: () => rootRoute, path: '/accounts/$accountId/move', component: MovePage }),
  createRoute({ getParentRoute: () => rootRoute, path: '/categories', component: CategoriesPage, validateSearch: categoriesSearch }),
  // "sets" is a static segment, which outranks `$categoryId` however they are ordered here.
  createRoute({ getParentRoute: () => rootRoute, path: '/categories/sets', component: SetsPage }),
  createRoute({ getParentRoute: () => rootRoute, path: '/categories/$categoryId', component: CategoryPage }),
  walletRoute.addChildren([
    createRoute({ getParentRoute: () => walletRoute, path: '/wallet', component: () => null }),
    // Money opened from Wallet: its account page, under its raised card. Opened from anywhere else it stands alone.
    createRoute({ getParentRoute: () => walletRoute, path: '/accounts/$accountId', component: AccountPage }),
    createRoute({
      getParentRoute: () => walletRoute,
      path: '/cards/$cardId',
      component: CardDetailPage,
      validateSearch: (search: Record<string, unknown>): CardSearch => ({
        tab: typeof search.tab === 'string' && ['statement', 'points', 'rules', 'card'].includes(search.tab) ? (search.tab as CardSearch['tab']) : undefined,
      }),
      // The card's four tabs became pages of their own (owner, 23 Oct): a link to a tab lands on its page.
      beforeLoad: ({ search, params }) => {
        if (search.tab) throw redirect({ to: TAB_PAGES[search.tab], params: { cardId: params.cardId }, replace: true });
      },
    }),
  ]),
  // Wallet's cards put in an order by hand, opened from its ⋯: a page of its own over the wallet, as Points is.
  // Nothing in the wallet's layout is a pattern under `/wallet`, so the static path is never read as a card.
  createRoute({ getParentRoute: () => rootRoute, path: '/wallet/reorder', component: WalletReorderPage }),
  // A card's pages, each pushed from its summary with ‹ back to it: the statement, this statement's points with the
  // purchases and the statement's own figure under them, and the settings with the card product, the earning rules
  // and the spend bonuses under them. Static last segments, so none is read as the wallet's `$cardId`.
  createRoute({ getParentRoute: () => rootRoute, path: '/cards/$cardId/statement', component: CardStatementPage }),
  createRoute({ getParentRoute: () => rootRoute, path: '/cards/$cardId/points', component: CardPointsPage }),
  createRoute({ getParentRoute: () => rootRoute, path: '/cards/$cardId/points/purchases',
    component: CardPurchasesPage,
    // `filter=nothing` lists only the purchases that earned nothing, which the points page's amber line opens.
    validateSearch: (search: Record<string, unknown>): { filter?: 'nothing' } => (search.filter === 'nothing' ? { filter: 'nothing' } : {}),
  }),
  createRoute({ getParentRoute: () => rootRoute, path: '/cards/$cardId/points/check', component: CardPointsCheckPage }),
  createRoute({ getParentRoute: () => rootRoute, path: '/cards/$cardId/settings', component: CardSettingsPage }),
  createRoute({ getParentRoute: () => rootRoute, path: '/cards/$cardId/settings/product', component: CardProductPage }),
  createRoute({ getParentRoute: () => rootRoute, path: '/cards/$cardId/settings/rules', component: EarnRulesPage }),
  createRoute({ getParentRoute: () => rootRoute, path: '/cards/$cardId/settings/bonuses', component: SpendBonusesPage }),
  // A static segment, so it outranks the wallet's `$cardId` however the two are nested.
  createRoute({ getParentRoute: () => rootRoute, path: '/cards/merchants', component: MerchantsPage }),
  // A points programme — a bank's, an airline's, a hotel's — is a balance of its own that cards earn into, so it has a
  // page of its own beside the wallet. "points" is static, so it outranks the wallet's `$cardId`.
  // The programmes, listed: opened from Wallet's corner. Static, so it outranks the wallet's `$cardId` as well.
  createRoute({ getParentRoute: () => rootRoute, path: '/cards/points', component: PointsPage }),
  createRoute({ getParentRoute: () => rootRoute, path: '/cards/points/$programmeId', component: ProgrammePage }),
  // A card's statement checked from screenshots (statement-check spec §3.4): a screen of its own over the wallet, as
  // Move is over an account. `batch` enters with screenshots the share sheet already read.
  createRoute({ getParentRoute: () => rootRoute, path: '/cards/$cardId/check', component: CheckStatementPage, validateSearch: checkSearch }),
  // Several statement screenshots shared from Photos, already read: which card they belong to, before the check (S2).
  createRoute({ getParentRoute: () => rootRoute, path: '/statement/shared', component: PickCardPage, validateSearch: sharedStatementSearch }),
  createRoute({ getParentRoute: () => rootRoute, path: '/net-worth', component: OverviewPage }),
  // The ratios, on a screen of their own: Net worth's corner glyph opens it.
  createRoute({ getParentRoute: () => rootRoute, path: '/net-worth/health', component: FinancialHealthPage }),
  // What the ratios are read with, and how, behind that screen's ⚙.
  createRoute({ getParentRoute: () => rootRoute, path: '/net-worth/health/settings', component: HealthSettingsPage }),
  // And what is waiting, behind the corner that counts it.
  createRoute({ getParentRoute: () => rootRoute, path: '/net-worth/attention', component: AttentionPage }),
  createRoute({ getParentRoute: () => rootRoute, path: '/net-worth/assets', component: AssetsPage }),
  /*
   * The Investments page that read the Assets page's shares by stock and by broker is gone: Assets lists one row per
   * stock itself, and each broker's account lists what it keeps. An old link lands on Assets.
   */
  createRoute({
    getParentRoute: () => rootRoute,
    path: '/net-worth/investments',
    beforeLoad: () => {
      throw redirect({ to: '/net-worth/assets', replace: true });
    },
  }),
  createRoute({
    getParentRoute: () => rootRoute,
    path: '/net-worth/investments/new',
    component: AddHoldingPage,
    validateSearch: (search: Record<string, unknown>): { link?: string } => ({ link: typeof search.link === 'string' ? search.link : undefined }),
  }),
  createRoute({ getParentRoute: () => rootRoute, path: '/net-worth/investments/dividends', component: IncomePage }),
  // Every buy and sell of every holding, off the foot of Assets' Investments.
  createRoute({ getParentRoute: () => rootRoute, path: '/net-worth/investments/trades', component: AllTradesPage }),
  createRoute({ getParentRoute: () => rootRoute, path: '/net-worth/investments/security/$securityId', component: SecurityPage }),
  createRoute({ getParentRoute: () => rootRoute, path: '/net-worth/investments/security/$securityId/price', component: SecurityPricePage }),
  // The static `none` outranks `$accountId`: holdings kept with no broker named.
  createRoute({ getParentRoute: () => rootRoute, path: '/net-worth/investments/broker/none', component: () => <BrokerPage none /> }),
  createRoute({ getParentRoute: () => rootRoute, path: '/net-worth/investments/broker/$accountId', component: () => <BrokerPage /> }),
  // "new" is a static segment, which outranks the `$accountId` below it however they are ordered here.
  createRoute({ getParentRoute: () => rootRoute, path: '/net-worth/assets/new', component: AddAssetPage, validateSearch: addAssetSearch }),
  // Every share and fund held, one price box each, and IDX's daily file to fill the shares.
  createRoute({ getParentRoute: () => rootRoute, path: '/net-worth/prices', component: UpdatePricesPage }),
  createRoute({ getParentRoute: () => rootRoute, path: '/net-worth/assets/$accountId', component: AssetDetailPage, validateSearch: assetSearch }),
  // An asset's settings, behind its gear: they used to sit at the bottom of the asset's own page.
  createRoute({ getParentRoute: () => rootRoute, path: '/net-worth/assets/$accountId/settings', component: AssetSettingsRoute }),
  createRoute({ getParentRoute: () => rootRoute, path: '/net-worth/assets/$accountId/edit', component: EditAssetRoute }),
  /*
   * Buy & sell was folded away (owner, 23 Oct): a trade is recorded and changed on its holding's page, a split in its
   * Settings, and every trade is read on All trades. An old link lands there.
   */
  createRoute({
    getParentRoute: () => rootRoute,
    path: '/net-worth/trades',
    beforeLoad: () => {
      throw redirect({ to: '/net-worth/investments/trades', replace: true });
    },
  }),
  // Monthly plans are set on each holding's own page and come due on Recurring, under the bills: an old link lands there.
  createRoute({
    getParentRoute: () => rootRoute,
    path: '/net-worth/trades/plans',
    beforeLoad: () => {
      throw redirect({ to: '/bills', replace: true });
    },
  }),
  createRoute({ getParentRoute: () => rootRoute, path: '/goals', component: GoalsPage }),
  // One goal on its own page: the list reads them as a set, and a goal that was a card among cards is a page now.
  createRoute({ getParentRoute: () => rootRoute, path: '/goals/new', component: NewGoalRoute }),
  createRoute({ getParentRoute: () => rootRoute, path: '/goals/$goalId', component: GoalRoute }),
  createRoute({ getParentRoute: () => rootRoute, path: '/goals/$goalId/edit', component: EditGoalRoute }),
  // Lend & borrow: money between you and people, both ways. It was drawn at /net-worth/debts under that name
  // while "Debts" meant only people; Debts is now everything owed, so the old address hands over, search and all.
  createRoute({ getParentRoute: () => rootRoute, path: '/net-worth/lend-borrow', component: LendBorrowPage, validateSearch: lendBorrowSearch }),
  // Adding to one side of it, on a screen of its own: the title says which side, so the form needs no toggle.
  createRoute({
    getParentRoute: () => rootRoute,
    path: '/net-worth/lend-borrow/new-receivable',
    component: () => <NewDebtPage direction="lent" />,
    validateSearch: lendBorrowSearch,
  }),
  createRoute({
    getParentRoute: () => rootRoute,
    path: '/net-worth/lend-borrow/new-payable',
    component: () => <NewDebtPage direction="borrowed" />,
    validateSearch: lendBorrowSearch,
  }),
  // One loan on its own page — repaid, forgiven or changed there — and one person, with each of their loans a row.
  // `loan/…` is a fixed first segment, so it is matched before a side and a name.
  createRoute({ getParentRoute: () => rootRoute, path: '/net-worth/lend-borrow/loan/$accountId', component: LoanPage }),
  createRoute({ getParentRoute: () => rootRoute, path: '/net-worth/lend-borrow/$side/$person', component: PersonPage }),
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
  createRoute({ getParentRoute: () => rootRoute, path: '/review', component: ReviewPage, validateSearch: fromSearch }),
  createRoute({ getParentRoute: () => rootRoute, path: '/backup', component: BackupPage }),
  createRoute({ getParentRoute: () => rootRoute, path: '/backup/icloud', component: ICloudRestorePage }),
  createRoute({ getParentRoute: () => rootRoute, path: '/account', component: AccountMenuPage }),
  createRoute({ getParentRoute: () => rootRoute, path: '/account/workspaces/$bookId', component: WorkspacePage }),
  // Settings was the page of workspaces; they live on the Account page now, so an old link lands there.
  createRoute({
    getParentRoute: () => rootRoute,
    path: '/settings',
    beforeLoad: () => {
      throw redirect({ to: '/account', replace: true });
    },
  }),
  // Household sharing: where a `cicis://join/<code>` link lands, in the shell and on the web alike (spec §11). The code is
  // the fragment, `/join#<code>`: half of it is the invite's secret, and a fragment is never sent to a server.
  createRoute({ getParentRoute: () => rootRoute, path: '/join', component: JoinPage }),
  // Linked from nowhere: the owner reaches it by its address, to switch on what the app cannot sell yet.
  createRoute({ getParentRoute: () => rootRoute, path: '/settings/developer', component: DeveloperSettingsPage }),
  // Capture: how to set the phone up, what it keeps, and what each source has learned. The row that reaches it is
  // iPhone-only (`isNative()`); the addresses themselves work everywhere, so the same pages can be shown on a desktop.
  createRoute({ getParentRoute: () => rootRoute, path: '/settings/capture', component: CaptureSettingsPage }),
  createRoute({ getParentRoute: () => rootRoute, path: '/settings/capture/sources/$sourceId', component: SourcePage }),
  // The design kit's specimen sheet. Deliberately not in `nav.ts`: it is a place to look at the primitives
  // before the routes adopt them, not a screen anyone navigates to.
  createRoute({ getParentRoute: () => rootRoute, path: '/design-kit', component: KitPage }),
  // Joint net worth (§8.3): an item of the other's, read-only — from the household's Net worth or Wallet's "…, shared".
  createRoute({ getParentRoute: () => rootRoute, path: '/net-worth/shared/$itemId', component: SharedItemPage }),
]);

export const router = createRouter({ routeTree });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
