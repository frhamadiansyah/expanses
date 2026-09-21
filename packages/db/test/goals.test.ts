import { beforeEach, describe, expect, it } from 'vitest';
import {
  type AccountRow,
  archiveGoal,
  createAccount,
  createDatabase,
  createWorkspace,
  type Database,
  listAssetProfiles,
  listEarmarks,
  listGoals,
  migrate,
  MIGRATIONS,
  removeEarmark,
  reorderGoals,
  saveAssetProfile,
  saveEarmark,
  saveGoal,
  saveGoalTx,
  setStagePaid,
  type WorkspaceContext,
} from '../src/index';
import { createNodeExecutor } from '../src/node';
import { goalStageTerms } from '../src/schema-health';
import { setupDb } from './helpers';

let database: Database;
let ws: WorkspaceContext;
let bca: AccountRow;
let gold: AccountRow;

beforeEach(async () => {
  ({ database, ws } = await setupDb());
  bca = await createAccount(database, ws, { name: 'BCA Tahapan', kind: 'asset', subtype: 'bank', currency: 'IDR', openingBalanceMinor: 50_000_000, openedOn: '2026-01-01' });
  gold = await createAccount(database, ws, { name: 'Antam gold bars', kind: 'asset', subtype: 'investment', currency: 'IDR' });
  await saveAssetProfile(database, ws, { accountId: gold.id, assetKind: 'gold' });
});

const hajj = () => ({
  name: 'Hajj for two',
  kind: 'hajj' as const,
  growthBps: 500,
  returnBps: 600,
  stages: [
    { name: 'Setoran awal', targetMinor: 50_000_000, targetMonths: null, dueOn: '2027-06-30' },
    { name: 'Final payment', targetMinor: 120_000_000, targetMonths: null, dueOn: '2048-06-30' },
  ],
});

describe('migration 0008', () => {
  it('is version 8 and named goals', () => {
    expect(MIGRATIONS.find((migration) => migration.version === 8)).toMatchObject({ name: 'goals' });
  });

  it('applies on a database already populated through version 7 and keeps what is there', async () => {
    const older = createDatabase(createNodeExecutor());
    await migrate(older, MIGRATIONS.filter((migration) => migration.version <= 7));
    const workspace = await createWorkspace(older, { name: 'Personal', type: 'personal', baseCurrency: 'IDR' });
    const account = await createAccount(older, workspace, { name: 'Antam gold bars', kind: 'asset', subtype: 'investment', currency: 'IDR' });

    const applied = await migrate(older);
    // Written after the upgrade: a version 7 table still demands the four-digit code this project
    // used before the real ones were checked, and every preset now carries a three-digit code.
    await saveAssetProfile(older, workspace, { accountId: account.id, assetKind: 'gold' });

    expect(applied).toContain(8);
    await expect(listAssetProfiles(older, workspace)).resolves.toHaveLength(1);
    await expect(listGoals(older, workspace)).resolves.toEqual([]);
  });
});

describe('saveGoal', () => {
  it('stores a goal with its stages, in date order', async () => {
    const id = await saveGoal(database, ws, hajj());

    const goals = await listGoals(database, ws);
    expect(goals).toHaveLength(1);
    expect(goals[0]).toMatchObject({ id, name: 'Hajj for two', kind: 'hajj', growthBps: 500, returnBps: 600, rank: 0, status: 'active' });
    expect(goals[0]!.stages.map((stage) => stage.name)).toEqual(['Setoran awal', 'Final payment']);
  });

  it('takes as many stages as the scheme needs', async () => {
    const id = await saveGoal(database, ws, {
      ...hajj(),
      stages: [
        { name: 'Setoran awal', targetMinor: 25_000_000, targetMonths: null, dueOn: '2027-06-30' },
        { name: 'Pelunasan tahap 1', targetMinor: 40_000_000, targetMonths: null, dueOn: '2040-01-31' },
        { name: 'Pelunasan tahap 2', targetMinor: 60_000_000, targetMonths: null, dueOn: '2048-06-30' },
      ],
    });

    const goal = (await listGoals(database, ws)).find((row) => row.id === id)!;
    expect(goal.stages).toHaveLength(3);
  });

  it('needs at least one stage', async () => {
    await expect(saveGoal(database, ws, { ...hajj(), stages: [] })).rejects.toThrow(/stage/i);
  });

  it('takes an amount or a number of months on a stage, never both and never neither', async () => {
    await expect(
      saveGoal(database, ws, { ...hajj(), stages: [{ name: 'Both', targetMinor: 1_000_000, targetMonths: 6, dueOn: '2027-01-01' }] }),
    ).rejects.toThrow(/amount or/i);
    await expect(
      saveGoal(database, ws, { ...hajj(), stages: [{ name: 'Neither', targetMinor: null, targetMonths: null, dueOn: '2027-01-01' }] }),
    ).rejects.toThrow(/amount or/i);
  });

  it('replaces the stages when saved again and keeps the ids passed back', async () => {
    const id = await saveGoal(database, ws, hajj());
    const first = (await listGoals(database, ws))[0]!.stages;

    await saveGoal(database, ws, {
      ...hajj(),
      id,
      stages: [
        { id: first[0]!.id, name: 'Setoran awal', targetMinor: 25_000_000, targetMonths: null, dueOn: '2027-06-30' },
        { name: 'Extra step', targetMinor: 10_000_000, targetMonths: null, dueOn: '2030-01-31' },
      ],
    });

    const goal = (await listGoals(database, ws))[0]!;
    expect(goal.stages).toHaveLength(2);
    expect(goal.stages[0]).toMatchObject({ id: first[0]!.id, targetMinor: 25_000_000 });
    expect(goal.stages.map((stage) => stage.name)).toEqual(['Setoran awal', 'Extra step']);
  });

  it('puts a new goal at the end of the order', async () => {
    await saveGoal(database, ws, hajj());
    const second = await saveGoal(database, ws, { ...hajj(), name: 'University' });

    const goals = await listGoals(database, ws);
    expect(goals.find((goal) => goal.id === second)!.rank).toBe(1);
    expect(goals.map((goal) => goal.name)).toEqual(['Hajj for two', 'University']);
  });
});

describe('goal housekeeping', () => {
  it('writes a new order', async () => {
    const first = await saveGoal(database, ws, hajj());
    const second = await saveGoal(database, ws, { ...hajj(), name: 'University' });

    await reorderGoals(database, ws, [second, first]);

    expect((await listGoals(database, ws)).map((goal) => goal.name)).toEqual(['University', 'Hajj for two']);
  });

  it('marks a stage paid and unmarks it', async () => {
    const id = await saveGoal(database, ws, hajj());
    const stageId = (await listGoals(database, ws)).find((goal) => goal.id === id)!.stages[0]!.id;

    await setStagePaid(database, ws, stageId, '2026-09-12');
    expect((await listGoals(database, ws))[0]!.stages[0]!.paidOn).toBe('2026-09-12');

    await setStagePaid(database, ws, stageId, null);
    expect((await listGoals(database, ws))[0]!.stages[0]!.paidOn).toBeNull();
  });

  it('hides an archived goal but keeps its row', async () => {
    const id = await saveGoal(database, ws, hajj());

    await archiveGoal(database, ws, id);

    await expect(listGoals(database, ws)).resolves.toEqual([]);
    await expect(listGoals(database, ws, { includeArchived: true })).resolves.toHaveLength(1);
  });

  it('keeps another workspace out', async () => {
    await saveGoal(database, ws, hajj());
    const other = await createWorkspace(database, { name: 'Shared', type: 'shared', baseCurrency: 'IDR' });

    await expect(listGoals(database, other)).resolves.toEqual([]);
  });
});

describe('set-aside amounts', () => {
  it('sets money aside from a savings account', async () => {
    const id = await saveGoal(database, ws, hajj());

    await saveEarmark(database, ws, { goalId: id, accountId: bca.id, amountMinor: 20_000_000 });

    await expect(listEarmarks(database, ws)).resolves.toEqual([{ goalId: id, accountId: bca.id, amountMinor: 20_000_000 }]);
  });

  it('replaces the amount for the same goal and account', async () => {
    const id = await saveGoal(database, ws, hajj());
    await saveEarmark(database, ws, { goalId: id, accountId: bca.id, amountMinor: 20_000_000 });
    await saveEarmark(database, ws, { goalId: id, accountId: bca.id, amountMinor: 30_000_000 });

    const earmarks = await listEarmarks(database, ws);
    expect(earmarks).toHaveLength(1);
    expect(earmarks[0]!.amountMinor).toBe(30_000_000);
  });

  it('refuses to set aside from a holding, which is tagged per purchase instead', async () => {
    const id = await saveGoal(database, ws, hajj());

    await expect(saveEarmark(database, ws, { goalId: id, accountId: gold.id, amountMinor: 1_000_000 })).rejects.toThrow(/tag/i);
  });

  it('removes one', async () => {
    const id = await saveGoal(database, ws, hajj());
    await saveEarmark(database, ws, { goalId: id, accountId: bca.id, amountMinor: 20_000_000 });

    await removeEarmark(database, ws, id, bca.id);

    await expect(listEarmarks(database, ws)).resolves.toEqual([]);
  });
});

describe('a stage’s own return', () => {
  it('is read back with the goal, and forgotten when the goal is typed by hand', async () => {
    const { database, ws } = await setupDb();
    const { goalId, stageIds } = await database.transaction((tx) =>
      saveGoalTx(tx, ws, {
        name: 'School', kind: 'education', growthBps: 1000, returnBps: 800, derived: true,
        stages: [{ name: 'Preschool', targetMinor: 8_000_000, targetMonths: null, dueOn: '2027-07-01' }],
      }),
    );
    await database.db.insert(goalStageTerms).values({ stageId: stageIds[0]!, workspaceId: ws.workspaceId, goalId, returnBps: 400, derivedKey: 'pre:0' });
    expect((await listGoals(database, ws))[0]!.stages[0]!.returnBps).toBe(400);

    const stage = (await listGoals(database, ws))[0]!.stages[0]!;
    await saveGoal(database, ws, { id: goalId, name: 'School', kind: 'education', growthBps: 1000, returnBps: 800, stages: [{ ...stage, targetMinor: 9_000_000 }] });
    expect((await listGoals(database, ws))[0]!.stages[0]!.returnBps).toBeNull();
  });

  it('goes with a stage that a derived save drops, and stays with the ones it keeps', async () => {
    const { database, ws } = await setupDb();
    const { goalId, stageIds } = await database.transaction((tx) =>
      saveGoalTx(tx, ws, {
        name: 'School', kind: 'education', growthBps: 1000, returnBps: 800, derived: true,
        stages: [
          { name: 'Preschool', targetMinor: 8_000_000, targetMonths: null, dueOn: '2027-07-01' },
          { name: 'Primary', targetMinor: 9_000_000, targetMonths: null, dueOn: '2029-07-01' },
        ],
      }),
    );
    await database.db.insert(goalStageTerms).values([
      { stageId: stageIds[0]!, workspaceId: ws.workspaceId, goalId, returnBps: 400, derivedKey: 'pre:0' },
      { stageId: stageIds[1]!, workspaceId: ws.workspaceId, goalId, returnBps: 600, derivedKey: 'pri:0' },
    ]);
    const kept = (await listGoals(database, ws))[0]!.stages[1]!;
    await database.transaction((tx) =>
      saveGoalTx(tx, ws, { id: goalId, name: 'School', kind: 'education', growthBps: 1000, returnBps: 800, derived: true, stages: [kept] }),
    );
    expect((await listGoals(database, ws))[0]!.stages.map((stage) => stage.returnBps)).toEqual([600]);
    expect((await database.db.select().from(goalStageTerms)).map((row) => row.stageId)).toEqual([stageIds[1]]);
  });

  it('gives stage ids back in the order the stages were given', async () => {
    const { database, ws } = await setupDb();
    const { goalId, stageIds } = await database.transaction((tx) =>
      saveGoalTx(tx, ws, {
        name: 'School', kind: 'education', growthBps: 1000, returnBps: 800,
        stages: [
          { name: 'Later', targetMinor: 1, targetMonths: null, dueOn: '2030-01-01' },
          { name: 'Sooner', targetMinor: 1, targetMonths: null, dueOn: '2027-01-01' },
        ],
      }),
    );
    const stages = (await listGoals(database, ws)).find((row) => row.id === goalId)!.stages;
    expect(stageIds).toEqual([stages.find((s) => s.name === 'Later')!.id, stages.find((s) => s.name === 'Sooner')!.id]);
    expect(stages.every((stage) => stage.returnBps === null)).toBe(true);
  });
});
