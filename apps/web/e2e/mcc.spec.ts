import { expect, type Page, test } from '@playwright/test';
import { openCard } from './accounts';
import { addTransaction, choosePayment } from './add-transaction';
import { closePurchase, openPurchase, purchaseRowOf } from './purchases';
import { cardPage, cardPointsPage, saveCardTerms, chooseCatalogueCard } from './card-section';
import { chooseMccCode, closeMccSheet, openMccSheet, rememberWord } from './mcc-sheet';

test.beforeEach(({ page }) => {
  page.on('dialog', (dialog) => void dialog.accept());
});

async function addCard(page: Page, name: string) {
  await openCard(page, { name });
}

async function openCardPage(page: Page, name: string) {
  await page.goto('/wallet');
  await page.getByRole('link', { name: new RegExp(`^${name}(,|$)`) }).click();
  await expect(page.getByRole('heading', { name })).toBeVisible();
}

async function applyCatalogue(page: Page, card: string, search: string, entryName: string) {
  await openCardPage(page, card);
  await cardPage(page, 'Settings');
  await page.getByLabel('Billing date').fill('25');
  await page.getByLabel('Due date').fill('12');
  await saveCardTerms(page);
  await chooseCatalogueCard(page, search, entryName);
}

/** The card's purchases with what each earned: under this statement's points. */
async function openPurchases(page: Page, card: string) {
  await openCardPage(page, card);
  await cardPage(page, 'Points');
  await cardPointsPage(page, 'Purchases');
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
  if (!p.mcc) {
    await addTransaction(page, { description: p.description, paidWith: p.card, category: p.category, amount: p.amount, date: p.on });
    if (!p.on) await expect(page.getByText(p.description)).toBeVisible();
    return;
  }
  // The MCC lives under "Add more details" now, on a screen of its own — §4's row, not a fold-out on the card.
  await page.getByRole('button', { name: 'Add transaction' }).click();
  const form = page.getByRole('dialog', { name: 'Add a transaction' });
  await form.getByRole('button', { name: 'Paid with' }).click();
  await choosePayment(page, p.card);
  await form.getByLabel('Amount', { exact: true }).fill(p.amount);
  await form.getByRole('button', { name: 'Category' }).click();
  await page.getByRole('dialog', { name: 'Select category' }).getByRole('button', { name: p.category, exact: true }).click();
  await form.getByLabel('Note').fill(p.description);
  if (p.on) await form.getByLabel('Date').fill(p.on);
  await form.getByRole('button', { name: 'Add more details' }).click();
  const more = page.getByRole('region', { name: 'More details' });
  await openMccSheet(page, more);
  await chooseMccCode(page, p.mcc);
  if (p.remember) await rememberWord(page, p.remember);
  await closeMccSheet(page);
  await form.getByRole('button', { name: 'Save' }).click();
  await expect(form).toHaveCount(0);
  if (!p.on) await expect(page.getByText(p.description)).toBeVisible();
}

const thisCycle = (page: Page) => page.getByRole('main');
// The statements panel lists the same purchases; these tests are about the points list, whose rows say so.
const purchaseRow = purchaseRowOf;

/** A date in the statement cycle before the current one, for a card whose statement closes on day 25. */
function lastCycleDate(): string {
  const today = new Date();
  const date = new Date(today.getFullYear(), today.getMonth() - (today.getDate() > 25 ? 0 : 1), 15);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

test('remembering a merchant MCC removes the Maybank Platinum extra from past purchases too', async ({ page }) => {
  await addCard(page, 'Maybank Platinum');
  await applyCatalogue(page, 'Maybank Platinum', 'platinum', 'Maybank Visa Platinum');
  await buy(page, { card: 'Maybank Platinum', description: 'BURGER BANGOR KEMANG', category: 'Restaurants', amount: '60000' });

  await openPurchases(page, 'Maybank Platinum');
  // Restaurants defaults to MCC 5812: 3 base plus 6 extra at restaurants.
  await expect(purchaseRow(page, 'BURGER BANGOR KEMANG')).toContainText('9 points');
  const sheet5812 = await openPurchase(page, 'BURGER BANGOR KEMANG');
  await expect(sheet5812.getByTestId('purchase-mcc')).toContainText('5812 · category guess');
  await closePurchase(page, 'BURGER BANGOR KEMANG');

  await buy(page, { card: 'Maybank Platinum', description: 'BURGER BANGOR PIM', category: 'Restaurants', amount: '60000', mcc: '5814', remember: 'burger bangor' });
  await openPurchases(page, 'Maybank Platinum');
  await expect(purchaseRow(page, 'BURGER BANGOR KEMANG')).toContainText('No points');
  const sheet5814 = await openPurchase(page, 'BURGER BANGOR KEMANG');
  await expect(sheet5814.getByTestId('purchase-mcc')).toContainText('5814 · remembered');
});

test('a per-purchase actual of 0 suggests fast food, and remembering it matches the bank', async ({ page }) => {
  await addCard(page, 'Maybank Platinum');
  await applyCatalogue(page, 'Maybank Platinum', 'platinum', 'Maybank Visa Platinum');
  await buy(page, { card: 'Maybank Platinum', description: 'WARUNG STEAK JKT', category: 'Restaurants', amount: '60000' });

  await openPurchases(page, 'Maybank Platinum');
  const row = await openPurchase(page, 'WARUNG STEAK JKT');
  await row.getByLabel('Actual points for WARUNG STEAK JKT').fill('0');
  await row.getByRole('button', { name: 'Save actual for WARUNG STEAK JKT' }).click();
  await expect(row).toContainText('WARUNG STEAK JKT as MCC 5814 Fast Food Restaurants would earn 0 points');
  await row.getByRole('button', { name: 'Remember “warung steak jkt” as 5814' }).click();
  await expect(row.getByTestId('purchase-mcc')).toContainText('5814 · remembered');
  await expect(row).toContainText('Matches the bank');
});

test('a BMW dealer purchase earns 1 TREATS Point per Rp 3.333', async ({ page }) => {
  await addCard(page, 'Maybank BMW Card');
  await applyCatalogue(page, 'Maybank BMW Card', 'bmw', 'Maybank BMW');
  await buy(page, { card: 'Maybank BMW Card', description: 'BMW ASTRA CILANDAK', category: 'Miscellaneous', amount: '3333000' });
  await openCardPage(page, 'Maybank BMW Card');
  await cardPage(page, 'Points');
  await expect(thisCycle(page)).toContainText(/At BMW dealers\s*Rp\s3\.333\.000 → 1\.000 points/);
});

test('a shoe store purchase typed as MCC 5661 earns the Manchester United sports extra', async ({ page }) => {
  await addCard(page, 'Maybank MU Card');
  await applyCatalogue(page, 'Maybank MU Card', 'manchester', 'Maybank Manchester United');
  await buy(page, { card: 'Maybank MU Card', description: 'SEPATU KITA', category: 'Clothing', amount: '200000', mcc: '5661' });
  await openCardPage(page, 'Maybank MU Card');
  await cardPage(page, 'Points');
  await expect(thisCycle(page)).toContainText(/3x at sports merchants\s*Rp\s200\.000 → 20 points/);
  await cardPointsPage(page, 'Purchases');
  await expect(purchaseRow(page, 'SEPATU KITA')).toContainText('30 points');
});

test('a BCA statement total that differs lists likely causes', async ({ page }) => {
  await addCard(page, 'BCA KF Signature');
  await applyCatalogue(page, 'BCA KF Signature', 'signature', 'BCA KrisFlyer Visa Signature');
  await buy(page, { card: 'BCA KF Signature', description: 'PANTI ASUHAN KASIH', category: 'Gift giving', amount: '1350000', on: lastCycleDate() });

  await openCardPage(page, 'BCA KF Signature');
  await cardPage(page, 'Points');
  await cardPointsPage(page, 'Points the statement shows');
  const check = page.locator('section', { has: page.getByRole('heading', { name: /^Check against statement:/ }) });
  await expect(check).toContainText('Projected 100 miles');
  await check.getByLabel('Actual miles on statement').fill('0');
  await check.getByRole('button', { name: 'Save' }).click();
  await expect(check).toContainText('Likely causes');
  await expect(check).toContainText(/PANTI ASUHAN KASIH as MCC \d{4} .* would earn 0 miles/);
});
