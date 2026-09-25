import { expect, type Page } from '@playwright/test';
import { openTypes } from './accounts';
import { openDrawers } from './drawers';

export type Choice = 'principal' | 'principal_interest' | 'close';
export interface Combo {
  currency: 'IDR' | 'USD';
  choice: Choice;
  paid: 'monthly' | 'at_maturity';
  exempt: boolean;
  /** Each proposal's net interest, as the card prints it, in the order they are proposed. */
  nets: string[];
  /** The deposit's balance at the end, or null when it closed. */
  deposit: string | null;
  payout: string;
}

export const SETUP = {
  IDR: { opened: '2026-07-15', matures: '2026-10-15', payoutName: 'BCA Tahapan', payoutBalance: '1000000', depositName: 'BCA Deposito', depositBalance: '50000000', rate: '4,25', fx: undefined },
  USD: { opened: '2026-08-01', matures: '2026-11-01', payoutName: 'Jenius USD', payoutBalance: '50', depositName: 'Jenius Deposito', depositBalance: '10000', rate: '3,5', fx: '16350' },
} as const;

/** Noon local, so no time zone can move the day. */
export const at = (date: string) => new Date(`${date}T12:00:00`);

// prettier-ignore
export const COMBOS: Combo[] = [
  { currency: 'IDR', choice: 'principal',          paid: 'at_maturity', exempt: false, nets: ['428.493'],                       deposit: '50.000.000', payout: '1.428.493' },
  { currency: 'IDR', choice: 'principal',          paid: 'at_maturity', exempt: true,  nets: ['535.616'],                       deposit: '50.000.000', payout: '1.535.616' },
  { currency: 'IDR', choice: 'principal',          paid: 'monthly',     exempt: false, nets: ['144.384', '144.384', '139.726'], deposit: '50.000.000', payout: '1.428.494' },
  { currency: 'IDR', choice: 'principal',          paid: 'monthly',     exempt: true,  nets: ['180.479', '180.479', '174.657'], deposit: '50.000.000', payout: '1.535.615' },
  { currency: 'IDR', choice: 'principal_interest', paid: 'at_maturity', exempt: false, nets: ['428.493'],                       deposit: '50.428.493', payout: '1.000.000' },
  { currency: 'IDR', choice: 'principal_interest', paid: 'at_maturity', exempt: true,  nets: ['535.616'],                       deposit: '50.535.616', payout: '1.000.000' },
  { currency: 'IDR', choice: 'close',              paid: 'at_maturity', exempt: false, nets: ['428.493'],                       deposit: null,         payout: '51.428.493' },
  { currency: 'IDR', choice: 'close',              paid: 'at_maturity', exempt: true,  nets: ['535.616'],                       deposit: null,         payout: '51.535.616' },
  { currency: 'IDR', choice: 'close',              paid: 'monthly',     exempt: false, nets: ['144.384', '144.384', '139.726'], deposit: null,         payout: '51.428.494' },
  { currency: 'IDR', choice: 'close',              paid: 'monthly',     exempt: true,  nets: ['180.479', '180.479', '174.657'], deposit: null,         payout: '51.535.615' },
  { currency: 'USD', choice: 'principal',          paid: 'at_maturity', exempt: false, nets: ['70,57'],                         deposit: '10.000,00',  payout: '120,57' },
  { currency: 'USD', choice: 'principal',          paid: 'at_maturity', exempt: true,  nets: ['88,21'],                         deposit: '10.000,00',  payout: '138,21' },
  { currency: 'USD', choice: 'principal',          paid: 'monthly',     exempt: false, nets: ['23,78', '23,01', '23,78'],       deposit: '10.000,00',  payout: '120,57' },
  { currency: 'USD', choice: 'principal',          paid: 'monthly',     exempt: true,  nets: ['29,72', '28,76', '29,72'],       deposit: '10.000,00',  payout: '138,20' },
  { currency: 'USD', choice: 'principal_interest', paid: 'at_maturity', exempt: false, nets: ['70,57'],                         deposit: '10.070,57',  payout: '50,00' },
  { currency: 'USD', choice: 'principal_interest', paid: 'at_maturity', exempt: true,  nets: ['88,21'],                         deposit: '10.088,21',  payout: '50,00' },
  { currency: 'USD', choice: 'close',              paid: 'at_maturity', exempt: false, nets: ['70,57'],                         deposit: null,         payout: '10.120,57' },
  { currency: 'USD', choice: 'close',              paid: 'at_maturity', exempt: true,  nets: ['88,21'],                         deposit: null,         payout: '10.138,21' },
  { currency: 'USD', choice: 'close',              paid: 'monthly',     exempt: false, nets: ['23,78', '23,01', '23,78'],       deposit: null,         payout: '10.120,57' },
  { currency: 'USD', choice: 'close',              paid: 'monthly',     exempt: true,  nets: ['29,72', '28,76', '29,72'],       deposit: null,         payout: '10.138,20' },
];

/**
 * "Recorded it myself" on the first proposal, the rest confirmed: one walk for each choice × payout, across both
 * currencies and both tax states. A roll-over of principal + interest pays nothing out during the term, so that
 * pair of answers is not one the screen offers and has no walk of its own. The repository walks every pair it can
 * store (Task 7); these are the screens'.
 */
// prettier-ignore
export const HAND_COMBOS: Combo[] = [
  { currency: 'IDR', choice: 'principal',          paid: 'at_maturity', exempt: false, nets: ['428.493'],                       deposit: '50.000.000', payout: '1.000.000' },
  { currency: 'IDR', choice: 'close',              paid: 'at_maturity', exempt: true,  nets: ['535.616'],                       deposit: '50.000.000', payout: '1.000.000' },
  { currency: 'USD', choice: 'principal',          paid: 'monthly',     exempt: true,  nets: ['29,72', '28,76', '29,72'],       deposit: '10.000,00',  payout: '108,48' },
  { currency: 'USD', choice: 'principal_interest', paid: 'at_maturity', exempt: true,  nets: ['88,21'],                         deposit: '10.000,00',  payout: '50,00' },
  { currency: 'USD', choice: 'close',              paid: 'monthly',     exempt: false, nets: ['23,78', '23,01', '23,78'],       deposit: null,         payout: '10.096,79' },
];

export const comboName = (c: Combo) => `${c.currency} · ${c.choice} · ${c.paid} · ${c.exempt ? 'tax-free' : 'taxed'}`;

/** Types into a box one key at a time, the way a thumb or a keyboard does. */
export async function typeInto(page: Page, label: string, text: string) {
  const box = page.getByLabel(label, { exact: true });
  await box.click();
  await box.selectText();
  await box.press('Backspace');
  await box.pressSequentially(text, { delay: 20 });
}

export async function addMoneyAccount(
  page: Page,
  o: { kind: 'Current account' | 'Time deposit'; name: string; balance: string; currency: 'IDR' | 'USD'; fx?: string; opened: string; matures?: string; rate?: string },
) {
  await page.goto('/accounts/new');
  await page.getByRole('button', { name: o.kind }).click();
  await typeInto(page, 'Name', o.name);
  await typeInto(page, 'Balance now', o.balance);
  if (o.currency !== 'IDR') await page.getByLabel('Currency', { exact: true }).selectOption(o.currency);
  if (o.fx) await typeInto(page, `Rate: IDR per 1 ${o.currency}`, o.fx);
  if (o.matures) await page.getByLabel('Matures on').fill(o.matures); // a date input only takes a whole date
  if (o.rate) await typeInto(page, 'Interest rate', o.rate);
  await page.getByLabel('Balance as of').fill(o.opened);
  await page.getByRole('button', { name: 'Add account' }).click();
  /* The form navigates to the money list once the write is done, so that is what the save is waited for first. */
  await expect(page).toHaveURL(/\/accounts$/);
  /*
   * A current account is a row on that list, inside its type's drawer — and adding this one may be what made the
   * cash group divide at all, so the drawers are opened after the save, not before it. A time deposit is a row on no
   * such list: it holds money it cannot be paid from, so it is waited for where it is priced, on the asset list.
   */
  if (o.kind === 'Time deposit') {
    await page.goto('/net-worth/assets');
    // A deposit's row is folded into its kind's drawer, which the list opens shut.
    await openDrawers(page);
    // A prefix, not the whole name: an asset row reads "BCA Deposito · Time deposit · …", as every other list
    // here does, and `openDeposit` matches it the same way.
    await expect(page.getByRole('link', { name: new RegExp(`^${o.name}`) })).toBeVisible();
    return;
  }
  await openTypes(page);
  await expect(page.getByRole('link', { name: o.name, exact: true })).toBeVisible();
}

export async function setUp(page: Page, currency: 'IDR' | 'USD') {
  const s = SETUP[currency];
  await page.route('https://api.frankfurter.dev/**', (route) => void route.abort());
  await page.clock.setSystemTime(at(s.opened));
  await addMoneyAccount(page, { kind: 'Current account', name: s.payoutName, balance: s.payoutBalance, currency, fx: s.fx, opened: s.opened });
  await addMoneyAccount(page, { kind: 'Time deposit', name: s.depositName, balance: s.depositBalance, currency, fx: s.fx, opened: s.opened, matures: s.matures, rate: s.rate });
  return s;
}

export async function openDeposit(page: Page, name: string) {
  await page.goto('/net-worth/assets');
  // A deposit sits inside the drawer its kind folds into, so the drawer is opened first.
  await openDrawers(page);
  await page.getByRole('link', { name: new RegExp(`^${name}`) }).click();
}

export async function automate(page: Page, c: Pick<Combo, 'choice' | 'paid' | 'exempt'>, termMonths = '3') {
  // The deposit's own term first, on its terms card…
  await page.getByLabel('Term', { exact: true }).selectOption(termMonths);
  await expect(page.getByTestId('deposit-term')).toHaveAttribute('aria-busy', 'false');
  // …then the decision, one picker at a time under the switch.
  await page.getByLabel('Automate at maturity').check();
  await expect(page.getByLabel('At maturity', { exact: true })).toBeVisible();
  // Monthly first: choosing everything rolling over freezes it, and the walk must set it before that.
  if (c.choice !== 'principal_interest') await page.getByLabel('Interest paid').selectOption(c.paid);
  await page.getByLabel('At maturity', { exact: true }).selectOption(c.choice);
  if (c.exempt) await page.getByLabel('Tax-free deposit').check();
  await settingsSaved(page);
}

/** Every change the settings group made has reached the database, so a reload or a clock jump cannot lose one. */
export async function settingsSaved(page: Page) {
  await expect(page.getByTestId('maturity-settings')).toHaveAttribute('aria-busy', 'false');
}

/**
 * Settles every proposal in the order given, checking each one's net and the count still waiting before it is
 * settled. With `firstByHand`, the first one is "Recorded it myself" and the rest are confirmed.
 */
export async function confirmEach(page: Page, nets: string[], firstByHand = false) {
  const card = page.getByTestId('deposit-proposal');
  for (const [i, net] of nets.entries()) {
    await expect(card).toContainText(net);
    // The count is what proves the card moved on, since two payouts in a row can carry the same net.
    if (i < nets.length - 1) await expect(card).toContainText(`${nets.length - 1 - i} more waiting`);
    else await expect(card).not.toContainText('more waiting');
    await card.getByRole('button', { name: firstByHand && i === 0 ? 'Recorded it myself' : 'Confirm' }).click();
  }
}

export async function startReport(page: Page, year: number) {
  await page.goto('/tax-report');
  await page.getByLabel('Tax year').selectOption(String(year));
  await page.getByRole('button', { name: `Start the ${year} report` }).click();
  await expect(page.getByText('Ikhtisar')).toBeVisible();
}

export async function expectBalance(page: Page, name: string, figure: string) {
  await page.goto('/accounts');
  await openTypes(page);
  // The accounts page is the kit's list now, not a table: each account is a line, and the name is its link.
  const row = page.getByRole('listitem').filter({ has: page.getByRole('link', { name, exact: true }) });
  await expect(row).toContainText(figure);
}

/**
 * A deposit's own balance, on the deposit's own page.
 *
 * It is not read on the money list, because a deposit is on no such list: it holds money it cannot be paid from, so
 * the accounts a ledger spends from are the ones that page lists, and a deposit is reached where it is priced — the
 * asset list, behind this page.
 */
export async function expectDepositBalance(page: Page, name: string, figure: string) {
  await openDeposit(page, name);
  await expect(page.getByRole('main')).toContainText(figure);
}

export async function walk(page: Page, c: Combo, firstByHand = false) {
  const s = await setUp(page, c.currency);
  await openDeposit(page, s.depositName);
  await automate(page, c);
  // The app goes unopened until the maturity: everything due in the term waits for it.
  await page.clock.setSystemTime(at(s.matures));
  // The deposit is a row inside its kind's drawer, which the Assets list opens shut.
  await page.goto('/net-worth/assets');
  await openDrawers(page);
  await expect(page.getByRole('link', { name: new RegExp(`^${s.depositName}`) })).toContainText('Due');
  await page.getByRole('link', { name: new RegExp(`^${s.depositName}`) }).click();
  await confirmEach(page, c.nets, firstByHand);
  if (c.deposit === null) {
    await expect(page).toHaveURL(/\/net-worth\/assets$/);
    await expect(page.getByRole('link', { name: new RegExp(`^${s.depositName}`) })).toHaveCount(0);
  } else {
    await expect(page.getByTestId('deposit-proposal')).toHaveCount(0);
    await expectDepositBalance(page, s.depositName, c.deposit);
  }
  await expectBalance(page, s.payoutName, c.payout);
}
