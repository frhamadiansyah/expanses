import { sql } from 'drizzle-orm';
import type { Tx } from '../database';
import { lineageOfTransaction, projectPurchase, rowUpsertsTx, writeChangeSetsTx, type CaptureConfig, type SharedBook } from './capture';
import type { DevicePublic, Op } from './types';

/*
 * Seeding (household-sharing spec §6.5 steps 0–3): sharing a workspace that already has history. Every row in scope
 * goes into the outbox as a full upsert, in an order a receiver can apply straight through — the book, its members and
 * devices, categories parents first, then what hangs off them, then every non-void purchase oldest first — cut into
 * change-sets with fresh hlcs and their field clocks written. Step 4 (draining, and the invite after it) is the caller's.
 */

export type SharingErrorCode = 'CURRENCY' | 'ALREADY_SHARED' | 'NOT_FOUND';

export class SharingError extends Error {
  constructor(
    readonly code: SharingErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'SharingError';
  }
}

export interface SeedInput {
  bookId: string;
  relayBookId: string;
  memberId: string;
  memberName: string;
  deviceId: string;
  deviceName: string;
  device: DevicePublic;
}

/** §6.5 step 0 (ruled O3): the book must keep its money in the owner's own currency. Refuses before anything is made. */
export async function assertShareableTx(tx: Tx, bookId: string): Promise<void> {
  const [row] = await tx.values<[string, string]>(
    sql`SELECT b.base_currency, w.base_currency FROM books b JOIN workspaces w ON w.id = b.workspace_id WHERE b.id = ${bookId}`,
  );
  if (!row) throw new SharingError('NOT_FOUND', 'That workspace is not here');
  const [bookCurrency, ownCurrency] = row;
  if (bookCurrency !== ownCurrency) {
    throw new SharingError(
      'CURRENCY',
      `This workspace keeps its money in ${bookCurrency}; this app keeps yours in ${ownCurrency}. Sharing across currencies isn't supported yet.`,
    );
  }
  if ((await tx.values(sql`SELECT 1 FROM shared_books WHERE book_id = ${bookId}`)).length > 0) {
    throw new SharingError('ALREADY_SHARED', 'This workspace is already shared');
  }
}

/** Categories parents first, so a receiver never meets a child before its parent. */
function parentsFirst(ops: Op[]): Op[] {
  const byId = new Map(ops.map((op) => [op.id, op]));
  const depth = (op: Op, seen = new Set<string>()): number => {
    const parentId = op.op === 'upsert' ? (op.fields.parentId as string | null) : null;
    const parent = parentId ? byId.get(parentId) : undefined;
    if (!parent || seen.has(op.id)) return 0;
    seen.add(op.id);
    return 1 + depth(parent, seen);
  };
  return ops.map((op, i) => ({ op, i, d: depth(op) })).sort((a, b) => a.d - b.d || a.i - b.i).map((x) => x.op);
}

/**
 * §6.5 steps 1–3 inside the caller's transaction: `shared_books` (epoch 1), this member and this device, then every row
 * in scope, sealed into the outbox. The relay book (step 1) is made by the caller first. Returns how many change-sets
 * wait to be drained.
 */
export async function seedBookTx(tx: Tx, config: Pick<CaptureConfig, 'sealerFor' | 'now'>, input: SeedInput): Promise<number> {
  await assertShareableTx(tx, input.bookId);
  const now = new Date().toISOString();
  await tx.run(
    sql`INSERT INTO shared_books (book_id, relay_book_id, epoch, member_id, state, shared_at) VALUES (${input.bookId}, ${input.relayBookId}, 1, ${input.memberId}, 'active', ${now})`,
  );
  await tx.run(sql`INSERT INTO book_members (book_id, member_id, name, role, joined_at) VALUES (${input.bookId}, ${input.memberId}, ${input.memberName}, 'owner', ${now})`);
  await tx.run(sql`
    INSERT INTO book_devices (book_id, device_id, member_id, name, sign_jwk, agree_jwk, added_at, removed_at)
    VALUES (${input.bookId}, ${input.deviceId}, ${input.memberId}, ${input.deviceName}, ${JSON.stringify(input.device.signJwk)}, ${JSON.stringify(input.device.agreeJwk)}, ${now}, NULL)`);

  const book: SharedBook = { bookId: input.bookId, memberId: input.memberId, epoch: 1 };
  const ops: Op[] = [];
  const rows = (entity: string) => rowUpsertsTx(tx, book, entity);
  ops.push(...(await rows('book')), ...(await rows('member')), ...(await rows('device')));
  ops.push(...parentsFirst(await rows('category')), ...(await rows('category_need')));
  ops.push(...(await rows('budget')), ...(await rows('budget_frequency')), ...(await rows('budget_override')));
  ops.push(...(await rows('book_income')), ...(await rows('book_income_override')));
  ops.push(...(await rows('bill')), ...(await rows('bill_window')), ...(await rows('bill_skip')));

  // Every non-void purchase, oldest first, paid by this member. A void one never existed for the other member.
  const heads = await tx.values<[string]>(sql`
    SELECT t.id FROM transactions t JOIN book_transactions bt ON bt.transaction_id = t.id
    WHERE bt.book_id = ${input.bookId} AND t.status = 'posted'
    ORDER BY t.occurred_on, t.created_at, t.rowid`);
  for (const [head] of heads) {
    const lineageId = await lineageOfTransaction(tx, head);
    const purchase = (await projectPurchase(tx, head, input.memberId, null))!;
    purchase.money.paidBy = input.memberId;
    await tx.run(
      sql`INSERT INTO sync_lineage (lineage_id, book_id, head_transaction_id, paid_by, paid_label) VALUES (${lineageId}, ${input.bookId}, ${head}, ${input.memberId}, ${purchase.money.paidLabel})`,
    );
    ops.push({ entity: 'purchase', id: lineageId, op: 'upsert', fields: { ...purchase } });
  }
  return writeChangeSetsTx(tx, config, book, ops);
}
