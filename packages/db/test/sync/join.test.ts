import { expenseLines } from '@expanses/core';
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { postTransaction } from '../../src/index';
import { base32Crockford, encodeInviteCode, fromBase32Crockford, inviteLink, parseInviteCode } from '../../src/sync/invite';
import { SharingError } from '../../src/sync/seed';
import { categoryOf, Household, projectBook, type Device } from './household';

/*
 * Invites and joining (spec §8.1–8.3, §13 `join.test.ts`): the code carries the invite id and a secret the relay never
 * sees; the preview comes before any claim, so a currency mismatch claims nothing; a joiner reads every epoch the book
 * has had; a linked device of an owner becomes an owner on the relay.
 */

async function spend(d: Device, bookId: string, description: string, amountMinor: number): Promise<string> {
  const groceries = await categoryOf(d.database, bookId, 'Groceries');
  return postTransaction(d.database, d.ws, {
    occurredOn: '2026-09-10',
    description,
    lines: expenseLines({ categoryAccountId: groceries, paymentAccountId: d.bank, amountMinor, currency: 'IDR' }),
  });
}

const count = async (d: Device, table: string) => (await d.database.db.values<[number]>(sql`SELECT count(*) FROM ${sql.raw(table)}`))[0]![0];

describe('the invite code (§8.1 step 6)', () => {
  const inviteId = '01928a4e-7b3c-7def-8123-456789abcdef';
  const secret = Uint8Array.from({ length: 16 }, (_, i) => i * 17);

  it('is 52 Crockford characters in groups of four, and gives back the id and the secret', () => {
    const code = encodeInviteCode(inviteId, secret);
    expect(code).toMatch(/^([0-9A-HJKMNP-TV-Z]{4}-){12}[0-9A-HJKMNP-TV-Z]{4}$/);
    expect(code.replace(/-/g, '')).toHaveLength(52);
    expect(parseInviteCode(code)).toEqual({ inviteId, secret });
  });

  it('forgives case, spaces, the link around it, and the look-alikes Crockford was made for', () => {
    const code = encodeInviteCode(inviteId, secret);
    const sloppy = code.toLowerCase().replace(/-/g, ' ').replace(/1/g, 'l').replace(/0/g, 'o');
    expect(parseInviteCode(sloppy)).toEqual({ inviteId, secret });
    expect(parseInviteCode(inviteLink(code))).toEqual({ inviteId, secret });
    expect(inviteLink(code)).toBe(`cicis://join/${code}`);
  });

  it('refuses a code with a character missing, one too many, or one that is not in the alphabet', () => {
    const code = encodeInviteCode(inviteId, secret).replace(/-/g, '');
    expect(() => parseInviteCode(code.slice(1))).toThrow();
    expect(() => parseInviteCode(code + '0')).toThrow();
    expect(() => parseInviteCode('U' + code.slice(1))).toThrow();
  });

  it('base32 Crockford round-trips any length', () => {
    for (const length of [0, 1, 5, 16, 31, 32]) {
      const bytes = Uint8Array.from({ length }, (_, i) => (i * 37 + 11) & 0xff);
      expect(fromBase32Crockford(base32Crockford(bytes), length)).toEqual(bytes);
    }
  });
});

describe('joining (§8.2)', () => {
  it('the preview names the book and the inviter before anything is claimed, and the secret never reaches the relay', async () => {
    const home = new Household();
    const fandri = await home.device('Fandri');
    const dewi = await home.device('Dewi');
    const bookId = await home.share(fandri);
    const { code, inviteId } = await fandri.engine.createInvite(bookId, { inviterName: 'Fandri' });
    const preview = await dewi.engine.previewInvite(code);
    expect(preview).toMatchObject({ bookId, bookName: 'Personal', inviterName: 'Fandri', baseCurrency: 'IDR', claimed: false, expired: false });
    await expect(dewi.transport.previewInvite(inviteId)).resolves.toMatchObject({ claimed: false });
    const stored = JSON.stringify(home.relay.peek(home.relayBookId)!.invites.get(inviteId));
    const secret = parseInviteCode(code).secret;
    expect(stored).not.toContain('Fandri');
    expect(stored).not.toContain('Personal');
    expect(stored).not.toContain(Buffer.from(secret).toString('base64url'));
  });

  it('a currency mismatch claims nothing and stores nothing; the invite is still good for someone else', async () => {
    const home = new Household();
    const fandri = await home.device('Fandri');
    const sgd = await home.device('Sgd', 'member-sgd', 'SGD');
    const dewi = await home.device('Dewi');
    const bookId = await home.share(fandri);
    const { code, inviteId } = await fandri.engine.createInvite(bookId, { inviterName: 'Fandri' });
    const refused = await sgd.engine.joinBook(code, { ws: sgd.ws, memberName: 'Sgd', deviceName: 'phone' }).catch((e: unknown) => e);
    expect(refused).toBeInstanceOf(SharingError);
    expect((refused as SharingError).code).toBe('CURRENCY');
    expect((refused as SharingError).message).toBe("This workspace keeps its money in IDR; this app's own accounts are kept in SGD. Sharing across currencies isn't supported yet.");
    await expect(sgd.transport.previewInvite(inviteId)).resolves.toMatchObject({ claimed: false });
    expect(home.relay.peek(home.relayBookId)!.devices.has(sgd.deviceId)).toBe(false);
    for (const table of ['shared_books', 'book_epoch_keys', 'sync_outbox']) expect(await count(sgd, table)).toBe(0);
    expect((await sgd.database.db.values(sql`SELECT 1 FROM books WHERE id = ${bookId}`)).length).toBe(0);
    await dewi.engine.joinBook(code, { ws: dewi.ws, memberName: 'Dewi', deviceName: 'phone' });
    expect(home.relay.peek(home.relayBookId)!.devices.has(dewi.deviceId)).toBe(true);
  });

  it('a claimed invite, a mistyped code and an expired invite each say so', async () => {
    const home = new Household();
    const fandri = await home.device('Fandri');
    const dewi = await home.device('Dewi');
    const other = await home.device('Other');
    const bookId = await home.share(fandri);
    const { code } = await fandri.engine.createInvite(bookId, { inviterName: 'Fandri' });
    await dewi.engine.joinBook(code, { ws: dewi.ws, memberName: 'Dewi', deviceName: 'phone' });
    await expect(other.engine.joinBook(code, { ws: other.ws, memberName: 'O', deviceName: 'p' })).rejects.toMatchObject({ code: 'INVITE_CLAIMED' });
    // The same invite id with another secret: the preview does not open.
    const { inviteId } = parseInviteCode(code);
    const wrong = encodeInviteCode(inviteId, new Uint8Array(16));
    await expect(other.engine.previewInvite(wrong)).rejects.toMatchObject({ code: 'BAD_CODE' });
    await expect(other.engine.previewInvite('not a code')).rejects.toMatchObject({ code: 'BAD_CODE' });
    const late = await fandri.engine.createInvite(bookId, { inviterName: 'Fandri' });
    const future = new (await import('../../src/sync/engine')).SyncEngine(other.database, other.transport, other.keys, () => Date.now() + 8 * 24 * 3600 * 1000);
    await expect(future.joinBook(late.code, { ws: other.ws, memberName: 'O', deviceName: 'p' })).rejects.toMatchObject({ code: 'INVITE_EXPIRED' });
  });

  it('a joiner after two rotations reads the whole history', async () => {
    const home = new Household();
    const fandri = await home.device('Fandri');
    const dewi = await home.device('Dewi');
    const budi = await home.device('Budi');
    const sari = await home.device('Sari');
    const bookId = await home.share(fandri);
    await spend(fandri, bookId, 'epoch one', 10_000);
    await home.join(dewi, fandri);
    await home.settle([fandri, dewi]);
    await fandri.engine.removeDevice(bookId, dewi.deviceId);
    await spend(fandri, bookId, 'epoch two', 20_000);
    await home.join(budi, fandri);
    await home.settle([fandri, budi]);
    await fandri.engine.removeDevice(bookId, budi.deviceId);
    await spend(fandri, bookId, 'epoch three', 30_000);
    await fandri.engine.syncOnce(bookId);

    const epochs = await fandri.database.db.values<[number]>(sql`SELECT epoch FROM book_epoch_keys ORDER BY epoch`);
    expect(epochs.map(([e]) => e)).toEqual([1, 2, 3]);
    const sealedUnder = new Set([...home.relay.peek(home.relayBookId)!.log.values()].filter((e) => e.kind === 'change').map((e) => e.epoch));
    expect([...sealedUnder].sort()).toEqual([1, 2, 3]);

    await home.join(sari, fandri);
    await home.settle([fandri, sari]);
    const sariView = await projectBook(sari.database, bookId);
    expect(Object.values(sariView.purchase!).map((p) => (p as { description: string }).description).sort()).toEqual(['epoch one', 'epoch three', 'epoch two']);
    expect(sariView).toEqual(await projectBook(fandri.database, bookId));
  });
});

describe('linking your own device (§8.3)', () => {
  it("joins as the same member, and an owner's linked device becomes an owner on the relay", async () => {
    const home = new Household();
    const fandri = await home.device('Fandri');
    const tablet = await home.device('Tablet');
    const dewi = await home.device('Dewi');
    const bookId = await home.share(fandri);
    await spend(fandri, bookId, 'before the tablet', 10_000);
    const { code } = await fandri.engine.linkDevice(bookId, { inviterName: 'Fandri' });
    await tablet.engine.joinBook(code, { ws: tablet.ws, memberName: 'ignored', deviceName: 'Tablet' });
    await home.settle([fandri, tablet]);
    const [[member]] = (await tablet.database.db.values<[string]>(sql`SELECT member_id FROM shared_books WHERE book_id = ${bookId}`)) as [[string]];
    expect(member).toBe(fandri.memberId);
    expect(await count(tablet, 'book_members')).toBe(1);
    expect(home.relay.peek(home.relayBookId)!.owners.has(tablet.deviceId)).toBe(true);
    // As an owner, the tablet can invite.
    const { code: fromTablet } = await tablet.engine.createInvite(bookId, { inviterName: 'Fandri' });
    await dewi.engine.joinBook(fromTablet, { ws: dewi.ws, memberName: 'Dewi', deviceName: 'phone', memberId: dewi.memberId });
    await home.settle();
    expect(await projectBook(dewi.database, bookId)).toEqual(await projectBook(fandri.database, bookId));
    expect(await projectBook(tablet.database, bookId)).toEqual(await projectBook(fandri.database, bookId));
  });
});

describe('sharing (§6.5) leaves nothing on the relay when the seed fails', () => {
  it('the relay book made before the seed is deleted again', async () => {
    const home = new Household();
    const fandri = await home.device('Fandri');
    const book = await (await import('../../src/index')).personalBook(fandri.database, fandri.ws);
    // The seed's transaction fails part way (a full disk, say), after the relay book exists.
    await fandri.database.execScript(`CREATE TEMP TRIGGER seed_fails BEFORE INSERT ON main.sync_lineage BEGIN SELECT RAISE(ABORT, 'disk full'); END;`);
    await spend(fandri, book.id, 'history', 1_000);
    const made: string[] = [];
    const createBook = fandri.transport.createBook.bind(fandri.transport);
    fandri.transport.createBook = async (device) => {
      const result = await createBook(device);
      made.push(result.bookId);
      return result;
    };
    await expect(fandri.engine.shareBook(book.id, { memberName: 'Fandri', deviceName: 'phone' })).rejects.toThrow();
    expect(made).toHaveLength(1);
    expect(home.relay.peek(made[0]!)!.deleted).toBe(true);
    expect(await count(fandri, 'shared_books')).toBe(0);
    expect(await count(fandri, 'book_epoch_keys')).toBe(0);
    // And sharing can simply be tried again once the cause is gone.
    await fandri.database.execScript('DROP TRIGGER temp.seed_fails');
    await expect(fandri.engine.shareBook(book.id, { memberName: 'Fandri', deviceName: 'phone' })).resolves.toMatchObject({ changeSets: 1 });
  });
});

describe('what joining checks before it claims (I4, task 5 fix round 1)', () => {
  it('a book this device already holds is refused before the claim, so the invite is not spent', async () => {
    const home = new Household();
    const fandri = await home.device('Fandri');
    const bookId = await home.share(fandri);
    const { code, inviteId } = await fandri.engine.createInvite(bookId, { inviterName: 'Fandri' });
    // The owner's own device opening its own invite: the book is here already.
    await expect(fandri.engine.joinBook(code, { ws: fandri.ws, memberName: 'x', deviceName: 'x' })).rejects.toMatchObject({ code: 'ALREADY_SHARED' });
    // A device holding a book under that id that is not shared (a copy of the owner's file, say).
    const copy = await home.device('Copy');
    await copy.database.execScript(
      `INSERT INTO books (id, workspace_id, name, kind, base_currency, count_events_in_budget, sort_order, archived_at, created_at) VALUES ('${bookId}', '${copy.ws.workspaceId}', 'Personal', 'personal', 'IDR', 0, 5, NULL, '2026-01-01')`,
    );
    await expect(copy.engine.joinBook(code, { ws: copy.ws, memberName: 'x', deviceName: 'x' })).rejects.toMatchObject({ code: 'ALREADY_SHARED' });
    await expect(fandri.transport.previewInvite(inviteId)).resolves.toMatchObject({ claimed: false });
  });

  it("the invite's keys and its preview are sealed apart: neither opens as the other", async () => {
    const { inviteKeyOf, openInviteJson, sealInviteJson, inviteAad } = await import('../../src/sync/invite');
    const key = await inviteKeyOf(new Uint8Array(16), 'invite-1');
    const keys = await sealInviteJson(key, [{ epoch: 1, key: 'k' }], inviteAad('keys', 'invite-1'));
    await expect(openInviteJson(key, keys, inviteAad('preview', 'invite-1'))).rejects.toThrow();
    await expect(openInviteJson(key, keys, inviteAad('keys', 'invite-2'))).rejects.toThrow();
    await expect(openInviteJson(key, keys, inviteAad('keys', 'invite-1'))).resolves.toEqual([{ epoch: 1, key: 'k' }]);
  });
});
