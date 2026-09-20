import { expect, type Page, test } from '@playwright/test';
import { addTransaction, addTransfer, attachPhoto, closeDetails, shareWith } from './add-transaction';
import { addEvent } from './event-plan';

const TODAY = new Date().toISOString().slice(0, 10);

/** The directory `photos/store.ts` keeps pictures in, a sibling of the database's `.expanses/` and never inside it. */
const PHOTO_DIRECTORY = 'expanses-photos';

/** What is in `expanses-photos/` right now, by name, read from the page rather than from anything the app says. */
function photoFiles(page: Page): Promise<string[]> {
  return page.evaluate(async (directory) => {
    const root = await navigator.storage.getDirectory();
    const dir = await root.getDirectoryHandle(directory).catch(() => null);
    if (!dir) return [];
    const found: string[] = [];
    for await (const entry of dir.values()) found.push(entry.name);
    return found.sort();
  }, PHOTO_DIRECTORY);
}

/** Puts a file in the photo directory behind the app's back — an abandoned form's leftovers, in one line. */
function plantPhoto(page: Page, name: string): Promise<void> {
  return page.evaluate(
    async ([directory, fileName]) => {
      const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle(directory, { create: true });
      const writable = await (await dir.getFileHandle(fileName, { create: true })).createWritable();
      await writable.write(new TextEncoder().encode('a receipt nobody kept'));
      await writable.close();
    },
    [PHOTO_DIRECTORY, name] as const,
  );
}


test.beforeEach(({ page }) => {
  page.on('dialog', (dialog) => void dialog.accept());
});

async function addAccount(page: Page, name: string, type: string, extra?: (page: Page) => Promise<void>) {
  await page.goto('/accounts');
  await page.getByLabel('Name', { exact: true }).fill(name);
  await page.getByLabel('Type').selectOption(type);
  if (extra) await extra(page);
  await page.getByRole('button', { name: 'Add account' }).click();
  await expect(page.getByRole('link', { name, exact: true })).toBeVisible();
}

test('an expense goes in through the card and comes out in the list', async ({ page }) => {
  await addAccount(page, 'BCA Tahapan', 'bank');
  await page.goto('/transactions');

  // The workspace row opens on the workspace that is open, so nothing has to be chosen to record here.
  await page.getByRole('button', { name: 'Add transaction' }).click();
  await expect(page.getByRole('dialog', { name: 'Add a transaction' }).getByRole('button', { name: 'Workspace' })).toContainText('Personal');
  await page.getByRole('dialog', { name: 'Add a transaction' }).getByRole('button', { name: 'Cancel' }).click();

  await addTransaction(page, { description: 'Superindo', paidWith: 'BCA Tahapan', category: 'Groceries', amount: '500000' });

  const row = page.getByTestId('transaction-row').filter({ hasText: 'Superindo' });
  await expect(row).toHaveCount(1);
  await expect(row).toContainText('Groceries');
  await expect(row).toContainText('500.000');
});

test('income lands in the account it was received into', async ({ page }) => {
  await addAccount(page, 'BCA Tahapan', 'bank');
  await page.goto('/transactions');
  await addTransaction(page, { mode: 'Income', description: 'Freelance', paidWith: 'BCA Tahapan', category: 'Salary', amount: '7500000' });

  await expect(page.getByTestId('transaction-row').filter({ hasText: 'Freelance' })).toContainText('7.500.000');
  // Received, not spent: the account is 7.500.000 richer, which is what tells income from an expense.
  await page.goto('/accounts');
  await expect(page.getByRole('listitem').filter({ hasText: 'BCA Tahapan' }).first()).toContainText('7.500.000');
});

test('Paid with names each card by its digits, and choosing one sets the account and the card together', async ({ page }) => {
  await addAccount(page, 'BCA KrisFlyer', 'credit_card', async () => {
    await page.getByLabel('Bank', { exact: true }).selectOption('BCA');
    await page.getByLabel('Last 4 digits').fill('1467');
  });
  // A second card on the same account: one statement, two sets of digits.
  await page.goto('/cards');
  await page.getByRole('link', { name: 'BCA KrisFlyer', exact: true }).click();
  await page.getByLabel('Last 4 digits').fill('8802');
  await page.getByLabel('Whose card').fill('Spouse');
  await page.getByRole('button', { name: 'Add card' }).click();
  await expect(page.getByTestId('card-on-account')).toHaveCount(2);

  await page.goto('/transactions');
  await page.getByRole('button', { name: 'Add transaction' }).click();
  await page.getByRole('dialog', { name: 'Add a transaction' }).getByRole('button', { name: 'Paid with' }).click();
  const sheet = page.getByRole('dialog', { name: 'Paid with' });
  await expect(sheet.getByRole('button', { name: 'BCA KrisFlyer ···· 1467', exact: true })).toBeVisible();
  await expect(sheet.getByRole('button', { name: 'BCA KrisFlyer ···· 8802', exact: true })).toBeVisible();
  // The account alone is not offered: it would answer the question by leaving half of it unanswered.
  await expect(sheet.getByRole('button', { name: 'BCA KrisFlyer', exact: true })).toHaveCount(0);
  await sheet.getByRole('button', { name: 'Close' }).click();
  await page.getByRole('dialog', { name: 'Add a transaction' }).getByRole('button', { name: 'Cancel' }).click();

  await addTransaction(page, { description: 'Ranch Market', paidWith: 'BCA KrisFlyer ···· 8802', category: 'Groceries', amount: '450000' });

  // The card, not only the account: the row prints the digits it was charged on.
  const row = page.getByTestId('transaction-row').filter({ hasText: 'Ranch Market' });
  await expect(row).toContainText('8802');
  await expect(row).not.toContainText('1467');
});

test('/transactions/new opens the empty card rather than a receipt for a transaction called "new"', async ({ page }) => {
  await addAccount(page, 'BCA Tahapan', 'bank');
  await page.goto('/transactions/new');

  await expect(page.getByRole('heading', { name: 'Add a transaction' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Category' })).toBeVisible();
  // A receipt draws a hero; the card never does. If `$transactionId` had swallowed "new" this is what would show.
  await expect(page.getByTestId('receipt-hero')).toHaveCount(0);
  await expect(page.getByText('That transaction is not on this device.')).toHaveCount(0);
});

test('a desktop types the amount into a real input, and the keyboard does what the keypad does', async ({ page }) => {
  await addAccount(page, 'BCA Tahapan', 'bank');
  await page.goto('/transactions/new');

  // §3.4: the keypad is the phone's. A desktop is not a phone with its keyboard taken away.
  await expect(page.getByTestId('keypad')).toHaveCount(0);
  const amount = page.getByLabel('Amount', { exact: true });
  await expect(amount).toHaveRole('textbox');

  // Leaving the field evaluates it, as DONE does on the dock.
  await amount.fill('85000+15000');
  await page.getByLabel('Note').click();
  await expect(amount).toHaveValue('100000');

  // And so does Enter, without saving on the same press.
  await amount.fill('272400+5000');
  await amount.press('Enter');
  await expect(amount).toHaveValue('277400');
  await expect(page.getByRole('heading', { name: 'Add a transaction' })).toBeVisible();
});

/** A foreign account opened with a balance stores that day's rate, which is what a cross-currency save then needs. */
async function addForeignAccount(page: Page, name: string, currency: string, balance: string, rate: string) {
  await page.goto('/accounts');
  await page.getByLabel('Name', { exact: true }).fill(name);
  await page.getByLabel('Type').selectOption('bank');
  await page.getByLabel('Currency').selectOption(currency);
  await page.getByLabel('Current balance').fill(balance);
  await page.getByLabel('Balance as of').fill(TODAY);
  await page.getByLabel(`Rate: IDR per 1 ${currency}`).fill(rate);
  await page.getByRole('button', { name: 'Add account' }).click();
  await expect(page.getByRole('link', { name, exact: true })).toBeVisible();
}

async function addGoal(page: Page, name: string, amount: string, dueOn: string) {
  await page.goto('/goals');
  await page.getByRole('button', { name: 'Add goal' }).first().click();
  await page.getByLabel('What kind of goal').selectOption('education');
  await page.getByLabel('Name', { exact: true }).fill(name);
  await page.getByLabel(/Cost in today's money/).first().fill(amount);
  await page.getByLabel('Needed by').first().fill(dueOn);
  await page.getByRole('button', { name: 'Add goal' }).last().click();
  await expect(page.getByRole('heading', { name })).toBeVisible();
}

test('a transfer moves money between two accounts and is filed in no workspace', async ({ page }) => {
  await addAccount(page, 'BCA Tahapan', 'bank', async () => {
    await page.getByLabel('Current balance').fill('20000000');
  });
  await addAccount(page, 'Jenius', 'savings', async () => {
    await page.getByLabel('Current balance').fill('0');
  });
  await page.goto('/transactions');

  // §3.5: there is no workspace row on this tab. A transfer touches no category, so the ledger files it nowhere;
  // a row offering to file it would offer something the save cannot honour.
  await page.getByRole('button', { name: 'Add transaction' }).click();
  const form = page.getByRole('dialog', { name: 'Add a transaction' });
  await form.getByRole('radio', { name: 'Transfer', exact: true }).click();
  await expect(form.getByRole('button', { name: 'Workspace for this transaction' })).toHaveCount(0);
  // The hint that keeps a fund purchase off this tab is the To row's own line.
  await expect(form.getByText(/Use Buy or sell, so units are counted/)).toBeVisible();
  await form.getByRole('button', { name: 'Cancel' }).click();

  await addTransfer(page, { from: 'BCA Tahapan', to: 'Jenius (IDR)', amount: '500000', note: 'Top up' });

  // Out of one, into the other, to the rupiah.
  await page.goto('/accounts');
  await expect(page.getByRole('listitem').filter({ hasText: 'BCA Tahapan' }).first()).toContainText('19.500.000');
  await expect(page.getByRole('listitem').filter({ hasText: 'Jenius' }).first()).toContainText('500.000');
});

test('a transfer into a USD account asks for the received amount, and will not save without it', async ({ page }) => {
  await page.route('https://api.frankfurter.dev/**', (route) => void route.abort());
  await addAccount(page, 'BCA Tahapan', 'bank', async () => {
    await page.getByLabel('Current balance').fill('20000000');
  });
  // USD has exponent 2, so a figure read in the wrong currency lands 100× out rather than looking identical.
  // The rate is stored as the opening balance's own conversion, so the balance has to be worth converting.
  await addForeignAccount(page, 'Wise USD', 'USD', '10', '16000');

  await page.goto('/transactions');
  await page.getByRole('button', { name: 'Add transaction' }).click();
  const form = page.getByRole('dialog', { name: 'Add a transaction' });
  await form.getByRole('radio', { name: 'Transfer', exact: true }).click();
  await form.getByRole('button', { name: 'From' }).click();
  await page.getByRole('dialog', { name: 'From' }).getByRole('button', { name: 'BCA Tahapan', exact: true }).click();

  // Same currency on both sides: nothing to ask, because what left is what landed.
  await expect(form.getByLabel(/^Received amount/)).toHaveCount(0);
  await form.getByLabel('To', { exact: true }).selectOption({ label: 'Wise USD (USD)' });
  const received = form.getByLabel('Received amount (USD)');
  await expect(received).toBeVisible();
  await expect(received).toHaveAttribute('required', '');
  await form.getByRole('button', { name: 'Cancel' }).click();

  await addTransfer(page, { from: 'BCA Tahapan', to: 'Wise USD (USD)', amount: '1600000', receivedAmount: '100', note: 'To Wise' });

  // USD 100 landed as USD 100 on top of the opening 10 — not 10.000, which is what reading the second figure in
  // the wrong currency does.
  await page.goto('/accounts');
  await expect(page.getByRole('listitem').filter({ hasText: 'Wise USD' }).first()).toContainText('110,00');
  await expect(page.getByRole('listitem').filter({ hasText: 'BCA Tahapan' }).first()).toContainText('18.400.000');
});

test('a transfer tagged For goal parks the money against the goal', async ({ page }) => {
  await addAccount(page, 'BCA Tahapan', 'bank', async () => {
    await page.getByLabel('Current balance').fill('20000000');
  });
  await addAccount(page, 'Jenius', 'savings', async () => {
    await page.getByLabel('Current balance').fill('0');
  });
  await addGoal(page, 'University for Aisyah', '350000000', '2038-07-31');

  await page.goto('/transactions');
  await addTransfer(page, { from: 'BCA Tahapan', to: 'Jenius (IDR)', amount: '2000000', goal: 'University for Aisyah', note: 'Parking' });

  // `recordTaggedTransfer`, not a plain posting: the row says which goal it was parked for, and the goal has it.
  await expect(page.getByText(/for University for Aisyah/)).toBeVisible();
  await page.goto('/goals');
  await expect(page.getByText(/2\.000\.000/).first()).toBeVisible();
});

test('"Charged in" opens filled in at the rate this device stored for the day', async ({ page }) => {
  // No rate server: what is known is what this device has stored, which is the whole point of the estimate.
  await page.route('https://api.frankfurter.dev/**', (route) => void route.abort());
  await addAccount(page, 'BCA Tahapan', 'bank');

  const typeForeign = async (amount: string) => {
    await page.goto('/transactions/new');
    await page.getByRole('button', { name: 'Paid with' }).click();
    await page.getByRole('dialog', { name: 'Paid with' }).getByRole('button', { name: 'BCA Tahapan', exact: true }).click();
    await page.getByRole('button', { name: 'Currency' }).click();
    // The sheet lists CNY under Recent once it has been chosen, and under All currencies always.
    await page.getByRole('dialog', { name: 'Currency' }).getByRole('button', { name: 'CNY Chinese Yuan' }).first().click();
    await page.getByLabel('Amount', { exact: true }).fill(amount);
    await page.getByLabel('Note').click();
  };

  // Nothing is stored for CNY yet, so nothing is guessed: an estimate built on a rate nobody has is worse
  // than no estimate, and the row says so instead of inventing one.
  await typeForeign('100');
  await expect(page.getByLabel('Charged in IDR')).toHaveValue('');
  await expect(page.getByText(/No CNY→IDR rate is known/)).toBeVisible();

  // A CNY account opened today stores today's CNY→IDR rate.
  await page.goto('/accounts');
  await page.getByLabel('Name', { exact: true }).fill('Alipay');
  await page.getByLabel('Type').selectOption('bank');
  await page.getByLabel('Currency').selectOption('CNY');
  // The rate is stored as the balance's own conversion, so there has to be a balance to convert.
  await page.getByLabel('Current balance').fill('1000');
  await page.getByLabel('Balance as of').fill(TODAY);
  await page.getByLabel('Rate: IDR per 1 CNY').fill('2200');
  await page.getByRole('button', { name: 'Add account' }).click();
  await expect(page.getByRole('link', { name: 'Alipay', exact: true })).toBeVisible();

  // Now the day has a rate, so the row opens with the estimate already in it — and it is a figure worked out
  // from the rate, not the figure typed: CNY 100 at 2.200 is Rp 220.000, and CNY 250 is Rp 550.000.
  await typeForeign('100');
  await expect(page.getByLabel('Charged in IDR')).toHaveValue('220000');
  await expect(page.getByText(`\u2248 2.200 per 1 CNY \u00b7 suggested from ${TODAY}`)).toBeVisible();

  await typeForeign('250');
  await expect(page.getByLabel('Charged in IDR')).toHaveValue('550000');
});

/** A card with real terms, so the points engine has a scheme to measure a purchase against. */
async function catalogueCard(page: Page, name: string, search: string, entryName: string) {
  await page.goto('/cards');
  await page.getByRole('link', { name, exact: true }).click();
  await page.getByLabel('Billing date').fill('25');
  await page.getByLabel('Due date').fill('12');
  await page.getByRole('button', { name: 'Save terms' }).click();
  await page.getByLabel('Search catalogue').fill(search);
  await page.getByRole('button', { name: entryName, exact: true }).click();
  await page.getByRole('button', { name: 'Use these terms' }).click();
  await expect(page.getByText('From catalogue · Linked')).toBeVisible();
}

test('every extra survives the save, and leaving it out of the report leaves only the chart and the budgets', async ({ page }) => {
  await addAccount(page, 'KF Signature', 'credit_card', async () => {
    await page.getByLabel('Amount owed now').fill('0');
  });
  await catalogueCard(page, 'KF Signature', 'signature', 'BCA Singapore Airlines KrisFlyer Visa Signature');
  await addEvent(page, 'Lebaran');

  await page.goto('/transactions');
  await page.getByRole('button', { name: 'Add transaction' }).click();
  const form = page.getByRole('dialog', { name: 'Add a transaction' });
  await form.getByRole('button', { name: 'Paid with' }).click();
  await page.getByRole('dialog', { name: 'Paid with' }).getByRole('button', { name: 'KF Signature', exact: true }).click();
  await form.getByLabel('Amount', { exact: true }).fill('85000');
  await form.getByRole('button', { name: 'Category' }).click();
  await page.getByRole('dialog', { name: 'Select category' }).getByRole('button', { name: 'Groceries', exact: true }).click();
  await form.getByLabel('Note').fill('Superindo');

  await form.getByRole('button', { name: 'Add more details' }).click();
  const more = page.getByRole('dialog', { name: 'More details' });

  await more.getByRole('button', { name: 'Event' }).click();
  await page.getByRole('dialog', { name: 'Event' }).getByRole('button', { name: 'Lebaran' }).click();
  await expect(more.getByRole('button', { name: 'Event' })).toContainText('Lebaran');

  // An uneven split: 40.000 and 45.000 make the 85.000 the card was charged, and neither is half of it.
  await more.getByRole('button', { name: 'Split' }).click();
  const split = page.getByRole('dialog', { name: 'Split' });
  await split.getByRole('button', { name: '+ Split' }).click();
  await split.getByLabel('Split 1 amount').fill('40000');
  await split.getByLabel('Split 2 category').selectOption({ label: 'Restaurants' });
  await split.getByLabel('Split 2 amount').fill('45000');
  await expect(split.getByText('Total Rp 85.000')).toBeVisible();
  await split.getByRole('button', { name: 'Close' }).click();
  await expect(more.getByRole('button', { name: 'Split' })).toContainText('2 splits · Total Rp 85.000');

  await more.getByRole('button', { name: 'MCC' }).click();
  const mccSheet = page.getByRole('dialog', { name: 'MCC' });
  await mccSheet.getByLabel('MCC', { exact: true }).fill('5411');
  await mccSheet.getByRole('button', { name: 'Close' }).click();
  await expect(more.getByRole('button', { name: 'MCC' })).toContainText('5411');

  await more.getByRole('button', { name: 'Channel' }).click();
  await page.getByRole('dialog', { name: 'Channel' }).getByRole('button', { name: 'Offline' }).click();
  await expect(more.getByRole('button', { name: 'Channel' })).toContainText('Offline');

  await more.getByRole('switch', { name: 'Exclude from report' }).click();
  await expect(more.getByRole('switch', { name: 'Exclude from report' })).toHaveAttribute('aria-checked', 'true');
  await more.getByRole('button', { name: 'Close' }).click();

  await form.getByRole('button', { name: 'Save' }).click();
  await expect(form).toHaveCount(0);

  // The receipt carries the event and the channel it was given, and says it is out of the chart.
  await page.getByRole('link', { name: 'Receipt for Superindo' }).click();
  await expect(page.getByTestId('receipt-hero')).toBeVisible();
  await expect(page.getByText('Lebaran')).toBeVisible();
  await expect(page.getByText('Offline')).toBeVisible();
  await expect(page.getByText('Excluded from the chart and budgets')).toBeVisible();

  /*
   * A second purchase, excluded and tagged to nothing, for the half of the asymmetry that is about the chart.
   * The first one cannot show it: spending tagged to an event already leaves the monthly chart and the caps, so
   * a chart with no ring above a Lebaran purchase says nothing about whether the switch was read.
   */
  await page.goto('/transactions');
  await page.getByRole('button', { name: 'Add transaction' }).click();
  await form.getByRole('button', { name: 'Paid with' }).click();
  await page.getByRole('dialog', { name: 'Paid with' }).getByRole('button', { name: 'KF Signature', exact: true }).click();
  await form.getByLabel('Amount', { exact: true }).fill('50000');
  await form.getByRole('button', { name: 'Category' }).click();
  await page.getByRole('dialog', { name: 'Select category' }).getByRole('button', { name: 'Groceries', exact: true }).click();
  await form.getByLabel('Note').fill('Ranch Market');
  await form.getByRole('button', { name: 'Add more details' }).click();
  await page.getByRole('dialog', { name: 'More details' }).getByRole('switch', { name: 'Exclude from report' }).click();
  await page.getByRole('dialog', { name: 'More details' }).getByRole('button', { name: 'Close' }).click();
  await form.getByRole('button', { name: 'Save' }).click();
  await expect(form).toHaveCount(0);

  // Out of the chart… the month's own total is the figure the ring is drawn from, so it is what the exclusion
  // has to move: "nothing recorded" alone is also what an empty month says, and would pass without it.
  await page.goto('/transactions');
  await expect(page.getByText('Ranch Market').first()).toBeVisible();
  await expect(page.getByTestId('period-total')).toHaveText('Rp 0');
  await expect(page.getByTestId('spending-report')).toContainText('Nothing recorded for');

  // …and still on the card: the statement, the balance and the points all still hold both of them, which is the
  // whole asymmetry exclusion exists for. 85.000 at MCC 5411, typed here rather than guessed from the category.
  await page.goto('/accounts');
  await expect(page.getByRole('listitem').filter({ hasText: 'KF Signature' }).first()).toContainText('135.000');
  await page.goto('/cards');
  await page.getByRole('link', { name: 'KF Signature', exact: true }).click();
  await page.getByRole('tab', { name: 'Points' }).click();
  const row = page.locator('li:not([data-testid="statement-line"])', { hasText: 'Superindo' });
  await expect(row).toContainText('MCC 5411 · typed');
});

test('a split is read in the paying account’s own currency, exponent and all', async ({ page }) => {
  await page.route('https://api.frankfurter.dev/**', (route) => void route.abort());
  await addAccount(page, 'Wise Card', 'credit_card', async () => {
    await page.getByLabel('Currency').selectOption('USD');
    await page.getByLabel('Amount owed now').fill('0');
  });

  await page.goto('/transactions');
  await page.getByRole('button', { name: 'Add transaction' }).click();
  const form = page.getByRole('dialog', { name: 'Add a transaction' });
  await form.getByRole('button', { name: 'Paid with' }).click();
  await page.getByRole('dialog', { name: 'Paid with' }).getByRole('button', { name: 'Wise Card', exact: true }).click();
  await form.getByRole('button', { name: 'Add more details' }).click();
  const more = page.getByRole('dialog', { name: 'More details' });
  await more.getByRole('button', { name: 'Split' }).click();
  const split = page.getByRole('dialog', { name: 'Split' });
  await split.getByRole('button', { name: '+ Split' }).click();
  await split.getByLabel('Split 1 category').selectOption({ label: 'Groceries' });
  await split.getByLabel('Split 1 amount').fill('40.50');
  await split.getByLabel('Split 2 category').selectOption({ label: 'Restaurants' });
  await split.getByLabel('Split 2 amount').fill('44.50');

  // USD 85, not 8.500 and not 85.000: USD has two decimals, and a figure read at the wrong exponent on this
  // card would be a hundred times what was typed. IDR cannot show that mistake at all — its exponent is 0.
  await expect(split.getByText('Total US$85,00')).toBeVisible();
  await split.getByRole('button', { name: 'Close' }).click();
  await expect(more.getByRole('button', { name: 'Split' })).toContainText('2 splits · Total US$85,00');
});

test('a missing rate is asked for under Add more details, and the save then goes through', async ({ page }) => {
  await page.route('https://api.frankfurter.dev/**', (route) => void route.abort());
  // No balance, so nothing stores a USD→IDR rate on the way in: the save is the first thing to want one.
  await addAccount(page, 'Wise USD', 'bank', async () => {
    await page.getByLabel('Currency').selectOption('USD');
  });

  await page.goto('/transactions');
  await page.getByRole('button', { name: 'Add transaction' }).click();
  const form = page.getByRole('dialog', { name: 'Add a transaction' });
  await form.getByRole('button', { name: 'Paid with' }).click();
  await page.getByRole('dialog', { name: 'Paid with' }).getByRole('button', { name: 'Wise USD', exact: true }).click();
  await form.getByLabel('Amount', { exact: true }).fill('12.50');
  await form.getByRole('button', { name: 'Category' }).click();
  await page.getByRole('dialog', { name: 'Select category' }).getByRole('button', { name: 'Restaurants', exact: true }).click();
  await form.getByLabel('Note').fill('Blue Bottle');
  await form.getByRole('button', { name: 'Save' }).click();

  // §3.3: the rate field lives under Add more details and only there, so the refusal says where to go.
  await expect(form.getByRole('alert')).toContainText('No USD→IDR rate');
  await expect(form.getByRole('alert')).toContainText('Add more details');

  await form.getByRole('button', { name: 'Add more details' }).click();
  const more = page.getByRole('dialog', { name: 'More details' });
  await more.getByLabel('Rate: IDR per 1 USD').fill('16000');
  // `ratePreview` under the row, reading back what was typed, so a decimal slip is visible before Save.
  await expect(more.getByText('Reads as 1 USD = 16.000 IDR')).toBeVisible();
  await more.getByRole('button', { name: 'Close' }).click();

  await form.getByRole('button', { name: 'Save' }).click();
  await expect(form).toHaveCount(0);
  // USD 12,50 at 16.000 is Rp 200.000 — the rate typed by hand is the one the save stored and used.
  await expect(page.getByTestId('transaction-row').filter({ hasText: 'Blue Bottle' })).toContainText('12,50');
  await page.goto('/spending');
  await expect(page.getByText(/200\.000/).first()).toBeVisible();
});

/**
 * A dinner for four, split equally — the shape the form could not record until now.
 *
 * `splitBill` has taken a list of shares since Task 5 and `recentPeople` has offered the people on the books for
 * just as long; the card went on asking for exactly one name and one figure, so a bill shared three ways had to
 * be typed as three transactions or not at all. Every figure below is one `equalShares` worked out and the
 * summary card promised before Save: 400.000 divided four ways, 100.000 each, 300.000 owed back.
 */
test('a bill split equally between three people leaves each of them owing their share', async ({ page }) => {
  await addAccount(page, 'BCA Visa', 'credit_card', async () => {
    await page.getByLabel('Amount owed now').fill('0');
  });

  await page.goto('/transactions');
  await page.getByRole('button', { name: 'Add transaction' }).click();
  const form = page.getByRole('dialog', { name: 'Add a transaction' });
  await form.getByRole('button', { name: 'Paid with' }).click();
  await page.getByRole('dialog', { name: 'Paid with' }).getByRole('button', { name: 'BCA Visa', exact: true }).click();
  await form.getByLabel('Amount', { exact: true }).fill('400000');
  await form.getByRole('button', { name: 'Category' }).click();
  await page.getByRole('dialog', { name: 'Select category' }).getByRole('button', { name: 'Restaurants', exact: true }).click();
  await form.getByLabel('Note').fill('Dinner at Plataran');

  const { more, sheet } = await shareWith(page, form, [{ name: 'Andi' }, { name: 'Budi' }, { name: 'Citra' }]);

  // The three figures the user reads before pressing Save, and the three the save then posts.
  const summary = sheet.getByTestId('with-summary');
  await expect(summary).toContainText('Bill');
  await expect(summary).toContainText('Rp 400.000');
  await expect(summary).toContainText('They owe you');
  await expect(summary).toContainText('Rp 300.000');
  await expect(summary).toContainText('Your share');
  await expect(sheet.getByTestId('with-your-share')).toHaveText('Rp 100.000');

  // Shut, the row underneath reads back what was decided — the summary Task 14's edit sheet will show too.
  await sheet.getByRole('button', { name: 'Close' }).click();
  await expect(more.getByRole('button', { name: 'With', exact: true })).toContainText('3 people · They owe you Rp 300.000');
  await more.getByRole('button', { name: 'Close' }).click();
  await form.getByRole('button', { name: 'Save' }).click();
  await expect(form).toHaveCount(0);

  // Three people on the books, not one, and each of them owing a quarter of the bill.
  await page.goto('/net-worth/debts');
  for (const person of ['Andi', 'Budi', 'Citra']) {
    await expect(page.getByRole('heading', { name: person })).toBeVisible();
    // The figure beside that person's own name: each of them owes a quarter, rather than one of them the lot.
    await expect(page.getByRole('heading', { name: person }).locator('xpath=following-sibling::span')).toContainText('100.000');
  }

  // The card was charged the whole 400.000 — what the restaurant took, not what the dinner cost the owner.
  await page.goto('/accounts');
  await expect(page.getByRole('listitem').filter({ hasText: 'BCA Visa' }).first()).toContainText('400.000');

  // …and only the owner's own quarter is spending. The month's total is the figure the ring is drawn from, so
  // a split that posted the whole bill to Restaurants would read 400.000 here.
  await page.goto('/transactions');
  await expect(page.getByTestId('period-total')).toHaveText('Rp 100.000');
  await expect(page.getByTestId('spending-report')).toContainText('Restaurants');
});

/**
 * Custom amounts: one person's share is typed, and yours is what is left.
 *
 * Deliberately uneven — 400.000 less a typed 133.333 — because an even division cannot tell `yourShare` from a
 * halving, and the remainder rule is the whole reason the shares add back to the bill to the rupiah.
 */
test('a typed share leaves the rest of the bill as your own spending', async ({ page }) => {
  await addAccount(page, 'BCA Tahapan', 'bank', async () => {
    await page.getByLabel('Current balance').fill('50000000');
  });

  await page.goto('/transactions');
  await page.getByRole('button', { name: 'Add transaction' }).click();
  const form = page.getByRole('dialog', { name: 'Add a transaction' });
  await form.getByRole('button', { name: 'Paid with' }).click();
  await page.getByRole('dialog', { name: 'Paid with' }).getByRole('button', { name: 'BCA Tahapan', exact: true }).click();
  await form.getByLabel('Amount', { exact: true }).fill('400000');
  await form.getByRole('button', { name: 'Category' }).click();
  await page.getByRole('dialog', { name: 'Select category' }).getByRole('button', { name: 'Restaurants', exact: true }).click();
  await form.getByLabel('Note').fill('Sate Khas Senayan');

  const { more, sheet } = await shareWith(page, form, [{ name: 'Andi', owes: '133333' }]);
  await expect(sheet.getByTestId('with-summary')).toContainText('Rp 133.333');
  await expect(sheet.getByTestId('with-your-share')).toHaveText('Rp 266.667');

  await closeDetails(more, sheet);
  await form.getByRole('button', { name: 'Save' }).click();
  await expect(form).toHaveCount(0);

  await page.goto('/net-worth/debts');
  await expect(page.getByRole('heading', { name: 'Andi' })).toBeVisible();
  await expect(page.getByText(/133\.333/).first()).toBeVisible();

  // 266.667, not 200.000: what is left of the bill, never half of it.
  await page.goto('/transactions');
  await expect(page.getByTestId('period-total')).toHaveText('Rp 266.667');
});

/**
 * A photograph attached while the purchase is being recorded, and read back off the device on its receipt.
 *
 * This is the first thing in the app to put a picture on a transaction: Task 6 built the OPFS store, the backup
 * zip and the orphan sweep, and nothing called any of it from the form. The bytes asserted at the end are the
 * bytes handed to the file input at the start — read back out of the blob URL, so the assertion is about this
 * device's own storage rather than about anything the page says.
 */
test('a photograph attached to a purchase is on its receipt, and ✕ takes it off again', async ({ page }) => {
  await addAccount(page, 'BCA Visa', 'credit_card', async () => {
    await page.getByLabel('Amount owed now').fill('0');
  });

  await page.goto('/transactions');
  await page.getByRole('button', { name: 'Add transaction' }).click();
  const form = page.getByRole('dialog', { name: 'Add a transaction' });
  await form.getByRole('button', { name: 'Paid with' }).click();
  await page.getByRole('dialog', { name: 'Paid with' }).getByRole('button', { name: 'BCA Visa', exact: true }).click();
  await form.getByLabel('Amount', { exact: true }).fill('85000');
  await form.getByRole('button', { name: 'Category' }).click();
  await page.getByRole('dialog', { name: 'Select category' }).getByRole('button', { name: 'Groceries', exact: true }).click();
  await form.getByLabel('Note').fill('Superindo');

  // Left behind by some earlier half-filled form, put there behind the app's back: closing the sheet runs the
  // orphan sweep, and a file no row names must go with it.
  await plantPhoto(page, 'abandoned-by-a-half-filled-form.jpg');

  const { more, sheet } = await attachPhoto(page, form, { name: 'wrong-one.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('the wrong receipt') });

  // ✕ takes both halves away — the row and the file — so the picture that goes with the transaction is the
  // second one and only the second one. The bytes are the half a sweep cannot put back.
  await sheet.getByRole('button', { name: 'Remove photo 1' }).click();
  await expect(sheet.getByRole('button', { name: 'Photo 1', exact: true })).toHaveCount(0);
  await expect(more.getByRole('button', { name: 'Photos' })).toContainText('None');
  expect(await photoFiles(page)).toEqual(['abandoned-by-a-half-filled-form.jpg']);

  await sheet.getByTestId('photo-library-input').setInputFiles({ name: 'receipt.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('a receipt') });
  await expect(sheet.getByRole('button', { name: 'Photo 1', exact: true })).toBeVisible();
  await expect(more.getByRole('button', { name: 'Photos' })).toContainText('1 photo');

  await closeDetails(more, sheet);
  // One file left on the device: the picture on the open form, which `allPhotoFileNames` names even though its
  // row has no transaction yet. The abandoned one is gone, and the sweep is what took it.
  await expect.poll(() => photoFiles(page), { timeout: 15_000 }).toHaveLength(1);
  expect(await photoFiles(page)).not.toContain('abandoned-by-a-half-filled-form.jpg');
  await form.getByRole('button', { name: 'Save' }).click();
  await expect(form).toHaveCount(0);

  await page.getByRole('link', { name: 'Receipt for Superindo' }).click();
  const picture = page.getByTestId('photo-strip').getByRole('img', { name: 'Receipt photo for Superindo' });
  await expect(picture).toHaveCount(1);
  await expect(picture).toHaveAttribute('src', /^blob:/);
  // The bytes behind that URL are the ones chosen in the form, read back out of this device's own OPFS.
  expect(await picture.evaluate(async (img: HTMLImageElement) => (await fetch(img.src)).text())).toBe('a receipt');

  // Tapped, it opens full size — the promise the sheet's own line makes.
  await picture.click();
  await expect(page.getByRole('dialog', { name: 'Photo' })).toBeVisible();
});
