import { expect, type Page, test } from '@playwright/test';
import { addTransaction } from './add-transaction';

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
