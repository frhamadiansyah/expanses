import { expect, type Page } from '@playwright/test';

/**
 * A card on the wallet, by name. The Cards page also lists the points programmes, and a programme's row carries the
 * name of the card earning into it, so a card is looked for on the wallet itself.
 */
export const walletCard = (page: Page, name: string | RegExp) => page.getByRole('region', { name: 'Cards' }).getByRole('link', { name });

/**
 * Open one of the card's own pages from its summary. The four tabs it had are pages now: the statement (the round
 * Statement button), this statement's points (the round Points, Miles or Cashback button), and the settings (⚙ in the corner), which hold
 * what the Card and Rewards rules tabs did.
 */
export async function cardPage(page: Page, which: 'Statement' | 'Points' | 'Settings') {
  const main = page.getByRole('main');
  if (which === 'Statement') await main.getByRole('group', { name: 'Actions' }).getByRole('link', { name: 'Statement', exact: true }).click();
  else if (which === 'Points') await main.getByRole('group', { name: 'Actions' }).getByRole('link', { name: /^(Points|Miles|Cashback)$/ }).click();
  else await main.getByRole('link', { name: 'Settings', exact: true }).first().click();
  const title = { Statement: 'Statement', Points: "This statement's points", Settings: 'Settings' }[which];
  await expect(page.getByRole('heading', { name: title, exact: true }).first()).toBeVisible();
}

/**
 * Open a page under the card's Settings: Card product, Earning rules, Spend bonuses. A card on the catalogue shows no
 * rules or bonuses rows (it follows the catalogue), so for those the editor is reached by its address, which still
 * stands, to exercise the editors on catalogue rows.
 */
export async function cardSettingsPage(page: Page, which: 'Card product' | 'Earning rules' | 'Spend bonuses') {
  const row = page.getByRole('main').getByRole('button', { name: new RegExp(`^${which}`) });
  if (which !== 'Card product' && (await row.count()) === 0) {
    const here = new URL(page.url()).pathname.replace(/\/$/, '');
    await page.goto(`${here}/${which === 'Earning rules' ? 'rules' : 'bonuses'}`);
  } else {
    await row.click();
  }
  await expect(page.getByRole('heading', { name: which, exact: true }).first()).toBeVisible();
}

/** The card's purchases with what each earned: this statement's points, then Purchases. */
export async function cardPurchases(page: Page) {
  await cardPage(page, 'Points');
  await cardPointsPage(page, 'Purchases');
}

/**
 * Save the card's terms from its Settings page: Enter in a terms field (Due date unless given) is the form's own
 * save, and the page stays; the short wait lets the write settle before the spec moves on.
 */
export async function saveCardTerms(page: Page, field = 'Due date') {
  await page.getByLabel(field, { exact: true }).press('Enter');
  await page.waitForTimeout(500);
}

/**
 * From the card's Settings: choose the card from the catalogue. Card product → search → the card → its preview →
 * Use this card, which lands back on Settings with the product filled. `level` picks a member level when the card has them.
 */
export async function chooseCatalogueCard(page: Page, search: string, entryName: string, level?: string) {
  await page.getByRole('main').getByRole('button', { name: /^Card product/ }).click();
  await expect(page.getByRole('heading', { name: 'Card product', exact: true }).first()).toBeVisible();
  await page.getByLabel('Search card or bank').fill(search);
  await page.getByRole('main').getByRole('button', { name: new RegExp(`^${entryName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}( |$)`) }).first().click();
  if (level) await page.getByLabel('Level').selectOption({ label: level });
  await page.getByRole('button', { name: 'Use this card' }).click();
  await expect(page.getByRole('heading', { name: 'Settings', exact: true }).first()).toBeVisible();
}

/**
 * From the card's Settings: set its rewards up by hand — Card product → My card is not listed → Save — and open its
 * Earning rules page, where the rule forms are. `unit` and `name` fill the by-hand form first.
 */
export async function setUpRewardsByHand(page: Page, opts: { unit?: 'Points' | 'Miles' | 'Cashback'; name?: string; openRules?: boolean } = {}) {
  await page.getByRole('main').getByRole('button', { name: /^Card product/ }).click();
  await page.getByRole('button', { name: 'My card is not listed' }).click();
  await expect(page.getByRole('heading', { name: 'Set up by hand', exact: true }).first()).toBeVisible();
  if (opts.name) await page.getByLabel('Program name').fill(opts.name);
  if (opts.unit) await page.getByLabel('Earns').selectOption({ label: opts.unit });
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  if (opts.openRules === false) return;
  await page.getByRole('main').getByRole('button', { name: /^Earning rules/ }).click();
  await expect(page.getByRole('heading', { name: 'Earning rules', exact: true }).first()).toBeVisible();
}

/** Open a page under this statement's points — the purchases, or the points the statement shows. */
export async function cardPointsPage(page: Page, which: 'Purchases' | 'Points the statement shows') {
  await page.getByRole('main').getByRole('link', { name: new RegExp(`^${which}`) }).click();
  await expect(page.getByRole('heading', { name: which === 'Purchases' ? 'Purchases' : 'Points on the statement', exact: true }).first()).toBeVisible();
}

/**
 * Start the card's first instalment plan, the only way in while it has none: Settings, the Instalments row, then ＋.
 * The New instalment plan sheet is left open for the caller to fill.
 */
export async function startPlan(page: Page) {
  await cardPage(page, 'Settings');
  await page.getByRole('main').getByRole('link', { name: /^Instalments/ }).click();
  await expect(page.getByRole('heading', { name: 'Instalments', exact: true }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Add a plan' }).click();
}

/** Back from the Instalments page and the settings to the card's own page, where the plans box now shows. */
export async function backToCardFromPlans(page: Page) {
  await page.goBack();
  await page.goBack();
  await expect(page.getByTestId('card-instalments')).toBeVisible();
}
