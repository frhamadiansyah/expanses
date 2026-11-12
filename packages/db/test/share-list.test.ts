import { sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { type Database, markShareListAsked, shareListAskedFor } from '../src/index';
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
