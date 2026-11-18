import { expect, type Page } from '@playwright/test';

/**
 * The membership cards on the Points page, walked once and run at both widths (`points-programmes.spec.ts` on the wide
 * screen's table, `phone-programme-faces.spec.ts` on the phone's pile).
 *
 * A programme whose name is a drawn membership card's is drawn as that card — its art and its name, no chip, mark or
 * digits — and its Settings offer the programme's card tiers, which change the face; a programme nothing is drawn for
 * keeps the plain face.
 */

/** Whether the page is the wide screen's (Mac Points: a table, ＋ Add programme in the title bar) or the phone's pile. */
const isDesk = async (page: Page) => (await page.locator('[data-testid="points-page"][data-desk="true"]').count()) > 0;

/** The face of a programme on the Points pile or the wide screen's table, by the programme's name. */
const faceOf = (page: Page, name: string, desk: boolean) =>
  desk
    ? page
        .getByTestId('points-row')
        .filter({ has: page.getByRole('link', { name: new RegExp(`^${name}, `) }) })
        .getByTestId('card-face')
    : page
        .getByRole('region', { name: 'Points' })
        .getByTestId('wallet-card')
        .filter({ has: page.getByRole('link', { name: new RegExp(`^${name}, `) }) })
        .getByTestId('card-face');

/** A programme's own page: a tap on its face on the phone, a double-click on its row on the wide screen. */
async function openProgramme(page: Page, name: string, desk: boolean) {
  const link = page.getByRole('region', { name: desk ? 'Programmes' : 'Points' }).getByRole('link', { name: new RegExp(`^${name}, `) });
  if (desk) await link.dblclick();
  else await link.click();
  await expect(page.getByTestId('programme-balance')).toBeVisible();
}

async function addProgramme(page: Page, name: string, desk: boolean) {
  await page.locator('header').getByRole('button', { name: desk ? 'Add programme' : 'New programme' }).click();
  await page.getByRole('dialog').getByLabel('Name').fill(name);
  // The sheet's own ✓ (the wide screen's title bar has an Add programme too).
  await page.getByRole('dialog').getByRole('button', { name: 'Add programme' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
}

export async function programmeFaces(page: Page) {
  await page.goto('/cards/points');
  await expect(page.getByRole('heading', { name: 'Points' }).first()).toBeVisible();
  const desk = await isDesk(page);
  // An airline nothing is drawn for, then KrisFlyer: the last added is the front card, whole.
  await addProgramme(page, 'Hilton Honors', desk);
  await addProgramme(page, 'KrisFlyer', desk);

  await expect(faceOf(page, 'KrisFlyer', desk)).toHaveAttribute('data-face', 'krisflyer');
  await expect(faceOf(page, 'Hilton Honors', desk)).not.toHaveAttribute('data-face', /./);

  // The membership card is drawn as approved, and nothing is laid over it: no chip, no mark, no digits.
  const kris = faceOf(page, 'KrisFlyer', desk);
  await expect(kris.getByTestId('programme-art')).toBeAttached();
  await expect(kris.getByTestId('card-chip')).toHaveCount(0);
  await expect(kris.getByTestId('card-contactless')).toHaveCount(0);
  await expect(kris).not.toContainText('••••');
  // Covered in the pile, the plain face's band names its programme as it always did; whole in the table, its own print does.
  if (desk) await expect(faceOf(page, 'Hilton Honors', desk)).toContainText('Hilton Honors');
  else await expect(faceOf(page, 'Hilton Honors', desk).getByTestId('card-band')).toContainText('Hilton Honors');

  // Its Settings offer KrisFlyer's tiers; Elite Gold changes the face, and holds across a reload.
  await openProgramme(page, 'KrisFlyer', desk);
  await page.getByRole('group', { name: 'Actions' }).getByRole('button', { name: 'Settings' }).click();
  const tier = page.getByRole('dialog').getByLabel('Membership tier');
  await expect(tier).toHaveValue('member');
  await tier.selectOption({ label: 'Elite Gold' });
  await page.getByRole('button', { name: 'Save programme' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);

  await page.goto('/cards/points');
  await expect(faceOf(page, 'KrisFlyer', desk)).toHaveAttribute('data-face', 'krisflyer-gold');
  await page.reload();
  await expect(faceOf(page, 'KrisFlyer', desk)).toHaveAttribute('data-face', 'krisflyer-gold');

  // A programme nothing is drawn for is offered no tier.
  await openProgramme(page, 'Hilton Honors', desk);
  await page.getByRole('group', { name: 'Actions' }).getByRole('button', { name: 'Settings' }).click();
  await expect(page.getByRole('dialog').getByLabel('Name')).toHaveValue('Hilton Honors');
  await expect(page.getByRole('dialog').getByLabel('Membership tier')).toHaveCount(0);
}
