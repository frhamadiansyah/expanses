import { EXCHANGE_RESULT_KEYS } from '@expanses/core';
import { type SQL, sql, type SQLWrapper } from 'drizzle-orm';

/*
 * An exchange's gain or loss counts nowhere (owner, 17 Nov 2026): `EXCHANGE_RESULT_KEYS`. The withdrawal rate still
 * writes the pair; every reader that adds up spending or income adds this beside its category kind, so the pair's
 * category line is never one of its rows. The key travels with the category, so a partner's phone leaves it out alike.
 */

/** Over a category account's system key: true when it is not Exchange gain or Exchange loss. */
export function notExchangeResult(systemKey: SQLWrapper): SQL {
  return sql`(${systemKey} IS NULL OR ${systemKey} NOT IN (${sql.join(
    EXCHANGE_RESULT_KEYS.map((key) => sql`${key}`),
    sql`, `,
  )}))`;
}
