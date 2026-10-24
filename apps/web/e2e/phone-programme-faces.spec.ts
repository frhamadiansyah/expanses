import { test } from '@playwright/test';
import { programmeFaces } from './programme-faces';

/** The same membership-card journey as `points-programmes.spec.ts`, at a phone's width with its tab bar. */
test('a KrisFlyer programme is drawn as its membership card, its tier changes the face, and an unknown programme keeps the plain face', async ({ page }) => {
  await programmeFaces(page);
});
