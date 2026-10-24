/**
 * A split part counted in no workspace — "Not counted" (0090). It is money the card was charged for that is no
 * workspace's spending: a line on the owner's Not counted equity account, which no report reads (every report reads
 * income and expense lines), while the card keeps the whole charge.
 */

/** The system key of the Not counted equity account. */
export const NOT_COUNTED_KEY = 'not_counted';

/**
 * What a form names a Not counted part's line by, before the ledger knows the account: a posting line on this id is
 * posted on the workspace's Not counted account, made on first use.
 */
export const NOT_COUNTED_LINE = 'not-counted';

/** A line on the Not counted account, by its system key as a view reads it. */
export const isNotCountedKey = (systemKey: string | null | undefined): boolean => systemKey === NOT_COUNTED_KEY;
