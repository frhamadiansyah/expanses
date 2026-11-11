import { sql } from 'drizzle-orm';
import type { Db } from '../database';
import type { BookContext } from './apply';

/*
 * Own purchases onto the right accounts (sharing resilience §6.5, D-B6). A purchase never carries a local account id,
 * only `paidLabel`: the account's name as its payer saw it, `"Name ···· 1234"` for a card, `"A + B"` for two. When this
 * member paid and this phone has no head of the purchase (its rows came back through the share: Place them now, a
 * Reconnect), apply looks for the one own account the label names. The choice is local only: the money side of an own
 * purchase never travels, so peers are unaffected.
 */

/** A card's label as capture writes it (`capture.ts`, the payer's label): the account's name, four dots, the last four. */
const CARD_LABEL = /^(.+) ···· (\d{4})$/;

/**
 * The one own account here the label names, in the line's currency, with the card it names when it names one: an
 * account of this workspace, open (not archived), a money account (asset or liability), not a placeholder. A card
 * label matches by the account's name and the card's last four. None or more than one: null.
 */
export async function ownPlaceForLabelTx(tx: Db, ctx: BookContext, label: string, currency: string): Promise<{ accountId: string; cardId: string | null } | null> {
  const open = sql`a.workspace_id = ${ctx.ws.workspaceId} AND a.archived_at IS NULL AND a.kind IN ('asset', 'liability') AND a.currency = ${currency}
    AND a.id NOT IN (SELECT account_id FROM book_member_accounts)`;
  const card = CARD_LABEL.exec(label);
  const rows = card
    ? await tx.values<[string, string | null]>(sql`
        SELECT DISTINCT a.id, c.id FROM accounts a JOIN cards c ON c.account_id = a.id
        WHERE a.name = ${card[1]!} AND c.last4 = ${card[2]!} AND ${open}`)
    : await tx.values<[string, string | null]>(sql`SELECT a.id, NULL FROM accounts a WHERE a.name = ${label} AND ${open}`);
  if (rows.length !== 1) return null;
  const [accountId, cardId] = rows[0]!;
  return { accountId, cardId };
}

/** The one own account here the label names, in that currency (see `ownPlaceForLabelTx`); null for none or several. */
export async function ownAccountForLabelTx(tx: Db, ctx: BookContext, label: string, currency: string): Promise<string | null> {
  return (await ownPlaceForLabelTx(tx, ctx, label, currency))?.accountId ?? null;
}
