import { expect, test } from '@playwright/test';
import { editGoal } from './goals';
import { addGoal, addMoneyAccount, goalCard, goalRow, setAside } from './set-aside';

test('a goal can be deleted: its set-aside is released and the goal is gone from the list', async ({ page }) => {
  page.on('dialog', (dialog) => void dialog.accept());
  await addMoneyAccount(page, 'BCA Tahapan', 'bank', '20000000');
  await addGoal(page, 'Holiday fund', '10000000');
  await setAside(page, 'Holiday fund', 'BCA Tahapan', '4000000');

  const card = await goalCard(page, 'Holiday fund');
  await editGoal(card);
  await page.getByRole('button', { name: 'Delete goal' }).click();

  await expect(page).toHaveURL(/\/goals$/);
  await expect(goalRow(page, 'Holiday fund')).toHaveCount(0);
});
