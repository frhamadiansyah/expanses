import { expenseLines } from '@expanses/core';
import { describe, expect, it } from 'vitest';
import {
  clearTransactionPointActual,
  createAccount,
  createProgram,
  listAccounts,
  listPrograms,
  listTransactionPointActuals,
  PointsError,
  postTransaction,
  recordTransactionPointActual,
  replaceTransaction,
  setProgramCrediting,
} from '../src/index';
import { setupDb } from './helpers';

async function purchaseSetup() {
  const t = await setupDb();
  const { database, ws } = t;
  const card = await createAccount(database, ws, { name: 'Maybank Platinum', kind: 'liability', subtype: 'credit_card', currency: 'IDR' });
  const program = await createProgram(database, ws, { cardAccountId: card.id, name: 'Maybank TREATS Points', unit: 'points', cycleAnchor: 'statement' });
  const dining = (await listAccounts(database, ws)).find((a) => a.systemKey === 'food.dining')!.id;
  const lines = expenseLines({ categoryAccountId: dining, paymentAccountId: card.id, amountMinor: 60_000, currency: 'IDR' });
  const purchaseId = await postTransaction(database, ws, { occurredOn: '2026-09-05', description: 'MCDONALD SENAYAN', lines });
  return { ...t, card, program, lines, purchaseId };
}

describe('transaction point actuals', () => {
  it('records, updates, lists, and clears an actual', async () => {
    const { database, ws, program, purchaseId } = await purchaseSetup();
    await recordTransactionPointActual(database, ws, { programId: program.id, transactionId: purchaseId, actualPoints: 3 });
    expect(await listTransactionPointActuals(database, ws, program.id)).toMatchObject([{ transactionId: purchaseId, actualPoints: 3, editedAfterCheck: false }]);
    await recordTransactionPointActual(database, ws, { programId: program.id, transactionId: purchaseId, actualPoints: 2.5 });
    expect(await listTransactionPointActuals(database, ws, program.id)).toMatchObject([{ transactionId: purchaseId, actualPoints: 2.5 }]);
    await clearTransactionPointActual(database, ws, program.id, purchaseId);
    expect(await listTransactionPointActuals(database, ws, program.id)).toEqual([]);
  });

  it('rejects more than one decimal, non-numbers, and unknown programs or purchases', async () => {
    const { database, ws, program, purchaseId } = await purchaseSetup();
    for (const actualPoints of [2.25, Number.NaN]) {
      await expect(recordTransactionPointActual(database, ws, { programId: program.id, transactionId: purchaseId, actualPoints })).rejects.toThrow(PointsError);
    }
    await expect(recordTransactionPointActual(database, ws, { programId: 'missing', transactionId: purchaseId, actualPoints: 1 })).rejects.toThrow(PointsError);
    await expect(recordTransactionPointActual(database, ws, { programId: program.id, transactionId: 'missing', actualPoints: 1 })).rejects.toThrow(PointsError);
  });

  it('moves an actual to the edited purchase and marks it, and recording again clears the mark', async () => {
    const { database, ws, program, purchaseId, lines } = await purchaseSetup();
    await recordTransactionPointActual(database, ws, { programId: program.id, transactionId: purchaseId, actualPoints: 0 });
    const replacement = await replaceTransaction(database, ws, purchaseId, { occurredOn: '2026-09-05', description: 'MCDONALDS SENAYAN', lines });
    expect(await listTransactionPointActuals(database, ws, program.id)).toMatchObject([{ transactionId: replacement, actualPoints: 0, editedAfterCheck: true }]);
    await recordTransactionPointActual(database, ws, { programId: program.id, transactionId: replacement, actualPoints: 3 });
    expect(await listTransactionPointActuals(database, ws, program.id)).toMatchObject([{ transactionId: replacement, actualPoints: 3, editedAfterCheck: false }]);
  });

  it('changes crediting without un-linking a catalogue program', async () => {
    const { database, ws, program } = await purchaseSetup();
    await database.execScript(`UPDATE reward_programs SET catalog_status = 'linked' WHERE id = '${program.id}'`);
    await setProgramCrediting(database, ws, program.id, 'per_transaction');
    expect(await listPrograms(database, ws)).toMatchObject([{ id: program.id, crediting: 'per_transaction', catalogStatus: 'linked' }]);
    await expect(setProgramCrediting(database, ws, program.id, 'daily' as 'per_statement')).rejects.toThrow(PointsError);
  });
});
