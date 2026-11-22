import { test } from '@playwright/test';
import { addCard, addFormHintAndToggle, addFormKeepsTicked, pasteOldAndNew } from './card-past-paid-off';

/* A card purchase dated before the card was added starts out paid off: the phone's width (the desk's: card-past-paid-off.spec). */
test.beforeEach(async ({ page }) => {
  page.on('dialog', (dialog) => void dialog.accept());
  await addCard(page);
});

test('a pasted list on a card: the line before the card was added is Paid off, the card owes only the new one', async ({ page }, info) => {
  await pasteOldAndNew(page, info);
});

test('the Add form ticks an old card purchase paid off by itself, and a tap leaves it owed', async ({ page }, info) => {
  await addFormHintAndToggle(page, info);
});

test('left ticked, an old card purchase is spending and the card owes what it did', async ({ page }) => {
  await addFormKeepsTicked(page);
});
