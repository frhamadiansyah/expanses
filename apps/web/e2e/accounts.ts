import { expect, type Page } from '@playwright/test';

/**
 * Opening an account the way the app opens one now: the picker asks what it is, the form asks only that.
 *
 * The inline form that used to sit at the foot of the Accounts page is gone — it was the same job as the `+`
 * beside the title, and two doors to one room. A walk that filled it in place names the kind instead, in the
 * picker's own words, and then answers what that kind asks.
 *
 * Money accounts, cards and loans each have their own door: money is `/accounts/new`, a card or a loan is
 * `/debts/new` (the picker's hint says the same to the owner).
 */

/** What the account picker calls each kind of money the ledger stores. */
const MONEY_KIND: Record<string, string> = {
  cash: 'Cash',
  bank: 'Current account',
  savings: 'Saving account',
  time_deposit: 'Time deposit',
  ewallet: 'Digital wallet',
  fund: 'Fund account',
  other_cash: 'Other cash equivalents',
};

export interface NewAccount {
  /** The ledger's subtype — `bank`, `savings`, `fund`, `ewallet`, `cash`, `other_cash`, `time_deposit`. */
  subtype: string;
  name: string;
  /** What the account holds now. The old form called this "Current balance"; the picker calls it "Balance now". */
  balance?: string;
  currency?: string;
  /** A rate typed for a day the device holds none for: the row under a foreign currency. */
  rate?: string;
  /** The day the money is in the account's name from. Defaults to today. */
  opened?: string;
  /** A deposit's term: the day it comes back and what it pays. */
  matures?: string;
  interestRate?: string;
  /** The account the money moves from, for an opening balance that is a transfer. */
  from?: string;
  /** A card's bank, and a loan's lender — the doors each ask for one. */
  bank?: string;
  lender?: string;
  /** A card's last four digits, when the walk says them rather than typing them into an extra. */
  last4?: string;
  /** Anything else the caller's walk has to fill before saving, in the form's own labels. */
  extra?: (page: Page) => Promise<void>;
}

/** Opens a money account through the picker and leaves the Accounts page showing it. */
export async function openAccount(page: Page, o: NewAccount) {
  // A card and a loan used to be two more values in the old form's Type column. Each has its own door now, and a
  // loan's door asks who lent the money — a loan's terms are what keep that name, and a loan opened without
  // months left keeps no terms at all, so the walk gives the field an answer and nothing more.
  if (o.subtype === 'credit_card') return openCard(page, { name: o.name, owed: o.balance, bank: o.bank, last4: o.last4, currency: o.currency, rate: o.rate, extra: o.extra });
  if (o.subtype === 'loan') return openLoan(page, { kind: 'Multi-purpose loan', name: o.name, owed: o.balance, currency: o.currency, rate: o.rate, lender: o.lender ?? 'Bank' });
  await page.goto('/accounts/new');
  /* A picker row's accessible name is its title *plus* the line under it, so the name is anchored rather than
   * exact — and anchored rather than loose, because several other rows say "cash" in their own subtitle. */
  const label = MONEY_KIND[o.subtype] ?? 'Current account';
  await page.getByRole('button', { name: new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\b|$)`) }).click();
  await page.getByLabel('Name', { exact: true }).pressSequentially(o.name);
  if (o.currency && o.currency !== 'IDR') await page.getByLabel('Currency', { exact: true }).selectOption(o.currency);
  if (o.balance) await page.getByLabel('Balance now').pressSequentially(o.balance);
  if (o.from) await page.getByLabel('Where the money comes from').selectOption({ label: o.from });
  if (o.matures) await page.getByLabel('Matures on').fill(o.matures);
  if (o.interestRate) await page.getByLabel('Interest rate').pressSequentially(o.interestRate);
  if (o.rate) await page.getByLabel(/^Rate:/).pressSequentially(o.rate);
  if (o.opened) await page.getByLabel('Balance as of').fill(o.opened);
  if (o.extra) await o.extra(page);
  await page.getByRole('button', { name: 'Add account' }).click();
  await expect(page.getByRole('link', { name: o.name, exact: true })).toBeVisible();
}

export interface NewCard {
  name: string;
  /** What is owed on it now, when the walk cares. */
  owed?: string;
  /** Its bank, when the card is typed by hand rather than picked from the catalogue. */
  bank?: string;
  last4?: string;
  /** The currency a hand-typed card is issued in, and the rate for a day the device holds none for. */
  currency?: string;
  rate?: string;
  /** The card's own two dates, when the walk needs them set. */
  statementDay?: string;
  dueDay?: string;
  /**
   * Anything else filled in the form's own labels, before Save.
   *
   * It runs *before* the button, not after: digits typed here are the digits the account is opened with, and a
   * card recorded without them has no plastic on it at all — a supplementary card would then become the first.
   */
  extra?: (page: Page) => Promise<void>;
  /**
   * Whether the card is expected to open. False for a walk that is testing the refusal: the button is pressed
   * and the form's own words are read, so the card's page is never reached.
   */
  expectSuccess?: boolean;
}

/**
 * Opens a card by hand through the debt picker — "Not listed — type the name", which is the door the old inline
 * form's Type=credit_card was. It lands on the card's own page, where the app takes a new card next.
 */
export async function openCard(page: Page, o: NewCard) {
  await page.goto('/debts/new');
  await page.getByRole('button', { name: 'Credit card' }).click();
  await page.getByLabel('Name', { exact: true }).fill(o.name);
  if (o.bank) await page.getByLabel('Bank').selectOption({ label: o.bank });
  if (o.currency && o.currency !== 'IDR') await page.getByLabel('Currency', { exact: true }).selectOption(o.currency);
  if (o.last4) await page.getByLabel('Last 4 digits').fill(o.last4);
  if (o.owed) await page.getByLabel('Owed now').fill(o.owed);
  if (o.rate) await page.getByLabel(/^Rate:/).pressSequentially(o.rate);
  if (o.statementDay) await page.getByLabel('Billing date').fill(o.statementDay);
  if (o.dueDay) await page.getByLabel('Due date').fill(o.dueDay);
  if (o.extra) await o.extra(page);
  await page.getByRole('button', { name: 'Add card' }).click();
  if (o.expectSuccess === false) return;
  await expect(page.getByRole('heading', { name: o.name })).toBeVisible();
}

export interface NewLoan {
  /** The picker's own words: "Multi-purpose loan", "Home mortgage", "Online loan or paylater". */
  kind: string;
  name: string;
  owed?: string;
  /** The currency the debt is in, when it is not the workspace's own. */
  currency?: string;
  /** The day's rate, for a debt in a currency the device holds no rate for. */
  rate?: string;
  lender?: string;
  interestRate?: string;
  months?: string;
}

/** Opens a loan through the debt picker, which asks for the terms that give it a schedule. */
export async function openLoan(page: Page, o: NewLoan) {
  await page.goto('/debts/new');
  await page.getByRole('button', { name: o.kind }).click();
  await page.getByLabel('Name', { exact: true }).fill(o.name);
  if (o.owed) await page.getByLabel('Owed now').fill(o.owed);
  if (o.currency && o.currency !== 'IDR') await page.getByLabel('Currency', { exact: true }).selectOption(o.currency);
  if (o.rate) await page.getByLabel(/^Rate:/).pressSequentially(o.rate);
  if (o.lender) await page.getByLabel('Lender').fill(o.lender);
  if (o.interestRate) await page.getByLabel('Interest rate').fill(o.interestRate);
  if (o.months) await page.getByLabel('Months left').fill(o.months);
  await page.getByRole('button', { name: 'Add debt' }).click();
  // Read as text, not as a link: the desk names the debt in its row, while the phone's list makes the whole
  // line the target and the name part of its label.
  await expect(page.getByText(o.name, { exact: true }).first()).toBeVisible();
}
