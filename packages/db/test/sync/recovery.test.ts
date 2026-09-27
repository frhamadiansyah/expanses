import { expenseLines } from '@expanses/core';
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { postTransaction, voidTransaction } from '../../src/index';
import { REMEMBERED_MEMBER_KEY } from '../../src/sync/seed';
import { categoryOf, headOf, Household, projectBook, skipsOf, type Device } from './household';

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
