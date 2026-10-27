import { expect, type Page, test } from '@playwright/test';
import { openCard } from './accounts';
import { cardPage, walletCard, saveCardTerms } from './card-section';
import { programmeFaces } from './programme-faces';

test.beforeEach(({ page }) => {
  page.on('dialog', (dialog) => void dialog.accept());
});

/*
 * Points programmes: a bank's programme is a balance of its own that its cards earn into, and its points convert into
 * an airline's. Invented balances throughout.
 */

/** A card with rewards set up by hand, earning into a programme named `programme`. */
async function cardEarningInto(page: Page, card: string, programme: string) {
  await openCard(page, { name: card });
  await page.goto('/wallet');
  await walletCard(page, card).click();
  await cardPage(page, 'Settings');
  await page.getByLabel('Billing date').fill('25');
  await page.getByLabel('Due date').fill('12');
  await saveCardTerms(page);
  await page.getByLabel('Program name').fill(programme);
  await page.getByRole('button', { name: 'Set up rewards' }).click();
  await page.getByRole('button', { name: 'Add rule' }).click();
  await page.getByLabel('Rule name').fill('Base');
  await page.getByLabel('Points', { exact: true }).fill('1');
  await page.getByLabel('Per spend (IDR)').fill('2500');
  await page.getByRole('button', { name: 'Save rule' }).click();
  await expect(page.getByText('1 per Rp')).toBeVisible();
}

/** A programme's face on the Points page's pile, named by the programme, its balance and who earns into it. */
const programmeRow = (page: Page, name: string) =>
  page.getByRole('region', { name: 'Points' }).getByRole('link', { name: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}, `) });

test("converting Livin' Poin into KrisFlyer shows both balances", async ({ page }) => {
  await cardEarningInto(page, 'Mandiri Prioritas', "Livin' Poin");

  // The programme is on the Cards page, called by the card that earns into it.
  await page.goto('/cards/points');
  await expect(programmeRow(page, "Livin' Poin")).toHaveAccessibleName(new RegExp('Mandiri Prioritas'));
  await programmeRow(page, "Livin' Poin").click();
  await expect(page.getByTestId('programme-balance')).toHaveText('0 points');

  // Its balance set to the one the bank's app shows.
  await page.getByRole('group', { name: 'Actions' }).getByRole('button', { name: 'Balance' }).click();
  await page.getByLabel('Actual balance').fill('20.000');
  await page.getByRole('button', { name: 'Set balance' }).click();
  await expect(page.getByTestId('programme-balance')).toHaveText('20.000 points');

  // Converted into an airline programme that does not exist yet, made in the same step.
  await page.getByRole('group', { name: 'Actions' }).getByRole('button', { name: 'Convert' }).click();
  await page.getByLabel('To', { exact: true }).selectOption({ label: 'New programme…' });
  await page.getByLabel('Programme name').fill('KrisFlyer');
  await page.getByLabel('Counted in').selectOption('miles');
  await page.getByLabel('Points converted').fill('10.000');
  await page.getByLabel('Miles received').fill('6.660');
  await page.getByRole('button', { name: 'Save conversion' }).click();

  await expect(page.getByTestId('programme-balance')).toHaveText('10.000 points');
  await expect(page.getByTestId('programme-history')).toContainText('To KrisFlyer');
  await expect(page.getByTestId('programme-history')).toContainText('10.000 → 6.660 miles');

  // Both balances on the Cards page: the airline's filled by the conversion alone.
  await page.goto('/cards/points');
  await expect(programmeRow(page, "Livin' Poin")).toHaveAccessibleName(new RegExp('10\\.000 points'));
  await expect(programmeRow(page, 'KrisFlyer')).toHaveAccessibleName(new RegExp('6\\.660 miles'));
  await expect(programmeRow(page, 'KrisFlyer')).toHaveAccessibleName(new RegExp('No card · converted in'));

  await programmeRow(page, 'KrisFlyer').click();
  await expect(page.getByTestId('programme-balance')).toHaveText('6.660 miles');
  await expect(page.getByTestId('programme-history')).toContainText("From Livin' Poin");

  // Removing the conversion puts both back.
  await page.getByRole('button', { name: "Remove conversion From Livin' Poin" }).click();
  await expect(page.getByTestId('programme-balance')).toHaveText('0 miles');
  await page.goto('/cards/points');
  await expect(programmeRow(page, "Livin' Poin")).toHaveAccessibleName(new RegExp('20\\.000 points'));
});

test('a second card of the bank joins its programme', async ({ page }) => {
  await cardEarningInto(page, 'Mandiri Prioritas', "Livin' Poin");
  await cardEarningInto(page, 'Mandiri Platinum', 'Platinum points');

  await page.goto('/wallet');
  await walletCard(page, 'Mandiri Platinum').click();
  await cardPage(page, 'Settings');
  await page.getByLabel('Earns into', { exact: true }).selectOption({ label: "Livin' Poin" });
  await expect(page.getByTestId('points-balance')).toBeVisible();
  await expect(page.getByRole('button', { name: /^Programme.*Livin' Poin/ })).toBeVisible();

  // One programme for the two cards; the second card's own was empty, so it is put away.
  await page.goto('/cards/points');
  await expect(programmeRow(page, "Livin' Poin")).toHaveAccessibleName(new RegExp('2 cards earn here'));
  await expect(programmeRow(page, 'Platinum points')).toHaveCount(0);
  await programmeRow(page, "Livin' Poin").click();
  await expect(page.getByRole('link', { name: /Mandiri Prioritas/ })).toBeVisible();
  await expect(page.getByRole('link', { name: /Mandiri Platinum/ })).toBeVisible();

  // What a point fetches is set here too, for the card whose terms list it.
  const values = page.getByTestId('point-values');
  await values.getByLabel('Card').selectOption({ label: 'Mandiri Platinum' });
  await values.getByLabel('Redemption').fill('Statement credit');
  await values.getByLabel('Points redeemed').fill('1');
  await values.getByLabel('Worth').fill('25');
  await values.getByRole('button', { name: 'Add value' }).click();
  await expect(values).toContainText(/Statement credit: 1 points = Rp\s25/);
  await expect(values).toContainText('Mandiri Platinum');
  await values.getByRole('button', { name: 'Remove Statement credit' }).click();
  await expect(values).toContainText('No values yet');
});

test('a KrisFlyer programme is drawn as its membership card, its tier changes the face, and an unknown programme keeps the plain face', async ({ page }) => {
  await programmeFaces(page);
});
