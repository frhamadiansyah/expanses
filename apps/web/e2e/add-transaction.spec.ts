import { expect, type Page, test } from '@playwright/test';
import { openAccount, openTypes } from './accounts';
import { addTransaction, addTransfer, attachPhoto, closeDetails, shareWith } from './add-transaction';
import { addEvent } from './event-plan';
import { openGoalForm } from './goals';
import { cardSection } from './card-section';
import { todayIn } from './today';

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
  await openAccount(page, { subtype: type, name, extra });
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
  // An account is a line of the kit's list now, not a row of a table: the name and its balance on one line,
  // the actions under them. Every assertion below is the same fact, on the line that has it.
  await openTypes(page);
  await expect(page.getByRole('listitem').filter({ hasText: 'BCA Tahapan' }).first()).toContainText('7.500.000');
});

test('Paid with names each card by its digits, and choosing one sets the account and the card together', async ({ page }) => {
  await addAccount(page, 'BCA KrisFlyer', 'credit_card', async () => {
    await page.getByLabel('Bank', { exact: true }).selectOption('BCA');
    await page.getByLabel('Last 4 digits').fill('1467');
  });
  // A second card on the same account: one statement, two sets of digits.
  await page.goto('/cards');
  await page.getByRole('link', { name: /^BCA KrisFlyer(,|$)/ }).click();
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

  /*
   * The account alone is offered as well, and **last**: it is how a purchase is recorded when the card is not
   * known or not worth saying. It was taken away once without a decision, so the facts are asserted — that it is
   * there, that both cards are too, and that the account's own row comes after them rather than among them.
   *
   * Which of the two cards leads is the query's business, not this function's, so the cards are compared as a
   * set: pinning their order here would assert something `paymentOptions` never promised.
   */
  const offered = await sheet
    .locator('ul > li button')
    .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('aria-label')).filter((label) => label?.includes('BCA KrisFlyer')));
  expect(offered).toHaveLength(3);
  expect(offered.at(-1)).toBe('BCA KrisFlyer');
  expect([...offered.slice(0, 2)].sort()).toEqual(['BCA KrisFlyer ···· 1467', 'BCA KrisFlyer ···· 8802']);

  await sheet.getByRole('button', { name: 'Close' }).click();
  await page.getByRole('dialog', { name: 'Add a transaction' }).getByRole('button', { name: 'Cancel' }).click();

  await addTransaction(page, { description: 'Ranch Market', paidWith: 'BCA KrisFlyer ···· 8802', category: 'Groceries', amount: '450000' });

  // The card, not only the account: the row prints the digits it was charged on.
  const row = page.getByTestId('transaction-row').filter({ hasText: 'Ranch Market' });
  await expect(row).toContainText('8802');
  await expect(row).not.toContainText('1467');

  // And a purchase whose card nobody named is still a purchase: it records against the account, with no digits.
  await addTransaction(page, { description: 'Bakmi GM', paidWith: 'BCA KrisFlyer', category: 'Groceries', amount: '75000' });
  const unnamed = page.getByTestId('transaction-row').filter({ hasText: 'Bakmi GM' });
  await expect(unnamed).toContainText('BCA KrisFlyer');
  await expect(unnamed).not.toContainText('1467');
  await expect(unnamed).not.toContainText('8802');
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
  await openAccount(page, { subtype: 'bank', name, currency, balance, rate, opened: await todayIn(page) });
}

async function addGoal(page: Page, name: string, amount: string, dueOn: string) {
  await page.goto('/goals');
  await openGoalForm(page, 'Education');
  await page.getByLabel('Name', { exact: true }).fill(name);
  await page.getByLabel(/Cost in today's money/).first().fill(amount);
  await page.getByLabel('Needed by').first().fill(dueOn);
  await page.getByRole('button', { name: 'Add goal' }).last().click();
  await expect(page.getByTestId('goal-row').filter({ hasText: name }).first()).toBeVisible();
}

test('a transfer moves money between two accounts and is filed in no workspace', async ({ page }) => {
  await addAccount(page, 'BCA Tahapan', 'bank', async () => {
    await page.getByLabel('Balance now').fill('20000000');
  });
  await addAccount(page, 'Jenius', 'savings', async () => {
    await page.getByLabel('Balance now').fill('0');
  });
  await page.goto('/transactions');

  // §3.5: there is no workspace row on this tab. A transfer touches no category, so the ledger files it nowhere;
  // a row offering to file it would offer something the save cannot honour.
  await page.getByRole('button', { name: 'Add transaction' }).click();
  const form = page.getByRole('dialog', { name: 'Add a transaction' });
  await form.getByRole('radio', { name: 'Transfer', exact: true }).click();
  await expect(form.getByRole('button', { name: 'Workspace for this transaction' })).toHaveCount(0);
  // The hint that keeps a fund purchase off this tab is the To row's own line.
  await expect(form.getByText(/Use Buy \/ sell, so units are counted/)).toBeVisible();
  await form.getByRole('button', { name: 'Cancel' }).click();

  await addTransfer(page, { from: 'BCA Tahapan', to: 'Jenius (IDR)', amount: '500000', note: 'Top up' });

  // Out of one, into the other, to the rupiah.
  await page.goto('/accounts');
  await openTypes(page);
  await expect(page.getByRole('listitem').filter({ hasText: 'BCA Tahapan' }).first()).toContainText('19.500.000');
  await expect(page.getByRole('listitem').filter({ hasText: 'Jenius' }).first()).toContainText('500.000');
});

/**
 * The sixth broken combination, walked end to end: **Transfer + the currency flag**.
 *
 * Before the fix: Transfer → From = BCA Tahapan (IDR) → tap the flag → USD → type 100. The card drew
 * "Charged in IDR" = 1600000 with "≈ 16.000 per 1 USD" under it, Save raised no error, and **Rp 100** moved.
 * Three rows drawn and one honoured, with nothing on screen to say so.
 *
 * Nothing saw it because `addTransfer` never touched the flag and no transfer draft in `tx-form.test.ts` ever
 * set `currency`. This walks the exact path that lost the money, and asserts the figure the row shows is the
 * figure the ledger moves.
 */
test('a transfer offers no currency of its own, and moves the figure its row shows', async ({ page }) => {
  await page.route('https://api.frankfurter.dev/**', (route) => void route.abort());
  await addAccount(page, 'BCA Tahapan', 'bank', async () => {
    await page.getByLabel('Balance now').fill('20000000');
  });
  await addAccount(page, 'Jago', 'bank', async () => {
    await page.getByLabel('Balance now').fill('0');
  });
  // A USD account opened with a balance stores today's USD→IDR rate, which is what used to fill the row in.
  await addForeignAccount(page, 'Wise USD', 'USD', '10', '16000');

  await page.goto('/transactions');
  await page.getByRole('button', { name: 'Add transaction' }).click();
  const form = page.getByRole('dialog', { name: 'Add a transaction' });

  // The flag is offered on Expense, and choosing USD there really does draw the second row. The assertion
  // below turns on the tab rather than on the card having lost a control it never had.
  await form.getByRole('button', { name: 'Paid with' }).click();
  await page.getByRole('dialog', { name: 'Paid with' }).getByRole('button', { name: 'BCA Tahapan', exact: true }).click();
  await form.getByRole('button', { name: 'Currency' }).click();
  await page.getByRole('dialog', { name: 'Currency' }).getByRole('button', { name: 'USD US Dollar' }).first().click();
  await form.getByLabel('Amount', { exact: true }).fill('100');
  await expect(form.getByLabel('Charged in IDR')).toHaveValue('1600000');
  await expect(form.getByText(/per 1 USD/)).toBeVisible();

  // Now Transfer, with USD still on the flag. No flag, no charged row, no rate hint — and the figure already
  // typed is read in the From account's own currency, which is the only one a transfer has.
  await form.getByRole('radio', { name: 'Transfer', exact: true }).click();
  await form.getByRole('button', { name: 'From' }).click();
  await page.getByRole('dialog', { name: 'From' }).getByRole('button', { name: 'BCA Tahapan', exact: true }).click();
  await expect(form.getByRole('button', { name: 'Currency' })).toHaveCount(0);
  await expect(form.getByLabel(/^Charged in/)).toHaveCount(0);
  await expect(form.getByText(/per 1 USD/)).toHaveCount(0);

  // Typed here, on this tab, with the row saying IDR beside it: exactly the keystrokes that moved Rp 100 while
  // the card said Rp 1.600.000. No second figure appears now, whatever is typed.
  await form.getByLabel('Amount', { exact: true }).fill('100');
  await form.getByLabel('To', { exact: true }).selectOption({ label: 'Jago (IDR)' });
  await expect(form.getByLabel(/^Charged in/)).toHaveCount(0);
  await expect(form.getByText(/Charged in/)).toHaveCount(0);
  await form.getByLabel('Note').fill('To Jago');
  await form.getByRole('button', { name: 'Save' }).click();
  await expect(form).toHaveCount(0);

  // Rp 100 was typed and Rp 100 moved. The card used to say Rp 1.600.000 on the row that posts.
  const moved = page.getByTestId('transaction-row').filter({ hasText: 'To Jago' });
  await expect(moved).toContainText('Rp 100');
  await expect(moved).not.toContainText('1.600.000');
  await page.goto('/accounts');
  await openTypes(page);
  await expect(page.getByRole('listitem').filter({ hasText: 'BCA Tahapan' }).first()).toContainText('19.999.900');
  await expect(page.getByRole('listitem').filter({ hasText: 'Jago' }).first()).toContainText('100');
});

test('a transfer into a USD account asks for the received amount, and will not save without it', async ({ page }) => {
  await page.route('https://api.frankfurter.dev/**', (route) => void route.abort());
  await addAccount(page, 'BCA Tahapan', 'bank', async () => {
    await page.getByLabel('Balance now').fill('20000000');
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
  await openTypes(page);
  await expect(page.getByRole('listitem').filter({ hasText: 'Wise USD' }).first()).toContainText('110,00');
  await expect(page.getByRole('listitem').filter({ hasText: 'BCA Tahapan' }).first()).toContainText('18.400.000');
});

test('a transfer tagged For goal parks the money against the goal', async ({ page }) => {
  await addAccount(page, 'BCA Tahapan', 'bank', async () => {
    await page.getByLabel('Balance now').fill('20000000');
  });
  await addAccount(page, 'Jenius', 'savings', async () => {
    await page.getByLabel('Balance now').fill('0');
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
  const TODAY = await todayIn(page);
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
  await openAccount(page, { subtype: 'bank', name: 'Alipay', currency: 'CNY', balance: '1000', rate: '2200', opened: TODAY });

  // Now the day has a rate, so the row opens with the estimate already in it — and it is a figure worked out
  // from the rate, not the figure typed: CNY 100 at 2.200 is Rp 220.000, and CNY 250 is Rp 550.000.
  await typeForeign('100');
  await expect(page.getByLabel('Charged in IDR')).toHaveValue('220000');
  await expect(page.getByText(`\u2248 2.200 per 1 CNY \u00b7 suggested from ${TODAY}`)).toBeVisible();

  await typeForeign('250');
  await expect(page.getByLabel('Charged in IDR')).toHaveValue('550000');
});

/**
 * §2.1: the row that **posts** is driven the way a person drives it — one keystroke at a time.
 *
 * `fill()` sets a whole figure in a single change event, and that is the only way this row had ever been
 * driven. A human types. The pre-fill used to write into the charged row *only while it was empty*, so the
 * first keystroke filled it and every keystroke after was ignored: ¥120 pre-filled **Rp 2.270**, the rate for
 * one yuan, and that is the figure Save would have posted.
 */
test('the charged row follows an amount typed a digit at a time, and that figure is what posts', async ({ page }) => {
  await page.route('https://api.frankfurter.dev/**', (route) => void route.abort());
  await addAccount(page, 'BCA Tahapan', 'bank');
  // A CNY account opened today is what stores today's CNY→IDR rate; nothing else on this device has one.
  await addForeignAccount(page, 'Alipay', 'CNY', '1000', '2270');

  const openForeignForm = async () => {
    await page.goto('/transactions/new');
    await page.getByRole('button', { name: 'Paid with' }).click();
    await page.getByRole('dialog', { name: 'Paid with' }).getByRole('button', { name: 'BCA Tahapan', exact: true }).click();
    await page.getByRole('button', { name: 'Currency' }).click();
    await page.getByRole('dialog', { name: 'Currency' }).getByRole('button', { name: 'CNY Chinese Yuan' }).first().click();
  };

  await openForeignForm();
  const amount = page.getByLabel('Amount', { exact: true });
  const charged = page.getByLabel('Charged in IDR');

  // ¥1 · ¥12 · ¥120 at 2.270 — each keystroke a whole amount in its own right, and the row keeps up with it.
  await amount.pressSequentially('1');
  await expect(charged).toHaveValue('2270');
  await amount.pressSequentially('2');
  await expect(charged).toHaveValue('27240');
  await amount.pressSequentially('0');
  await expect(charged).toHaveValue('272400');

  // And down as well as up: a conversion of an amount that is no longer on screen is the same lie backwards.
  await amount.fill('');
  await expect(charged).toHaveValue('');

  // Once the user writes in the row it is theirs, and no later keystroke in the amount may overwrite it — the
  // figure the bank actually took is the whole reason the row is editable.
  await amount.pressSequentially('120');
  await expect(charged).toHaveValue('272400');
  await charged.fill('275000');
  await amount.fill('130');
  await expect(charged).toHaveValue('275000');

  // The money. Typed the way a person types it, saved without re-reading the row, and read back off the ledger.
  //
  // `delay` is load-bearing, not politeness. `pressSequentially` with no delay puts all three keys in before
  // React has re-rendered once, which makes it a paste again — and a paste is exactly the thing that was always
  // green. At human speed each keystroke is its own render, which is when the row has to keep up.
  await openForeignForm();
  await page.getByLabel('Amount', { exact: true }).pressSequentially('120', { delay: 80 });
  await page.getByRole('button', { name: 'Category' }).click();
  await page.getByRole('dialog', { name: 'Select category' }).getByRole('button', { name: 'Groceries', exact: true }).click();
  await page.getByLabel('Note').fill('Luckin Coffee');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page).toHaveURL(/\/transactions(\?|$)/);
  const row = page.getByTestId('transaction-row').filter({ hasText: 'Luckin Coffee' });
  // Rp 272.400 — what ¥120 converts to. Rp 2.270 is what this posted before, which is 120× short.
  await expect(row).toContainText('272.400');
  await expect(row).toContainText('CN¥120');
  await expect(row).not.toContainText('2.270');
});

/**
 * §2.2 and §2.3: adding somebody to the bill is not allowed to cost the purchase its own facts.
 *
 * `SplitBillInput` had no room for the card or for the original pair, so a US$100 dinner on a particular
 * supplementary card recorded neither: the row printed no digits, the receipt named the bare account, and the
 * "Original amount" line was simply absent. For a user whose points live on which card was tapped, that is the
 * purchase's most valuable fact.
 */
test('a shared bill keeps the card it was charged on, and what the merchant charged', async ({ page }) => {
  await page.route('https://api.frankfurter.dev/**', (route) => void route.abort());
  await addAccount(page, 'KF Signature', 'credit_card', async () => {
    await page.getByLabel('Bank', { exact: true }).selectOption('BCA');
    await page.getByLabel('Last 4 digits').fill('1467');
    await page.getByLabel('Owed now').fill('0');
  });
  // A second card on the same account, so "which card" has a wrong answer available to be caught at.
  await page.goto('/cards');
  await page.getByRole('link', { name: /^KF Signature(,|$)/ }).click();
  await page.getByLabel('Last 4 digits').fill('8802');
  await page.getByLabel('Whose card').fill('Spouse');
  await page.getByRole('button', { name: 'Add card' }).click();
  await expect(page.getByTestId('card-on-account')).toHaveCount(2);

  await page.goto('/transactions');
  await page.getByRole('button', { name: 'Add transaction' }).click();
  const form = page.getByRole('dialog', { name: 'Add a transaction' });
  await form.getByRole('button', { name: 'Paid with' }).click();
  await page.getByRole('dialog', { name: 'Paid with' }).getByRole('button', { name: 'KF Signature ···· 8802', exact: true }).click();
  await form.getByRole('button', { name: 'Currency' }).click();
  await page.getByRole('dialog', { name: 'Currency' }).getByRole('button', { name: 'USD US Dollar' }).first().click();
  await form.getByLabel('Amount', { exact: true }).fill('100');
  await form.getByLabel('Charged in IDR').fill('1600000');
  await form.getByRole('button', { name: 'Category' }).click();
  await page.getByRole('dialog', { name: 'Select category' }).getByRole('button', { name: 'Restaurants', exact: true }).click();
  await form.getByLabel('Note').fill('Dinner with Andi');
  const { more, sheet } = await shareWith(page, form, [{ name: 'Andi', owes: '800000' }]);
  await closeDetails(more, sheet);
  await form.getByRole('button', { name: 'Save' }).click();
  await expect(form).toHaveCount(0);

  const row = page.getByTestId('transaction-row').filter({ hasText: 'Dinner with Andi' });
  await expect(row).toContainText('8802');
  await expect(row).not.toContainText('1467');
  await expect(row).toContainText('US$100,00');

  await page.getByRole('link', { name: 'Receipt for Dinner with Andi' }).click();
  await expect(page.locator('div', { hasText: /^Paid with/ }).last()).toContainText('KF Signature ···· 8802');
  await expect(page.locator('div', { hasText: /^Total/ }).last()).toContainText('1.600.000');
  await expect(page.locator('div', { hasText: /^Original amount/ }).last()).toContainText('US$100,00');

  // It is still a shared bill and not a plain purchase that happened to keep two more columns: Andi owes his half.
  await page.goto('/net-worth/lend-borrow');
  await expect(page.getByText('Andi').first()).toBeVisible();
  await expect(page.getByText('800.000').first()).toBeVisible();
});

/**
 * §2.4: To, For goal and Received amount, which the screen draws together and the save used to walk past.
 *
 * `formToPost` took the goal branch first and ignored `draft.toAmount` — a field the screen marks `required` —
 * so both legs posted the source figure and the user met the ledger's own **`Lines in USD sum to 1600000,
 * expected 0`** after pressing Save, with no money moved. The combination is made to work rather than refused:
 * parking money in a foreign account against a goal is what a multi-currency saver does.
 */
test('a transfer that crosses currencies can be tagged to a goal', async ({ page }) => {
  await page.route('https://api.frankfurter.dev/**', (route) => void route.abort());
  await addAccount(page, 'BCA Tahapan', 'bank', async () => {
    await page.getByLabel('Balance now').fill('20000000');
  });
  await addForeignAccount(page, 'Wise USD', 'USD', '10', '16000');
  await addGoal(page, 'University for Aisyah', '350000000', '2038-07-31');

  await page.goto('/transactions');
  // US$100,03 — an odd number of cents, so a figure read at the wrong scale or rounded the wrong way cannot
  // pass for the right one. Saving at all is the first assertion: this used to end in a raw ledger error.
  await addTransfer(page, {
    from: 'BCA Tahapan',
    to: 'Wise USD (USD)',
    amount: '1600000',
    receivedAmount: '100.03',
    goal: 'University for Aisyah',
    note: 'Parking in USD',
  });
  await expect(page.getByText(/for University for Aisyah/)).toBeVisible();

  // What left and what landed, each in its own account's own money.
  await page.goto('/accounts');
  await openTypes(page);
  await expect(page.getByRole('listitem').filter({ hasText: 'Wise USD' }).first()).toContainText('110,03');
  await expect(page.getByRole('listitem').filter({ hasText: 'BCA Tahapan' }).first()).toContainText('18.400.000');

  // And the goal is funded out of the account the money landed in, for what that set-aside *is*: US$100,03,
  // not the Rp 1.600.000 that left, and not the `Rp 10.003` this page used to paint by printing the account's
  // own minor units under the base-currency symbol. The rupiah translation rides alongside, from the rate
  // typed when the account was opened.
  await page.goto('/goals');
  // The funding line is a row of the goal's own page: the name, what the funding is and the figure are parts of
  // one row rather than one run of text, so the row is named and asked — the same fix `goals.spec.ts` made.
  await page.getByTestId('goal-row').filter({ hasText: 'University for Aisyah' }).first().click();
  await expect(page).toHaveURL(/\/goals\/[^/]+$/);
  const fundedBy = page.getByTestId('goal-link').filter({ hasText: 'Wise USD' }).first();
  await expect(fundedBy).toBeVisible();
  await expect(fundedBy).toContainText('set aside');
  await expect(fundedBy).toContainText('US$100,03');
  await expect(fundedBy).not.toContainText(/Rp\s10\.003/);
  await expect(fundedBy).toContainText(/Rp\s1\.600\.480/);
});

/** A card with real terms, so the points engine has a scheme to measure a purchase against. */
async function catalogueCard(page: Page, name: string, search: string, entryName: string) {
  await page.goto('/cards');
  await page.getByRole('link', { name: new RegExp(`^${name}(,|$)`) }).click();
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
    await page.getByLabel('Owed now').fill('0');
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
  /*
   * And the split itself reached the ledger as **two** categories. This spec set a two-row split up in ten
   * lines and then asserted nothing about where the money was filed: collapsing `splitExpenseLines` to a
   * single line — all 85.000 to Groceries, Restaurants' 45.000 gone — passed this file, the receipt file and
   * lend-borrow, 27 tests, without a murmur. The purchase is excluded, so the chart cannot show the two
   * categories; the receipt names both of them, and names only one when the split has been collapsed.
   */
  await expect(page.getByTestId('receipt-hero')).toContainText('Restaurants · Groceries');
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
  await openTypes(page);
  await expect(page.getByRole('listitem').filter({ hasText: 'KF Signature' }).first()).toContainText('135.000');
  await page.goto('/cards');
  await page.getByRole('link', { name: /^KF Signature(,|$)/ }).click();
  await cardSection(page, 'Points');
  const row = page.getByTestId('purchase').filter({ hasText: 'Superindo' });
  await expect(row).toContainText('MCC 5411 · typed');
});

test('a split is read in the paying account’s own currency, exponent and all', async ({ page }) => {
  await page.route('https://api.frankfurter.dev/**', (route) => void route.abort());
  await addAccount(page, 'Wise Card', 'credit_card', async () => {
    await page.getByLabel('Currency', { exact: true }).selectOption('USD');
    await page.getByLabel('Owed now').fill('0');
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
  // One row taken away leaves one row, counted as one: "1 splits" is what this used to say.
  await more.getByRole('button', { name: 'Split' }).click();
  await split.getByRole('button', { name: 'Remove split 2' }).click();
  await split.getByRole('button', { name: 'Close' }).click();
  await expect(more.getByRole('button', { name: 'Split' })).toContainText('1 split · Total US$40,50');
});

/**
 * Where a split by category actually lands: one ledger line per category, each with its own figure.
 *
 * The extras spec above sets a two-row split up and its purchase is *excluded*, so no chart can show where the
 * money went. This one is not excluded, and it reads the two figures back off the month's own chart — which is
 * built from the ledger, not from the draft. Deliberately uneven (40.000 and 45.000) and deliberately under two
 * different parents, so a split collapsed onto one category, or one whose figures were swapped, reads wrong here
 * rather than reading like a rounding.
 */
test('a split by category posts one line per category, each with its own figure', async ({ page }) => {
  await addAccount(page, 'BCA Tahapan', 'bank', async () => {
    await page.getByLabel('Balance now').fill('50000000');
  });

  await page.goto('/transactions');
  await page.getByRole('button', { name: 'Add transaction' }).click();
  const form = page.getByRole('dialog', { name: 'Add a transaction' });
  await form.getByRole('button', { name: 'Paid with' }).click();
  await page.getByRole('dialog', { name: 'Paid with' }).getByRole('button', { name: 'BCA Tahapan', exact: true }).click();
  await form.getByLabel('Note').fill('Superindo');

  await form.getByRole('button', { name: 'Add more details' }).click();
  const more = page.getByRole('dialog', { name: 'More details' });
  await more.getByRole('button', { name: 'Split' }).click();
  const split = page.getByRole('dialog', { name: 'Split' });
  await split.getByRole('button', { name: '+ Split' }).click();
  await split.getByLabel('Split 1 category').selectOption({ label: 'Groceries' });
  await split.getByLabel('Split 1 amount').fill('40000');
  await split.getByLabel('Split 2 category').selectOption({ label: 'Restaurants' });
  await split.getByLabel('Split 2 amount').fill('45000');
  await split.getByRole('button', { name: 'Close' }).click();
  await more.getByRole('button', { name: 'Close' }).click();
  await form.getByRole('button', { name: 'Save' }).click();
  await expect(form).toHaveCount(0);

  // The whole bill left the account, once.
  await page.goto('/accounts');
  await openTypes(page);
  await expect(page.getByRole('listitem').filter({ hasText: 'BCA Tahapan' }).first()).toContainText('49.915.000');

  // And the month knows which 40.000 was groceries and which 45.000 was a restaurant: Groceries sits under
  // Household and Restaurants under Food and beverage, so the two figures cannot hide in one row.
  await page.goto('/transactions');
  await expect(page.getByTestId('period-total')).toHaveText('Rp 85.000');
  await page.getByTestId('see-categories').click();
  await expect(page.getByTestId('report-row').filter({ hasText: 'Household' })).toContainText('Rp 40.000');
  await expect(page.getByTestId('report-row').filter({ hasText: 'Food and beverage' })).toContainText('Rp 45.000');
});

/**
 * Split by category and With, offered side by side and refused together — in words, before Save.
 *
 * `splitBill` files your own share under one category, so a bill split across several has nowhere to put the
 * rest. Both rows used to be live: setting both posted the bill under the *first* split's category and threw
 * the others away, money and all, with nothing on screen to say so. Now whichever was set first stands and the
 * other row is greyed with the reason under it, so nothing has to be discovered at Save.
 */
test('Split by category and With refuse each other in words, before Save', async ({ page }) => {
  await addAccount(page, 'BCA Tahapan', 'bank', async () => {
    await page.getByLabel('Balance now').fill('50000000');
  });

  await page.goto('/transactions');
  await page.getByRole('button', { name: 'Add transaction' }).click();
  const form = page.getByRole('dialog', { name: 'Add a transaction' });
  await form.getByRole('button', { name: 'Paid with' }).click();
  await page.getByRole('dialog', { name: 'Paid with' }).getByRole('button', { name: 'BCA Tahapan', exact: true }).click();
  await form.getByLabel('Amount', { exact: true }).fill('85000');
  await form.getByRole('button', { name: 'Category' }).click();
  await page.getByRole('dialog', { name: 'Select category' }).getByRole('button', { name: 'Restaurants', exact: true }).click();

  await form.getByRole('button', { name: 'Add more details' }).click();
  const more = page.getByRole('dialog', { name: 'More details' });
  // Both rows are live while neither is set: the combination is offered, and refused only once it is made.
  await expect(more.getByRole('button', { name: 'Split' })).toBeEnabled();
  await expect(more.getByRole('button', { name: 'With', exact: true })).toBeEnabled();

  await more.getByRole('button', { name: 'Split' }).click();
  const split = page.getByRole('dialog', { name: 'Split' });
  await split.getByRole('button', { name: '+ Split' }).click();
  await split.getByLabel('Split 1 amount').fill('50000');
  await split.getByLabel('Split 2 category').selectOption({ label: 'Groceries' });
  await split.getByLabel('Split 2 amount').fill('35000');
  await split.getByRole('button', { name: 'Close' }).click();

  // With is shut, and says why — before Save, not as an error after it.
  await expect(more.getByRole('button', { name: 'With', exact: true })).toBeDisabled();
  await expect(more).toContainText('Remove the splits, or remove the people');
  // Split itself stays open: what was set first is the one that can still be corrected.
  await expect(more.getByRole('button', { name: 'Split' })).toBeEnabled();

  // The way out the words name really is a way out: take the splits off and With is offered again.
  await more.getByRole('button', { name: 'Split' }).click();
  await split.getByRole('button', { name: 'Remove split 2' }).click();
  await split.getByRole('button', { name: 'Remove split 1' }).click();
  await split.getByRole('button', { name: 'Close' }).click();
  await expect(more.getByRole('button', { name: 'With', exact: true })).toBeEnabled();

  // And the refusal goes the other way round too: a person on the bill shuts Split.
  await more.getByRole('button', { name: 'With', exact: true }).click();
  const withSheet = page.getByRole('dialog', { name: 'With', exact: true });
  await withSheet.getByLabel('Add a person').fill('Andi');
  await withSheet.getByRole('button', { name: 'Add', exact: true }).click();
  await withSheet.getByRole('button', { name: 'Close' }).click();
  await expect(more.getByRole('button', { name: 'Split' })).toBeDisabled();
  await expect(more.getByRole('button', { name: 'With', exact: true })).toBeEnabled();

  // …and the bill still saves as a shared bill, whole, under the one category it was given.
  await more.getByRole('button', { name: 'Close' }).click();
  await form.getByLabel('Note').fill('Warung Steak');
  await form.getByRole('button', { name: 'Save' }).click();
  await expect(form).toHaveCount(0);
  await page.goto('/net-worth/lend-borrow');
  await expect(page.getByRole('heading', { name: 'Andi' }).locator('xpath=following-sibling::span')).toContainText('42.500');
});

test('a missing rate is asked for under Add more details, and the save then goes through', async ({ page }) => {
  await page.route('https://api.frankfurter.dev/**', (route) => void route.abort());
  // No balance, so nothing stores a USD→IDR rate on the way in: the save is the first thing to want one.
  await addAccount(page, 'Wise USD', 'bank', async () => {
    await page.getByLabel('Currency', { exact: true }).selectOption('USD');
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
    await page.getByLabel('Owed now').fill('0');
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
  await page.goto('/net-worth/lend-borrow');
  for (const person of ['Andi', 'Budi', 'Citra']) {
    await expect(page.getByRole('heading', { name: person })).toBeVisible();
    // The figure beside that person's own name: each of them owes a quarter, rather than one of them the lot.
    await expect(page.getByRole('heading', { name: person }).locator('xpath=following-sibling::span')).toContainText('100.000');
  }

  // The card was charged the whole 400.000 — what the restaurant took, not what the dinner cost the owner.
  await page.goto('/accounts');
  await openTypes(page);
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
    await page.getByLabel('Balance now').fill('50000000');
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

  await page.goto('/net-worth/lend-borrow');
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
    await page.getByLabel('Owed now').fill('0');
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
  await page.getByRole('dialog', { name: 'Photo' }).getByRole('button', { name: 'Close' }).click();

  /*
   * Reopened for correction, the form shows the picture it already has. It used to say **Photos: None** — the
   * picture was never lost (`movePhotosTx` carries it across a correction) but the one screen that can show or
   * remove it said there was nothing there, which from the user's side is indistinguishable from data loss.
   */
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  const edit = page.getByRole('dialog', { name: 'Edit transaction' });
  await edit.getByRole('button', { name: 'Add more details' }).click();
  const reopened = page.getByRole('dialog', { name: 'More details' });
  await expect(reopened.getByRole('button', { name: 'Photos' })).toContainText('1 photo');
  await reopened.getByRole('button', { name: 'Photos' }).click();
  const photos = page.getByRole('dialog', { name: 'Photos' });
  await expect(photos.getByRole('button', { name: 'Photo 1', exact: true })).toBeVisible();

  // And it is the same picture, not a second one: removing it here really removes it, which is the whole
  // point of it being on screen. Saving the correction leaves the transaction with none.
  await photos.getByRole('button', { name: 'Remove photo 1' }).click();
  await expect(reopened.getByRole('button', { name: 'Photos' })).toContainText('None');
  await closeDetails(reopened, photos);
  await edit.getByRole('button', { name: 'Save' }).click();
  await expect(edit).toHaveCount(0);
  await page.getByRole('link', { name: 'Receipt for Superindo' }).click();
  await expect(page.getByTestId('photo-strip').getByRole('img', { name: 'Receipt photo for Superindo' })).toHaveCount(0);
});

/**
 * B7 and B7a: the picker is the tree, not a flat list — a card per top-level category with its children
 * indented under it — it can be searched, a parent is a real answer, and the category you meant can be made
 * without abandoning the form you are on.
 *
 * It is the one picker. The card's Category row, the edit sheet's and the list's category gesture all open this
 * component, and none of them was touched to get any of it.
 */
test('the category picker is a tree, it searches, and a new category is made without leaving the form', async ({ page }) => {
  await addAccount(page, 'BCA Tahapan', 'bank');
  await page.goto('/transactions');

  await page.getByRole('button', { name: 'Add transaction' }).click();
  const form = page.getByRole('dialog', { name: 'Add a transaction' });
  await form.getByRole('button', { name: /^Category/ }).click();
  const picker = page.getByRole('dialog', { name: 'Select category' });

  // A parent is a row like any other, and its children are drawn indented beneath it — the elbow's own indent,
  // which is what tells a card's children from the cards themselves.
  const parent = picker.getByRole('button', { name: 'Food and beverage', exact: true });
  const child = picker.getByRole('button', { name: 'Restaurants', exact: true });
  await expect(parent).toHaveCSS('padding-left', '14px');
  await expect(child).toHaveCSS('padding-left', '34px');

  // The search narrows on the whole path: a parent brings its children, and nothing else stays.
  const search = picker.getByLabel('Search categories');
  await search.fill('food');
  await expect(child).toHaveCount(1);
  await expect(picker.getByRole('button', { name: 'Groceries', exact: true })).toHaveCount(0);
  await search.fill('');
  await expect(picker.getByRole('button', { name: 'Groceries', exact: true })).toHaveCount(1);

  // Tapping a parent picks the parent. "Food and beverage" is an answer, not a heading.
  await parent.click();
  await expect(picker).toHaveCount(0);
  await expect(form.getByRole('button', { name: /^Category/ })).toContainText('Food and beverage');

  // + New category: the name, where it goes, and the icon it draws.
  await form.getByRole('button', { name: /^Category/ }).click();
  await picker.getByRole('button', { name: 'New category' }).click();
  const made = page.getByRole('dialog', { name: 'New category' });
  await made.getByLabel('Name', { exact: true }).fill('Boba');
  await made.getByLabel('Inside').selectOption({ label: 'Food and beverage' });
  await made.getByRole('button', { name: 'coffee', exact: true }).click();
  await made.getByRole('button', { name: 'Save' }).click();

  // Back on the form with it chosen — no second trip through the picker to say so.
  await expect(picker).toHaveCount(0);
  await expect(form.getByRole('button', { name: /^Category/ })).toContainText('Boba');

  await form.getByRole('button', { name: /^Category/ }).click();
  const boba = picker.getByRole('button', { name: 'Boba', exact: true });
  // Filed under Food and beverage: indented like its siblings, and the whole path is its title.
  await expect(boba).toHaveCSS('padding-left', '34px');
  await expect(boba).toHaveAttribute('title', 'Food and beverage › Boba');
  // And it draws the icon that was picked for it, rather than inheriting its parent's.
  await expect(boba.locator('svg.lucide-coffee')).toHaveCount(1);
  await boba.click();

  await form.getByRole('button', { name: /^(Paid with|Received into)/ }).click();
  await page.getByRole('dialog', { name: /^(Paid with|Received into)$/ }).getByRole('button', { name: 'BCA Tahapan', exact: true }).click();
  await form.getByLabel('Amount', { exact: true }).fill('28000');
  await form.getByLabel('Note').fill('Chatime');
  await form.getByRole('button', { name: 'Save' }).click();
  await expect(form).toHaveCount(0);
  await expect(page.getByTestId('transaction-row').filter({ hasText: 'Chatime' })).toContainText('Boba');

  // And it is a category like the rest: the Categories page lists it under the parent it was filed in.
  await page.goto('/categories');
  await expect(page.getByText('Boba')).toBeVisible();
});

/** A day inside the month on show that is never today, so a date the form ignored reads wrong rather than right. */
const otherDay = (today: string) => `${today.slice(0, 8)}${today.endsWith('-01') ? '02' : '01'}`;

/**
 * §2's field map, walked in one purchase: nothing the old form could record has been lost.
 *
 * Every row here is a field the old `add-transaction.html` had, and each is read back off a screen that is
 * built from the ledger rather than from the draft — the row, the receipt and the card's Points tab. The
 * fields are deliberately set *together*: each of them has only ever been tested on its own path, and the one
 * defect this plan's review found — Split and With, each perfect alone — was a pair nothing crossed.
 *
 * Two of §2's rows cannot join this purchase, and that is the screen's own refusal rather than an omission:
 * Split by category is refused beside With (`SPLIT_WITH_REFUSAL`), and refused again beside a foreign amount,
 * because a split's rows are read in the account's own currency and have nowhere to keep what the merchant
 * charged. Both refusals have their own tests below.
 */
test('nothing was lost: one purchase carries every field the old form had', async ({ page }) => {
  const OTHER_DAY = otherDay(await todayIn(page));
  // No rate server: the figures below are the ones typed, never ones fetched behind the test's back.
  await page.route('https://api.frankfurter.dev/**', (route) => void route.abort());
  await addAccount(page, 'KF Signature', 'credit_card', async () => {
    await page.getByLabel('Bank', { exact: true }).selectOption('BCA');
    await page.getByLabel('Last 4 digits').fill('1467');
    await page.getByLabel('Owed now').fill('0');
  });
  // A second card on the same account, so "which card" is a real question with a wrong answer available.
  await page.goto('/cards');
  await page.getByRole('link', { name: /^KF Signature(,|$)/ }).click();
  await page.getByLabel('Last 4 digits').fill('8802');
  await page.getByLabel('Whose card').fill('Spouse');
  await page.getByRole('button', { name: 'Add card' }).click();
  await expect(page.getByTestId('card-on-account')).toHaveCount(2);
  await catalogueCard(page, 'KF Signature', 'signature', 'BCA Singapore Airlines KrisFlyer Visa Signature');
  await addEvent(page, 'Lebaran');

  await page.goto('/transactions');
  await page.getByRole('button', { name: 'Add transaction' }).click();
  const form = page.getByRole('dialog', { name: 'Add a transaction' });

  // Paid with — and the card of it, not just the account.
  await form.getByRole('button', { name: 'Paid with' }).click();
  await page.getByRole('dialog', { name: 'Paid with' }).getByRole('button', { name: 'KF Signature ···· 8802', exact: true }).click();
  // The flag, the amount in the merchant's currency, and what the bank actually took.
  await form.getByRole('button', { name: 'Currency' }).click();
  await page.getByRole('dialog', { name: 'Currency' }).getByRole('button', { name: 'USD US Dollar' }).first().click();
  await form.getByLabel('Amount', { exact: true }).fill('100');
  await form.getByLabel('Charged in IDR').fill('1600000');
  await form.getByRole('button', { name: 'Category' }).click();
  await page.getByRole('dialog', { name: 'Select category' }).getByRole('button', { name: 'Groceries', exact: true }).click();
  await form.getByLabel('Note').fill('Superindo');
  await form.getByLabel('Date').fill(OTHER_DAY);

  await form.getByRole('button', { name: 'Add more details' }).click();
  const more = page.getByRole('dialog', { name: 'More details' });
  await more.getByRole('button', { name: 'Event' }).click();
  await page.getByRole('dialog', { name: 'Event' }).getByRole('button', { name: 'Lebaran' }).click();
  await more.getByRole('button', { name: 'MCC' }).click();
  const mccSheet = page.getByRole('dialog', { name: 'MCC' });
  await mccSheet.getByLabel('MCC', { exact: true }).fill('5411');
  // Remember for this merchant: the code then belongs to the merchant rather than to this one purchase, which
  // is the whole difference between the two — `typedMcc` clears the purchase's own code when a pattern is set.
  await mccSheet.getByRole('checkbox', { name: /^Remember this MCC/ }).check();
  await expect(mccSheet.getByRole('textbox', { name: 'Merchant text' })).toHaveValue('superindo');
  await mccSheet.getByRole('button', { name: 'Close' }).click();
  await more.getByRole('button', { name: 'Channel' }).click();
  await page.getByRole('dialog', { name: 'Channel' }).getByRole('button', { name: 'Offline' }).click();
  await more.getByRole('button', { name: 'Close' }).click();

  await form.getByRole('button', { name: 'Save' }).click();
  await expect(form).toHaveCount(0);

  // The row: the note, the category, what the account was charged, what the merchant charged, and the digits.
  const row = page.getByTestId('transaction-row').filter({ hasText: 'Superindo' });
  await expect(row).toHaveCount(1);
  await expect(row).toContainText('Groceries');
  await expect(row).toContainText('1.600.000');
  await expect(row).toContainText('US$100,00');
  await expect(row).toContainText('8802');
  // The supplementary's digits, never the primary's: an account lending one card to every purchase on it is
  // exactly the mistake `receiptLines` guards against.
  await expect(row).not.toContainText('1467');

  /*
   * A second purchase on the *other* card of the same account, so the pair of assertions above cannot be
   * satisfied by "whichever card this account lists first". Mutating the row's lookup to the account's first
   * card left the test green until this existed — the two happened to coincide — which is the shape of a test
   * that proves something already true for another reason.
   */
  await addTransaction(page, { description: 'Ranch Market', paidWith: 'KF Signature ···· 1467', category: 'Groceries', amount: '50000' });
  const primary = page.getByTestId('transaction-row').filter({ hasText: 'Ranch Market' });
  await expect(primary).toContainText('1467');
  await expect(primary).not.toContainText('8802');
  // …and the first row did not follow it: two purchases on one account, each carrying its own digits.
  await expect(row).toContainText('8802');

  // The receipt: the same facts again, off the transaction rather than off the row's own summary.
  await page.getByRole('link', { name: 'Receipt for Superindo' }).click();
  await expect(page.locator('div', { hasText: /^Paid with/ }).last()).toContainText('KF Signature ···· 8802');
  await expect(page.locator('div', { hasText: /^Total/ }).last()).toContainText('1.600.000');
  await expect(page.locator('div', { hasText: /^Original amount/ }).last()).toContainText('US$100,00');
  await expect(page.locator('div', { hasText: /^Event/ }).last()).toContainText('Lebaran');
  await expect(page.locator('div', { hasText: /^Channel/ }).last()).toContainText('Offline');
  // The date is the one typed, not the day the test ran: `OTHER_DAY` is never today.
  await expect(page.getByTestId('receipt-hero')).toContainText(String(Number(OTHER_DAY.slice(8, 10))));

  // The other purchase's receipt names the other card, for the same reason the rows do: `receiptLines` has its
  // own card lookup, and one receipt in isolation cannot tell it from "this account's first card".
  await page.goto('/transactions');
  await page.getByRole('link', { name: 'Receipt for Ranch Market' }).click();
  await expect(page.locator('div', { hasText: /^Paid with/ }).last()).toContainText('KF Signature ···· 1467');

  // The MCC: remembered for the merchant rather than typed onto this purchase, which is what the checkbox
  // promised. The points engine reads it back through `resolveMcc`, and says where it came from.
  await page.goto('/cards');
  await page.getByRole('link', { name: /^KF Signature(,|$)/ }).click();
  await cardSection(page, 'Points');
  const purchase = page.getByTestId('purchase').filter({ hasText: 'Superindo' });
  await expect(purchase).toContainText('MCC 5411 · yours');
});

/**
 * Split by category beside a foreign amount — the second pair the two of them make, and the second refusal.
 *
 * A split's rows are typed, summed and posted in the paying account's own currency; §3.3's original pair has
 * one row to live in and a split has none. Refused in words, before Save files the rows at the wrong exponent:
 * `parseMajor` would otherwise answer a USD figure on an IDR card with "IDR allows 0 decimal places", which is
 * an error about exponents where what the user chose was a currency.
 */
test('a split by category refuses a foreign amount in words, and the way out works', async ({ page }) => {
  await page.route('https://api.frankfurter.dev/**', (route) => void route.abort());
  await addAccount(page, 'BCA Visa', 'credit_card', async () => {
    await page.getByLabel('Owed now').fill('0');
  });

  await page.goto('/transactions');
  await page.getByRole('button', { name: 'Add transaction' }).click();
  const form = page.getByRole('dialog', { name: 'Add a transaction' });
  await form.getByRole('button', { name: 'Paid with' }).click();
  await page.getByRole('dialog', { name: 'Paid with' }).getByRole('button', { name: 'BCA Visa', exact: true }).click();
  await form.getByRole('button', { name: 'Currency' }).click();
  await page.getByRole('dialog', { name: 'Currency' }).getByRole('button', { name: 'USD US Dollar' }).first().click();
  await form.getByLabel('Amount', { exact: true }).fill('100');
  await form.getByLabel('Charged in IDR').fill('1600000');
  await form.getByLabel('Note').fill('Superindo');

  await form.getByRole('button', { name: 'Add more details' }).click();
  const more = page.getByRole('dialog', { name: 'More details' });
  await more.getByRole('button', { name: 'Split' }).click();
  const split = page.getByRole('dialog', { name: 'Split' });
  await split.getByRole('button', { name: '+ Split' }).click();
  await split.getByLabel('Split 1 category').selectOption({ label: 'Groceries' });
  await split.getByLabel('Split 1 amount').fill('600000');
  await split.getByLabel('Split 2 category').selectOption({ label: 'Restaurants' });
  await split.getByLabel('Split 2 amount').fill('1000000');
  await split.getByRole('button', { name: 'Close' }).click();
  await more.getByRole('button', { name: 'Close' }).click();

  await form.getByRole('button', { name: 'Save' }).click();
  // In the currency's own words, naming both ways out — not `MoneyError`'s "IDR allows 0 decimal places".
  await expect(form.getByRole('alert')).toContainText('A split is entered in IDR');
  await expect(form.getByRole('alert')).toContainText('remove the split');
  await expect(form.getByRole('alert')).not.toContainText('decimal places');

  // The way out the words name really is one: back to the account's own currency and the split saves, whole.
  await form.getByRole('button', { name: 'Currency' }).click();
  await page.getByRole('dialog', { name: 'Currency' }).getByRole('button', { name: 'IDR Indonesian Rupiah' }).first().click();
  await expect(form.getByLabel('Charged in IDR')).toHaveCount(0);
  await form.getByLabel('Amount', { exact: true }).fill('1600000');
  await form.getByRole('button', { name: 'Save' }).click();
  await expect(form).toHaveCount(0);
  await expect(page.getByTestId('transaction-row').filter({ hasText: 'Superindo' })).toContainText('1.600.000');
  // Both categories, each with its own figure: a split collapsed onto one of them reads wrong here.
  await page.getByTestId('see-categories').click();
  await expect(page.getByTestId('report-row').filter({ hasText: 'Household' })).toContainText('Rp 600.000');
  await expect(page.getByTestId('report-row').filter({ hasText: 'Food and beverage' })).toContainText('Rp 1.000.000');
});

/**
 * §11's asymmetry, both halves, against every reader that is supposed to disagree about one purchase.
 *
 * The extras spec above reads the chart's half. This one adds the two the plan names and nothing asserted: the
 * **budget's** spending, which is a second reader of `categoryRows` and could have been left behind, and the
 * **Excluded pill**, which is the only thing in the list that says why a purchase you can see is missing from
 * your spending. Both purchases are on one card and under one category, so every figure below is the same two
 * numbers read by five different readers — and each reader has to pick the right one of them.
 */
test('an excluded purchase leaves the chart and the budget, keeps the statement and the points, and says so', async ({ page }) => {
  await addAccount(page, 'KF Signature', 'credit_card', async () => {
    await page.getByLabel('Owed now').fill('0');
  });
  await catalogueCard(page, 'KF Signature', 'signature', 'BCA Singapore Airlines KrisFlyer Visa Signature');

  const spend = async (note: string, amount: string, exclude: boolean) => {
    await page.goto('/transactions');
    await page.getByRole('button', { name: 'Add transaction' }).click();
    const form = page.getByRole('dialog', { name: 'Add a transaction' });
    await form.getByRole('button', { name: 'Paid with' }).click();
    await page.getByRole('dialog', { name: 'Paid with' }).getByRole('button', { name: 'KF Signature', exact: true }).click();
    await form.getByLabel('Amount', { exact: true }).fill(amount);
    await form.getByRole('button', { name: 'Category' }).click();
    await page.getByRole('dialog', { name: 'Select category' }).getByRole('button', { name: 'Groceries', exact: true }).click();
    await form.getByLabel('Note').fill(note);
    if (exclude) {
      await form.getByRole('button', { name: 'Add more details' }).click();
      const more = page.getByRole('dialog', { name: 'More details' });
      await more.getByRole('switch', { name: 'Exclude from report' }).click();
      await expect(more.getByRole('switch', { name: 'Exclude from report' })).toHaveAttribute('aria-checked', 'true');
      await more.getByRole('button', { name: 'Close' }).click();
    }
    await form.getByRole('button', { name: 'Save' }).click();
    await expect(form).toHaveCount(0);
  };

  await spend('Ranch Market', '50000', false);
  await spend('Superindo', '85000', true);

  // The list shows both, and says which of them is out — faded and struck through is not readable by a test,
  // so the pill is what has to carry the sentence.
  await page.goto('/transactions');
  const excluded = page.getByTestId('transaction-row').filter({ hasText: 'Superindo' });
  const counted = page.getByTestId('transaction-row').filter({ hasText: 'Ranch Market' });
  await expect(excluded).toContainText('Excluded');
  // Only the excluded one wears it: a pill on every row would pass the line above and mean nothing.
  await expect(counted).not.toContainText('Excluded');

  // Out of the chart: 50.000, never 135.000. The month's total is the figure the ring is drawn from.
  await expect(page.getByTestId('period-total')).toHaveText('Rp 50.000');

  // …and out of the budget, which is a second reader of the same rows. 1.000.000 capped, 50.000 spent.
  await page.goto('/budget');
  await page.getByLabel('Category', { exact: true }).selectOption({ label: 'Household' });
  await page.getByLabel('Monthly amount (IDR)').fill('1000000');
  await page.getByLabel('Just this month').uncheck();
  await page.getByRole('button', { name: 'Set budget' }).click();
  const line = page.getByTestId('line-Household');
  await expect(line).toContainText('50.000');
  await expect(line).not.toContainText('135.000');

  // …while the balance, the statement and the points all still hold both. This is the half the switch must not
  // touch, and the half a "leave it out of everything" reading of the switch would break.
  await page.goto('/accounts');
  await openTypes(page);
  await expect(page.getByRole('listitem').filter({ hasText: 'KF Signature' }).first()).toContainText('135.000');
  await page.goto('/cards');
  await page.getByRole('link', { name: /^KF Signature(,|$)/ }).click();
  await cardSection(page, 'Points');
  await expect(page.getByTestId('purchase').filter({ hasText: 'Superindo' })).toContainText('85.000');
  await expect(page.getByTestId('purchase').filter({ hasText: 'Ranch Market' })).toContainText('50.000');
});

/**
 * §9: a desktop records a purchase with the keyboard alone, and **evaluating is not saving**.
 *
 * The amount field is a real `<input>` running `amountAfterEnter` — the very evaluator the phone's DONE runs —
 * so the first Enter works the expression out and the form stays open. A field that saved on the same press
 * would post whatever the expression happened to read as, which is how a 100x error reaches the ledger by one
 * keystroke. Then the same figure by blur alone, because §9 promises both.
 */
test('the keyboard alone records a purchase, and evaluating is not saving', async ({ page }) => {
  await addAccount(page, 'BCA Tahapan', 'bank');
  await page.goto('/transactions');

  // Tab to the + rather than clicking it: a button no keyboard can reach is a screen a keyboard cannot start.
  const add = page.getByRole('button', { name: 'Add transaction' });
  await page.locator('body').press('Tab');
  for (let step = 0; step < 40 && !(await add.evaluate((el) => el === document.activeElement)); step += 1) {
    await page.keyboard.press('Tab');
  }
  await expect(add).toBeFocused();
  await page.keyboard.press('Enter');
  const form = page.getByRole('dialog', { name: 'Add a transaction' });
  await expect(form).toBeVisible();

  await form.getByRole('button', { name: 'Paid with' }).click();
  await page.getByRole('dialog', { name: 'Paid with' }).getByRole('button', { name: 'BCA Tahapan', exact: true }).click();
  await form.getByRole('button', { name: 'Category' }).click();
  await page.getByRole('dialog', { name: 'Select category' }).getByRole('button', { name: 'Groceries', exact: true }).click();
  await form.getByLabel('Note').fill('Superindo');

  const amount = form.getByLabel('Amount', { exact: true });
  await amount.fill('85000+15000');
  await amount.press('Enter');
  /*
   * The evaluator ran; nothing was saved yet. Both halves matter, and the second one is asserted against the
   * **ledger** rather than against the form: a card whose Enter did submit is still on screen for as long as the
   * write takes, so `expect(form).toBeVisible()` passes for a save already in flight — which it did, under the
   * mutation that made Enter submit. "No such row yet" cannot pass that way.
   */
  await expect(amount).toHaveValue('100000');
  // Save is still pressable, which a card mid-submit's is not — `busy` disables it the instant a save starts.
  await expect(form.getByRole('button', { name: 'Save' })).toBeEnabled();
  await expect(page.getByTestId('transaction-row').filter({ hasText: 'Superindo' })).toHaveCount(0);
  await expect(form).toBeVisible();
  await form.getByRole('button', { name: 'Save' }).click();
  await expect(form).toHaveCount(0);
  await expect(page.getByTestId('transaction-row').filter({ hasText: 'Superindo' })).toContainText('100.000');

  // And the same figure by blur alone: Tab out of the field, and the row still reads 100.000.
  await page.getByRole('button', { name: 'Add transaction' }).click();
  await form.getByRole('button', { name: 'Paid with' }).click();
  await page.getByRole('dialog', { name: 'Paid with' }).getByRole('button', { name: 'BCA Tahapan', exact: true }).click();
  await form.getByRole('button', { name: 'Category' }).click();
  await page.getByRole('dialog', { name: 'Select category' }).getByRole('button', { name: 'Groceries', exact: true }).click();
  await form.getByLabel('Note').fill('Ranch Market');
  const second = form.getByLabel('Amount', { exact: true });
  await second.fill('85000+15000');
  await second.press('Tab');
  await expect(second).toHaveValue('100000');
  await form.getByRole('button', { name: 'Save' }).click();
  await expect(form).toHaveCount(0);
  await expect(page.getByTestId('transaction-row').filter({ hasText: 'Ranch Market' })).toContainText('100.000');
});

/**
 * Event, Photos and Exclude on one purchase — the third combination, and the one whose halves are furthest
 * apart: the event is a column on `transactions`, the exclusion a row in `transaction_flags`, and the picture
 * a row in `transaction_photos` with its bytes in OPFS. Three writers, one database transaction, one Save.
 *
 * Excluded is deliberately *on* while the photo is attached: `writeExtrasTx` writes the flag and the photo rows
 * in the same call, and a flag written where the photo rows should be is a receipt with no picture on it.
 */
test('an event, a photograph and the exclusion survive one save together', async ({ page }) => {
  await addAccount(page, 'BCA Visa', 'credit_card', async () => {
    await page.getByLabel('Owed now').fill('0');
  });
  await addEvent(page, 'Lebaran');

  await page.goto('/transactions');
  await page.getByRole('button', { name: 'Add transaction' }).click();
  const form = page.getByRole('dialog', { name: 'Add a transaction' });
  await form.getByRole('button', { name: 'Paid with' }).click();
  await page.getByRole('dialog', { name: 'Paid with' }).getByRole('button', { name: 'BCA Visa', exact: true }).click();
  await form.getByLabel('Amount', { exact: true }).fill('85000');
  await form.getByRole('button', { name: 'Category' }).click();
  await page.getByRole('dialog', { name: 'Select category' }).getByRole('button', { name: 'Groceries', exact: true }).click();
  await form.getByLabel('Note').fill('Superindo');

  const { more, sheet } = await attachPhoto(page, form, { name: 'receipt.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('a Lebaran receipt') });
  await sheet.getByRole('button', { name: 'Close' }).click();
  await more.getByRole('button', { name: 'Event' }).click();
  await page.getByRole('dialog', { name: 'Event' }).getByRole('button', { name: 'Lebaran' }).click();
  await more.getByRole('switch', { name: 'Exclude from report' }).click();
  await expect(more.getByRole('button', { name: 'Photos' })).toContainText('1 photo');
  await more.getByRole('button', { name: 'Close' }).click();
  await form.getByRole('button', { name: 'Save' }).click();
  await expect(form).toHaveCount(0);

  await page.getByRole('link', { name: 'Receipt for Superindo' }).click();
  await expect(page.locator('div', { hasText: /^Event/ }).last()).toContainText('Lebaran');
  await expect(page.getByTestId('excluded-note')).toContainText('Excluded from the chart and budgets');
  // The bytes, off this device's own OPFS — not merely a row saying a picture exists.
  const picture = page.getByTestId('photo-strip').getByRole('img', { name: 'Receipt photo for Superindo' });
  await expect(picture).toHaveCount(1);
  expect(await picture.evaluate(async (img: HTMLImageElement) => (await fetch(img.src)).text())).toBe('a Lebaran receipt');
});

/**
 * An edit that changes the mode: the fourth combination, and the one where a field is supposed to be dropped.
 *
 * A card's facts belong to a purchase. Turning one into income — a refund landing back on the card — must take
 * the MCC and the card with it, or the row keeps facts its own shape can no longer explain. Everything that is
 * **not** a card's fact has to survive the same save: the channel and the exclusion live in `transaction_flags`,
 * the event on the transaction, and the picture in `transaction_photos` — and `replaceTransaction` carries each
 * of them onto a brand-new id. This is the one place all four are asked to travel at once.
 */
test('an edit that turns a purchase into income drops the card’s facts and keeps the rest', async ({ page }) => {
  await addAccount(page, 'KF Signature', 'credit_card', async () => {
    await page.getByLabel('Owed now').fill('0');
  });
  // Real terms, so the Points tab has a scheme to list the purchase against — and so the MCC is readable there.
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
  await more.getByRole('button', { name: 'MCC' }).click();
  const mccSheet = page.getByRole('dialog', { name: 'MCC' });
  await mccSheet.getByLabel('MCC', { exact: true }).fill('5411');
  await mccSheet.getByRole('button', { name: 'Close' }).click();
  await more.getByRole('button', { name: 'Channel' }).click();
  await page.getByRole('dialog', { name: 'Channel' }).getByRole('button', { name: 'Online' }).click();
  await more.getByRole('switch', { name: 'Exclude from report' }).click();
  await more.getByRole('button', { name: 'Close' }).click();
  await form.getByRole('button', { name: 'Save' }).click();
  await expect(form).toHaveCount(0);

  // It really is a card purchase with an MCC first, or the drop below proves nothing.
  await page.goto('/cards');
  await page.getByRole('link', { name: /^KF Signature(,|$)/ }).click();
  await cardSection(page, 'Points');
  await expect(page.getByTestId('purchase').filter({ hasText: 'Superindo' })).toContainText('MCC 5411 · typed');

  // The refund, made from the receipt the purchase already has.
  await page.goto('/transactions');
  await page.getByRole('link', { name: 'Receipt for Superindo' }).click();
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  const edit = page.getByRole('dialog', { name: 'Edit transaction' });
  await edit.getByRole('radio', { name: 'Income' }).click();
  // Changing the tab clears the category, because a category of the old shape cannot answer the new one.
  await edit.getByRole('button', { name: /^Category/ }).click();
  await page.getByRole('dialog', { name: 'Select category' }).getByRole('button', { name: 'Cashback & Rewards', exact: true }).click();
  await edit.getByRole('button', { name: 'Save' }).click();
  await expect(edit).toHaveCount(0);

  // The card's own facts are gone with the purchase: no MCC, and no card on the row.
  await page.goto('/cards');
  await page.getByRole('link', { name: /^KF Signature(,|$)/ }).click();
  await cardSection(page, 'Points');
  await expect(page.getByTestId('purchase').filter({ hasText: 'Superindo' })).toHaveCount(0);

  // Everything that was never a card's fact came across to the new id, all four at once.
  await page.goto('/transactions');
  await page.getByRole('link', { name: 'Receipt for Superindo' }).click();
  await expect(page.locator('div', { hasText: /^Paid into/ }).last()).toContainText('KF Signature');
  await expect(page.locator('div', { hasText: /^Event/ }).last()).toContainText('Lebaran');
  await expect(page.locator('div', { hasText: /^Channel/ }).last()).toContainText('Online');
  await expect(page.getByTestId('excluded-note')).toContainText('Excluded from the chart and budgets');
});
