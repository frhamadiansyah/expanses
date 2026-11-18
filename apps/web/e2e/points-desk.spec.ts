import { expect, type Page, test } from '@playwright/test';
import { openCard, openFace } from './accounts';
import { addTransaction } from './add-transaction';
import { cardPage, saveCardTerms, setUpRewardsByHand, walletCard } from './card-section';

/*
 * Points on a wide screen (Mac redesign step 9, option A): every programme in one table with a small card before its
 * name — its membership card as the iPhone draws it, or, the Mac's own, its bank's drawn card for a bank's programme no
 * membership card is drawn for — over Worth, Earned and Expiring soon. A click opens the programme's side peek (the card
 * big, the balance, Convert, Adjust, Redeem, Edit, Earned with, Recent, Expire), a double-click or Open today's
 * programme page. Invented programmes and figures.
 */

test.beforeEach(({ page }) => {
  page.on('dialog', (dialog) => void dialog.accept());
});

const peek = (page: Page) => page.getByTestId('points-peek');
const row = (page: Page, name: string) => page.getByTestId('points-row').filter({ has: page.getByRole('link', { name: new RegExp(`^${name}, `) }) });

async function addProgramme(page: Page, name: string, unit: 'points' | 'miles' | 'cashback') {
  await page.locator('header').getByRole('button', { name: 'Add programme' }).click();
  await page.getByRole('dialog').getByLabel('Name').fill(name);
  await page.getByRole('dialog').getByLabel('Counted in').selectOption(unit);
  await page.getByRole('dialog').getByRole('button', { name: 'Add programme' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
}

/** From the open peek: the balance the programme's own app shows, and what one of its points is worth. */
async function adjustAndValue(page: Page, name: string, balance: string, value?: string) {
  await row(page, name).click();
  await expect(peek(page).getByTestId('peek-title')).toHaveText(name);
  await peek(page).getByRole('button', { name: 'Adjust' }).click();
  await page.getByLabel('Actual balance').fill(balance);
  await page.getByRole('dialog').getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  if (!value) return;
  await peek(page).getByRole('button', { name: 'Edit' }).click();
  await page.getByRole('dialog').getByRole('button', { name: /Value per point/ }).click();
  await page.getByLabel(/^1 \w+ = Rp/).fill(value);
  await page.getByRole('button', { name: 'Save value' }).click();
  await page.getByRole('button', { name: 'Save programme' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
}

test('each programme wears its card — its membership card, its bank’s card, or the plain face — with the phone’s figures, and Worth adds up', async ({ page }) => {
  await page.goto('/cards/points');
  await expect(page.getByRole('heading', { name: 'Points', level: 1 })).toBeVisible();
  await addProgramme(page, 'KrisFlyer', 'miles');
  await addProgramme(page, 'BCA Rewards', 'points');
  await addProgramme(page, 'Hilton Honors', 'points');
  await adjustAndValue(page, 'KrisFlyer', '12.500', '200');
  await adjustAndValue(page, 'BCA Rewards', '8.000', '50');
  await adjustAndValue(page, 'Hilton Honors', '3.000');
  await page.keyboard.press('Escape');
  await expect(peek(page)).toHaveCount(0);

  // KrisFlyer is its membership card, whole, with nothing laid over it; BCA Rewards wears BCA's drawn card; Hilton the plain face.
  await expect(row(page, 'KrisFlyer')).toHaveAttribute('data-face', 'krisflyer');
  await expect(row(page, 'KrisFlyer').getByTestId('programme-art')).toBeAttached();
  await expect(row(page, 'KrisFlyer').getByTestId('card-chip')).toHaveCount(0);
  await expect(row(page, 'BCA Rewards')).toHaveAttribute('data-face', 'bca');
  await expect(row(page, 'BCA Rewards').getByTestId('card-face')).toHaveAttribute('data-face', 'bca');
  await expect(row(page, 'Hilton Honors')).not.toHaveAttribute('data-face', /./);
  await expect(row(page, 'Hilton Honors').getByTestId('card-face')).not.toHaveAttribute('data-face', /./);
  // The small card is about an icon's width.
  const small = await row(page, 'KrisFlyer').getByTestId('card-face').boundingBox();
  expect(Math.round(small!.width)).toBe(46);

  // The table's figures: balance, worth at the value per point, nothing for a programme with none.
  await expect(row(page, 'KrisFlyer').getByTestId('points-row-balance')).toContainText('12.500');
  await expect(row(page, 'KrisFlyer').getByTestId('points-row-worth')).toHaveText('Rp 2.500.000');
  await expect(row(page, 'BCA Rewards').getByTestId('points-row-worth')).toHaveText('Rp 400.000');
  await expect(row(page, 'Hilton Honors').getByTestId('points-row-worth')).toHaveText('—');

  // Worth is its unit rows added up, the unvalued programme said and left out.
  await expect(page.getByTestId('points-worth-miles')).toContainText('Rp 2.500.000');
  await expect(page.getByTestId('points-worth-points')).toContainText('Rp 400.000');
  await expect(page.getByTestId('points-worth-total')).toHaveText('Rp 2.900.000');
  await expect(page.getByTestId('points-worth-unvalued')).toContainText('1 programme with no value per point');

  // The programme's own page reads the same balance and worth.
  await row(page, 'KrisFlyer').getByRole('link').dblclick();
  await expect(page).toHaveURL(/\/cards\/points\/[^/]+$/);
  await expect(page.getByTestId('programme-balance')).toHaveText('12.500 miles');
  await expect(page.getByTestId('programme-provenance')).toContainText('Rp 2.500.000');
});

test('a click opens the peek — the card big, balance, Earned with, Recent, Expire — ⌃ ⌄ step, Esc closes, Open and a double-click open the page', async ({ page }) => {
  // A card at BCA earning into a programme whose own name names no bank: it wears BCA's card by the card's issuer.
  await openCard(page, { name: 'Kartu Seroja', bank: 'BCA' });
  await page.goto('/wallet');
  await openFace(walletCard(page, 'Kartu Seroja'));
  await cardPage(page, 'Settings');
  await page.getByLabel('Billing date').fill('25');
  await page.getByLabel('Due date').fill('12');
  await saveCardTerms(page);
  await setUpRewardsByHand(page, { name: 'Poin Seroja' });
  await page.getByRole('button', { name: 'Add rule' }).click();
  await page.getByLabel('Rule name').fill('Base');
  await page.getByLabel('Points', { exact: true }).fill('1');
  await page.getByLabel('Per spend').fill('2500');
  await page.getByRole('button', { name: 'Save rule' }).click();
  await expect(page.getByText('1 per Rp')).toBeVisible();
  await page.goto('/transactions');
  // The pickers name the card with its bank in front.
  await addTransaction(page, { description: 'Toko Kenanga', paidWith: 'BCA Kartu Seroja', category: 'Groceries', amount: '250000' });

  await page.setViewportSize({ width: 1280, height: 860 });
  await page.goto('/cards/points');
  await addProgramme(page, 'KrisFlyer', 'miles');
  await adjustAndValue(page, 'KrisFlyer', '5.000');
  await page.keyboard.press('Escape');

  await expect(row(page, 'Poin Seroja')).toHaveAttribute('data-face', 'bca');
  await row(page, 'Poin Seroja').click();
  await expect(page).toHaveURL(/\/cards\/points$/);
  await expect(peek(page).getByTestId('peek-title')).toHaveText('Poin Seroja');
  // The card drawn big at the top, BCA's.
  const big = peek(page).getByTestId('peek-face').getByTestId('card-face');
  await expect(big).toHaveAttribute('data-face', 'bca');
  expect(Math.round((await big.boundingBox())!.width)).toBe(306);
  // The balance as its page says it, and the cards earning here with this statement's points.
  await expect(peek(page).getByTestId('peek-balance')).toHaveText('100 points');
  await expect(peek(page).getByTestId('peek-provenance')).toHaveText('0 posted · 100 estimated');
  await expect(peek(page).getByTestId('peek-earner')).toHaveText(/Kartu Seroja\s*\+100 this statement/);
  await expect(peek(page).getByTestId('peek-recent-row').first()).toContainText('Kartu Seroja');
  await expect(peek(page).getByTestId('peek-recent-row').first()).toContainText('+100');
  await expect(peek(page).getByTestId('peek-expire')).toContainText('Never');
  for (const name of ['Convert', 'Adjust', 'Redeem', 'Edit', 'Open']) await expect(peek(page).getByRole('button', { name, exact: true })).toBeVisible();

  // The page makes room for the peek: no figure under it at 1280.
  await expect(row(page, 'Poin Seroja')).toHaveAttribute('aria-selected', 'true');
  await expect
    .poll(async () => {
      const table = await page.getByTestId('points-programmes').boundingBox();
      const panel = await peek(page).boundingBox();
      return table!.x + table!.width <= panel!.x;
    })
    .toBe(true);

  // Redeem lists the uses alone; Convert the programmes too.
  await peek(page).getByRole('button', { name: 'Redeem' }).click();
  await expect(page.getByRole('dialog').getByRole('heading', { name: 'Redeem' })).toBeVisible();
  await expect(page.getByRole('dialog').getByRole('button', { name: 'Something else…' })).toBeVisible();
  await expect(page.getByRole('dialog').getByRole('button', { name: 'Another programme…' })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await peek(page).getByRole('button', { name: 'Convert' }).click();
  await expect(page.getByRole('dialog').getByRole('button', { name: 'Another programme…' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);

  // ⌄ steps to the next programme, the membership card drawn big; Esc closes.
  await peek(page).getByRole('button', { name: 'Next programme' }).click();
  await expect(peek(page).getByTestId('peek-title')).toHaveText('KrisFlyer');
  await expect(peek(page).getByTestId('peek-face').getByTestId('programme-art')).toBeAttached();
  await expect(peek(page).getByTestId('peek-balance')).toHaveText('5.000 miles');
  await expect(peek(page).getByTestId('peek-earners')).toContainText('No card earns here');
  await page.keyboard.press('Escape');
  await expect(peek(page)).toHaveCount(0);

  // Open is the programme's own page, reading the same balance.
  await row(page, 'Poin Seroja').click();
  await peek(page).getByRole('button', { name: 'Open' }).click();
  await expect(page).toHaveURL(/\/cards\/points\/[^/]+$/);
  await expect(page.getByTestId('programme-balance')).toHaveText('100 points');
  await page.goBack();

  // A double-click on a row is its page too.
  await row(page, 'KrisFlyer').dblclick();
  await expect(page).toHaveURL(/\/cards\/points\/[^/]+$/);
  await expect(page.getByTestId('programme-balance')).toHaveText('5.000 miles');
  await page.goBack();

  // A statement's line in Recent opens that card's points.
  await row(page, 'Poin Seroja').click();
  await peek(page).getByTestId('peek-recent-row').first().click();
  await expect(page).toHaveURL(/\/cards\/[^/]+\/points$/);
});
