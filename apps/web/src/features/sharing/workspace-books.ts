import type { SharedBookSummary } from '@expanses/db';

/**
 * The shared books that are workspaces. A shared event's relay book is listed by `listSharedBooks` too (the sync needs
 * it polled), marked `kind: 'event'`; it has no workspace to switch to or to read-only, so the switcher, the read-only
 * notice and the other lookups by workspace id never see it.
 */
export const workspaceBooks = (books: SharedBookSummary[]): SharedBookSummary[] => books.filter((book) => book.kind !== 'event');
