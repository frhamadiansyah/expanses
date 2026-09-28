import { expenseLines } from '@expanses/core';
import { sql } from 'drizzle-orm';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { inBook, postTransaction, renameAccount, replaceTransaction, voidTransaction } from '../../src/index';
import { captureConfigOf, projectPurchase, rowUpsertsTx, writeChangeSetsTx } from '../../src/sync/capture';
import { encodeHlc } from '../../src/sync/hlc';
import { REMEMBERED_MEMBER_KEY } from '../../src/sync/seed';
import type { Op } from '../../src/sync/types';
import { categoryOf, headOf, Household, projectBook, skipsOf, type Device } from './household';
import { runStep, stepArb, type Step } from './programs';

/*
 * The recovery paths of a share (recovery review, 2026-09-27; spec §8.2, §8.6, §8.7): a copy moves onto another relay
 * book only when it is not live and the share is an owner's (N1); a copy kept as its own rejoins the share made again
 * (N3); and whatever either side changed while the share was down reaches the other when it is made again, by each
 * field's own clock (N2). Every run ends with both devices reading the same book and no skips.
 */

async function spend(d: Device, bookId: string, description: string, amountMinor = 25_000): Promise<string> {
  const groceries = await categoryOf(d.database, bookId, 'Groceries');
  return postTransaction(d.database, d.ws, {
    occurredOn: '2026-09-10',
    description,
    lines: expenseLines({ categoryAccountId: groceries, paymentAccountId: d.bank, amountMinor, currency: 'IDR' }),
  });
}

const sharedRow = async (d: Device, bookId: string) =>
  (await d.database.db.values<[string, string]>(sql`SELECT state, relay_book_id FROM shared_books WHERE book_id = ${bookId}`))[0];
const roles = async (d: Device, bookId: string) =>
  d.database.db.values<[string, string]>(sql`SELECT member_id, role FROM book_members WHERE book_id = ${bookId} ORDER BY member_id`);
const descriptions = async (d: Device, bookId: string) =>
  Object.values((await projectBook(d.database, bookId)).purchase!)
    .filter((p) => p !== 'void')
    .map((p) => (p as { description: string }).description)
    .sort();
const claimed = async (d: Device, code: string) => (await d.transport.previewInvite((await d.engine.previewInvite(code)).inviteId)).claimed;

async function converged(a: Device, b: Device, bookId: string): Promise<void> {
  expect(await projectBook(b.database, bookId)).toEqual(await projectBook(a.database, bookId));
  expect(await skipsOf(a.database)).toEqual([]);
  expect(await skipsOf(b.database)).toEqual([]);
}

describe('a copy moves onto another relay book only when it is not live, and to an owner’s share (N1)', () => {
  it('an ex-member’s share made again cannot take a healthy owner’s active copy: refused before the claim, nothing applied', async () => {
    const home = new Household();
    const fandri = await home.device('Fandri');
    const dewi = await home.device('Dewi');
    const bookId = await home.share(fandri);
    await home.join(dewi, fandri);
    await home.settle();
    const a = await spend(fandri, bookId, 'A');
    await home.settle();
    const r1 = home.relayBookId;

    // Dewi, a plain member, leaves, keeps her copy, shares it again as herself, voids Fandri's purchase, and invites
    // Fandri to "link" his device.
    await dewi.engine.leave(bookId);
    await dewi.engine.forgetSharing(bookId);
    await dewi.engine.shareBook(bookId, { memberName: 'Dewi', deviceName: 'x' });
    await voidTransaction(dewi.database, dewi.ws, (await headOf(dewi.database, a))!);
    await dewi.engine.syncOnce(bookId);
    const { code } = await dewi.engine.createInvite(bookId, { inviterName: 'Dewi', sameMember: true, memberId: fandri.memberId });

    const before = await projectBook(fandri.database, bookId);
    const rolesBefore = await roles(fandri, bookId);
    await expect(fandri.engine.joinBook(code, { ws: fandri.ws, memberName: 'Fandri', deviceName: 'f' })).rejects.toMatchObject({ code: 'STILL_SHARED' });
    expect(await claimed(fandri, code)).toBe(false);
    expect(await sharedRow(fandri, bookId)).toEqual(['active', r1]);
    expect(await projectBook(fandri.database, bookId)).toEqual(before);
    expect(await roles(fandri, bookId)).toEqual(rolesBefore);
    expect(await descriptions(fandri, bookId)).toEqual(['A']);
  });

  it('a copy that is not live moves only to a share made by someone who was an owner of it here; the preview says it replaces', async () => {
    const home = new Household();
    const fandri = await home.device('Fandri');
    const dewi = await home.device('Dewi');
    const budi = await home.device('Budi');
    const bookId = await home.share(fandri);
    await home.join(dewi, fandri);
    await home.join(budi, fandri);
    await home.settle();
    await spend(budi, bookId, 'Budi, before');
    await home.settle();
    await budi.engine.leave(bookId);
    expect((await sharedRow(budi, bookId))![0]).toBe('unshared');

    // A plain member's share made again, offered to Budi's unshared copy: refused before the claim.
    await dewi.engine.leave(bookId);
    await dewi.engine.forgetSharing(bookId);
    await dewi.engine.shareBook(bookId, { memberName: 'Dewi', deviceName: 'x' });
    await dewi.engine.syncOnce(bookId);
    const { code: byMember } = await dewi.engine.createInvite(bookId, { inviterName: 'Dewi', sameMember: true, memberId: budi.memberId });
    const before = await projectBook(budi.database, bookId);
    await expect(budi.engine.joinBook(byMember, { ws: budi.ws, memberName: 'Budi', deviceName: 'b' })).rejects.toMatchObject({ code: 'INVITER_NOT_OWNER' });
    expect(await claimed(budi, byMember)).toBe(false);
    expect((await sharedRow(budi, bookId))![0]).toBe('unshared');
    expect(await projectBook(budi.database, bookId)).toEqual(before);

    // The owner's share made again is taken, and its preview says what it replaces.
    await fandri.engine.stopSharing(bookId);
    const again = await fandri.engine.shareBook(bookId, { memberName: 'Fandri', deviceName: 'f' });
    home.relayBookId = again.relayBookId;
    await fandri.engine.syncOnce(bookId);
    const { code } = await fandri.engine.createInvite(bookId, { inviterName: 'Fandri', sameMember: true, memberId: budi.memberId });
    const [[bookName]] = (await budi.database.db.values<[string]>(sql`SELECT name FROM books WHERE id = ${bookId}`)) as [[string]];
    expect((await budi.engine.previewInvite(code)).replaces).toEqual({ bookName });
    await budi.engine.joinBook(code, { ws: budi.ws, memberName: 'Budi', deviceName: 'b' });
    await home.settle([fandri, budi]);
    await converged(fandri, budi, bookId);
    expect(await descriptions(budi, bookId)).toEqual(['Budi, before']);
  });

  it('an invite back onto the same relay book (§8.7) replaces nothing and needs no owner check', async () => {
    const home = new Household();
    const dewi = await home.device('Dewi');
    const fandri = await home.device('Fandri');
    const bookId = await home.share(dewi);
    await home.join(fandri, dewi);
    await home.settle();
    const restored = await home.restore(fandri, await fandri.database.exportBytes());
    await restored.engine.checkRestore();
    const { code } = await dewi.engine.createInvite(bookId, { inviterName: 'Dewi', sameMember: true, memberId: fandri.memberId });
    expect((await restored.engine.previewInvite(code)).replaces).toBeNull();
    await restored.engine.joinBook(code, { ws: restored.ws, memberName: 'Fandri', deviceName: 'new phone' });
    await home.settle();
    await converged(dewi, restored, bookId);
  });
});

describe('a copy kept as its own rejoins the share made again (N3)', () => {
  it('as the member it remembers, through an owner’s invite naming that member; what it recorded meanwhile goes out', async () => {
    const home = new Household();
    const fandri = await home.device('Fandri');
    const dewi = await home.device('Dewi');
    const bookId = await home.share(fandri);
    await home.join(dewi, fandri);
    await home.settle();
    await spend(dewi, bookId, 'Dewi, before');
    await home.settle();
    await fandri.engine.stopSharing(bookId);
    expect((await dewi.engine.syncOnce(bookId)).ended).toBe('unshared');
    await dewi.engine.forgetSharing(bookId);
    await spend(dewi, bookId, 'Dewi, her own');

    const again = await fandri.engine.shareBook(bookId, { memberName: 'Fandri', deviceName: 'f' });
    home.relayBookId = again.relayBookId;
    await fandri.engine.syncOnce(bookId);
    const { code: plain } = await fandri.engine.createInvite(bookId, { inviterName: 'Fandri' });
    await expect(dewi.engine.joinBook(plain, { ws: dewi.ws, memberName: 'Dewi', deviceName: 'd' })).rejects.toMatchObject({ code: 'INVITE_MISMATCH' });
    expect(await claimed(dewi, plain)).toBe(false);
    const { code } = await fandri.engine.createInvite(bookId, { inviterName: 'Fandri', sameMember: true, memberId: dewi.memberId });
    const joined = await dewi.engine.joinBook(code, { ws: dewi.ws, memberName: 'Dewi', deviceName: 'd' });
    expect(joined.memberId).toBe(dewi.memberId);
    expect(await sharedRow(dewi, bookId)).toEqual(['active', again.relayBookId]);
    await home.settle([fandri, dewi]);
    await converged(fandri, dewi, bookId);
    expect(await descriptions(fandri, bookId)).toEqual(['Dewi, before', 'Dewi, her own']);
  });

  it('refuses a share made by someone who was not an owner of it here, before the claim', async () => {
    const home = new Household();
    const fandri = await home.device('Fandri');
    const dewi = await home.device('Dewi');
    const budi = await home.device('Budi');
    const bookId = await home.share(fandri);
    await home.join(dewi, fandri);
    await home.join(budi, fandri);
    await home.settle();
    await budi.engine.leave(bookId);
    await budi.engine.forgetSharing(bookId);
    await dewi.engine.leave(bookId);
    await dewi.engine.forgetSharing(bookId);
    await dewi.engine.shareBook(bookId, { memberName: 'Dewi', deviceName: 'x' });
    await dewi.engine.syncOnce(bookId);
    const { code } = await dewi.engine.createInvite(bookId, { inviterName: 'Dewi', sameMember: true, memberId: budi.memberId });
    await expect(budi.engine.joinBook(code, { ws: budi.ws, memberName: 'Budi', deviceName: 'b' })).rejects.toMatchObject({ code: 'INVITER_NOT_OWNER' });
    expect(await claimed(budi, code)).toBe(false);
    expect(await sharedRow(budi, bookId)).toBeUndefined();
  });

  it('a plain workspace that was never shared here, under the same id, is still refused', async () => {
    const home = new Household();
    const fandri = await home.device('Fandri');
    const dewi = await home.device('Dewi');
    const bookId = await home.share(fandri);
    await home.join(dewi, fandri);
    await home.settle();
    await fandri.engine.stopSharing(bookId);
    await dewi.engine.syncOnce(bookId);
    await dewi.engine.forgetSharing(bookId);
    // No remembered member: as a workspace that was never shared from here.
    await dewi.database.db.run(sql`DELETE FROM settings WHERE key = ${REMEMBERED_MEMBER_KEY(bookId)}`);
    const again = await fandri.engine.shareBook(bookId, { memberName: 'Fandri', deviceName: 'f' });
    home.relayBookId = again.relayBookId;
    await fandri.engine.syncOnce(bookId);
    const { code } = await fandri.engine.createInvite(bookId, { inviterName: 'Fandri', sameMember: true, memberId: dewi.memberId });
    await expect(dewi.engine.joinBook(code, { ws: dewi.ws, memberName: 'Dewi', deviceName: 'd' })).rejects.toMatchObject({ code: 'ALREADY_SHARED' });
    expect(await claimed(dewi, code)).toBe(false);
  });
});

/**
 * The ruled C1 recovery (§8.7): the only owner's phone is restored; while the share is down Dewi changes things on the
 * orphaned relay book (`orphan`) and the restored phone changes things too (`waiting`, then `own` once it keeps the
 * book as its own); then it shares again and invites Dewi, who stops sharing on the old relay book and rejoins.
 */
async function recovery(opts: {
  orphan?: (dewi: Device, bookId: string, ids: { fandri: string; dewi: string }) => Promise<void>;
  waiting?: (restored: Device, bookId: string, ids: { fandri: string; dewi: string }) => Promise<void>;
  own?: (restored: Device, bookId: string, ids: { fandri: string; dewi: string }) => Promise<void>;
}) {
  const home = new Household();
  const fandri = await home.device('Fandri');
  const dewi = await home.device('Dewi');
  const bookId = await home.share(fandri);
  await home.join(dewi, fandri);
  await home.settle();
  const ids = { fandri: await spend(fandri, bookId, 'Fandri, before'), dewi: await spend(dewi, bookId, 'Dewi, before') };
  await home.settle();
  const restored = await home.restore(fandri, await fandri.database.exportBytes());
  await restored.engine.checkRestore();

  await opts.orphan?.(dewi, bookId, ids);
  await dewi.engine.syncOnce(bookId);
  await opts.waiting?.(restored, bookId, ids);
  await restored.engine.forgetSharing(bookId);
  await opts.own?.(restored, bookId, ids);

  const again = await restored.engine.shareBook(bookId, { memberName: 'Fandri', deviceName: 'new phone' });
  home.relayBookId = again.relayBookId;
  await restored.engine.syncOnce(bookId);
  const { code } = await restored.engine.createInvite(bookId, { inviterName: 'Fandri', sameMember: true, memberId: dewi.memberId });
  // Dewi's copy is still live on the orphaned relay book: she stops sharing it there first (N1, a).
  await expect(dewi.engine.joinBook(code, { ws: dewi.ws, memberName: 'Dewi', deviceName: 'd' })).rejects.toMatchObject({ code: 'STILL_SHARED' });
  await dewi.engine.leave(bookId);
  await dewi.engine.joinBook(code, { ws: dewi.ws, memberName: 'Dewi', deviceName: 'd' });
  await home.settle([restored, dewi]);
  await home.settle([restored, dewi]);
  await converged(restored, dewi, bookId);
  return { restored, dewi, bookId, ids };
}

const lineOf = async (d: Device, lineageId: string) => {
  const head = (await headOf(d.database, lineageId))!;
  const [tx] = await d.database.db.values<[string, string]>(sql`SELECT occurred_on, description FROM transactions WHERE id = ${head}`);
  const entries = await d.database.db.values<[string, number, string]>(sql`SELECT account_id, amount_minor, currency FROM entries WHERE transaction_id = ${head} ORDER BY rowid`);
  return { head, occurredOn: tx![0], description: tx![1], lines: entries.map(([accountId, amountMinor, currency]) => ({ accountId, amountMinor: Number(amountMinor), currency })) };
};
const purchaseOf = async (d: Device, bookId: string, lineageId: string) => (await projectBook(d.database, bookId)).purchase![lineageId];

describe('what changed while the share was down reaches both sides (N2)', () => {
  it('a member’s edit of a field of an existing row, made on the orphaned relay book', async () => {
    const { restored, bookId } = await recovery({
      orphan: async (dewi, bookId) => renameAccount(dewi.database, inBook(dewi.ws, bookId), await categoryOf(dewi.database, bookId, 'Groceries'), 'Groceries, renamed by Dewi'),
    });
    await expect(categoryOf(restored.database, bookId, 'Groceries, renamed by Dewi')).resolves.toEqual(expect.any(String));
  });

  it('a member’s void of an existing purchase', async () => {
    const { restored, dewi, bookId, ids } = await recovery({
      orphan: async (dewi, _bookId, ids) => void (await voidTransaction(dewi.database, dewi.ws, (await headOf(dewi.database, ids.fandri))!)),
    });
    expect(await purchaseOf(restored, bookId, ids.fandri)).toBe('void');
    expect(await descriptions(dewi, bookId)).toEqual(['Dewi, before']);
  });

  it('a member’s correction of the money of an existing purchase', async () => {
    const { restored, bookId, ids } = await recovery({
      orphan: async (dewi, _bookId, ids) => {
        const was = await lineOf(dewi, ids.fandri);
        const lines = was.lines.map((l) => ({ ...l, amountMinor: Math.sign(l.amountMinor) * 40_000 }));
        await replaceTransaction(dewi.database, dewi.ws, was.head, { occurredOn: was.occurredOn, description: was.description, lines });
      },
    });
    const money = (await purchaseOf(restored, bookId, ids.fandri)) as { money: { lines: { amountMinor: number }[] } };
    expect(money.money.lines.map((l) => l.amountMinor)).toEqual([40_000]);
  });

  it('the restored phone’s own edits, while it waited and while the book was its own, win over the clocks it kept', async () => {
    const { dewi, bookId, ids } = await recovery({
      waiting: async (restored, bookId, ids) => {
        await renameAccount(restored.database, inBook(restored.ws, bookId), await categoryOf(restored.database, bookId, 'Supplies'), 'Supplies, while waiting');
        const was = await lineOf(restored, ids.fandri);
        await replaceTransaction(restored.database, restored.ws, was.head, { occurredOn: was.occurredOn, description: 'Fandri, edited while waiting', lines: was.lines });
      },
      own: async (restored, _bookId, ids) => {
        await voidTransaction(restored.database, restored.ws, (await headOf(restored.database, ids.dewi))!);
      },
    });
    await expect(categoryOf(dewi.database, bookId, 'Supplies, while waiting')).resolves.toEqual(expect.any(String));
    expect(await descriptions(dewi, bookId)).toEqual(['Fandri, edited while waiting']);
    expect(await purchaseOf(dewi, bookId, ids.dewi)).toBe('void');
  });

  const RUNS = Number(process.env.RECOVERY_RUNS ?? 25);
  it(`property: random edits before, after the backup, on both sides while the share is down, then share again and rejoin (${RUNS} runs)`, async () => {
    const phase = (devices: number, max: number) => fc.array(stepArb(devices), { maxLength: max });
    await fc.assert(
      fc.asyncProperty(fc.record({ shared: phase(2, 10), lost: phase(2, 6), orphan: phase(2, 8), own: phase(1, 4) }), async (program) => {
        const home = new Household();
        const fandri = await home.device('Fandri');
        const dewi = await home.device('Dewi');
        const bookId = await home.share(fandri);
        await home.join(dewi, fandri);
        await home.settle();
        const run = async (devices: Device[], steps: Step[], skipSync = false) => {
          for (const step of steps) if (!(skipSync && step.kind === 'sync')) await runStep(home, devices[step.device]!, step);
        };
        await run([fandri, dewi], program.shared);
        await home.settle();
        const backup = await fandri.database.exportBytes();
        // The phone records on after the backup, then is lost; what it synced is on the orphaned relay book.
        await run([fandri, dewi], program.lost);
        await fandri.engine.syncOnce(bookId);
        const restored = await home.restore(fandri, backup);
        await restored.engine.checkRestore();
        await run([restored, dewi], program.orphan);
        await dewi.engine.syncOnce(bookId);
        await restored.engine.forgetSharing(bookId);
        await run([restored], program.own, true);

        const again = await restored.engine.shareBook(bookId, { memberName: 'Fandri', deviceName: 'new phone' });
        home.relayBookId = again.relayBookId;
        await restored.engine.syncOnce(bookId);
        const { code } = await restored.engine.createInvite(bookId, { inviterName: 'Fandri', sameMember: true, memberId: dewi.memberId });
        await dewi.engine.leave(bookId);
        await dewi.engine.joinBook(code, { ws: dewi.ws, memberName: 'Dewi', deviceName: 'd' });
        await home.settle([restored, dewi]);
        await home.settle([restored, dewi]);
        await converged(restored, dewi, bookId);
      }),
      { numRuns: RUNS, seed: 20260927, endOnFailure: true },
    );
  }, 1_800_000);
});

describe('forgetSharing (recovery review, minor)', () => {
  it('refuses an active book whose view is still empty: a share made here and not yet synced is live', async () => {
    const home = new Household();
    const fandri = await home.device('Fandri');
    const bookId = await home.share(fandri);
    await expect(fandri.engine.forgetSharing(bookId)).rejects.toMatchObject({ code: 'STILL_SHARED' });
  });
});

describe('a field clock later than its change-set is taken at the change-set’s (re-review, NEW-1)', () => {
  it('a member’s far-future clock pins neither a purchase’s money nor a row field: the owner’s later correction wins everywhere', async () => {
    const home = new Household();
    const fandri = await home.device('Fandri');
    const dewi = await home.device('Dewi');
    const budi = await home.device('Budi');
    const bookId = await home.share(fandri);
    await home.join(dewi, fandri);
    await home.join(budi, fandri);
    await home.settle();
    const groceries = await categoryOf(fandri.database, bookId, 'Groceries');
    const x = await spend(fandri, bookId, 'X');
    await home.settle();

    // A modified client: money and a category name sent with a clock ten years ahead, under a change-set of now.
    const book = { bookId, memberId: dewi.memberId, epoch: 1 };
    const future = encodeHlc(Date.now() + 10 * 365 * 86_400_000, 0, dewi.deviceId);
    const dewiHead = (await headOf(dewi.database, x))!;
    await dewi.database.transaction(async (tx) => {
      const [[paidBy, paidLabel]] = (await tx.values<[string, string]>(sql`SELECT paid_by, paid_label FROM sync_lineage WHERE lineage_id = ${x}`)) as [[string, string]];
      const money = (await projectPurchase(tx, dewiHead, dewi.memberId, { paidBy, paidLabel }))!.money;
      for (const line of money.lines) line.amountMinor = Math.sign(line.amountMinor) * 99_000;
      const category = (await rowUpsertsTx(tx, book, 'category')).find((op) => op.id === groceries) as Extract<Op, { op: 'upsert' }>;
      await writeChangeSetsTx(tx, captureConfigOf(dewi.database), book, [
        { entity: 'purchase', id: x, op: 'upsert', fields: { money }, changed: [], clocks: { money: future } },
        { ...category, fields: { ...category.fields, name: 'PINNED' }, changed: [], clocks: { name: future } },
      ]);
    });
    await home.settle();

    // The owner corrects both; the correction is later than the forged change-set, and wins on every device.
    const head = (await headOf(fandri.database, x))!;
    const entries = await fandri.database.db.values<[string, number, string]>(sql`SELECT account_id, amount_minor, currency FROM entries WHERE transaction_id = ${head} ORDER BY rowid`);
    await replaceTransaction(fandri.database, fandri.ws, head, { occurredOn: '2026-09-10', description: 'X', lines: entries.map(([accountId, a, currency]) => ({ accountId, amountMinor: Math.sign(Number(a)) * 50_000, currency })) });
    await renameAccount(fandri.database, inBook(fandri.ws, bookId), groceries, 'Groceries, fixed');
    await home.settle();
    await home.settle();
    for (const d of [fandri, dewi, budi]) {
      const purchase = (await purchaseOf(d, bookId, x)) as { money: { lines: { amountMinor: number }[] } };
      expect(purchase.money.lines.map((l) => l.amountMinor)).toEqual([50_000]);
      expect(await d.database.db.values(sql`SELECT name FROM accounts WHERE id = ${groceries}`)).toEqual([['Groceries, fixed']]);
      expect(await skipsOf(d.database)).toEqual([]);
    }
  }, 300_000);
});
