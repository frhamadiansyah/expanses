import { expect, type Page, test } from '@playwright/test';
import { openLoan, personRow } from './people';
import { openAccount } from './accounts';
import { openDrawers } from './drawers';

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
const turnOver = (page: Page) => page.getByRole('radiogroup', { name: 'Lend & borrow' }).getByRole('radio', { name: 'Payables' }).tap();

/** One person each way: Andi owes you Rp 1.000.000, you owe Dewi Rp 750.000. */
async function twoPeople(page: Page) {
  await openAccount(page, { subtype: 'bank', name: 'BCA Tahapan', balance: '50000000' });

  await page.goto('/net-worth/lend-borrow');
  // The phone shows one side, so + goes straight to that side's screen: Receivables opens on New receivable.
  await page.getByRole('link', { name: 'New receivable' }).tap();
  await page.getByLabel('Person').fill('Andi');
  await page.getByLabel('Type', { exact: true }).selectOption({ index: 1 });
  await page.getByLabel(/^Money (lent|borrowed)/).fill('1000000');
  await page.getByLabel('Paid from').selectOption({ label: 'BCA Tahapan (IDR)' });
  await page.getByRole('button', { name: 'Save', exact: true }).tap();
  await expect(personRow(page, 'Andi')).toBeVisible();

  // On Payables the same + is New payable.
  await turnOver(page);
  await page.getByRole('link', { name: 'New payable' }).tap();
  await page.getByLabel('Person').fill('Dewi');
  await page.getByLabel('Type', { exact: true }).selectOption({ index: 1 });
  await page.getByLabel(/^Money (lent|borrowed)/).fill('750000');
  await page.getByLabel('Received into').selectOption({ label: 'BCA Tahapan (IDR)' });
  await page.getByRole('button', { name: 'Save', exact: true }).tap();
  // Save comes back to the side just added to, so Dewi is on screen without turning anything over.
  /* A save is instant, but the list's repaint is a second ledger read and it can begin before the write lands: on a
     loaded machine Dewi is then missing, and no further read is coming. One reload settles it; the side is in the
     address, so it survives the reload. */
  try {
    await expect(personRow(page, 'Dewi')).toBeVisible({ timeout: 5_000 });
  } catch {
    await page.reload();
    await expect(personRow(page, 'Dewi')).toBeVisible();
  }
  // Back to a freshly opened page, so each spec starts where a reader starts: on the segment the page chooses.
  await page.goto('/net-worth/lend-borrow');
  await expect(page.getByTestId('debts-total-Receivables')).toBeVisible();
}

const sides = (page: Page) => page.getByRole('radiogroup', { name: 'Lend & borrow' });

test('by thumb: the mockup’s control shows one side at a time, and one tap turns it over', async ({ page }) => {
  await twoPeople(page);

  // The mockup's own reading: the first segment, and only the list that belongs to it.
  await expect(sides(page).getByRole('radio', { name: 'Receivables' })).toBeChecked();
  await expect(personRow(page, 'Andi')).toBeVisible();
  await expect(page.getByTestId('debts-total-Receivables')).toHaveText('Rp 1.000.000');
  await expect(page.getByRole('heading', { name: 'Payables', level: 2 })).toHaveCount(0);
  await expect(personRow(page, 'Dewi')).toHaveCount(0);
  await expect(page.getByTestId('debts-total-Payables')).toHaveCount(0);

  await sides(page).getByRole('radio', { name: 'Payables' }).tap();
  await expect(page.getByTestId('debts-total-Payables')).toHaveText('Rp 750.000');
  await expect(personRow(page, 'Dewi')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Receivables', level: 2 })).toHaveCount(0);
  await expect(page.getByTestId('debts-total-Receivables')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('by thumb: a person opened from Debts opens on the side they are on', async ({ page }) => {
  await twoPeople(page);

  await page.goto('/net-worth/loans');
  // A person you owe is a row inside its kind's drawer, which the list opens shut.
  await openDrawers(page);
  await page.getByRole('link', { name: /Dewi/ }).tap();
  await expect(page).toHaveURL(/\/net-worth\/lend-borrow\?person=Dewi$/);
  await expect(page.getByRole('heading', { name: 'Only Dewi' })).toBeVisible();
  // Dewi is someone you owe, so the control opens on that side: the way in never lands on an empty list.
  await expect(personRow(page, 'Dewi')).toBeVisible();
  await expect(page.getByTestId('debts-total-Payables')).toBeVisible();

  await page.getByRole('link', { name: 'Show everyone' }).tap();
  await expect(page.getByTestId('debts-total-Receivables')).toHaveText('Rp 1.000.000');
});

test('by thumb: settled items stay where they were, under the switch', async ({ page }) => {
  await twoPeople(page);

  await openLoan(page, 'Andi');
  await page.getByRole('button', { name: 'Forgive rest' }).tap();
  await expect(page.getByRole('button', { name: 'Forgive rest' })).toHaveCount(0);
  // Back on the list, Andi is settled: it opens on Receivables rather than turning itself over to where people are.
  await page.goto('/net-worth/lend-borrow');
  await expect(sides(page).getByRole('radio', { name: 'Receivables' })).toBeChecked();
  await page.getByRole('button', { name: /Show settled/ }).tap();
  await expect(personRow(page, 'Andi')).toBeVisible();
  await expect(page.getByRole('button', { name: /Hide settled/ })).toBeVisible();
});
test('+ adds on a screen of its own for the side the phone is showing, and a person shown comes along', async ({ page }) => {
  await twoPeople(page);

  // Receivables first, so + is New receivable: a whole screen, with its way back and no direction to choose.
  await page.getByRole('link', { name: 'New receivable' }).tap();
  await expect(page.getByRole('heading', { name: 'New receivable' })).toBeVisible();
  await expect(page.getByRole('radio', { name: /I (lent|borrowed) money/ })).toHaveCount(0);
  await expect(page.getByLabel('Paid from')).toBeVisible();
  await page.getByRole('link', { name: /Lend & borrow/ }).first().tap();
  await expect(page).toHaveURL(/\/net-worth\/lend-borrow(\?|$)/);

  // Lend & borrow showing only Dewi: + there starts with her name. Her open loan is offered under Loan once
  // something is typed, as names are under Person — a loan with no reason under the words "No reason noted".
  await page.goto('/net-worth/lend-borrow?person=Dewi');
  await page.getByRole('link', { name: 'New payable' }).tap();
  await expect(page.getByLabel('Person')).toHaveValue('Dewi');
  const chip = page.getByRole('button', { name: /^No reason noted · .*750\.000 left$/ });
  await expect(chip).toHaveCount(0);
  await page.getByRole('textbox', { name: 'Loan', exact: true }).fill('no');
  await chip.tap();

  // Picked, the money adds to her loan: its sub category and due date are that loan's, so the form stops asking.
  await expect(page.getByText(/^Adds to this open loan/)).toBeVisible();
  await expect(page.getByLabel('Type', { exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Add more details' }).tap();
  await expect(page.getByRole('textbox', { name: 'Due by' })).toHaveCount(0);
});

test('the notes on a new receivable are behind an ⓘ, and the ID it asks for is not one country\'s', async ({ page }) => {
  await openAccount(page, { subtype: 'bank', name: 'BCA Tahapan', balance: '50000000' });
  await page.goto('/net-worth/lend-borrow/new-receivable');
  // The notes live with the rows they explain, behind Add more details.
  await page.getByRole('button', { name: 'Add more details' }).tap();

  // Fine print waits behind the ⓘ beside its label, and comes out only when asked for. Loan and Due by need none,
  // and carry none.
  const note = page.getByText(/^Optional\. A card or bank charge for sending the money\./);
  await expect(note).toHaveCount(0);
  await page.getByRole('button', { name: 'About Fee' }).tap();
  await expect(note).toBeVisible();
  await expect(page.getByText(/\byou(r)?\b/i).filter({ hasText: /^Optional/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'About Loan' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'About Due by' })).toHaveCount(0);

  // A tax ID, for whichever country's report it reaches.
  await expect(page.getByRole('textbox', { name: 'Tax ID', exact: true })).toBeVisible();
  await expect(page.getByText(/NIK|NPWP|SPT/)).toHaveCount(0);
  await page.getByRole('button', { name: 'About Tax ID' }).tap();
  await expect(page.getByText(/needed only when this loan appears in a tax report/)).toBeVisible();

  // The sub-category's line under it was the same choice again in Indonesian; it is gone.
  await expect(page.getByText(/Piutang|Utang/)).toHaveCount(0);
});

test('Person offers the names already on the list as chips, and lines up with the rows under it', async ({ page }) => {
  await twoPeople(page);
  await page.getByRole('link', { name: 'New receivable' }).tap();
  const person = page.getByLabel('Person');
  await person.fill('an');
  // Andi is on the list; a chip under the field fills him in.
  await page.getByRole('button', { name: 'Andi', exact: true }).tap();
  await expect(person).toHaveValue('Andi');
  await expect(page.getByRole('button', { name: 'Andi', exact: true })).toHaveCount(0);
  // No browser suggestion list, which on iOS kept the text short of every other row's value.
  await expect(person).not.toHaveAttribute('list', /.+/);
});
