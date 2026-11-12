import { sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { type Database, markShareListAsked, seedShareListAsked, shareListAskedFor } from '../src/index';
import { setupDb } from './helpers';

let database: Database;

beforeEach(async () => {
  ({ database } = await setupDb());
});

describe('the share list offered once per member', () => {
  it('asks for nobody until marked, then remembers each member per workspace book', async () => {
    expect(await shareListAskedFor(database, 'book-family')).toEqual([]);
    await markShareListAsked(database, 'book-family', ['m-andi']);
    expect(await shareListAskedFor(database, 'book-family')).toEqual(['m-andi']);
    await markShareListAsked(database, 'book-family', ['m-sari', 'm-andi']);
    expect(await shareListAskedFor(database, 'book-family')).toEqual(['m-andi', 'm-sari']);
    expect(await shareListAskedFor(database, 'book-other')).toEqual([]);
  });

  it('an unreadable mark reads as nobody asked', async () => {
    await database.db.run(sql`INSERT INTO settings (key, value) VALUES ('share.list.asked.book-family', 'not json')`);
    expect(await shareListAskedFor(database, 'book-family')).toEqual([]);
  });
});

describe('the first run of this build', () => {
  async function sharedBook(withMembers: { memberId: string; removed?: boolean }[]): Promise<string> {
    const [book] = await database.db.values<[string]>(sql`SELECT id FROM books LIMIT 1`);
    const bookId = book![0];
    await database.db.run(sql`INSERT INTO shared_books (book_id, relay_book_id, epoch, member_id, state, shared_at) VALUES (${bookId}, 'relay-1', 1, 'm-rina', 'active', '2026-11-01T00:00:00Z')`);
    for (const [i, member] of [{ memberId: 'm-rina' }, ...withMembers].entries()) {
      await database.db.run(sql`
        INSERT INTO book_devices (book_id, device_id, member_id, name, sign_jwk, agree_jwk, added_at, removed_at)
        VALUES (${bookId}, ${`d-${i}`}, ${member.memberId}, 'Phone', '{}', '{}', '2026-11-01T00:00:00Z', ${'removed' in member && member.removed ? '2026-11-02T00:00:00Z' : null})`);
    }
    return bookId;
  }

  it('marks every member already joined as offered, once, so a household sharing since before is not redirected', async () => {
    const bookId = await sharedBook([{ memberId: 'm-andi' }, { memberId: 'm-old', removed: true }]);
    await seedShareListAsked(database);
    expect(await shareListAskedFor(database, bookId)).toEqual(['m-andi']);
    // Someone joining after the first run is offered the step as usual: the seed does not run again.
    await database.db.run(sql`
      INSERT INTO book_devices (book_id, device_id, member_id, name, sign_jwk, agree_jwk, added_at, removed_at)
      VALUES (${bookId}, 'd-sari', 'm-sari', 'Phone', '{}', '{}', '2026-11-12T00:00:00Z', NULL)`);
    await seedShareListAsked(database);
    expect(await shareListAskedFor(database, bookId)).toEqual(['m-andi']);
  });

  it('with nothing shared, only remembers that it ran', async () => {
    await seedShareListAsked(database);
    expect(await shareListAskedFor(database, 'any')).toEqual([]);
  });
});
