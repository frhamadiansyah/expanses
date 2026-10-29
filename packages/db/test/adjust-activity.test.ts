import { expect, it } from 'vitest';
import { activityOf, adjustBalance, createAccount, nativeBalances, undoActivity } from '../src/index';
import { setupDb } from './helpers';

it('an Adjust balance reaches the activity list, whichever kind, and Undo takes it back', async () => {
  const { database, ws } = await setupDb();
  const cash = await createAccount(database, ws, { name: 'Pocket cash', kind: 'asset', subtype: 'cash', currency: 'IDR', openingBalanceMinor: 932_500, openedOn: '2026-01-01' });
  await adjustBalance(database, ws, { accountId: cash.id, actualMinor: 887_500, onDate: '2026-10-29', as: 'correction' });
  await adjustBalance(database, ws, { accountId: cash.id, actualMinor: 800_000, onDate: '2026-10-29', as: 'cashflow' });
  const lines = await activityOf(database, ws, {});
  expect(lines).toHaveLength(2);
  expect(lines.map((line) => line.title)).toEqual(['Pocket cash counted', 'Pocket cash counted']);
  expect(lines.every((line) => line.state === 'open' && line.undo?.kind === 'remove')).toBe(true);
  expect((await nativeBalances(database, ws))[cash.id]).toBe(800_000);

  await undoActivity(database, ws, lines[0]!.id);
  expect((await nativeBalances(database, ws))[cash.id]).toBe(887_500);
  await undoActivity(database, ws, lines[1]!.id);
  expect((await nativeBalances(database, ws))[cash.id]).toBe(932_500);
});
