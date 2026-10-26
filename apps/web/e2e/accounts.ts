import { expect, type Locator, type Page } from '@playwright/test';
import { openDrawers } from './drawers';
import { setBalanceCurrency, setCurrency } from './currency-field';
import { todayIn } from './today';

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

/**
 * Open every type drawer on `/accounts`.
 *
 * The list opens as a list of sums: a kind of account divides into its types — `Cash`, `Current account`,
 * `Saving account` — and each type is closed until it is tapped. A walk that reads a row on that page, clicks its
 * name or counts a figure opens the drawers first, which is the one thing the page asks of a reader now. A kind
 * that holds only one type draws its rows flat and has no drawer to open.
 */
export async function openTypes(page: Page) {
  /* The list is painted a moment after the route changes. Ask what is closed before that and the answer is
   * "nothing", which leaves every row behind its drawer — so wait for the list first, and carry on if this page
   * has no accounts at all. */
  await page.locator('main ul li').first().waitFor({ timeout: 5_000 }).catch(() => {});
  /* Open them one at a time by "the first one still closed": a snapshot of handles goes stale as each click
   * redraws the list, and the last handle then points at a drawer that no longer exists. */
  const closed = page.locator('[data-testid^="type-drawer-"][aria-expanded="false"]');
  for (let i = 0; i < 12 && (await closed.count()) > 0; i += 1) await closed.first().click();
}

/** What the account picker calls each kind of money the ledger stores. */
const MONEY_KIND: Record<string, string> = {
  cash: 'Cash',
  bank: 'Current account',
  savings: 'Saving account',
  time_deposit: 'Time deposit',
  ewallet: 'Digital wallet',
  emoney: 'Electronic money',
  fund: 'Fund account',
  other_cash: 'Other cash equivalents',
};

export interface NewAccount {
  /** The ledger's subtype — `bank`, `savings`, `fund`, `ewallet`, `cash`, `other_cash`, `time_deposit`. */
  subtype: string;
  name: string;
  /** What the account holds now: the form's "Current balance". */
  balance?: string;
  currency?: string;
  /** A rate typed for a day the device holds none for: the row under a foreign currency. */
  rate?: string;
  /**
   * The day the money is in the account's name from. Defaults to today. The form asks no day — its balance is
   * today's — so an earlier day is reached by setting the browser's clock to it while the account is opened.
   */
  opened?: string;
  /** A deposit's term: the day it comes back and what it pays. */
  matures?: string;
  interestRate?: string;
  /** The account the money moves from, for an opening balance that is a transfer. */
  from?: string;
  /** A card's bank, a fund account's RDN bank, and a loan's lender — the doors each ask for one. */
  bank?: string;
  lender?: string;
  /** A card's last four digits, when the walk says them rather than typing them into an extra. */
  last4?: string;
  /** Anything else the caller's walk has to fill before saving, in the form's own labels. */
  extra?: (page: Page) => Promise<void>;
  /** The name the account is shown by when a bank typed in `extra` goes in front of it ("Mandiri Xpresi"); `name` else. */
  shown?: string;
}

/**
 * A money account's or a credit card's card on Wallet, by name. A card's accessible name is its name and the figure
 * on its band ("Everyday, Rp 3.000.000"), so the name is anchored rather than exact.
 */
export const walletCard = (page: Page, name: string) =>
  page.getByRole('region', { name: 'Cards' }).getByRole('link', { name: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(,|$)`) });

/**
 * What a card on Wallet reads — a balance, or what a credit card owes — read off the card's own name, which carries
 * the figure on its band. Where the Accounts list's row once said "Rp 7.500.000", the card does.
 */
export async function expectWalletFigure(page: Page, name: string, figure: string) {
  await expect(walletCard(page, name)).toHaveAccessibleName(new RegExp(figure.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
}

/** An account's own page, opened from its card on Wallet — under the raised card, as a person opens it. */
export async function openWalletAccount(page: Page, name: string) {
  await page.goto('/wallet');
  await walletCard(page, name).click();
  await expect(page).toHaveURL(/\/accounts\/[^/]+$/);
}

/**
 * The balance of an account opened from Wallet is on the back of its raised card: a tap turns the card over. Turns it
 * to the balance when it is not there already, so a journey that reads the balance can call this wherever it is.
 */
export async function showBalance(page: Page) {
  const turn = page.getByRole('button', { name: /, show balance$/ });
  if ((await turn.count()) > 0) await turn.click();
  await expect(page.getByTestId('balance-card')).toBeVisible();
}

/** Turns the raised card back to its face, when it shows the balance. */
export async function showCard(page: Page) {
  const turn = page.getByRole('button', { name: /, show card$/ });
  if ((await turn.count()) > 0) await turn.click();
  await expect(page.getByTestId('balance-card')).toBeHidden();
}

/** Opens a money account through the picker and leaves Wallet showing its card (or Assets, for money never spent from). */
export async function openAccount(page: Page, o: NewAccount) {
  // A card and a loan used to be two more values in the old form's Type column. Each has its own door now, and a
  // loan's door asks who lent the money — a loan's terms are what keep that name, and a loan opened without
  // months left keeps no terms at all, so the walk gives the field an answer and nothing more.
  if (o.subtype === 'credit_card') return openCard(page, { name: o.name, owed: o.balance, bank: o.bank, last4: o.last4, currency: o.currency, rate: o.rate, extra: o.extra });
  if (o.subtype === 'loan') return openLoan(page, { kind: 'Multi-purpose loan', name: o.name, owed: o.balance, currency: o.currency, rate: o.rate, lender: o.lender ?? 'Bank' });
  // The browser's own now, not Node's: a spec that already pinned the clock gets its pinned day back afterwards.
  const back = o.opened && o.opened !== (await todayIn(page)) ? { browser: await page.evaluate(() => Date.now()), node: Date.now() } : null;
  if (back) await page.clock.setSystemTime(new Date(`${o.opened}T12:00:00`));
  try {
    await openMoneyAccount(page, o);
  } finally {
    // Put back where it was, plus the seconds the walk took, so a later step's "today" is the run's own.
    if (back) await page.clock.setSystemTime(back.browser + (Date.now() - back.node));
  }
}

/** The money account's own walk, on whatever day the browser's clock says. */
async function openMoneyAccount(page: Page, o: NewAccount) {
  await page.goto('/accounts/new');
  /* A picker row's accessible name is its title *plus* the line under it, so the name is anchored rather than
   * exact — and anchored rather than loose, because several other rows say "cash" in their own subtitle. */
  const label = MONEY_KIND[o.subtype] ?? 'Current account';
  await page.getByRole('button', { name: new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\b|$)`) }).click();
  // A fund account has no name of its own: it is called by its broker, and its bank is the RDN's.
  if (o.subtype === 'fund') {
    await page.getByLabel('Broker', { exact: true }).pressSequentially(o.name);
    if (o.bank) await page.getByLabel('Custodian', { exact: true }).pressSequentially(o.bank);
  } else {
    await page.getByLabel('Name', { exact: true }).pressSequentially(o.name);
  }
  // The currency is the symbol before the balance, picked before the figure is typed so the figure is read in it.
  if (o.currency && o.currency !== 'IDR') await setBalanceCurrency(page, o.currency);
  if (o.balance) await page.getByLabel('Current balance', { exact: true }).pressSequentially(o.balance);
  if (o.from) await page.getByLabel('Where the money comes from').selectOption({ label: o.from });
  if (o.matures) await page.getByLabel('Matures on').fill(o.matures);
  if (o.interestRate) await page.getByLabel('Interest rate').pressSequentially(o.interestRate);
  if (o.rate) await page.getByLabel(/^Rate:/).pressSequentially(o.rate);
  if (o.extra) await o.extra(page);
  await page.getByRole('button', { name: 'Add account' }).click();
  /*
   * A time deposit and a broker's cash are rows on no list of money and in no drawer of one: neither can be paid
   * from — a deposit is locked until it matures, and an RDN's money is moved to a bank first — so both are waited
   * for where they are priced, the asset list. Their rows there read "BCA Deposito · Ledger balance · …", as every
   * row on that list does, so the name is a prefix rather than the whole accessible name.
   */
  if (o.subtype === 'time_deposit' || o.subtype === 'fund') {
    /* The form navigates to the asset list once the write is done, so that is what the save is waited for first. */
    await expect(page).toHaveURL(/\/net-worth\/assets$/);
    /* The asset list folds its rows into a drawer per kind, and opens with them closed. */
    await openDrawers(page);
    await expect(page.getByRole('link', { name: new RegExp(`^${o.shown ?? o.name}`) })).toBeVisible();
    return;
  }
  /* Money kept for spending is a card on Wallet, where the form lands once the write is done. */
  await expect(page).toHaveURL(/\/wallet$/);
  await expect(walletCard(page, o.shown ?? o.name)).toBeVisible();
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
 * The new card form's ⌕ search, answered with a name the catalogue does not carry: its last row, which splits a
 * leading bank off into the row's bank half. `scope` is where the form is drawn — the page, or the Paid with sheet
 * whose step the search is.
 */
export async function nameCardByHand(page: Page, name: string, scope: Page | Locator = page) {
  await scope.getByRole('button', { name: 'Find in the catalogue' }).click();
  await page.getByLabel('Search cards').fill(name);
  await page.getByRole('button', { name: `Use “${name}” as the name` }).click();
}

/** The new card form's ⌕ search, answered from the catalogue: the search narrowed by `query`, then the product. */
export async function pickCatalogueCard(page: Page, query: string, product: string, scope: Page | Locator = page) {
  await scope.getByRole('button', { name: 'Find in the catalogue' }).click();
  await page.getByLabel('Search cards').fill(query);
  await page.getByRole('button', { name: product, exact: true }).click();
}

/**
 * Opens a card by hand through the debt picker, typed on the bank-and-name row as the door the old inline form's
 * Type=credit_card was: the name in the name half, as given, and the bank in the bank half when the walk names one.
 * Currency and dates are the form's details, opened only when the walk gives one. It lands on the card's own page,
 * where the app takes a new card next.
 */
export async function openCard(page: Page, o: NewCard) {
  await page.goto('/debts/new');
  await page.getByRole('button', { name: 'Credit card' }).click();
  await page.getByLabel('Name', { exact: true }).fill(o.name);
  if (o.bank) await page.getByLabel('Bank', { exact: true }).fill(o.bank);
  // An extra may fill any of the form's labels, the folded ones among them, so it gets the details open too.
  if ((o.currency && o.currency !== 'IDR') || o.statementDay || o.dueDay || o.extra) await page.getByRole('button', { name: 'Add more details' }).click();
  if (o.currency && o.currency !== 'IDR') await setCurrency(page.getByLabel('Currency', { exact: true }), o.currency);
  if (o.last4) await page.getByLabel('Last 4 digits').fill(o.last4);
  if (o.owed) await page.getByLabel('Current balance').fill(o.owed);
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
  if (o.currency && o.currency !== 'IDR') await setCurrency(page.getByLabel('Currency', { exact: true }), o.currency);
  if (o.rate) await page.getByLabel(/^Rate:/).pressSequentially(o.rate);
  if (o.lender) await page.getByLabel('Lender').fill(o.lender);
  if (o.interestRate) await page.getByLabel('Interest rate').fill(o.interestRate);
  if (o.months) await page.getByLabel('Months left').fill(o.months);
  await page.getByRole('button', { name: 'Add debt' }).click();
  // The Debts list folds its rows by kind — a mortgage with the mortgages — so the drawer comes first.
  await openDrawers(page);
  // Read as text, not as a link: the desk names the debt in its row, while the phone's list makes the whole
  // line the target and the name part of its label.
  await expect(page.getByText(o.name, { exact: true }).first()).toBeVisible();
}

/**
 * Opens an account's or an asset's settings, behind the page's ⋯. A gear in the corner is still taken if a page
 * draws one. Waits for whichever the page draws, then takes that way in.
 */
export async function openSettings(page: Page) {
  const main = page.getByRole('main');
  const gear = main.getByRole('link', { name: 'Settings', exact: true });
  const more = main.getByRole('button', { name: 'More', exact: true });
  await gear.or(more).first().waitFor();
  if ((await gear.count()) > 0) {
    await gear.click();
    return;
  }
  await more.click();
  await page.getByRole('menuitem', { name: 'Settings', exact: true }).click();
}

/**
 * An estimated asset (land, a house, a car) has no Value button on its page: its value is a row of its Settings. Opens
 * Settings, opens the row's sheet and returns with the sheet open, for the caller to type in; ‹ comes back after.
 */
export async function openValueSheet(page: Page) {
  await openSettings(page);
  await page.getByRole('button', { name: /^Value/ }).click();
}

/** A plastic on a card's Settings, through the Add a card row's sheet. */
export async function addPlastic(page: Page, last4: string, holder?: string) {
  await page.getByRole('button', { name: 'Add a card', exact: true }).click();
  const sheet = page.getByRole('dialog', { name: 'Add a card' });
  await sheet.getByRole('textbox', { name: 'Last 4 digits' }).fill(last4);
  if (holder) await sheet.getByRole('textbox', { name: 'Whose card' }).fill(holder);
  await sheet.getByRole('button', { name: 'Add card', exact: true }).click();
  await expect(sheet).toHaveCount(0);
}

/** Opens a plastic's Edit card sheet from its row on a card's Settings. */
export async function editPlastic(page: Page, last4: string) {
  await page.getByRole('button', { name: `Edit card ending ${last4}` }).click();
  return page.getByRole('dialog', { name: 'Edit card' });
}

/** Removes a plastic from its Edit card sheet. */
export async function removePlastic(page: Page, last4: string) {
  const sheet = await editPlastic(page, last4);
  await sheet.getByRole('button', { name: 'Remove card', exact: true }).click();
  await expect(sheet).toHaveCount(0);
}

/** Leaves Settings for the page it was opened from, once the sheet is closed. */
export async function backFromSettings(page: Page) {
  await page.getByRole('main').getByRole('link', { name: 'Save', exact: true }).or(page.getByRole('button', { name: 'Save', exact: true })).first().click();
}
