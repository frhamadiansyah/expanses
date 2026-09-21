import { expect, type Page, test } from '@playwright/test';
import { addPurchase, addTransaction, attachPhoto } from './add-transaction';

test.beforeEach(({ page }) => {
  page.on('dialog', (dialog) => void dialog.accept());
});

async function addAccount(page: Page, name: string, type: string, balanceLabel: string, amount: string) {
  await page.goto('/accounts');
  await page.getByLabel('Name', { exact: true }).fill(name);
  await page.getByLabel('Type').selectOption(type);
  await page.getByLabel(balanceLabel).fill(amount);
  await page.getByRole('button', { name: 'Add account' }).click();
  await expect(page.getByRole('link', { name, exact: true })).toBeVisible();
}

async function addGold(page: Page) {
  await page.goto('/net-worth/assets');
  await page.getByRole('button', { name: 'Add asset' }).click();
  await page.getByLabel('What is it?').selectOption('gold');
  await page.getByLabel('Name', { exact: true }).fill('Antam gold bars');
  await page.getByLabel('Bought on').fill('2026-03-09');
  await page.getByLabel('How much').fill('10');
  await page.getByLabel('Total cost (IDR)').fill('18600000');
  await page.getByRole('button', { name: 'Add asset' }).last().click();
  await expect(page.getByRole('link', { name: /Antam gold bars/ })).toBeVisible();
}

async function addStock(page: Page) {
  await page.goto('/net-worth/assets');
  await page.getByRole('button', { name: 'Add asset' }).click();
  await page.getByLabel('What is it?').selectOption('stock');
  await page.getByLabel('Name', { exact: true }).fill('BBRI shares');
  // Two lots owned before today, so the holding is listed; they are paid from Opening Balances.
  await page.getByLabel('Bought on').fill('2026-03-09');
  await page.getByLabel('How much').fill('200');
  await page.getByLabel('Total cost (IDR)').fill('1900000');
  await page.getByRole('button', { name: 'Add asset' }).last().click();
  await expect(page.getByRole('link', { name: /BBRI shares/ })).toBeVisible();
}

test('records a purchase from the transaction window, and it never counts as spending', async ({ page }) => {
  await addAccount(page, 'BCA Tahapan', 'bank', 'Current balance', '50000000');
  await addGold(page);

  await page.goto('/transactions');
  await page.getByRole('button', { name: 'Add transaction' }).click();
  const form = page.getByRole('dialog', { name: 'Add a transaction' });
  await form.getByRole('radio', { name: 'Buy or sell' }).click();
  await form.getByLabel('Grams').fill('2');
  await form.getByLabel(/What it cost, before fees/).fill('3980000');
  await form.getByLabel('Paid with').first().selectOption({ label: 'BCA Tahapan (IDR)' });
  await form.getByRole('button', { name: 'Save' }).click();
  await expect(form).toHaveCount(0);

  // The purchase shows as a purchase, not as spending.
  await expect(page.getByText('Bought 2 Antam gold bars')).toBeVisible();
  const row = page.locator('li', { hasText: 'Bought 2 Antam gold bars' }).last();
  await expect(row.getByRole('link', { name: 'Buy & sell' })).toBeVisible();

  // Cash fell by what it cost, and the gold is held at cost: net worth is unchanged.
  await page.goto('/net-worth');
  await expect(page.getByTestId('net-worth')).toContainText('68.600.000');
  await page.goto('/net-worth/trades');
  await expect(page.getByText('12 g').first()).toBeVisible();
});

test('pays for a purchase with the credit card, so the card owes more and the points still count', async ({ page }) => {
  await addAccount(page, 'BCA Tahapan', 'bank', 'Current balance', '50000000');
  await addAccount(page, 'BCA KrisFlyer', 'credit_card', 'Amount owed now', '0');
  await addGold(page);

  await page.goto('/transactions');
  await page.getByRole('button', { name: 'Add transaction' }).click();
  const form = page.getByRole('dialog', { name: 'Add a transaction' });
  await form.getByRole('radio', { name: 'Buy or sell' }).click();
  await form.getByLabel('Grams').fill('2');
  await form.getByLabel(/What it cost, before fees/).fill('3980000');
  await form.getByLabel('Paid with').first().selectOption({ label: 'BCA KrisFlyer (IDR)' });
  await form.getByLabel('MCC').fill('5944');
  await form.getByRole('button', { name: 'Save' }).click();
  await expect(form).toHaveCount(0);
  await expect(page.getByText('Bought 2 Antam gold bars')).toBeVisible();

  // The card now owes the purchase, and the bank was never touched.
  await page.goto('/net-worth');
  await expect(page.getByText(/3\.980\.000/).first()).toBeVisible();
  await expect(page.getByTestId('net-worth')).toContainText('68.600.000');
});

test('a transfer cannot land in a holding measured in units', async ({ page }) => {
  await addAccount(page, 'BCA Tahapan', 'bank', 'Current balance', '50000000');
  await addGold(page);

  await page.goto('/transactions');
  await page.getByRole('button', { name: 'Add transaction' }).click();
  const form = page.getByRole('dialog', { name: 'Add a transaction' });
  await form.getByRole('radio', { name: 'Transfer' }).click();
  // Exactly "To": the chart above the form labels itself "… Total spent", which a loose match also catches.
  await expect(form.getByLabel('To', { exact: true })).not.toContainText('Antam gold bars');
  await expect(form.getByText(/Use Buy or sell, so units are counted/)).toBeVisible();
});

test('turns an expense already recorded into the purchase it really was', async ({ page }) => {
  await addAccount(page, 'BCA Tahapan', 'bank', 'Current balance', '50000000');
  await addGold(page);

  await page.goto('/transactions');
  await addTransaction(page, { description: 'UBS Gold Store', paidWith: 'BCA Tahapan', category: 'Shopping', amount: '3980000' });
  await expect(page.getByText('UBS Gold Store')).toBeVisible();

  // The row opens where it is; turning it into a purchase is one of the things it offers there.
  await page.locator('li', { hasText: 'UBS Gold Store' }).last().click();
  await page.getByRole('button', { name: 'This was a purchase' }).click();
  await page.getByLabel('Units, shares or grams').fill('2');
  await page.getByRole('button', { name: 'Save as a purchase' }).click();

  await expect(page.getByText('Bought 2 Antam gold bars')).toBeVisible();
  await page.goto('/net-worth/trades');
  await expect(page.getByText('12 g').first()).toBeVisible();
});

test('parks money at the broker for a goal, then buys one lot and the leftover keeps waiting', async ({ page }) => {
  await addAccount(page, 'BCA Tahapan', 'bank', 'Current balance', '50000000');
  await addAccount(page, 'RDN Stockbit', 'bank', 'Current balance', '0');
  await addStock(page);

  // Broker cash is money meant to be invested, not the emergency buffer.
  await page.goto('/net-worth/assets');
  await page.getByRole('link', { name: /RDN Stockbit/ }).click();
  await page.getByLabel('Counts as').selectOption('invest');
  await page.getByRole('button', { name: 'Save settings' }).click();
  await expect(page.getByText('Saved.')).toBeVisible();

  await page.goto('/goals');
  await page.getByRole('button', { name: 'Add goal' }).first().click();
  await page.getByLabel('What kind of goal').selectOption('education');
  await page.getByLabel('Name', { exact: true }).fill('University for Aisyah');
  await page.getByLabel(/Cost in today's money/).first().fill('350000000');
  await page.getByLabel('Needed by').first().fill('2038-07-31');
  await page.getByRole('button', { name: 'Add goal' }).last().click();
  await expect(page.getByRole('heading', { name: 'University for Aisyah' })).toBeVisible();

  await page.goto('/transactions');
  await page.getByRole('button', { name: 'Add transaction' }).click();
  const form = page.getByRole('dialog', { name: 'Add a transaction' });
  await form.getByRole('radio', { name: 'Transfer' }).click();
  await form.getByRole('button', { name: 'From' }).click();
  await page.getByRole('dialog', { name: 'From' }).getByRole('button', { name: 'BCA Tahapan', exact: true }).click();
  await form.getByLabel('To', { exact: true }).selectOption({ label: 'RDN Stockbit (IDR)' });
  await form.getByLabel('Amount', { exact: true }).fill('2000000');
  await form.getByLabel('For goal').selectOption({ label: 'University for Aisyah' });
  await form.getByRole('button', { name: 'Save' }).click();
  await expect(form).toHaveCount(0);
  // The row carries the goal once the write has landed, so the next page cannot read a stale database.
  await expect(page.getByText(/for University for Aisyah/)).toBeVisible();

  // Parked money is set aside for the goal straight away.
  await page.goto('/goals');
  await expect(page.getByText(/2\.000\.000/).first()).toBeVisible();

  // One lot of 100 shares at Rp 9.889,81 leaves Rp 1.011.019 behind.
  await page.goto('/transactions');
  await page.getByRole('button', { name: 'Add transaction' }).click();
  const buying = page.getByRole('dialog', { name: 'Add a transaction' });
  await buying.getByRole('radio', { name: 'Buy or sell' }).click();
  await buying.getByLabel('What you bought or sold').selectOption({ label: 'Investments › BBRI shares' });
  await buying.getByLabel('Lots').fill('1');
  await buying.getByLabel(/What it cost, before fees/).fill('988981');
  await buying.getByLabel('Paid with').first().selectOption({ label: 'RDN Stockbit (IDR)' });
  await buying.getByLabel('For goal').selectOption({ label: 'University for Aisyah' });
  await buying.getByRole('button', { name: 'Save' }).click();
  await expect(buying).toHaveCount(0);
  await expect(page.getByText('Bought 100 BBRI shares')).toBeVisible();

  // The leftover is still waiting at the broker, and the Overview says so.
  await page.goto('/net-worth');
  await expect(page.getByText(/1\.011\.019 has been waiting in RDN Stockbit/)).toBeVisible();
});

async function addGoal(page: Page, kind: string, name: string, amount: string, dueOn: string) {
  await page.goto('/goals');
  await page.getByRole('button', { name: 'Add goal' }).first().click();
  await page.getByLabel('What kind of goal').selectOption(kind);
  await page.getByLabel('Name', { exact: true }).fill(name);
  await page.getByLabel(/Cost in today's money/).first().fill(amount);
  await page.getByLabel('Needed by').first().fill(dueOn);
  await page.getByRole('button', { name: 'Add goal' }).last().click();
  await expect(page.getByRole('heading', { name })).toBeVisible();
}

test('a card purchase with a fee, tagged to a goal, moves the units, the goal and what the card owes', async ({ page }) => {
  await addAccount(page, 'BCA Tahapan', 'bank', 'Current balance', '50000000');
  await addAccount(page, 'BCA KrisFlyer', 'credit_card', 'Amount owed now', '0');
  await addGold(page);
  await addGoal(page, 'hajj', 'Hajj fund', '50000000', '2028-06-30');

  await page.goto('/transactions');
  await addPurchase(page, {
    what: 'Antam gold bars',
    amount: '3980000',
    units: '2',
    fee: '15000',
    paidWith: 'BCA KrisFlyer (IDR)',
    goal: 'Hajj fund',
    pointsCategory: 'Shopping (general)',
    mcc: '5944',
  });

  // Units first: 10 g were already held, so 2 more make 12.
  await expect(page.getByText('Bought 2 Antam gold bars')).toBeVisible();
  await page.goto('/net-worth/trades');
  await expect(page.getByText('12 g').first()).toBeVisible();

  // The goal has the two grams against it — the whole point of tagging the buy. The figure beside them is a
  // valuation and moves with the price; what the tag decides is which goal the units belong to.
  await page.goto('/goals');
  await expect(page.getByText('Antam gold bars · 2 tagged for Hajj fund')).toBeVisible();

  // The card owes the cost **and the fee** — 3.980.000 + 15.000 — and the bank was never touched.
  await page.goto('/accounts');
  await expect(page.getByRole('listitem').filter({ hasText: 'BCA KrisFlyer' }).first()).toContainText('3.995.000');
  await expect(page.getByRole('listitem').filter({ hasText: 'BCA Tahapan' }).first()).toContainText('50.000.000');

  // And the refusals come with it: a trade's money half is corrected on Buy & sell or not at all. The receipt is
  // reached by the ⓘ at the end of the row — clicking the row itself edits in place on a desktop and opens
  // nothing here, which would make every assertion below it pass without ever loading the page they are about.
  await page.goto('/transactions');
  await page.getByRole('link', { name: 'Receipt for Bought 2 Antam gold bars' }).click();
  await expect(page).toHaveURL(/\/transactions\/[0-9a-zA-Z-]{20,}$/);
  // The two assertions above are the anchor the three below need: a `toHaveCount(0)` run the instant after a
  // navigation passes on a page that has not drawn yet, whatever the page would eventually have shown.
  await expect(page.getByTestId('receipt-hero')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Buy & sell' })).toBeVisible();
  // Both ways in: the round button in the header and the one in the footer are gated separately, and a trade
  // that lost only one of the two guards would still be editable from the other.
  await expect(page.getByRole('button', { name: 'Edit this transaction' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Edit', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Delete this transaction' })).toHaveCount(0);
});

test('a sale pays its proceeds into a bank account and takes the units back out', async ({ page }) => {
  await addAccount(page, 'BCA Tahapan', 'bank', 'Current balance', '50000000');
  await addGold(page);

  await page.goto('/transactions');
  await addPurchase(page, { what: 'Antam gold bars', mode: 'sell', amount: '4200000', units: '2', paidWith: 'BCA Tahapan (IDR)' });

  await expect(page.getByText('Sold 2 Antam gold bars')).toBeVisible();
  // 10 g less the 2 sold, and the proceeds are in the bank.
  await page.goto('/net-worth/trades');
  await expect(page.getByText('8 g').first()).toBeVisible();
  await page.goto('/accounts');
  await expect(page.getByRole('listitem').filter({ hasText: 'BCA Tahapan' }).first()).toContainText('54.200.000');
});

test('a purchase paid by card reaches the points engine with the MCC and category it was given', async ({ page }) => {
  await addAccount(page, 'KF Signature', 'credit_card', 'Amount owed now', '0');
  await addGold(page);

  // A card with real terms, so there is a points scheme for the purchase to be measured against.
  await page.goto('/cards');
  await page.getByRole('link', { name: 'KF Signature', exact: true }).click();
  await page.getByLabel('Billing date').fill('25');
  await page.getByLabel('Due date').fill('12');
  await page.getByRole('button', { name: 'Save terms' }).click();
  await page.getByLabel('Search catalogue').fill('signature');
  await page.getByRole('button', { name: 'BCA Singapore Airlines KrisFlyer Visa Signature', exact: true }).click();
  await page.getByRole('button', { name: 'Use these terms' }).click();
  await expect(page.getByText('From catalogue · Linked')).toBeVisible();

  await page.goto('/transactions');
  await addPurchase(page, {
    what: 'Antam gold bars',
    amount: '1350000',
    units: '1',
    paidWith: 'KF Signature (IDR)',
    pointsCategory: 'Shopping (general)',
    mcc: '5944',
  });

  await page.goto('/cards');
  await page.getByRole('link', { name: 'KF Signature', exact: true }).click();
  await page.getByRole('radio', { name: 'Points' }).click();
  // Units are recorded, so this is not spending — and it is still a card purchase, so it still earns.
  const row = page.locator('li:not([data-testid="statement-line"])', { hasText: 'Bought 1 Antam gold bars' });
  await expect(row).toContainText('MCC 5944 · typed');
  // Rp 1.350.000 on this card is 100 miles. Nought would mean the category never reached the engine.
  await expect(row).toContainText('100 miles');
});

/**
 * §4 scopes Photos and Exclude from report to "always", and `extraRows` answers both for a trade — but the card
 * drew "Add more details" inside the expense branch alone, so the Buy or sell tab computed two rows that nothing
 * ever drew. A contract note could not be kept with the purchase it belongs to, and `purchaseDraftToInput` had
 * nowhere to take either fact from.
 *
 * Both halves are read back off the receipt, which is built from what was stored rather than from the draft.
 */
test('a purchase can keep its contract note and be left out of the report', async ({ page }) => {
  await addAccount(page, 'BCA Tahapan', 'bank', 'Current balance', '50000000');
  await addGold(page);

  await page.goto('/transactions');
  await page.getByRole('button', { name: 'Add transaction' }).click();
  const form = page.getByRole('dialog', { name: 'Add a transaction' });
  await form.getByRole('radio', { name: 'Buy or sell' }).click();
  await form.getByLabel('Grams').fill('2');
  await form.getByLabel(/What it cost, before fees/).fill('3980000');
  await form.getByLabel('Paid with').first().selectOption({ label: 'BCA Tahapan (IDR)' });

  // The very same row the other three tabs carry, opening the very same sheet.
  const { more, sheet } = await attachPhoto(page, form, { name: 'note.png', mimeType: 'image/png', buffer: Buffer.from('a contract note') });
  await sheet.getByRole('button', { name: 'Close' }).click();
  await expect(more.getByRole('button', { name: 'Photos' })).toContainText('1 photo');
  await more.getByRole('switch', { name: 'Exclude from report' }).click();
  await more.getByRole('button', { name: 'Close' }).click();
  await form.getByRole('button', { name: 'Save' }).click();
  await expect(form).toHaveCount(0);

  await page.getByRole('link', { name: 'Receipt for Bought 2 Antam gold bars' }).click();
  await expect(page.getByTestId('receipt-hero')).toBeVisible();
  // The picture is on the transaction, and the exclusion was stored with it: neither was dropped on the way.
  await expect(page.getByTestId('photo-strip').getByRole('img')).toHaveCount(1);
  await expect(page.getByTestId('excluded-note')).toBeVisible();
});
