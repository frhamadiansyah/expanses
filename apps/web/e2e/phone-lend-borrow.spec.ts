import { expect, type Page, test } from '@playwright/test';
import { openAccount } from './accounts';

/**
 * Lend & borrow at 390 px: the mockup's segmented control, one side at a time.
 *
 * The other half of this decision is the desktop's, and it is the half that must not change: both columns stay
 * side by side, asserted in `lend-borrow.spec.ts`. Here the point is that nothing the phone needs is behind a
 * second screen, that a person opened from Debts shows the side they are on, and that settled items survive.
 */

test.beforeEach(({ page }) => {
  page.on('dialog', (dialog) => void dialog.accept());
});

async function type(page: Page, label: string | RegExp, value: string) {
  await page.getByLabel(label, { exact: typeof label === 'string' }).pressSequentially(value);
}

/** Turn the phone's segmented control over to the side a borrow lands on. */
const turnOver = (page: Page) => page.getByRole('radiogroup', { name: 'Lend & borrow' }).getByRole('radio', { name: 'You owe' }).tap();

/** One person each way: Andi owes you Rp 1.000.000, you owe Dewi Rp 750.000. */
async function twoPeople(page: Page) {
  await openAccount(page, { subtype: 'bank', name: 'BCA Tahapan', balance: '50000000' });

  await page.goto('/net-worth/lend-borrow');
  await page.getByRole('button', { name: 'Add a loan' }).tap();
  await page.getByLabel('Person').fill('Andi');
  await page.getByLabel(/^Amount/).fill('1000000');
  await page.getByLabel('Paid from').selectOption({ label: 'BCA Tahapan (IDR)' });
  await page.getByRole('button', { name: 'Save', exact: true }).tap();
  await expect(page.getByRole('heading', { name: 'Andi' })).toBeVisible();

  await page.getByRole('button', { name: 'Add a loan' }).tap();
  await page.getByRole('radio', { name: 'I borrowed money' }).tap();
  await page.getByLabel('Person').fill('Dewi');
  await page.getByLabel(/^Amount/).fill('750000');
  await page.getByLabel('Received into').selectOption({ label: 'BCA Tahapan (IDR)' });
  await page.getByRole('button', { name: 'Save', exact: true }).tap();
  // The sheet must be gone before the control is tapped, or the tap lands on the sheet and the side never turns.
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toHaveCount(0);
  // The borrow lands on the other side of the switch, which is where the phone finds it.
  await turnOver(page);
  /* A save is instant, but the list's repaint is a second ledger read and it can begin before the write lands: on a
     loaded machine Dewi is then missing from the side that was just opened, and no further read is coming. One
     reload and a fresh tap settle it. */
  try {
    await expect(page.getByRole('heading', { name: 'Dewi' })).toBeVisible({ timeout: 5_000 });
  } catch {
    await page.reload();
    await turnOver(page);
    await expect(page.getByRole('heading', { name: 'Dewi' })).toBeVisible();
  }
  // Back to a freshly opened page, so each spec starts where a reader starts: on the segment the page chooses.
  await page.goto('/net-worth/lend-borrow');
  await expect(page.getByTestId('debts-total-Owed to you')).toBeVisible();
}

const sides = (page: Page) => page.getByRole('radiogroup', { name: 'Lend & borrow' });

test('by thumb: the mockup’s control shows one side at a time, and one tap turns it over', async ({ page }) => {
  await twoPeople(page);

  // The mockup's own reading: the first segment, and only the list that belongs to it.
  await expect(sides(page).getByRole('radio', { name: 'Owed to you' })).toBeChecked();
  await expect(page.getByRole('heading', { name: 'Andi' })).toBeVisible();
  await expect(page.getByTestId('debts-total-Owed to you')).toHaveText('Rp 1.000.000');
  await expect(page.getByRole('heading', { name: 'You owe', level: 2 })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Dewi' })).toHaveCount(0);
  await expect(page.getByTestId('debts-total-You owe')).toHaveCount(0);

  await sides(page).getByRole('radio', { name: 'You owe' }).tap();
  await expect(page.getByTestId('debts-total-You owe')).toHaveText('Rp 750.000');
  await expect(page.getByRole('heading', { name: 'Dewi' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Owed to you', level: 2 })).toHaveCount(0);
  await expect(page.getByTestId('debts-total-Owed to you')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('by thumb: a person opened from Debts opens on the side they are on', async ({ page }) => {
  await twoPeople(page);

  await page.goto('/net-worth/loans');
  await page.getByRole('link', { name: /Dewi/ }).tap();
  await expect(page).toHaveURL(/\/net-worth\/lend-borrow\?person=Dewi$/);
  await expect(page.getByRole('heading', { name: 'Only Dewi' })).toBeVisible();
  // Dewi is someone you owe, so the control opens on that side: the way in never lands on an empty list.
  await expect(page.getByRole('heading', { name: 'Dewi', exact: true })).toBeVisible();
  await expect(page.getByTestId('debts-total-You owe')).toBeVisible();

  await page.getByRole('link', { name: 'Show everyone' }).tap();
  await expect(page.getByTestId('debts-total-Owed to you')).toHaveText('Rp 1.000.000');
});

test('by thumb: settled items stay where they were, under the switch', async ({ page }) => {
  await twoPeople(page);

  await page.getByRole('button', { name: 'Forgive rest' }).tap();
  // Andi is settled now: the switch stays on the side the reader was reading rather than turning itself over.
  await expect(sides(page).getByRole('radio', { name: 'Owed to you' })).toBeChecked();
  await page.getByRole('button', { name: /Show settled/ }).tap();
  await expect(page.getByRole('heading', { name: 'Andi' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Hide settled/ })).toBeVisible();
});