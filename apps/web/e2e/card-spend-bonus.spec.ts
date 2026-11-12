import { test } from '@playwright/test';
import { cardWithPurchase, plasticSpendFlow, flipHero, refundFlow, waiverFlow } from './card-spend-bonus';

/**
 * A card's hero is the card, turned over like a bank or e-wallet account: Owed now and the limit on the back, the
 * nearest spend bonus (or the points) under them. The fee waiver is one row in Settings; a reached challenge is
 * marked Fee waived from its page, which refunds the recorded fee charge and leaves the challenge saying so.
 */
test('the card flips to Owed now; the Fee waiver challenge shows on the back; Fee waived refunds the fee charge and Undo takes it back', async ({ page }) => {
  await cardWithPurchase(page, 'Flip Card', '412000');
  await flipHero(page, 'Flip Card');
  await waiverFlow(page, 'Flip Card');
  await refundFlow(page, 'Flip Card');
});

test('each plastic card’s face says what that card spent this statement', async ({ page }) => {
  await plasticSpendFlow(page);
});
