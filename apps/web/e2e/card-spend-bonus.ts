import { expect, type Page } from '@playwright/test';
import { addPlastic, openCard } from './accounts';
import { addTransaction } from './add-transaction';
import { cardPage, pickChargedOn, saveCardTerms, showCardBack } from './card-section';

const pad = (n: number) => String(n).padStart(2, '0');
export const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const days = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d;
};
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** A card billed on the 31st (so today is always on the open statement) with a purchase on it. */
export async function cardWithPurchase(page: Page, name: string, amount: string) {
  await openCard(page, { name, statementDay: '31', dueDay: '15' });
  await buy(page, name, amount);
}

export async function buy(page: Page, card: string, amount: string) {
  await page.goto('/transactions');
  await addTransaction(page, { description: 'Noodle House', paidWith: card, category: 'Groceries', amount });
}

export async function openWalletCard(page: Page, name: string) {
  await page.goto('/wallet');
  await page.getByRole('region', { name: 'Cards' }).getByRole('link', { name: new RegExp(`^${name}(,|$)`) }).click();
  await expect(page).toHaveURL(/\/cards\/[^/]+$/);
}

/** The card's hero is the card: face up to begin with, Outstanding on the back, and nothing of it left under the card. */
export async function flipHero(page: Page, name: string) {
  await openWalletCard(page, name);
  const raised = page.getByRole('region', { name: 'Cards' }).locator('[data-place="raised"]');
  await expect(raised.getByTestId('card-face')).toBeVisible();
  await expect(page.getByTestId('tile-left-to-pay')).toBeHidden();
  const turn = page.getByRole('button', { name: /, show balance$/ });
  await expect(turn).toHaveAttribute('aria-pressed', 'false');
  // The page below is the four round buttons, then Recent: no Owed tile, no statement block.
  await expect(page.getByRole('group', { name: 'Actions' }).getByRole('button')).toHaveText(['Pay']);
  await expect(page.getByRole('group', { name: 'Actions' }).getByRole('link')).toHaveText(['Spend', 'Points', 'Statement']);
  await expect(page.getByRole('heading', { name: 'Recent' })).toBeVisible();
  await expect(page.getByText('Spent this statement')).toHaveCount(0);
  // One plastic card: nothing is printed top-right of its face.
  await expect(page.getByTestId('face-spent')).toHaveCount(0);
  const front = (await raised.boundingBox())!;

  await turn.click();
  const back = page.getByTestId('tile-left-to-pay');
  await expect(back).toBeVisible();
  await expect(back).toContainText('Outstanding');
  await expect(back.getByTestId('tile-unpaid-balance')).toContainText('412.000');
  await expect(back.getByTestId('limit-bar')).toHaveCount(0);
  // No bonus yet and no rewards on this card: the slot says so rather than showing a ring.
  await expect(page.getByTestId('back-bonus')).toHaveCount(0);
  await expect(page.getByTestId('back-points')).toContainText('Rewards are not set up');
  // The back is the card's own box.
  await expect.poll(async () => Math.abs((await back.boundingBox())!.height - front.height)).toBeLessThanOrEqual(1);
  await page.getByRole('button', { name: /, show card$/ }).click();
  await expect(back).toBeHidden();
}

/** Sets the annual fee on the card's Settings and returns to the Fee waiver row. */
export async function setFee(page: Page, fee: string, chargedOn: string) {
  await cardPage(page, 'Settings');
  await page.getByLabel('Annual fee', { exact: true }).fill(fee);
  await pickChargedOn(page, chargedOn);
  await saveCardTerms(page, 'Annual fee');
  await page.waitForTimeout(400);
}

/** The Fee waiver flow: None to begin with, a challenge chosen and filled in, the row and the card's back saying so. */
export async function waiverFlow(page: Page, name: string) {
  await openWalletCard(page, name);
  const chargedOn = new Date();
  chargedOn.setFullYear(chargedOn.getFullYear() - 1);
  chargedOn.setDate(chargedOn.getDate() - 15);
  await setFee(page, '800000', iso(chargedOn));

  const row = page.getByTestId('fee-waiver-row');
  await expect(row).toContainText('None');
  // Settings keeps three rows in Annual fee: no This year's fee.
  await expect(page.getByTestId('card-annual-fee')).toHaveCount(0);
  await row.click();
  await expect(page.getByRole('heading', { name: 'Fee waiver', exact: true }).first()).toBeVisible();
  // A challenge asks for the spend, the day it counts from, the day to spend by and what counts: no Then or reminder rows.
  await page.getByTestId('waiver-challenge').click();
  await expect(page.getByLabel('Then')).toHaveCount(0);
  await page.getByLabel('Spend', { exact: true }).fill('1500000');
  await page.getByLabel('Counted from').fill(iso(days(-10)));
  const by = days(3);
  await page.getByLabel('Spend by').fill(iso(by));
  // Progress is the spend the challenge counts so far, a plain amount.
  await expect(page.getByTestId('fee-progress')).toContainText('412.000');
  await page.getByRole('button', { name: 'Save', exact: true }).click();

  // What is left to spend, short: Rp 1.088.000 reads as 1,1 jt.
  await expect(page.getByTestId('fee-waiver-row')).toContainText(/Rp\s1,1 jt to go/);
  // Tapping the row again shows the kind ticked; the card's back carries the challenge with what is left.
  await openWalletCard(page, name);
  await showCardBack(page);
  const bonus = page.getByTestId('back-bonus');
  await expect(bonus).toContainText('Fee waiver challenge');
  await expect(bonus).toContainText('Rp 800.000');
  await expect(bonus).toContainText('1.088.000 to go');
  await expect(bonus).toContainText('3 days left');
}

/**
 * A met challenge's fee, recorded on the Fee waiver page (owner, 13 Nov 2026): the reached challenge's Fee waived opens
 * the page; the fee charge already on the card is its Charged line, and ⋮ → Add reversal cancels it in its category.
 * The challenge then says it was waived, with what came back, and Settings' Fee waiver row reads the year waived.
 */
export async function refundFlow(page: Page, name: string) {
  await buy(page, name, '1200000');
  // The annual fee, as a statement names it, on the day it was charged (this year's, 15 days ago).
  const charged = days(-15);
  const year = charged.getFullYear();
  await page.goto('/transactions');
  await addTransaction(page, { description: 'BIAYA KARTU TAHUNAN', paidWith: name, category: 'Fees & charges', amount: '800000', date: iso(charged) });
  await openWalletCard(page, name);
  await showCardBack(page);
  const bonus = page.getByTestId('back-bonus');
  await expect(bonus).toContainText('Fee waiver challenge');
  await expect(bonus).toContainText('Rp 1.500.000 reached');
  await expect(bonus.getByTestId('bonus-ring')).toHaveAccessibleName('Reached');
  await expect(page.getByTestId('tile-unpaid-balance')).toContainText('2.412.000');

  await bonus.click();
  await expect(page.getByRole('heading', { name: 'Spend bonuses · nearest first' })).toBeVisible();
  await page.getByTestId('fee-waived').click();
  await expect(page).toHaveURL(/\/settings\/fee-waiver$/);
  await expect(page.getByText("This year's fee", { exact: true })).toBeVisible();
  const charge = page.getByTestId('fee-line-charged');
  await expect(charge.getByTestId('fee-line-charged-value')).toHaveText(`${charged.getDate()} ${MONTHS[charged.getMonth()]} · Rp 800.000`);
  await expect(page.getByTestId('fee-line-reversal')).toHaveCount(0);

  // ⋮ on Charged: Add reversal, Open the charge, Cancel. Cancel changes nothing.
  await charge.click();
  const menu = page.getByTestId('fee-menu');
  await expect(menu.getByRole('button')).toHaveText(['Add reversal', 'Open the charge', 'Cancel']);
  await menu.getByRole('button', { name: 'Cancel' }).click();
  await expect(menu).toHaveCount(0);
  await charge.click();
  await page.getByTestId('fee-menu-add-reversal').click();
  const sheet = page.getByRole('dialog', { name: 'Add reversal' });
  await expect(sheet.getByLabel('Amount')).toHaveValue('800.000');
  await sheet.getByRole('button', { name: 'Save' }).click();
  await expect(sheet).toHaveCount(0);
  const today = new Date();
  const back = today.getFullYear() === year ? `${today.getDate()} ${MONTHS[today.getMonth()]}` : `${today.getDate()} ${MONTHS[today.getMonth()]} ${today.getFullYear()}`;
  await expect(page.getByTestId('fee-line-reversal-value')).toHaveText(`${back} · Rp 800.000`);
  // Once money is back, Charged offers no second reversal.
  await charge.click();
  await expect(page.getByTestId('fee-menu').getByRole('button')).toHaveText(['Open the charge', 'Cancel']);
  await page.getByTestId('fee-menu').getByRole('button', { name: 'Cancel' }).click();

  await page.waitForTimeout(800);
  await openWalletCard(page, name);
  await showCardBack(page);
  await expect(page.getByTestId('tile-unpaid-balance')).toContainText('1.612.000');
  await expect(page.getByTestId('back-bonus')).toContainText('✓ Fee waived · Rp 800.000');

  await page.goto('/transactions');
  await expect(page.getByText('Annual fee reversal')).toBeVisible();

  await openWalletCard(page, name);
  await cardPage(page, 'Settings');
  await expect(page.getByTestId('fee-waiver-row')).toContainText(`${year} waived`);
  // ⋮ on Reversal opens it like any transaction.
  await page.getByTestId('fee-waiver-row').click();
  await page.getByTestId('fee-line-reversal').click();
  await page.getByTestId('fee-menu-open-reversal').click();
  await expect(page).toHaveURL(/\/transactions\/[^/]+$/);
}

/** A credit card with a primary and a supplementary plastic: each one's face says what that card spent this statement. */
export async function plasticSpendFlow(page: Page) {
  await openCard(page, { name: 'Twin Card', bank: 'BCA', last4: '1467', statementDay: '31', dueDay: '15' });
  await openWalletCard(page, 'BCA Twin Card');
  await cardPage(page, 'Settings');
  await addPlastic(page, '8802', 'Spouse');
  await buy(page, 'BCA Twin Card ···· 1467', '120000');
  await buy(page, 'BCA Twin Card ···· 8802', '450000');

  await openWalletCard(page, 'BCA Twin Card');
  const spent = page.getByTestId('face-spent');
  // The primary leads; its own spend, small "Spent" over the figure.
  await expect(spent).toContainText('Spent');
  await expect(spent).toContainText('120.000');
  await page.getByRole('button', { name: /^Show card ending 8802/ }).click();
  await expect(spent).toContainText('450.000');
  // The back is the whole account: both cards' spend is owed.
  await showCardBack(page);
  await expect(page.getByTestId('tile-unpaid-balance')).toContainText('570.000');
}
