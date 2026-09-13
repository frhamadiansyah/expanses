import { expect, type Page, test } from '@playwright/test';

test.beforeEach(({ page }) => {
  page.on('dialog', (dialog) => void dialog.accept());
});

async function addCard(page: Page, name: string) {
  await page.goto('/accounts');
  await page.getByLabel('Name', { exact: true }).fill(name);
  await page.getByLabel('Type').selectOption('credit_card');
  await page.getByRole('button', { name: 'Add account' }).click();
  await expect(page.getByRole('link', { name, exact: true })).toBeVisible();
}

async function openCard(page: Page, name: string) {
  await page.goto('/cards');
  await page.getByRole('link', { name, exact: true }).click();
  await expect(page.getByRole('heading', { name })).toBeVisible();
}

async function applyCatalogue(page: Page, card: string, search: string, entryName: string) {
  await openCard(page, card);
  await page.getByLabel('Statement day').fill('25');
  await page.getByLabel('Payment due day').fill('12');
  await page.getByRole('button', { name: 'Save terms' }).click();
  await page.getByLabel('Search catalogue').fill(search);
  await page.getByRole('button', { name: entryName, exact: true }).click();
  await page.getByRole('button', { name: 'Use these terms' }).click();
  await expect(page.getByText('From catalogue · Linked')).toBeVisible();
}

interface Purchase {
  card: string;
  description: string;
  category: string;
  amount: string;
  on?: string;
  mcc?: string;
  remember?: string;
}

async function buy(page: Page, p: Purchase) {
  await page.goto('/transactions');
  await page.getByRole('button', { name: 'Add transaction' }).click();
  if (p.on) await page.getByLabel('Date').fill(p.on);
  await page.getByLabel('Description').fill(p.description);
  await page.getByLabel('Paid with').selectOption({ label: `${p.card} (IDR)` });
  await page.getByLabel('Category').selectOption({ label: p.category });
  await page.getByLabel('Amount', { exact: true }).fill(p.amount);
  if (p.mcc) {
    await page.getByText('Card purchase details').click();
    await page.getByLabel('MCC', { exact: true }).fill(p.mcc);
    if (p.remember) {
      await page.getByLabel('Remember this MCC for every purchase containing the merchant text').check();
      await page.getByLabel('Merchant text', { exact: true }).fill(p.remember);
    }
  }
  await page.getByRole('button', { name: 'Save' }).click();
  // The form closes once the purchase is saved; a purchase dated in another month is not in this month's list.
  await expect(page.getByRole('button', { name: 'Add transaction' })).toBeVisible();
  if (!p.on) await expect(page.getByText(p.description)).toBeVisible();
}

const thisCycle = (page: Page) => page.locator('section', { has: page.getByRole('heading', { name: /^This cycle:/ }) });
const purchaseRow = (page: Page, description: string) => page.locator('li', { hasText: description });

/** A date in the statement cycle before the current one, for a card whose statement closes on day 25. */
function lastCycleDate(): string {
  const today = new Date();
  const date = new Date(today.getFullYear(), today.getMonth() - (today.getDate() > 25 ? 0 : 1), 15);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

test('remembering a merchant MCC removes the Maybank Platinum extra from past purchases too', async ({ page }) => {
  await addCard(page, 'Maybank Platinum');
  await applyCatalogue(page, 'Maybank Platinum', 'platinum', 'Maybank Kartu Kredit Visa Platinum');
  await buy(page, { card: 'Maybank Platinum', description: 'BURGER BANGOR KEMANG', category: 'Restaurants', amount: '60000' });

  await openCard(page, 'Maybank Platinum');
  // Restaurants defaults to MCC 5812: 3 base plus 6 extra at restaurants.
  await expect(purchaseRow(page, 'BURGER BANGOR KEMANG')).toContainText('9 points');
  await expect(purchaseRow(page, 'BURGER BANGOR KEMANG')).toContainText('MCC 5812 · category guess');

  await buy(page, { card: 'Maybank Platinum', description: 'BURGER BANGOR PIM', category: 'Restaurants', amount: '60000', mcc: '5814', remember: 'burger bangor' });
  await openCard(page, 'Maybank Platinum');
  await expect(purchaseRow(page, 'BURGER BANGOR KEMANG')).toContainText('0 points');
  await expect(purchaseRow(page, 'BURGER BANGOR KEMANG')).toContainText('MCC 5814 · yours');
});

test('a per-purchase actual of 0 suggests fast food, and remembering it matches the bank', async ({ page }) => {
  await addCard(page, 'Maybank Platinum');
  await applyCatalogue(page, 'Maybank Platinum', 'platinum', 'Maybank Kartu Kredit Visa Platinum');
  await buy(page, { card: 'Maybank Platinum', description: 'WARUNG STEAK JKT', category: 'Restaurants', amount: '60000' });

  await openCard(page, 'Maybank Platinum');
  const row = purchaseRow(page, 'WARUNG STEAK JKT');
  await row.getByLabel('Actual points for WARUNG STEAK JKT').fill('0');
  await row.getByRole('button', { name: 'Save actual for WARUNG STEAK JKT' }).click();
  await expect(row).toContainText('WARUNG STEAK JKT as MCC 5814 Fast Food Restaurants would earn 0 points');
  await row.getByRole('button', { name: 'Remember “warung steak jkt” as 5814' }).click();
  await expect(row).toContainText('MCC 5814 · yours');
  await expect(row).toContainText('Matches the bank');
});

test('a BMW dealer purchase earns 1 TREATS Point per Rp 3.333', async ({ page }) => {
  await addCard(page, 'BMW Card');
  await applyCatalogue(page, 'BMW Card', 'bmw', 'BMW Maybank Kartu Kredit');
  await buy(page, { card: 'BMW Card', description: 'BMW ASTRA CILANDAK', category: 'Miscellaneous (general)', amount: '3333000' });
  await openCard(page, 'BMW Card');
  await expect(thisCycle(page)).toContainText(/At BMW dealers\s*Rp\s3\.333\.000 → 1\.000 points/);
});

test('a shoe store purchase typed as MCC 5661 earns the Manchester United sports extra', async ({ page }) => {
  await addCard(page, 'MU Card');
  await applyCatalogue(page, 'MU Card', 'manchester', 'Maybank Kartu Kredit Manchester United');
  await buy(page, { card: 'MU Card', description: 'SEPATU KITA', category: 'Clothing', amount: '200000', mcc: '5661' });
  await openCard(page, 'MU Card');
  await expect(thisCycle(page)).toContainText(/3x at sports merchants\s*Rp\s200\.000 → 20 points/);
  await expect(purchaseRow(page, 'SEPATU KITA')).toContainText('30 points');
});

test('a BCA statement total that differs lists likely causes', async ({ page }) => {
  await addCard(page, 'KF Signature');
  await applyCatalogue(page, 'KF Signature', 'signature', 'BCA Singapore Airlines KrisFlyer Visa Signature');
  await buy(page, { card: 'KF Signature', description: 'PANTI ASUHAN KASIH', category: 'Gift giving (general)', amount: '1350000', on: lastCycleDate() });

  await openCard(page, 'KF Signature');
  const check = page.locator('section', { has: page.getByRole('heading', { name: /^Check against statement:/ }) });
  await expect(check).toContainText('Projected 100 miles');
  await check.getByLabel('Actual miles on statement').fill('0');
  await check.getByRole('button', { name: 'Save' }).click();
  await expect(check).toContainText('Likely causes');
  await expect(check).toContainText(/PANTI ASUHAN KASIH as MCC \d{4} .* would earn 0 miles/);
});
