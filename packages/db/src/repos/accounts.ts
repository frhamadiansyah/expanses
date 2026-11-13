import { type AccountKind, BANK_NAMED_SUBTYPES, currencyInfo, openingBalanceLines, uuidv7 } from '@expanses/core';
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { WorkspaceContext } from '../context';
import type { Database, Db } from '../database';
import { accounts, auditLog, entries, transactions } from '../schema';
import { bookCategories } from '../schema-books';
import { SYSTEM_ACCOUNTS, type SystemAccountKey } from '../seed';
import { notPlaceholder, sharingTablesExist } from '../sync/placeholder';
import { hasBooks, personalBookIdTx } from './books';
import { recordActivityTx } from './activity-log';
import { postTransactionTx } from './ledger';
import { captureMoneyAccountRenamingTx, markAccountDirtyTx, withCapture } from '../sync/capture';

export type AccountRow = typeof accounts.$inferSelect & {
  /**
   * Whether this money is for spending (0086): 1 — offered under "Paid with", counted in Wallet's balance, a card in
   * Wallet — or 0, kept as savings: still on Assets, still a transfer's From or To. Filled by `listAccounts` (every
   * list a screen reads); absent on a row read any other way, and on a database stopped before 0086, which reads as
   * on — what every account was until the switch existed. Means nothing on anything but a spendable money account.
   *
   * On a pocket it is the answer, not the pocket's own switch: on only when the pocket and its account both are
   * (`spendingSwitchOn`), so every list that offers pockets reads it off the row it offers.
   */
  forSpending?: number;
  /**
   * The bank an account at a bank is called by with its name ("Mandiri" in "Mandiri Xpresi"): the tax report's Nama
   * institusi as stored, for a current or saving account and a time deposit, and a credit card's issuer
   * (`BANK_NAMED_SUBTYPES`); null for anything else, and for one with no bank named. An account with pockets keeps its bank on its pockets' profiles, so
   * the account and every pocket read the first pocket's that names one. Filled by `listAccounts`, as `forSpending` is;
   * a screen prints it through `accountDisplayName` and never stores it in a name.
   */
  bank?: string | null;
  /**
   * The name as typed, where `name` has been replaced by the name a screen shows (`accountDisplayName`) — the app's
   * account lists do that, so every row prints "Mandiri Xpresi". Anything that writes a name back reads this one.
   * Absent on a row straight from the database, whose `name` is the typed one.
   */
  typedName?: string;
};

/** One row's "For spending" switch as stored: 0 off, anything else (1, or none at all) on. */
export type SpendingSwitch = { forSpending?: number };

/**
 * The rule for "For spending" (0086), in one place: money is for spending when its own switch is on and — for a
 * pocket — its account's is too. An account switched off keeps every pocket under it out, whatever each pocket says;
 * an account switched on leaves each pocket to its own switch, which is on until a pocket is switched off (leftover
 * lira after a trip, kept beside the rupiah that is still spent). A switch that is not there reads as on.
 */
export function spendingSwitchOn(row: SpendingSwitch, parent?: SpendingSwitch | null): boolean {
  return row.forSpending !== 0 && (parent?.forSpending ?? 1) !== 0;
}
export type AccountSubtype = AccountRow['subtype'];

export class AccountError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AccountError';
  }
}

export const BALANCE_SUBTYPES = {
  // 'event_balance' is a shared event's trip balance (shared events §5): made by the event, never offered by a picker.
  asset: ['cash', 'bank', 'savings', 'fund', 'ewallet', 'emoney', 'time_deposit', 'other_cash', 'investment', 'property', 'vehicle', 'receivable', 'event_balance'],
  liability: ['credit_card', 'loan', 'payable'],
} as const satisfies Record<'asset' | 'liability', readonly AccountSubtype[]>;

/**
 * Accounts money can be **paid from**: everyday cash, a wallet, a current or savings account. A transaction, a
 * bill, a card and an instalment are all paid out of one of these.
 *
 * A broker's cash is deliberately not here. An RDN cannot be spent from — the money is moved to a current or
 * savings account first — so it is not offered behind "Paid with", nor as the account a card or a loan is paid
 * from. It is money all the same: see `MONEY_SUBTYPES`, which is this list plus a broker's cash, and which the
 * three questions that really mean "money the ledger can move" ask instead.
 *
 * A time deposit is in neither list: it holds money it cannot be paid from, and the money leaves by a transfer
 * when it matures. Other cash equivalents — a cheque, a wesel, commercial paper — can be spent.
 */
export const SPENDABLE_SUBTYPES: readonly AccountSubtype[] = ['cash', 'bank', 'savings', 'ewallet', 'emoney', 'other_cash'];

/**
 * Money the ledger can move that nobody can spend: cash at a broker, which a buy is paid from and which is moved out
 * to a bank before it is spent from.
 *
 * Asked by exactly two questions — the cash side of a trade, and where a goal's money may wait — and by nothing else:
 * a deposit's opening balance cannot come from here and its payout cannot land here, so the deposit's own checks ask
 * `SPENDABLE_SUBTYPES` instead.
 */
export const MONEY_SUBTYPES: readonly AccountSubtype[] = [...SPENDABLE_SUBTYPES, 'fund'];

/** A pocket's stored name: the bank and the currency, so every list that prints a name already says both. */
export const pocketName = (parentName: string, currency: string) => `${parentName} · ${currency}`;

/**
 * The accounts that are pocket parents: every asset account some asset account names in `parent_id`, archived pockets
 * included. Categories use `parent_id` too, but they are income or expense, so they never count here.
 */
export function pocketParentIds(rows: readonly Pick<AccountRow, 'id' | 'parentId' | 'kind'>[]): Set<string> {
  const ids = new Set<string>();
  for (const row of rows) if (row.kind === 'asset' && row.parentId) ids.add(row.parentId);
  return ids;
}

/** A money account under a parent is a pocket; these are the rules for one (spec §3.4). */
async function checkPocketTx(tx: Db, ws: WorkspaceContext, pocket: AccountRow, parent: AccountRow): Promise<void> {
  if (pocket.kind !== 'asset') throw new AccountError('Only a money account holds pockets');
  if (parent.parentId !== null) throw new AccountError('A pocket cannot hold pockets of its own');
  if (parent.archivedAt !== null) throw new AccountError(`${parent.name} is archived`);
  if (parent.subtype !== pocket.subtype) throw new AccountError(`A pocket is the same kind of account as ${parent.name}`);
  // Any entry at all, posted or void: an account that has ever held money is not a parent.
  const [held] = await tx.select({ n: sql<number>`count(*)` }).from(entries).where(eq(entries.accountId, parent.id));
  if (Number(held?.n ?? 0) > 0) throw new AccountError(`${parent.name} already holds money of its own, so it cannot hold pockets`);
  const open = await tx
    .select({ currency: accounts.currency })
    .from(accounts)
    .where(and(eq(accounts.workspaceId, ws.workspaceId), eq(accounts.parentId, parent.id), isNull(accounts.archivedAt)));
  if (open.some((row) => row.currency === pocket.currency)) throw new AccountError(`${parent.name} already has a ${pocket.currency} pocket`);
}

export interface CreateAccountInput {
  name: string;
  kind: AccountKind;
  subtype: AccountSubtype;
  currency: string | null;
  parentId?: string | null;
  icon?: string | null;
  /** Natural sign: money held for assets, amount owed for liabilities. */
  openingBalanceMinor?: number;
  openedOn?: string;
  /** Required when the account currency differs from the workspace base and an opening balance is given. */
  openingRateToBase?: number;
  /** Place among its siblings (the existing `sort_order` column); a pocket's order in its account. Defaults to 0. */
  sortOrder?: number;
}

async function writeAudit(tx: Db, ws: WorkspaceContext, action: string, entityId: string, payload: unknown) {
  await tx.insert(auditLog).values({
    id: uuidv7(),
    workspaceId: ws.workspaceId,
    action,
    entity: 'account',
    entityId,
    payloadJson: JSON.stringify(payload),
    createdAt: new Date().toISOString(),
  });
}

export async function listAccounts(
  database: Database,
  ws: WorkspaceContext,
  opts: { includeArchived?: boolean; includePlaceholders?: boolean } = {},
): Promise<AccountRow[]> {
  const hidePlaceholders = !opts.includePlaceholders && (await sharingTablesExist(database.db));
  return database.db
    .select()
    .from(accounts)
    .where(
      and(
        eq(accounts.workspaceId, ws.workspaceId),
        opts.includeArchived ? undefined : isNull(accounts.archivedAt),
        hidePlaceholders ? notPlaceholder(accounts.id) : undefined,
      ),
    )
    // An account placed by Reorder cards (sort_order 1, 2, …) comes before the ones never placed (0), as on Wallet;
    // a pocket keeps its own sort_order among its siblings, where 0 is simply the first.
    .orderBy(asc(accounts.kind), sql`case when ${accounts.sortOrder} = 0 and ${accounts.parentId} is null then 1 else 0 end`, asc(accounts.sortOrder), asc(accounts.name))
    .then(async (rows) => {
      const off = await spendingOffIdsTx(database.db, ws);
      const own = (id: string) => ({ forSpending: off.has(id) ? 0 : 1 });
      const banks = await accountBanksTx(database.db, rows.filter((row) => row.kind !== 'income' && row.kind !== 'expense' && BANK_NAMED_SUBTYPES.includes(row.subtype)).map((row) => row.id));
      // A pocket reads the answer, its own switch and its account's together, so a pay-from list needs no parent.
      return rows.map((row) => ({
        ...row,
        forSpending: spendingSwitchOn(own(row.id), row.parentId ? own(row.parentId) : null) ? 1 : 0,
        bank: banks.get(row.id) ?? null,
      }));
    });
}

/**
 * The bank each bank-held account among `ids` is shown with (see `AccountRow.bank`), by account id; an account of any
 * other kind, or with no bank named, is not in the map. A credit card's is its issuer (card_identity). A money
 * account and its pockets read one bank: the account's own profile's Nama institusi, else its first pocket's that
 * names one — so "Mandiri Xpresi" and "Mandiri Xpresi · USD" never disagree.
 */
export async function accountBanksTx(tx: Db, ids: readonly string[]): Promise<Map<string, string>> {
  const banks = new Map<string, string>();
  if (ids.length === 0) return banks;
  const listOf = (values: readonly string[]) => sql.join(values.map((value) => sql`${value}`), sql`, `);
  const rows = await tx.values<[string, string | null, string, string]>(sql`SELECT id, parent_id, kind, subtype FROM accounts WHERE id IN (${listOf([...new Set(ids)])})`);
  const cards = rows.filter(([, , kind, subtype]) => kind === 'liability' && subtype === 'credit_card').map(([id]) => id);
  if (cards.length > 0) {
    const issuers = await tx.values<[string, string | null]>(sql`SELECT account_id, issuer FROM card_identity WHERE account_id IN (${listOf(cards)})`);
    for (const [id, issuer] of issuers) if (issuer?.trim()) banks.set(id, issuer.trim());
  }
  const held = rows.filter(([, , kind, subtype]) => kind === 'asset' && subtype !== 'credit_card' && BANK_NAMED_SUBTYPES.includes(subtype));
  const groups = [...new Set(held.map(([id, parentId]) => parentId ?? id))];
  if (groups.length === 0) return banks;
  // The accounts' own profiles and their pockets', pockets in their account's order.
  const named = await tx.values<[string, string | null, string]>(
    sql`SELECT a.id, a.parent_id, p.coretax_fields_json FROM accounts a JOIN asset_profiles p ON p.account_id = a.id
        WHERE a.id IN (${listOf(groups)}) OR a.parent_id IN (${listOf(groups)})
        ORDER BY a.sort_order, a.id`,
  );
  const instOf = (json: string): string | null => {
    try {
      const inst = (JSON.parse(json) as { inst?: unknown }).inst;
      return typeof inst === 'string' && inst.trim() ? inst.trim() : null;
    } catch {
      return null; // a profile whose fields cannot be read names no bank
    }
  };
  const own = new Map<string, string>();
  const fromPocket = new Map<string, string>();
  for (const [id, parentId, json] of named) {
    const inst = instOf(json);
    if (!inst) continue;
    if (parentId === null) own.set(id, inst);
    else if (!fromPocket.has(parentId)) fromPocket.set(parentId, inst);
  }
  for (const [id, parentId] of held) {
    const group = parentId ?? id;
    const bank = own.get(group) ?? fromPocket.get(group);
    if (bank) banks.set(id, bank);
  }
  return banks;
}

/*
 * The column is read and written by name (see the schema): a database stopped before 0086 has no for_spending, and
 * there every account is for spending. Asked once per handle, and only a yes is kept, as `numberColumnExists` does.
 */
const spendingColumn = new WeakMap<object, boolean>();
async function spendingColumnExists(tx: Db): Promise<boolean> {
  if (spendingColumn.get(tx)) return true;
  const rows = await tx.values<[number]>(sql`SELECT 1 FROM pragma_table_info('accounts') WHERE name = 'for_spending'`);
  if (rows.length > 0) spendingColumn.set(tx, true);
  return rows.length > 0;
}

/** The accounts of this workspace switched off "For spending": usually none, so it is the short list that is read. */
async function spendingOffIdsTx(tx: Db, ws: WorkspaceContext): Promise<Set<string>> {
  if (!(await spendingColumnExists(tx))) return new Set();
  const rows = await tx.values<[string]>(sql`SELECT id FROM accounts WHERE workspace_id = ${ws.workspaceId} AND for_spending = 0`);
  return new Set(rows.map(([id]) => id));
}

/** Whether one account is switched off "For spending" — false on a database that cannot say. */
export async function isSpendingOffTx(tx: Db, accountId: string): Promise<boolean> {
  if (!(await spendingColumnExists(tx))) return false;
  return (await tx.values(sql`SELECT 1 FROM accounts WHERE id = ${accountId} AND for_spending = 0`)).length > 0;
}

/** Writes the switch onto one account, where the column exists. */
export async function writeForSpendingTx(tx: Db, accountId: string, on: boolean): Promise<void> {
  if (!(await spendingColumnExists(tx))) return;
  await tx.run(sql`UPDATE accounts SET for_spending = ${on ? 1 : 0} WHERE id = ${accountId}`);
}

/*
 * card_tier (0087) is read and written by name too: a database stopped before it has no such column, and there no
 * account has a tier. Asked once per handle, and only a yes is kept, as the two columns before it are.
 */
const tierColumn = new WeakMap<object, boolean>();
async function tierColumnExists(tx: Db): Promise<boolean> {
  if (tierColumn.get(tx)) return true;
  const rows = await tx.values<[number]>(sql`SELECT 1 FROM pragma_table_info('accounts') WHERE name = 'card_tier'`);
  if (rows.length > 0) tierColumn.set(tx, true);
  return rows.length > 0;
}

/** A tier is the bank's short word for it: 'gold', 'prioritas' — letters alone, read by the app against the bank's list. */
const TIER_WORD = /^[a-z]{2,24}$/;

/** The kinds of money a debit card spends from: the only accounts a card tier means anything on. */
const TIERED_SUBTYPES: readonly AccountSubtype[] = ['bank', 'savings'];

/** Each account's card tier (0087), by account id: only the accounts that have one are listed. */
export async function listCardTiers(database: Database, ws: WorkspaceContext): Promise<Record<string, string>> {
  if (!(await tierColumnExists(database.db))) return {};
  const rows = await database.db.values<[string, string]>(
    sql`SELECT id, card_tier FROM accounts WHERE workspace_id = ${ws.workspaceId} AND card_tier IS NOT NULL AND archived_at IS NULL`,
  );
  return Object.fromEntries(rows);
}

/**
 * Which of its bank's debit cards a money account is drawn as in Wallet (0087): the tier's short word, or null for the
 * bank's first. Only a current or saving account carries a debit card, so only those take a tier.
 */
export async function setAccountCardTier(database: Database, ws: WorkspaceContext, id: string, tier: string | null): Promise<void> {
  const word = tier?.trim() || null;
  if (word !== null && !TIER_WORD.test(word)) throw new AccountError('A card tier is a short word, like gold');
  await database.transaction(async (tx) => {
    const [account] = await tx.select().from(accounts).where(and(eq(accounts.id, id), eq(accounts.workspaceId, ws.workspaceId)));
    if (!account) throw new AccountError('Account not found');
    if (account.kind !== 'asset' || !TIERED_SUBTYPES.includes(account.subtype)) throw new AccountError(`${account.name} is not an account a debit card spends from`);
    if (!(await tierColumnExists(tx))) throw new AccountError('This database cannot keep that yet');
    await tx.run(sql`UPDATE accounts SET card_tier = ${word} WHERE id = ${id}`);
    await writeAudit(tx, ws, 'card_tier', id, { cardTier: word });
    // A joint account's summary carries its tier (`ItemFace`), so the partner's phone draws the same face.
    markAccountDirtyTx(tx, id);
  });
}

export async function systemAccountId(tx: Db, ws: WorkspaceContext, key: SystemAccountKey): Promise<string> {
  const [row] = await tx
    .select({ id: accounts.id })
    .from(accounts)
    .where(and(eq(accounts.workspaceId, ws.workspaceId), eq(accounts.systemKey, key)));
  if (!row) throw new AccountError(`System account ${key} missing`);
  return row.id;
}

/**
 * A system account, made the first time it is needed in a workspace that predates it. Equity belongs to no book and
 * never leaves the device, so it is written without capture, as a new workspace writes its own.
 */
export async function ensureSystemAccountTx(tx: Db, ws: WorkspaceContext, key: SystemAccountKey): Promise<string> {
  const [row] = await tx
    .select({ id: accounts.id })
    .from(accounts)
    .where(and(eq(accounts.workspaceId, ws.workspaceId), eq(accounts.systemKey, key), eq(accounts.kind, 'equity')));
  if (row) return row.id;
  const spec = SYSTEM_ACCOUNTS.find((s) => s.key === key)!;
  const id = uuidv7();
  await tx.insert(accounts).values({
    id,
    workspaceId: ws.workspaceId,
    parentId: null,
    kind: 'equity',
    subtype: 'equity',
    name: spec.name,
    icon: null,
    currency: null,
    valuationMode: 'derived',
    systemKey: key,
    sortOrder: 0,
    archivedAt: null,
    createdAt: new Date().toISOString(),
  });
  return id;
}

export async function createAccount(database: Database, ws: WorkspaceContext, input: CreateAccountInput): Promise<AccountRow> {
  return database.transaction((tx) => createAccountTx(tx, ws, input));
}

/**
 * Opens an account inside a transaction already running, so a caller can create the account and
 * post against it as one atomic step. `createAccount` is this with a transaction of its own.
 */
export async function createAccountTx(tx: Db, ws: WorkspaceContext, input: CreateAccountInput): Promise<AccountRow> {
  const name = input.name.trim();
  if (!name) throw new AccountError('Name is required');
  if (input.kind === 'asset' || input.kind === 'liability') {
    if (!(BALANCE_SUBTYPES[input.kind] as readonly string[]).includes(input.subtype)) {
      throw new AccountError(`Subtype ${input.subtype} is not valid for ${input.kind}`);
    }
    if (!input.currency) throw new AccountError('Currency is required');
    currencyInfo(input.currency);
  } else if (input.kind === 'income' || input.kind === 'expense') {
    if (input.subtype !== 'category') throw new AccountError('Income and expense accounts must be categories');
    if (input.currency !== null) throw new AccountError('Categories do not have a currency');
  } else {
    throw new AccountError('Equity accounts are system-managed');
  }

  const now = new Date().toISOString();
  const row: AccountRow = {
    id: uuidv7(),
    workspaceId: ws.workspaceId,
    parentId: input.parentId ?? null,
    kind: input.kind,
    subtype: input.subtype,
    name,
    icon: input.icon ?? null,
    currency: input.currency,
    valuationMode: 'derived',
    systemKey: null,
    sortOrder: input.sortOrder ?? 0,
    archivedAt: null,
    createdAt: now,
  };

  {
    if (row.parentId) {
      const [parent] = await tx
        .select()
        .from(accounts)
        .where(and(eq(accounts.id, row.parentId), eq(accounts.workspaceId, ws.workspaceId)));
      if (!parent || parent.kind !== row.kind) throw new AccountError('Parent must be an account of the same kind');
      if (row.kind === 'asset' || row.kind === 'liability') await checkPocketTx(tx, ws, row, parent);
    }
    await withCapture(tx, { entity: 'category', id: row.id }, async () => {
      await tx.insert(accounts).values(row);
      if ((row.kind === 'income' || row.kind === 'expense') && (await hasBooks(tx))) {
        // A category belongs to a set of books: the one the context names, or the workspace's first (Personal).
        const bookId = ws.bookId ?? (await personalBookIdTx(tx, ws.workspaceId));
        if (bookId) await tx.insert(bookCategories).values({ categoryAccountId: row.id, workspaceId: ws.workspaceId, bookId });
      }
    });
    const opening = input.openingBalanceMinor ?? 0;
    if (opening !== 0 && (row.kind === 'asset' || row.kind === 'liability')) {
      await postTransactionTx(tx, ws, {
        occurredOn: input.openedOn ?? now.slice(0, 10),
        description: `Opening balance: ${name}`,
        lines: openingBalanceLines({
          accountId: row.id,
          kind: row.kind,
          balanceMinor: opening,
          currency: row.currency!,
          equityAccountId: await systemAccountId(tx, ws, 'opening_balance'),
        }),
        ratesToBase: input.openingRateToBase ? { [row.currency!]: input.openingRateToBase } : {},
      });
    }
    await writeAudit(tx, ws, 'create', row.id, input);
    return row;
  }
}

/**
 * Whether a money account is for spending (0086): on, it is offered under "Paid with" and every other pay-from list,
 * counted in Wallet's balance and a card in Wallet; off, it is kept as savings — still on Assets, still a transfer's
 * From or To, but asked for nowhere money is paid out of. Only a spendable kind of money has the switch: a deposit, a
 * broker's cash or a thing owned cannot be paid from whatever it says. A credit card has it too (off: out of Wallet and every pay-from list).
 *
 * An account and each of its pockets have a switch of their own, read together by `spendingSwitchOn`: the account's
 * off keeps all its pockets out, and its on leaves each pocket to its own. So switching the account off writes
 * nothing onto its pockets — a pocket switched off before (the lira left after a trip) is still off when the account
 * comes back on. One thing is written: an account switched back on whose pockets all say off (as every pocket did
 * when the account's switch was still copied onto them) has them all on again, rather than coming back with nothing
 * in it to spend.
 */
export async function setAccountForSpending(database: Database, ws: WorkspaceContext, id: string, on: boolean): Promise<void> {
  await database.transaction(async (tx) => {
    const [account] = await tx.select().from(accounts).where(and(eq(accounts.id, id), eq(accounts.workspaceId, ws.workspaceId)));
    if (!account) throw new AccountError('Account not found');
    if (!(account.kind === 'asset' && SPENDABLE_SUBTYPES.includes(account.subtype)) && account.subtype !== 'credit_card') throw new AccountError(`${account.name} is not money that can be spent from`);
    if (!(await spendingColumnExists(tx))) throw new AccountError('This database cannot keep that yet');
    await writeForSpendingTx(tx, id, on);
    if (on && account.parentId === null) {
      const pockets = await tx.values<[number]>(sql`SELECT for_spending FROM accounts WHERE workspace_id = ${ws.workspaceId} AND parent_id = ${id} AND kind = 'asset'`);
      if (pockets.length > 0 && pockets.every(([flag]) => flag === 0)) {
        await tx.run(sql`UPDATE accounts SET for_spending = 1 WHERE workspace_id = ${ws.workspaceId} AND parent_id = ${id} AND kind = 'asset'`);
      }
    }
    await writeAudit(tx, ws, 'for_spending', id, { forSpending: on });
  });
}

/** The two kinds of money account one tax code files (0102): a current account and a saving account. */
export type MoneyAccountKind = 'bank' | 'savings';
const SAME_CODE_KINDS: readonly string[] = ['bank', 'savings'] satisfies readonly MoneyAccountKind[];

/**
 * Makes a current account a saving account, or a saving account a current account. Both file under 0102, so the
 * tax code cannot say which one an account is; the subtype does, and this is the one way it is changed after the
 * account is opened — picked under Description as the other of the two.
 *
 * Only that pair, either way: nothing else becomes one of them and neither becomes anything else. Only the subtype is
 * written — the balance, its lines, its profile (group, code, tax fields), For spending, digits, card tier, debit cards
 * and its net-worth share and joint settings are the account's own and stay. An account with pockets changes with
 * every pocket under it, since a pocket is always its account's kind; a pocket alone is refused.
 *
 * What reads the subtype reads the new one from here on, history included: the savings ratio counts money moved into
 * a saving account as put away and into a current account as not. Captured as a rename is, so a shared item's
 * net-worth summary — which carries the subtype — goes out again to the partner.
 */
export async function setMoneyAccountKind(database: Database, ws: WorkspaceContext, id: string, kind: MoneyAccountKind): Promise<void> {
  if (!SAME_CODE_KINDS.includes(kind)) throw new AccountError('Only a current account and a saving account change into each other');
  await database.transaction(async (tx) => {
    const [account] = await tx.select().from(accounts).where(and(eq(accounts.id, id), eq(accounts.workspaceId, ws.workspaceId)));
    if (!account) throw new AccountError('Account not found');
    if (account.kind !== 'asset' || !SAME_CODE_KINDS.includes(account.subtype)) throw new AccountError(`${account.name} is not a current or saving account`);
    if (account.parentId !== null) throw new AccountError('A pocket is the kind of account it is in');
    if (account.subtype === kind) return;
    const pockets = await tx
      .select({ id: accounts.id })
      .from(accounts)
      .where(and(eq(accounts.workspaceId, ws.workspaceId), eq(accounts.parentId, id), eq(accounts.kind, 'asset')));
    const ids = [id, ...pockets.map((pocket) => pocket.id)];
    await withCapture(
      tx,
      ids.map((one) => ({ entity: 'category' as const, id: one })),
      () => tx.update(accounts).set({ subtype: kind }).where(and(eq(accounts.workspaceId, ws.workspaceId), inArray(accounts.id, ids))),
    );
    await writeAudit(tx, ws, 'kind', id, { from: account.subtype, to: kind });
  });
}

export async function renameAccount(database: Database, ws: WorkspaceContext, id: string, name: string): Promise<void> {
  if (!name.trim()) throw new AccountError('Name is required');
  await database.transaction((tx) => renameAccountTx(tx, ws, id, name));
}

/** The rename inside a transaction already open, for a change that renames as part of itself (a share's ticker or broker). */
export async function renameAccountTx(tx: Db, ws: WorkspaceContext, id: string, name: string): Promise<void> {
  const trimmed = name.trim();
  if (!trimmed) throw new AccountError('Name is required');
  const [before] = await tx.select({ name: accounts.name }).from(accounts).where(and(eq(accounts.id, id), eq(accounts.workspaceId, ws.workspaceId)));
  // A shared purchase paid from it names it (paidLabel): it goes out again under the new name.
  if (before) await captureMoneyAccountRenamingTx(tx, id);
  await withCapture(tx, { entity: 'category', id }, () =>
    tx.update(accounts).set({ name: trimmed }).where(and(eq(accounts.id, id), eq(accounts.workspaceId, ws.workspaceId))),
  );
  if (before) {
    // Pockets still named after the account follow it; one the owner renamed keeps its own name.
    const pockets = await tx
      .select({ id: accounts.id, name: accounts.name, currency: accounts.currency })
      .from(accounts)
      .where(and(eq(accounts.workspaceId, ws.workspaceId), eq(accounts.parentId, id), eq(accounts.kind, 'asset')));
    for (const pocket of pockets) {
      // Joint net worth: a shared pocket names its account (`pocketOf`), so each goes out again under the new name.
      markAccountDirtyTx(tx, pocket.id);
      if (pocket.currency && pocket.name === pocketName(before.name, pocket.currency)) {
        await captureMoneyAccountRenamingTx(tx, pocket.id);
        await tx.update(accounts).set({ name: pocketName(trimmed, pocket.currency) }).where(eq(accounts.id, pocket.id));
      }
    }
  }
  await writeAudit(tx, ws, 'rename', id, { name: trimmed });
}

/**
 * Wallet's order (owner's "A2", 24 Oct): the cards in `accountIds` — money kept for spending and credit cards, in one
 * mixed list — are given `sort_order` 1, 2, 3… in that order, atomically. An account left out keeps what it had (0, for
 * one added since), and Wallet puts those after the ordered ones.
 *
 * Only top-level money and credit accounts: a category's `sort_order` is its place in the tree, and a pocket's its
 * place in its account, so neither is ever a Wallet card. An id that is not one of this workspace's accounts, or is
 * listed twice, refuses the whole order. Written through the same capture as a rename, so it goes wherever an
 * account's own fields go; a money account is a device's own (it is never in a shared book), so today that is nowhere.
 */
export async function setWalletOrder(database: Database, ws: WorkspaceContext, accountIds: readonly string[]): Promise<void> {
  const ids = [...accountIds];
  if (new Set(ids).size !== ids.length) throw new AccountError('An account is listed twice');
  if (ids.length === 0) return;
  await database.transaction(async (tx) => {
    const rows = await tx
      .select({ id: accounts.id, name: accounts.name, kind: accounts.kind, parentId: accounts.parentId })
      .from(accounts)
      .where(and(eq(accounts.workspaceId, ws.workspaceId), inArray(accounts.id, ids)));
    if (rows.length !== ids.length) throw new AccountError('Account not found');
    for (const row of rows) {
      if ((row.kind !== 'asset' && row.kind !== 'liability') || row.parentId !== null) throw new AccountError(`${row.name} is not a card in Wallet`);
    }
    await withCapture(
      tx,
      ids.map((id) => ({ entity: 'category' as const, id })),
      async () => {
        for (const [index, id] of ids.entries()) {
          await tx.update(accounts).set({ sortOrder: index + 1 }).where(and(eq(accounts.id, id), eq(accounts.workspaceId, ws.workspaceId)));
        }
      },
    );
    await writeAudit(tx, ws, 'wallet_order', ids[0]!, { order: ids });
  });
}

/**
 * What one account holds: every posted entry, whatever its date, in the account's own currency. The balance an
 * archive checks is zero. The caller has already found the account in its workspace.
 */
export async function postedBalanceTx(tx: Db, id: string): Promise<number> {
  const [row] = await tx
    .select({ total: sql<number>`coalesce(sum(${entries.amountMinor}), 0)` })
    .from(entries)
    .innerJoin(transactions, eq(entries.transactionId, transactions.id))
    .where(and(eq(entries.accountId, id), eq(transactions.status, 'posted')));
  return Number(row?.total ?? 0);
}

/** Archives inside a transaction already running. Refuses a system account, and a money account that still holds a balance. */
export async function archiveAccountTx(tx: Db, ws: WorkspaceContext, id: string): Promise<void> {
  const [account] = await tx
    .select()
    .from(accounts)
    .where(and(eq(accounts.id, id), eq(accounts.workspaceId, ws.workspaceId)));
  if (!account) throw new AccountError('Account not found');
  // Default categories carry keys too; only the system equity accounts are protected.
  if (SYSTEM_ACCOUNTS.some((s) => s.key === account.systemKey)) throw new AccountError('System accounts cannot be archived');
  if (account.kind === 'asset') {
    const open = await tx
      .select({ currency: accounts.currency })
      .from(accounts)
      .where(and(eq(accounts.workspaceId, ws.workspaceId), eq(accounts.parentId, id), isNull(accounts.archivedAt)))
      .orderBy(asc(accounts.sortOrder), asc(accounts.id));
    if (open.length > 0) {
      throw new AccountError(`${account.name} still has pockets: ${open.map((row) => row.currency).join(', ')}. Archive each pocket first.`);
    }
  }
  if (account.kind === 'asset' || account.kind === 'liability') {
    // Archived money accounts leave net worth, so they must be empty first.
    if ((await postedBalanceTx(tx, id)) !== 0) {
      throw new AccountError(`${account.name} still has a balance. Bring it to zero before archiving so net worth stays correct.`);
    }
  }
  await withCapture(tx, { entity: 'category', id }, () => tx.update(accounts).set({ archivedAt: new Date().toISOString() }).where(eq(accounts.id, id)));
  await writeAudit(tx, ws, 'archive', id, {});
}

/**
 * The reverse of `archiveAccountTx`, inside a running transaction: the account is live again, and the audit says so.
 * Used when what archived it is taken back (a deposit's close, reopened by voiding what it posted).
 */
export async function unarchiveAccountTx(tx: Db, ws: WorkspaceContext, id: string): Promise<void> {
  const [account] = await tx
    .select({ id: accounts.id, archivedAt: accounts.archivedAt })
    .from(accounts)
    .where(and(eq(accounts.id, id), eq(accounts.workspaceId, ws.workspaceId)));
  if (!account) throw new AccountError('Account not found');
  if (account.archivedAt === null) return;
  await withCapture(tx, { entity: 'category', id }, () => tx.update(accounts).set({ archivedAt: null }).where(eq(accounts.id, id)));
  await writeAudit(tx, ws, 'unarchive', id, {});
}

export async function archiveAccount(database: Database, ws: WorkspaceContext, id: string): Promise<void> {
  await database.transaction(async (tx) => {
    await archiveAccountTx(tx, ws, id);
    await recordActivityTx(tx, ws, 'archive', id);
  });
}

/** The account audit trail, for the repos that change an account outside this file (a category's place, its icon). */
export const writeAccountAuditTx = writeAudit;
