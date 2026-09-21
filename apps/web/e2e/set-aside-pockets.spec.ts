import { expect, test } from '@playwright/test';
import { mockRates, openWithPockets } from './pockets';
import { addGoal, goalCard, setAside } from './set-aside';

test.beforeEach(({ page }) => {
  page.on('dialog', (dialog) => void dialog.accept());
});

/**
 * The pockets Move page is a transfer door (set-aside ruling I5): silent while the move fits in what is free on the
 * pocket it leaves, and asking "Move the promise" or "No — borrowing" once it takes more.
 */
test('moving between pockets asks only when it takes promised money, and the promise follows at the move\'s own rate', async ({ page }) => {
  await mockRates(page, { SGD: 12_680 });
  await openWithPockets(page, {
    name: 'Valas Plus',
    pockets: [
      { currency: 'USD', balance: '2400.00', rate: '16250' },
      { currency: 'SGD', balance: '1150.00' },
    ],
  });
  await addGoal(page, 'Umrah 2027', '40000000');
  // US$2.000,00 of the US$2.400,00 promised: US$400,00 free.
  await setAside(page, 'Umrah 2027', 'Valas Plus · USD (USD)', '2000.00');

  await page.goto('/accounts');
  await page.getByRole('link', { name: 'Valas Plus', exact: true }).click();
  await page.getByRole('link', { name: /Move between pockets/ }).click();
  await page.getByLabel('From').selectOption('USD');
  await page.getByLabel('To').selectOption('SGD');
  const leaves = page.getByLabel('Leaves USD');
  await leaves.pressSequentially('400');
  await expect(page.getByText(/more than is free/)).toHaveCount(0);
  await leaves.clear();
  await leaves.pressSequentially('500');
  await page.getByLabel('Arrives SGD').pressSequentially('638');
  // One hundred dollars over what is free: the question, and no move until it is answered.
  await expect(page.getByText(/100,00 more than is free/)).toBeVisible();
  // A pocket parent is never offered as where the promise goes: only the pocket the money reaches.
  await expect(page.getByRole('button', { name: 'Move the promise to Valas Plus', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Move it' }).click();
  await expect(page.getByRole('heading', { name: 'Move between pockets' })).toBeVisible();

  await page.getByRole('button', { name: 'Take from Umrah 2027' }).click();
  await page.getByRole('button', { name: 'Move the promise to Valas Plus · SGD' }).click();
  await page.getByRole('button', { name: 'Move it' }).click();
  await expect(page.getByTestId('pocket-USD')).toContainText('1.900,00');

  await page.goto('/goals');
  const umrah = goalCard(page, 'Umrah 2027');
  // US$100,00 over moved at 638 ÷ 500: S$127,60 now promised on the SGD pocket, US$1.900,00 left on USD.
  await expect(umrah.getByTestId('goal-link').filter({ hasText: 'Valas Plus · SGD' })).toContainText('127,60');
  await expect(umrah.getByTestId('goal-link').filter({ hasText: 'Valas Plus · USD' })).toContainText('1.900,00');
});
