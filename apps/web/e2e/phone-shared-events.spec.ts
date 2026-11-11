import { type Browser, expect, type Page, test, type TestInfo } from '@playwright/test';
import { currencyRow, setCurrency } from './currency-field';
import { openAccount, walletCard } from './accounts';
import { addTransaction } from './add-transaction';
import { mockRates } from './pockets';
import { corner, eventually, newEvent, openTrip, recordSharedSpend, sharedCard, showBalances, showCard, spendingRow } from './shared-events';
import { openWorkspaceSharePage } from './workspace-page';

/*
 * Shared events, end to end (shared events §9 step 5). Rina and Andi each on a phone of their own; Budi is a name
 * without the app. A week by the coast in lira: Rina pays a €90 fish dinner from her euro wallet for all three; Andi
 * cannot change what Rina paid; Andi records a boat while offline, which reaches Rina once he is back; Andi settles up
 * in rupiah; Rina takes the settle-up into her books; Debts shows what Budi still owes. Every figure is invented.
 *
 * It runs on the phone project (the file name says so) because the Add screen's amount is the keypad there, and the
 * owner's rule is that the Add screen never takes a typed amount. Two contexts are two phones, each with its own OPFS
 * database and keys, on the local relay Worker the Playwright config starts.
 */

test.describe.configure({ timeout: 300_000 });

/** Invented: 1 EUR = 17,640 IDR and 1 TRY = 560 IDR, so a euro is 31.5 lira. */
const RATES = { EUR: 17_640, TRY: 560 };

async function secondPhone(browser: Browser, info: TestInfo): Promise<Page> {
  const use = info.project.use;
  const context = await browser.newContext({ baseURL: use.baseURL, viewport: use.viewport, hasTouch: use.hasTouch, isMobile: use.isMobile, deviceScaleFactor: use.deviceScaleFactor, userAgent: use.userAgent });
  return context.newPage();
}

test('a trip in lira shared by two phones and a name: euro dinner, payer-only money, offline boat, settle-up in rupiah', async ({ page: rina, browser }, info) => {
  const andi = await secondPhone(browser, info);
  for (const phone of [rina, andi]) {
    phone.on('dialog', (dialog) => void dialog.accept());
    await mockRates(phone, RATES);
  }
  await openAccount(rina, { subtype: 'cash', name: 'Euro wallet', currency: 'EUR' });
  await openAccount(rina, { subtype: 'bank', name: 'Rina Bank', balance: '10000000' });
  await openAccount(andi, { subtype: 'bank', name: 'Andi Bank', balance: '10000000' });

  // Rina makes the trip and shares it in lira, with Budi as a name.
  await newEvent(rina, 'Coast week');
  await corner(rina, 'Share this event');
  const share = rina.getByRole('form', { name: 'Share this event' });
  await share.getByLabel('Name', { exact: true }).fill('Rina');
  await setCurrency(currencyRow(share, 'Currency'), 'TRY');
  await share.getByLabel('Without the app').fill('Budi');
  await share.getByRole('button', { name: 'Share', exact: true }).click();
  const link = (await rina.getByTestId('invite-link').textContent({ timeout: 60_000 }))!.trim();
  expect(link).toMatch(/^cicis:\/\/join\//);

  // Andi joins under his own name: the link opens "Join Coast week".
  await andi.goto(`/join#${link.replace('cicis://join/', '')}`);
  const join = andi.getByTestId('join-event');
  await expect(join).toContainText('Join Coast week', { timeout: 30_000 });
  await expect(join.getByRole('button', { name: 'I’m Budi' })).toBeVisible();
  await join.getByRole('button', { name: 'Someone new' }).click();
  await join.getByLabel('Name', { exact: true }).fill('Andi');
  await join.getByRole('button', { name: 'Join', exact: true }).click();
  await expect(andi.getByTestId('shared-event')).toBeVisible({ timeout: 60_000 });

  // The Share page's Events section names who each event is shared with.
  await rina.goto('/account');
  await openWorkspaceSharePage(rina, 'Personal');
  await eventually(rina, () => expect(rina.getByTestId('share-event-row').first()).toContainText('Shared with 2 people', { timeout: 1_000 }));

  // Rina pays a €90 fish dinner from her euro wallet, for all three; the keypad types the amount.
  await openTrip(rina);
  await corner(rina, 'Add spending');
  await recordSharedSpend(rina, { note: 'Fish dinner', amount: '90', currency: 'EUR', paidWith: 'Euro wallet' });
  // The page is a private event's: the tabs sit above the chart panel, whose middle says the total; the event's name is in a box at its top and the bar's title is the dates.
  const total = rina.getByTestId('shared-event-total');
  await expect(total).toContainText(/Total spent/);
  await expect(total).toContainText(/2[.,]835/);
  await expect(total).not.toContainText(/share/);
  await expect(total.getByRole('heading', { name: 'Coast week' })).toBeVisible();
  // No tabs: the hero swipes between Spending, Balances and Plan, and the Spending card is first.
  await expect(rina.getByTestId('shared-event-tabs')).toHaveCount(0);
  await expect(rina.getByTestId('hero-dots').getByRole('button', { name: 'Spending', exact: true })).toHaveAttribute('aria-current', 'true');
  await expect(rina.getByTestId('shared-event-header')).toHaveCount(0);
  // The record sits in its day, with who paid and the share beneath its amount.
  await expect(rina.getByTestId('shared-event-day').filter({ has: spendingRow(rina, 'Fish dinner') })).toBeVisible();
  await expect(spendingRow(rina, 'Fish dinner')).toContainText('Rina paid');
  await expect(spendingRow(rina, 'Fish dinner')).toContainText(/share .*30/);

  // Andi sees it, paid by Rina, with his share — and cannot change what Rina paid (D8).
  await openTrip(andi);
  await eventually(andi, () => expect(spendingRow(andi, 'Fish dinner')).toContainText('Rina paid', { timeout: 1_000 }));
  await expect(spendingRow(andi, 'Fish dinner')).toContainText('share');
  await spendingRow(andi, 'Fish dinner').click();
  const locked = sharedCard(andi);
  await expect(locked.getByLabel('Amount', { exact: true })).toBeDisabled();
  await expect(locked.getByRole('button', { name: /^Paid by/ })).toBeDisabled();
  await expect(locked).toContainText('Only Rina changes the amount, currency, rate or date of what Rina paid');
  await openTrip(andi);

  // Andi, offline, records a ₺600 boat from his rupiah bank for himself and Rina: it waits as "Not sent yet".
  await andi.context().setOffline(true);
  await corner(andi, 'Add spending');
  await recordSharedSpend(andi, { note: 'Boat', amount: '600', paidWith: 'Andi Bank', charged: { currency: 'IDR', amount: '336000' }, leaveOut: ['Budi'] });
  await expect(spendingRow(andi, 'Boat')).toContainText('Not sent yet', { timeout: 20_000 });

  // Back online, it goes, and Rina has it.
  await andi.context().setOffline(false);
  await eventually(andi, () => expect(spendingRow(andi, 'Boat')).not.toContainText('Not sent yet', { timeout: 1_000 }));
  await openTrip(rina);
  await eventually(rina, () => expect(spendingRow(rina, 'Boat')).toContainText('Andi paid', { timeout: 1_000 }));

  // The ring is the switch for its own rows: one tap shows the categories (uncategorised spending is Other, in the event
  // currency), picking one narrows the day lists to it, picking it again or folding the ring restores them.
  await rina.getByTestId('see-categories').click();
  const categoryRows = rina.getByTestId('event-category-row');
  await expect(categoryRows).toHaveCount(1);
  await expect(categoryRows.first()).toContainText('Other');
  await expect(categoryRows.first()).toContainText('100%');
  await categoryRows.first().click();
  await expect(categoryRows.first()).toHaveAttribute('aria-pressed', 'true');
  await expect(spendingRow(rina, 'Boat')).toBeVisible();
  await categoryRows.first().click();
  await expect(categoryRows.first()).toHaveAttribute('aria-pressed', 'false');
  await rina.getByTestId('hide-categories').click();
  await expect(categoryRows).toHaveCount(0);
  await expect(spendingRow(rina, 'Fish dinner')).toBeVisible();

  // Balances: Budi owes ₺945, Andi ₺645, both to Rina; the same list on both phones (D6).
  await showBalances(rina);
  // The panel holds each person's net balance as a bar: Rina ahead, Budi and Andi owing.
  const bars = rina.getByTestId('shared-balance-row');
  await expect(bars).toHaveCount(3);
  await expect(bars.filter({ hasText: 'Rina' })).toContainText(/\+/);
  await expect(bars.filter({ hasText: 'Budi' })).toContainText(/−.*945/);
  await expect(bars.filter({ hasText: 'Budi' })).not.toContainText('Without the app');
  await expect(rina.getByRole('heading', { name: 'To settle up' })).toBeVisible();
  const rinaPayments = rina.getByTestId('shared-payment-row');
  await expect(rinaPayments).toHaveCount(2);
  await expect(rinaPayments.nth(0)).toContainText(/Budi pays Rina .*945/);
  await expect(rinaPayments.nth(1)).toContainText(/Andi pays Rina .*645/);
  await openTrip(andi);
  await showBalances(andi);
  // The same list; only the chevron differs, since Settle up is offered on a line this phone's person pays or receives.
  const plain = (texts: string[]) => texts.map((t) => t.replace('›', '').trim());
  expect(plain(await andi.getByTestId('shared-payment-row').allTextContents())).toEqual(plain(await rinaPayments.allTextContents()));

  // Andi settles up in rupiah from his bank.
  await andi.getByTestId('shared-payment-row').filter({ hasText: 'Andi pays Rina' }).click();
  const settle = andi.getByTestId('settle-up');
  await settle.getByLabel('Paid from').selectOption({ label: 'Andi Bank · IDR' });
  await expect(settle.getByLabel('In account currency')).not.toHaveValue('');
  await settle.getByRole('button', { name: 'Record', exact: true }).click();
  await expect(andi.getByTestId('shared-balance-row').filter({ hasText: 'Andi' })).toContainText('Settled', { timeout: 30_000 });

  // The Plan card shows the plan hero, and the bar's ＋ adds a cost.
  await showCard(andi, 'Plan');
  await expect(andi.getByRole('link', { name: 'Add the first cost' })).toBeVisible();

  // Rina takes the settle-up into her books, into her rupiah bank (R6).
  await openTrip(rina);
  await eventually(rina, () => expect(rina.getByTestId('take-over-row')).toContainText("1 record is not in Rina's books yet", { timeout: 1_000 }));
  await rina.getByTestId('take-over-row').click();
  await rina.getByLabel('Into', { exact: true }).selectOption({ label: 'Rina Bank · IDR' });
  await rina.getByRole('button', { name: 'Add to the books' }).click();
  await expect(rina.getByTestId('take-over-row')).toHaveCount(0, { timeout: 30_000 });

  // Debts shows the trip, and what Budi still owes.
  await rina.goto('/net-worth/lend-borrow');
  await expect(rina.getByTestId('trip-row').filter({ hasText: 'Coast week' })).toContainText(/Budi pays Rina .*945/);

  // A purchase that already exists moves in with Select → Add to event: it leaves Cashflow and joins the trip's spending.
  await rina.goto('/transactions');
  await addTransaction(rina, { description: 'Taxi', paidWith: 'Rina Bank', category: 'Transport', amount: '120000' });
  await rina.getByRole('button', { name: 'Select', exact: true }).click();
  const bar = rina.getByRole('toolbar', { name: 'Selected transactions' });
  await expect(bar).toBeVisible();
  await rina.getByRole('checkbox', { name: 'Select Taxi' }).click();
  await bar.getByRole('button', { name: 'Actions' }).click();
  await rina.getByRole('menu', { name: 'Actions' }).getByRole('menuitem', { name: 'Add to event' }).click();
  await rina.getByRole('dialog', { name: 'Add to event' }).getByRole('button', { name: 'Coast week' }).click();
  await expect(bar).toHaveCount(0, { timeout: 30_000 });
  await expect(rina.getByTestId('transaction-row').filter({ hasText: 'Taxi' })).toHaveCount(0);
  await openTrip(rina);
  await expect(spendingRow(rina, 'Taxi')).toContainText('Rina paid');

  // The derived transaction stays in its account's history; its receipt opens the trip's expense to change it.
  await rina.goto('/wallet');
  await walletCard(rina, 'Rina Bank').click();
  await rina.getByTestId('account-recent').getByText('Taxi').click();
  await expect(rina).toHaveURL(/\/transactions\/[0-9a-zA-Z-]{20,}$/);
  await rina.getByRole('button', { name: 'Edit this transaction' }).click();
  await expect(rina.getByTestId('shared-expense-card')).toBeVisible();
  await expect(rina.getByLabel('Note', { exact: true })).toHaveValue('Taxi');
});
