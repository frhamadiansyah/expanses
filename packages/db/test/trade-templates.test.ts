import { beforeEach, describe, expect, it } from 'vitest';
import {
  type AccountRow,
  createAccount,
  createWorkspace,
  type Database,
  deleteTradeTemplate,
  dueTemplates,
  listTradeTemplates,
  listTrades,
  recordTrade,
  saveTradeTemplate,
  type WorkspaceContext,
} from '../src/index';
import { setupDb } from './helpers';

let database: Database;
let ws: WorkspaceContext;
let fund: AccountRow;
let bca: AccountRow;

beforeEach(async () => {
  ({ database, ws } = await setupDb());
  fund = await createAccount(database, ws, { name: 'Equity fund', kind: 'asset', subtype: 'investment', currency: 'IDR' });
  bca = await createAccount(database, ws, { name: 'BCA Tahapan', kind: 'asset', subtype: 'bank', currency: 'IDR', openingBalanceMinor: 50_000_000, openedOn: '2026-01-01' });
});

const monthly = (extra: Record<string, unknown> = {}) =>
  saveTradeTemplate(database, ws, { accountId: fund.id, cashAccountId: bca.id, amountMinor: 2_000_000, unitsMicro: null, dayOfMonth: 5, active: true, ...extra });

const buyFromTemplate = (templateId: string, occurredOn: string) =>
  recordTrade(database, ws, {
    accountId: fund.id,
    kind: 'buy',
    occurredOn,
    unitsMicro: 1_085_700,
    grossMinor: 2_000_000,
    feeMinor: 0,
    taxMinor: 0,
    cashAccountId: bca.id,
    templateId,
  });

describe('saveTradeTemplate', () => {
  it('stores a monthly buy and lists it', async () => {
    const id = await monthly();

    const templates = await listTradeTemplates(database, ws);
    expect(templates).toHaveLength(1);
    expect(templates[0]).toMatchObject({ id, accountId: fund.id, cashAccountId: bca.id, amountMinor: 2_000_000, unitsMicro: null, dayOfMonth: 5, active: true });
  });

  it('takes an amount or a number of units, never both and never neither', async () => {
    await expect(monthly({ unitsMicro: 1_000_000 })).rejects.toThrow(/amount or/i);
    await expect(monthly({ amountMinor: null, unitsMicro: null })).rejects.toThrow(/amount or/i);
  });

  it('takes a day from 1 to 28 so every month has it', async () => {
    await expect(monthly({ dayOfMonth: 0 })).rejects.toThrow(/1 and 28/);
    await expect(monthly({ dayOfMonth: 31 })).rejects.toThrow(/1 and 28/);
  });

  it('updates the template when the same id is saved again', async () => {
    const id = await monthly();
    await saveTradeTemplate(database, ws, { id, accountId: fund.id, cashAccountId: bca.id, amountMinor: 3_000_000, unitsMicro: null, dayOfMonth: 10, active: false });

    const templates = await listTradeTemplates(database, ws);
    expect(templates).toHaveLength(1);
    expect(templates[0]).toMatchObject({ amountMinor: 3_000_000, dayOfMonth: 10, active: false });
  });

  it('refuses an asset from another workspace', async () => {
    const other = await createWorkspace(database, { name: 'Shared', type: 'shared', baseCurrency: 'IDR' });
    await expect(
      saveTradeTemplate(database, other, { accountId: fund.id, cashAccountId: bca.id, amountMinor: 1_000_000, unitsMicro: null, dayOfMonth: 5, active: true }),
    ).rejects.toThrow();
  });
});

describe('dueTemplates', () => {
  it('lists a template whose day has passed with nothing recorded this month', async () => {
    const id = await monthly();

    const due = await dueTemplates(database, ws, '2026-09-12');
    expect(due.map((t) => t.id)).toEqual([id]);
  });

  it('waits until the day arrives', async () => {
    await monthly();

    await expect(dueTemplates(database, ws, '2026-09-04')).resolves.toEqual([]);
    await expect(dueTemplates(database, ws, '2026-09-05')).resolves.toHaveLength(1);
  });

  it('skips a template already recorded this month', async () => {
    const id = await monthly();
    await buyFromTemplate(id, '2026-09-05');

    await expect(dueTemplates(database, ws, '2026-09-12')).resolves.toEqual([]);
  });

  it('asks again the next month', async () => {
    const id = await monthly();
    await buyFromTemplate(id, '2026-08-05');

    await expect(dueTemplates(database, ws, '2026-09-12')).resolves.toHaveLength(1);
  });

  it('skips a paused template', async () => {
    await monthly({ active: false });

    await expect(dueTemplates(database, ws, '2026-09-12')).resolves.toEqual([]);
  });
});

describe('deleteTradeTemplate', () => {
  it('removes the template and leaves the buys it made', async () => {
    const id = await monthly();
    await buyFromTemplate(id, '2026-08-05');

    await deleteTradeTemplate(database, ws, id);

    await expect(listTradeTemplates(database, ws)).resolves.toEqual([]);
    const trades = await listTrades(database, ws, { accountId: fund.id });
    expect(trades).toHaveLength(1);
    expect(trades[0]!.templateId).toBe(id);
  });
});
