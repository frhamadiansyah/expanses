import { expect, type Locator, type Page, test } from '@playwright/test';
import { addPlastic, openCard } from './accounts';
import { addTransaction } from './add-transaction';
import { cardPage, saveCardTerms } from './card-section';

const SHOTS = '/private/tmp/claude-501/-Users-frhamadiansyah-Documents-Projects-Expanses/17ecd7cc-b713-4f21-b1a9-9a90ded56208/scratchpad';

const recent = (page: Page) => page.getByTestId('latest-transactions');

/** A credit card with a billing date, a points programme and a base rule: Recent lists the purchases of a card that earns. */
async function addEarningCard(page: Page, name: string, last4?: string) {
  await openCard(page, { name, last4 });
  await page.goto('/wallet');
  await page.getByRole('region', { name: 'Cards' }).getByRole('link', { name: new RegExp(`^${name}(,|$)`) }).click();
  await cardPage(page, 'Settings');
  await page.getByLabel('Billing date').fill('25');
  await page.getByLabel('Due date').fill('12');
  await saveCardTerms(page);
  await page.getByRole('button', { name: 'Set up rewards' }).click();
  await expect(page.getByText('Step 3 of 3')).toBeVisible();
  await page.getByRole('button', { name: 'Add rule' }).click();
  await page.getByRole('button', { name: 'Save rule' }).click();
  await expect(page.getByText('Step 3 of 3')).toHaveCount(0);
}

/** A horizontal drag across the middle of the raised card, as a finger would make. */
async function swipe(page: Page, target: Locator, dx: number) {
  const box = (await target.boundingBox())!;
  const y = box.y + box.height / 2;
  const x = box.x + box.width / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx / 2, y + 3, { steps: 4 });
  await page.mouse.move(x + dx, y + 3, { steps: 4 });
  await page.mouse.up();
}

test('swiping the card, or tapping its dots, shows that plastic’s purchases; the account stays whole', async ({ page }) => {
  await addEarningCard(page, 'Swipe Card');

  // Made while the account held no card row: it names no card, so it is the primary's.
  await page.goto('/transactions');
  await addTransaction(page, { description: 'Old lunch', paidWith: 'Swipe Card', category: 'Groceries', amount: '30000' });

  await page.goto('/wallet');
  await page.getByRole('region', { name: 'Cards' }).getByRole('link', { name: /^Swipe Card(,|$)/ }).click();
  await cardPage(page, 'Settings');
  await addPlastic(page, '1111', 'Me');
  await addPlastic(page, '2222', 'Spouse');

  await page.goto('/transactions');
  await addTransaction(page, { description: 'Primary dinner', paidWith: 'Swipe Card ···· 1111', category: 'Groceries', amount: '100000' });
  await addTransaction(page, { description: 'Spouse market', paidWith: 'Swipe Card ···· 2222', category: 'Groceries', amount: '450000' });

  await page.goto('/wallet');
  await page.getByRole('region', { name: 'Cards' }).getByRole('link', { name: /^Swipe Card(,|$)/ }).click();
  await expect(page.getByTestId('tile-left-to-pay')).toContainText('Owed now');
  const owed = await page.getByTestId('tile-unpaid-balance').innerText();
  const dots = page.getByRole('group', { name: 'Cards on this account' });
  const primaryDot = dots.getByRole('button', { name: /ending 1111/ });
  const spouseDot = dots.getByRole('button', { name: /ending 2222/ });
  const face = page.locator('[data-place="raised"] button');

  // The primary: its own purchase and the one that named no card.
  await expect(primaryDot).toHaveAttribute('aria-pressed', 'true');
  await expect(recent(page)).toContainText('Primary dinner');
  await expect(recent(page)).toContainText('Old lunch');
  await expect(recent(page)).not.toContainText('Spouse market');
  await page.screenshot({ path: `${SHOTS}/plastic-primary.png` });

  // A swipe left shows the next plastic, and is not a tap: the card page stays open.
  await swipe(page, face, -120);
  await expect(spouseDot).toHaveAttribute('aria-pressed', 'true');
  await expect(recent(page)).toContainText('Spouse market');
  await expect(recent(page)).not.toContainText('Primary dinner');
  await expect(recent(page)).not.toContainText('Old lunch');
  await expect(page.getByTestId('tile-left-to-pay')).toBeVisible();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${SHOTS}/plastic-spouse.png` });

  // The ends hold: another swipe left changes nothing; a swipe right goes back.
  await swipe(page, face, -120);
  await page.waitForTimeout(400);
  await expect(spouseDot).toHaveAttribute('aria-pressed', 'true');
  await swipe(page, face, 120);
  await expect(primaryDot).toHaveAttribute('aria-pressed', 'true');
  await expect(recent(page)).toContainText('Primary dinner');

  // The dots do the same and stay in step.
  await spouseDot.click();
  await expect(recent(page)).toContainText('Spouse market');
  await expect(recent(page)).not.toContainText('Old lunch');
  await primaryDot.click();
  await expect(recent(page)).toContainText('Old lunch');

  // What belongs to the account does not follow the card.
  await expect(page.getByTestId('tile-unpaid-balance')).toHaveText(owed);
  expect(owed).toMatch(/580[.,]000/);

  // A plain tap on the raised card still puts it down.
  await face.click();
  await expect(page.getByTestId('tile-left-to-pay')).toHaveCount(0);
});

test('a card with one plastic shows every purchase and has no dots', async ({ page }) => {
  await addEarningCard(page, 'Solo Card', '3333');
  await page.goto('/transactions');
  await addTransaction(page, { description: 'Solo lunch', paidWith: 'Solo Card', category: 'Groceries', amount: '30000' });
  await page.goto('/wallet');
  await page.getByRole('region', { name: 'Cards' }).getByRole('link', { name: /^Solo Card(,|$)/ }).click();
  await expect(recent(page)).toContainText('Solo lunch');
  // One plastic: no dots to show, and nothing for a swipe to step to.
  await expect(page.getByRole('group', { name: 'Cards on this account' })).toHaveCount(0);
});
