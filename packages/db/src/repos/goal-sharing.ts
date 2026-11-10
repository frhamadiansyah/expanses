import { sql } from 'drizzle-orm';
import type { Database } from '../database';
import { meetsVersion } from '../sync/events/version';
import { SHARED_GOALS_MIN_APP_VERSION } from '../sync/goals/version';
import { listSharedBooks } from './sharing';

/*
 * Which workspaces a goal can be shared into (shared goals §8.6, C3, D6): active workspace books with another current
 * member, where every device not removed already runs a build that knows shared goals.
 */

export interface GoalShareTarget {
  bookId: string;
  bookName: string;
  /** This device's member. */
  me: string;
  /** The other current members, in the order they joined: everyone here will see the goal (C31). */
  others: { memberId: string; name: string }[];
}

export async function goalShareTargets(database: Database): Promise<GoalShareTarget[]> {
  const out: GoalShareTarget[] = [];
  for (const shared of await listSharedBooks(database)) {
    if (shared.state !== 'active' || shared.kind !== 'workspace') continue;
    const others = shared.members.filter((m) => m.memberId !== shared.memberId).map(({ memberId, name }) => ({ memberId, name }));
    if (others.length === 0) continue;
    const versions = await database.db.values<[string | null]>(sql`SELECT app_version FROM book_devices WHERE book_id = ${shared.bookId} AND removed_at IS NULL`);
    if (!versions.every(([v]) => meetsVersion(v, SHARED_GOALS_MIN_APP_VERSION))) continue;
    const [book] = await database.db.values<[string]>(sql`SELECT name FROM books WHERE id = ${shared.bookId}`);
    if (!book) continue;
    out.push({ bookId: shared.bookId, bookName: book[0], me: shared.memberId, others });
  }
  return out;
}
