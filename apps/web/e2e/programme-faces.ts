import { expect, type Page } from '@playwright/test';

/**
 * The membership cards on the Points page, walked once and run at both widths (`points-programmes.spec.ts`,
 * `phone-programme-faces.spec.ts`).
 *
 * A programme whose name is a drawn membership card's is drawn as that card — its art and its name, no chip, mark or
 * digits — and its Settings offer the programme's card tiers, which change the face; a programme nothing is drawn for
 * keeps the plain face.
 */

/** The face of a programme on the Points pile, by the programme's name. */
const faceOf = (page: Page, name: string) =>
  page
    .getByRole('region', { name: 'Points' })
    .getByTestId('wallet-card')
    .filter({ has: page.getByRole('link', { name: new RegExp(`^${name}, `) }) })
    .getByTestId('card-face');

async function addProgramme(page: Page, name: string) {
  await page.locator('header').getByRole('button', { name: 'New programme' }).click();
  await page.getByRole('dialog').getByLabel('Name').fill(name);
  await page.getByRole('button', { name: 'Add programme' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
}

export async function programmeFaces(page: Page) {
  await page.goto('/cards/points');
  // An airline nothing is drawn for, then KrisFlyer: the last added is the front card, whole.
  await addProgramme(page, 'Hilton Honors');
  await addProgramme(page, 'KrisFlyer');

  await expect(faceOf(page, 'KrisFlyer')).toHaveAttribute('data-face', 'krisflyer');
  await expect(faceOf(page, 'Hilton Honors')).not.toHaveAttribute('data-face', /./);

  // The membership card is drawn as approved, and nothing is laid over it: no chip, no mark, no digits.
  const kris = faceOf(page, 'KrisFlyer');
  await expect(kris.getByTestId('programme-art')).toBeAttached();
  await expect(kris.getByTestId('card-chip')).toHaveCount(0);
  await expect(kris.getByTestId('card-contactless')).toHaveCount(0);
  await expect(kris).not.toContainText('••••');
  // Covered, the plain face's band names its programme as it always did.
  await expect(faceOf(page, 'Hilton Honors').getByTestId('card-band')).toContainText('Hilton Honors');

  // Its Settings offer KrisFlyer's tiers; Elite Gold changes the face, and holds across a reload.
  await page.getByRole('region', { name: 'Points' }).getByRole('link', { name: /^KrisFlyer, / }).click();
  await expect(page.getByTestId('programme-balance')).toBeVisible();
  await page.getByRole('group', { name: 'Actions' }).getByRole('button', { name: 'Settings' }).click();
  const tier = page.getByRole('dialog').getByLabel('Membership tier');
  await expect(tier).toHaveValue('member');
  await tier.selectOption({ label: 'Elite Gold' });
  await page.getByRole('button', { name: 'Save programme' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);

  await page.goto('/cards/points');
  await expect(faceOf(page, 'KrisFlyer')).toHaveAttribute('data-face', 'krisflyer-gold');
  await page.reload();
  await expect(faceOf(page, 'KrisFlyer')).toHaveAttribute('data-face', 'krisflyer-gold');

  // A programme nothing is drawn for is offered no tier.
  await page.getByRole('region', { name: 'Points' }).getByRole('link', { name: /^Hilton Honors, / }).click();
  await expect(page.getByTestId('programme-balance')).toBeVisible();
  await page.getByRole('group', { name: 'Actions' }).getByRole('button', { name: 'Settings' }).click();
  await expect(page.getByRole('dialog').getByLabel('Name')).toHaveValue('Hilton Honors');
  await expect(page.getByRole('dialog').getByLabel('Membership tier')).toHaveCount(0);
}
