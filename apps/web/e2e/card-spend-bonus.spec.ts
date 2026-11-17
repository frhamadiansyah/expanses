import { test } from '@playwright/test';
import { cardWithPurchase, plasticSpendFlow, flipHero, refundFlow, waiverFlow } from './card-spend-bonus';

/**
 * A card's hero is the card, turned over like a bank or e-wallet account: Outstanding and the limit on the back, the
 * nearest spend bonus (or the points) under them. The fee waiver is one row in Settings; a reached challenge is
 * recorded on the Fee waiver page, where Add reversal cancels the recorded fee charge and the challenge says so.
 */
test('the card flips to Outstanding; the Fee waiver challenge shows on the back; Fee waived opens the Fee waiver page, where Add reversal cancels the fee charge', async ({ page }) => {
  await cardWithPurchase(page, 'Flip Card', '412000');
  await flipHero(page, 'Flip Card');
  await waiverFlow(page, 'Flip Card');
  await refundFlow(page, 'Flip Card');
});

test('each plastic card’s face says what that card spent this statement', async ({ page }) => {
  await plasticSpendFlow(page);
});
