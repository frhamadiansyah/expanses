import { expect, type Page, test } from '@playwright/test';

test.beforeEach(({ page }) => {
  page.on('dialog', (dialog) => void dialog.accept());
});

async function type(page: Page, label: string, text: string) {
  const box = page.getByLabel(label, { exact: true }).last();
  await box.click();
  await box.press('ControlOrMeta+a');
  await box.pressSequentially(text, { delay: 30 });
}

async function retirementFigures(page: Page) {
  await type(page, 'Yearly spending in retirement (IDR)', '120000000');
  await type(page, 'Your age now', '35');
  await type(page, 'Age you retire', '55');
}

test('the catalogue says what each calculator answers, and opens its own page', async ({ page }) => {
  await page.goto('/calculators');
  // A row carries the sentence its page repeats, and no fields: choosing happens here, working out happens there.
  await expect(page.getByRole('link', { name: /Emergency fund/ })).toContainText('Months of outgoings, loan principal included');
  await expect(page.getByLabel('What goes out a month (IDR)')).toHaveCount(0);

  await page.getByRole('link', { name: /Retirement fund/ }).click();
  await expect(page).toHaveURL(/\/calculators\/retirement$/);
  await expect(page.getByRole('heading', { name: 'Retirement fund' })).toBeVisible();
  await expect(page.getByText('What the pot must hold the day you stop, drawn down while it earns.')).toBeVisible();

  // The way back names the list rather than "Back". Scoped by its own label: the sidebar has a Calculators link too.
  await page.getByLabel('Calculators', { exact: true }).click();
  await expect(page).toHaveURL(/\/calculators$/);
  await expect(page.getByRole('heading', { name: 'Calculators' })).toBeVisible();
});

test('an emergency fund is saved over a horizon and a rate you set, not a buried assumption', async ({ page }) => {
  await page.goto('/calculators/emergency');
  await type(page, 'What goes out a month (IDR)', '1000000');

  // Three months of outgoings — the prefill for single, salaried — make the pot.
  await expect(page.getByTestId('answer-emergency')).toContainText('3.000.000');
  // The kit's two assumptions now sit in the boxes they were made in.
  await expect(page.getByLabel('Save it over (months)')).toHaveValue('12');
  await expect(page.getByLabel('Est. return a year (%)')).toHaveValue('2');

  // A rate of nothing is plain division: three million over a year is 250.000 a month.
  await type(page, 'Est. return a year (%)', '0');
  await expect(page.getByTestId('answer-emergency')).toContainText('250.000');
  // Stretch it to two years and the month is halved.
  await type(page, 'Save it over (months)', '24');
  await expect(page.getByTestId('answer-emergency')).toContainText('125.000');
  // A horizon of nothing is refused on its row, and the answer waits rather than lying.
  await type(page, 'Save it over (months)', '0');
  await expect(page.getByText('Not below one month')).toBeVisible();
  await expect(page.getByTestId('answer-emergency')).toHaveCount(0);
});

test('answers what retirement costs a month without saving anything', async ({ page }) => {
  await page.goto('/calculators/retirement');
  await retirementFigures(page);

  // 120 jt a year for 20 years at 5% against 3.5%, in the money of the day you stop.
  await expect(page.getByTestId('answer-retirement')).toContainText('4.120.008.061');
  await expect(page.getByTestId('answer-retirement')).toContainText('Save each month');

  // Nothing is stored until it is asked for.
  await page.goto('/goals');
  await expect(page.getByRole('heading', { name: 'Retirement fund' })).toHaveCount(0);
});

test('saves each month at the return while saving, not the return while retired', async ({ page }) => {
  await page.goto('/calculators/retirement');
  await retirementFigures(page);
  const card = page.getByTestId('answer-retirement').locator('div > div').nth(1);
  await expect(card).toContainText('Save each month');
  const monthly = card.locator('p').nth(1);
  const at10 = await monthly.innerText();

  await type(page, 'Return while saving (%)', '5');
  await expect(monthly).not.toHaveText(at10);
  const at5 = await monthly.innerText();
  // The pot is the same; only what a month has to put in moves.
  await expect(page.getByTestId('answer-retirement')).toContainText('4.120.008.061');
  const figure = (text: string) => Number(text.replace(/\D/g, ''));
  expect(figure(at5)).toBeGreaterThan(figure(at10));

  // The drawdown return moves the pot instead.
  await type(page, 'Return while saving (%)', '10');
  await expect(monthly).toHaveText(at10);
  await type(page, 'Return while retired (%)', '8');
  await expect(page.getByTestId('answer-retirement')).not.toContainText('4.120.008.061');
});

test('a half-typed rate is refused on its row and the page stays up', async ({ page }) => {
  await page.goto('/calculators/retirement');
  await retirementFigures(page);
  await expect(page.getByTestId('answer-retirement')).toContainText('4.120.008.061');

  for (const half of ['-', ',']) {
    await type(page, 'Inflation a year (%)', half);
    await expect(page.getByText('Type a percentage, like 3,5')).toBeVisible();
    await expect(page.getByTestId('answer-retirement')).toHaveCount(0);
  }
  await type(page, 'Years in retirement', '20,5');
  await expect(page.getByText('Whole years, like 10')).toBeVisible();
  await type(page, 'Years in retirement', '20');
  await type(page, 'Inflation a year (%)', '3,5');
  await expect(page.getByTestId('answer-retirement')).toContainText('4.120.008.061');
  await expect(page.getByRole('heading', { name: 'Retirement fund' })).toBeVisible();
});

test('turns the answer into a goal, which reaches the budget sheet', async ({ page }) => {
  await page.goto('/calculators/retirement');
  await retirementFigures(page);
  await page.getByRole('button', { name: 'Save Retirement fund as a goal' }).click();
  await expect(page.getByText('Saved Retirement fund as a goal.')).toBeVisible();

  await page.goto('/goals');
  await expect(page.getByRole('heading', { name: 'Retirement fund' })).toBeVisible();
  await expect(page.getByText('Worked out from your figures')).toBeVisible();

  await page.goto('/budget');
  await expect(page.getByTestId('savings-Retirement fund')).toContainText('a month');
});

test('says what the levels will cost when the time comes, and saves them as a goal', async ({ page }) => {
  await page.goto('/calculators/education');
  // The page opens with one level to fill in.
  await type(page, 'Starts in year', '2036');
  await type(page, 'Until year', '2040');
  await type(page, 'Academic today (IDR)', '100000000');
  await expect(page.getByText('2036 to 2040 · due 1 January each year')).toBeVisible();

  // Four years at today's 100 juta, each inflated once to its own year, is far more than 400 juta.
  const answer = page.getByTestId('answer-education');
  await expect(answer).toContainText('You need');
  const need = Number((await answer.locator('div > div').first().innerText()).replace(/\D/g, ''));
  expect(need).toBeGreaterThan(400_000_000);

  await page.getByRole('button', { name: 'Save Education fund as a goal' }).click();
  await expect(page.getByText('Saved Education fund as a goal.')).toBeVisible();
  await page.goto('/goals');
  await expect(page.getByRole('heading', { name: 'Education fund' })).toBeVisible();
  await expect(page.getByRole('button', { name: / · year \d+: / })).toHaveCount(4);
});
