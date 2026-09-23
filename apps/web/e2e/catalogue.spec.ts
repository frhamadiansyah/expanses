import { expect, type Page, test } from '@playwright/test';
import { openCard } from './accounts';
import { addTransaction } from './add-transaction';
import { cardSection } from './card-section';

test.beforeEach(({ page }) => {
  // A linked catalogue card asks before an edit makes it customised.
  page.on('dialog', (dialog) => void dialog.accept());
});

async function addCard(page: Page, name: string) {
  await openCard(page, { name });
}

async function openCardPage(page: Page, name: string) {
  await page.goto('/cards');
  await page.getByRole('link', { name: new RegExp(`^${name}(,|$)`) }).click();
  await expect(page.getByRole('heading', { name })).toBeVisible();
}

/** Saves statement and due days, then applies the catalogue entry found by `search`. */
async function applyCatalogue(page: Page, card: string, search: string, entryName: string) {
  await openCardPage(page, card);
  await page.getByLabel('Billing date').fill('25');
  await page.getByLabel('Due date').fill('12');
  await page.getByRole('button', { name: 'Save terms' }).click();
  await expect(page.getByText('Step 2 of 3')).toBeVisible();
  await page.getByLabel('Search catalogue').fill(search);
  await page.getByRole('button', { name: entryName, exact: true }).click();
  await page.getByRole('button', { name: 'Use these terms' }).click();
  await expect(page.getByText('From catalogue · Linked')).toBeVisible();
}

async function buy(page: Page, p: { card: string; description: string; category: string; amount: string; original?: [currency: string, amount: string] }) {
  await page.goto('/transactions');
  if (!p.original) {
    await addTransaction(page, { description: p.description, paidWith: p.card, category: p.category, amount: p.amount });
    await expect(page.getByText(p.description)).toBeVisible();
    return;
  }
  // §3.3: what the merchant charged is typed in its own currency, and the row underneath is what the card
  // settled in — the pair the card's rules read. There is no second "Original amount" field any more.
  await page.getByRole('button', { name: 'Add transaction' }).click();
  const form = page.getByRole('dialog', { name: 'Add a transaction' });
  await form.getByRole('button', { name: 'Paid with' }).click();
  await page.getByRole('dialog', { name: 'Paid with' }).getByRole('button', { name: p.card, exact: true }).click();
  await form.getByRole('button', { name: 'Currency' }).click();
  await page.getByRole('dialog', { name: 'Currency' }).getByRole('button', { name: new RegExp(`^${p.original[0]} `) }).first().click();
  await form.getByLabel('Amount', { exact: true }).fill(p.original[1]);
  await form.getByLabel('Charged in IDR').fill(p.amount);
  await form.getByRole('button', { name: 'Category' }).click();
  await page.getByRole('dialog', { name: 'Select category' }).getByRole('button', { name: p.category, exact: true }).click();
  await form.getByLabel('Note').fill(p.description);
  await form.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText(p.description)).toBeVisible();
}

const thisCycle = (page: Page) => page.locator('section', { has: page.getByRole('heading', { name: /^This cycle:/ }) });

test('BCA KrisFlyer Visa Signature earns base miles and the cycle bonus with full progress', async ({ page }) => {
  await addCard(page, 'KF Signature');
  await applyCatalogue(page, 'KF Signature', 'signature', 'BCA Singapore Airlines KrisFlyer Visa Signature');
  await buy(page, { card: 'KF Signature', description: 'Anniversary dinner', category: 'Restaurants', amount: '21000000' });

  await openCardPage(page, 'KF Signature');
  await cardSection(page, 'Points');
  const cycle = thisCycle(page);
  // Rp 21.000.000 / 13.500 = 1.555,5 → 1.555 miles, plus 1.000 for reaching Rp 20.000.000.
  await expect(cycle).toContainText(/21\.000\.000 → 1\.555 miles/);
  await expect(cycle).toContainText(/Monthly spend bonus\s*Rp\s21\.000\.000 → 1\.000 miles/);
  await expect(cycle).toContainText('2.555');
  await expect(cycle).toContainText('Top tier reached this cycle');
  await expect(cycle.getByRole('progressbar', { name: 'Monthly spend bonus progress' })).toHaveAttribute('aria-valuenow', '100');
});

test('BCA UnionPay doubles points on an SGD purchase billed in rupiah', async ({ page }) => {
  await addCard(page, 'UnionPay');
  await applyCatalogue(page, 'UnionPay', 'unionpay', 'BCA UnionPay');
  await buy(page, { card: 'UnionPay', description: 'Din Tai Fung Orchard', category: 'Restaurants', amount: '540000', original: ['SGD', '45,20'] });
  await expect(page.getByText(/SGD\s45,20/)).toBeVisible();

  await openCardPage(page, 'UnionPay');
  await cardSection(page, 'Points');
  const cycle = thisCycle(page);
  // 54 base points plus 54 for spending in SGD; 100 of them transfer in steps of 20 to 50 KrisFlyer miles.
  await expect(cycle.getByText(/540\.000 → 54 points/)).toHaveCount(2);
  await expect(cycle).toContainText('108');
  await expect(cycle).toContainText('50 KrisFlyer');
});

test('editing a catalogue rule makes the card customised', async ({ page }) => {
  await addCard(page, 'KF Infinite');
  await applyCatalogue(page, 'KF Infinite', 'infinite', 'BCA Singapore Airlines KrisFlyer Visa Infinite');
  const rules = page.locator('section', { has: page.getByRole('heading', { name: 'Earn rules' }) });
  await rules.getByRole('button', { name: 'Edit' }).first().click();
  await page.getByRole('button', { name: 'Save rule' }).click();
  await expect(page.getByText('From catalogue · Customised')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Reset to catalogue' })).toBeVisible();
});

test('comparing in KrisFlyer ranks UnionPay converted miles above Signature miles', async ({ page }) => {
  await addCard(page, 'UnionPay');
  await applyCatalogue(page, 'UnionPay', 'unionpay', 'BCA UnionPay');
  await addCard(page, 'KF Signature');
  await applyCatalogue(page, 'KF Signature', 'signature', 'BCA Singapore Airlines KrisFlyer Visa Signature');

  await page.goto('/recommend');
  await page.getByLabel('Amount (IDR)').fill('540000');
  await page.getByLabel('Spent in').selectOption('SGD');
  await page.getByLabel('Category', { exact: true }).selectOption({ label: 'Restaurants' });
  await expect(page.getByLabel('Compare in').locator('option', { hasText: 'KrisFlyer' })).toHaveCount(1);
  await page.getByLabel('Compare in').selectOption('KrisFlyer');
  await page.getByRole('button', { name: 'Compare cards' }).click();

  const best = page.locator('section', { hasText: 'Best' });
  await expect(best).toContainText('UnionPay');
  await expect(best).toContainText('108 pts');
  await expect(best).toContainText('≈ 54 KrisFlyer');
  await expect(page.locator('section', { hasText: 'KF Signature' })).toContainText('≈ 40 KrisFlyer');
});

test('Mandiri World Prioritas earns per Rp 20.000 multiple, and a CNY taxi earns the transport rate', async ({ page }) => {
  await addCard(page, 'Mandiri Prioritas');
  await applyCatalogue(page, 'Mandiri Prioritas', 'prioritas', 'Mandiri World Prioritas');
  await buy(page, { card: 'Mandiri Prioritas', description: 'Kopi Kenangan', category: 'Cafe & dessert', amount: '25000' });
  await buy(page, { card: 'Mandiri Prioritas', description: 'Didi Shanghai', category: 'Ride hailing', amount: '250000', original: ['CNY', '55,00'] });

  await openCardPage(page, 'Mandiri Prioritas');
  await cardSection(page, 'Points');
  const cycle = thisCycle(page);
  // Rp 25.000 counts as one Rp 20.000 multiple: 3 points. The taxi earns 1 per Rp 100.000, not the overseas 4 per Rp 20.000.
  await expect(cycle).toContainText(/Domestic transactions\s*Rp\s25\.000 → 3 points/);
  await expect(cycle).toContainText(/Transport, fuel, real estate, education\s*Rp\s250\.000 → 2 points/);
  await expect(cycle).toContainText(/Overseas transactions\s*Rp\s0 → 0 points/);
});

test('CIMB Niaga World ALL Accor pre-fills billing date 22 and earns 2,5 points on Rp 60.000', async ({ page }) => {
  await addCard(page, 'CIMB Accor');
  await openCardPage(page, 'CIMB Accor');
  await page.getByLabel('Search catalogue').fill('accor');
  await page.getByRole('button', { name: 'CIMB Niaga World ALL Accor Live Limitless', exact: true }).click();
  await expect(page.getByLabel('Billing date')).toHaveValue('22');
  await page.getByLabel('Due date').fill('12');
  await page.getByRole('button', { name: 'Save terms' }).click();
  await page.getByRole('button', { name: 'Use these terms' }).click();
  await expect(page.getByText('From catalogue · Linked')).toBeVisible();

  await buy(page, { card: 'CIMB Accor', description: 'Superindo', category: 'Groceries', amount: '60000' });
  await openCardPage(page, 'CIMB Accor');
  await cardSection(page, 'Points');
  await expect(thisCycle(page)).toContainText(/Other domestic transactions\s*Rp\s60\.000 → 2,5 points/);
});

test('a spend bonus can be added by hand, and a catalogue one keeps what the form never shows', async ({ page }) => {
  await addCard(page, 'BCA KrisFlyer');
  await applyCatalogue(page, 'BCA KrisFlyer', 'krisflyer', 'BCA Singapore Airlines KrisFlyer Visa Signature');

  // The catalogue's own bonus is listed, which the owner could never see before. The entry carries one
  // per dated period, so the live one is the row not marked as past terms.
  const bonuses = page.locator('section', { has: page.getByRole('heading', { name: 'Spend bonuses' }) });
  const live = bonuses.getByTestId(/^bonus-/).filter({ hasNotText: 'past terms' }).first();
  await expect(live).toContainText('20.000.000');

  await live.getByRole('button', { name: 'Edit' }).click();
  await page.getByLabel('Tier 1 bonus').fill('1500');
  await page.getByRole('button', { name: 'Save bonus' }).click();
  await expect(bonuses.getByTestId(/^bonus-/).filter({ hasNotText: 'past terms' }).first()).toContainText('1.500');

  // Electricity is excluded by the catalogue, and that exclusion is not on the form: it must survive.
  await buy(page, { card: 'BCA KrisFlyer', description: 'PLN token', category: 'Electricity', amount: '21000000' });
  await openCardPage(page, 'BCA KrisFlyer');
  await cardSection(page, 'Points');
  await expect(thisCycle(page).getByRole('progressbar', { name: 'Monthly spend bonus progress' })).toHaveAttribute('aria-valuenow', '0');
});

test('adds a second tier to a card that pays more for spending more', async ({ page }) => {
  await addCard(page, 'BCA KrisFlyer');
  await applyCatalogue(page, 'BCA KrisFlyer', 'krisflyer', 'BCA Singapore Airlines KrisFlyer Visa Signature');

  const bonuses = page.locator('section', { has: page.getByRole('heading', { name: 'Spend bonuses' }) });
  await bonuses.getByTestId(/^bonus-/).filter({ hasNotText: 'past terms' }).first().getByRole('button', { name: 'Edit' }).click();
  await page.getByRole('button', { name: 'Add tier' }).click();
  await page.getByLabel('Tier 2 spend').fill('50000000');
  await page.getByLabel('Tier 2 bonus').fill('2000');
  await page.getByRole('button', { name: 'Save bonus' }).click();

  const live = bonuses.getByTestId(/^bonus-/).filter({ hasNotText: 'past terms' }).first();
  await expect(live).toContainText('50.000.000');
  await expect(live).toContainText('2.000');
});

test('editing a rule or a bonus opens its form where its row stood, not below the list', async ({ page }) => {
  await addCard(page, 'BCA KrisFlyer');
  await applyCatalogue(page, 'BCA KrisFlyer', 'krisflyer', 'BCA Singapore Airlines KrisFlyer Visa Signature');

  // Every rule and bonus row on the tab, in reading order: the rules come first.
  const rows = page.getByRole('button', { name: /^Edit / });
  const rules = page.locator('section', { has: page.getByRole('heading', { name: 'Earn rules' }) });
  const ruleCount = await rules.getByRole('button', { name: /^Edit / }).count();
  expect(ruleCount).toBeGreaterThanOrEqual(2);
  const total = await rows.count();
  // The second rule, so a row stands above it and another below it.
  const label = (await rows.nth(1).getAttribute('aria-label'))!;
  await rows.nth(1).click();

  // Its row is gone — replaced, not shown twice — and the form stands between its neighbours.
  await expect(rows).toHaveCount(total - 1);
  const form = page.getByRole('heading', { name: `Edit rule · ${label.replace(/^Edit /, '')}`, exact: true });
  await expect(form).toHaveCount(1);
  const opened = (await form.boundingBox())!;
  expect((await rows.nth(0).boundingBox())!.y).toBeLessThan(opened.y);
  expect(opened.y).toBeLessThan((await rows.nth(1).boundingBox())!.y);
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(rows).toHaveCount(total);

  const bonuses = page.locator('section', { has: page.getByRole('heading', { name: 'Spend bonuses' }) });
  const live = bonuses.getByTestId(/^bonus-/).filter({ hasNotText: 'past terms' }).first();
  const id = (await live.getAttribute('data-testid'))!;
  await live.getByRole('button', { name: /^Edit / }).click();
  await expect(page.getByTestId(id)).toHaveCount(0);
  await expect(rows).toHaveCount(total - 1);
  await expect(page.getByRole('heading', { name: /^Edit bonus · / })).toHaveCount(1);
});
