import { test } from '@playwright/test';
import { splitForeignJourney } from './split-foreign';

test('a split bought in another currency on a phone: a part typed in USD, the Rest in both figures, the receipt shows both', async ({ page }) => {
  await splitForeignJourney(page);
});
