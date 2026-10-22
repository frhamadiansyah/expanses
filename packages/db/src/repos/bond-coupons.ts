import { COUPON_FREQUENCIES, couponGrossMinor, couponTaxMinor, type CouponsPerYear, dueCouponDates, holdingPositionAfter, nextCouponOn } from '@expanses/core';
import { and, eq, sql } from 'drizzle-orm';
import type { WorkspaceContext } from '../context';
import type { Database, Db } from '../database';
import { accounts } from '../schema';
import { assetProfiles } from '../schema-assets';
import { AssetError } from './assets';
import { activeTrades, writeTradeTx } from './trades';

/*
 * A bond's coupon terms (0081), and the coupons they record. Kept on the phone that holds the bond — assets do not
 * travel between phones — so a coupon is recorded once, however many phones open the household.
 */

export interface BondCouponRow {
  accountId: string;
  rateBps: number;
  perYear: CouponsPerYear;
  /** The day of the month it pays on; a shorter month pays on its last day. */
  payDay: number;
  nextOn: string;
  maturesOn: string | null;
  taxBps: number;
  cashAccountId: string | null;
  /** Recorded by the app on the day it pays. */
  auto: boolean;
}

export type SaveBondCouponInput = Omit<BondCouponRow, 'payDay'> & { payDay?: number };

const DATE = /^\d{4}-\d{2}-\d{2}$/;

const couponTable = new WeakMap<object, boolean>();
async function couponsExist(tx: Db): Promise<boolean> {
  if (couponTable.get(tx)) return true;
  const rows = await tx.values<[number]>(sql`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'bond_coupons'`);
  if (rows.length > 0) couponTable.set(tx, true);
  return rows.length > 0;
}

type Raw = [string, number, number, number, string, string | null, number, string | null, number];
const toRow = ([accountId, rateBps, perYear, payDay, nextOn, maturesOn, taxBps, cashAccountId, auto]: Raw): BondCouponRow => ({
  accountId,
  rateBps: Number(rateBps),
  perYear: Number(perYear) as CouponsPerYear,
  payDay: Number(payDay),
  nextOn,
  maturesOn,
  taxBps: Number(taxBps),
  cashAccountId,
  auto: Number(auto) === 1,
});
const COLUMNS = sql`account_id, rate_bps, per_year, pay_day, next_on, matures_on, tax_bps, cash_account_id, auto`;

/** Every bond's terms in the workspace, by bond account id. */
export async function listBondCoupons(database: Database, ws: WorkspaceContext): Promise<Record<string, BondCouponRow>> {
  if (!(await couponsExist(database.db))) return {};
  const rows = await database.db.values<Raw>(sql`SELECT ${COLUMNS} FROM bond_coupons WHERE workspace_id = ${ws.workspaceId}`);
  return Object.fromEntries(rows.map((row) => [row[0], toRow(row)]));
}

/** Saves a bond's terms, all of them at once. Its pay day is the next payment's day unless one is given. */
export async function saveBondCoupon(database: Database, ws: WorkspaceContext, input: SaveBondCouponInput): Promise<void> {
  if (!Number.isInteger(input.rateBps) || input.rateBps <= 0 || input.rateBps > 100_000) throw new AssetError('A coupon rate is a percentage above nought');
  if (!(COUPON_FREQUENCIES as readonly number[]).includes(input.perYear)) throw new AssetError('A coupon is paid monthly, every 3 or 6 months, or yearly');
  if (!DATE.test(input.nextOn)) throw new AssetError('Choose the day of the next payment');
  if (input.maturesOn !== null && (!DATE.test(input.maturesOn) || input.maturesOn < input.nextOn)) throw new AssetError('A bond matures on or after its next payment');
  if (!Number.isInteger(input.taxBps) || input.taxBps < 0 || input.taxBps > 10_000) throw new AssetError('Tax withheld is between 0% and 100%');
  const payDay = input.payDay ?? Number(input.nextOn.slice(8, 10));
  await database.transaction(async (tx) => {
    const [profile] = await tx
      .select({ assetKind: assetProfiles.assetKind })
      .from(assetProfiles)
      .where(and(eq(assetProfiles.accountId, input.accountId), eq(assetProfiles.workspaceId, ws.workspaceId)));
    if (profile?.assetKind !== 'bond') throw new AssetError('Only a bond pays a coupon');
    if (input.cashAccountId) {
      const [cash] = await tx.select({ kind: accounts.kind }).from(accounts).where(and(eq(accounts.id, input.cashAccountId), eq(accounts.workspaceId, ws.workspaceId)));
      if (cash?.kind !== 'asset') throw new AssetError('A coupon is paid into a money account');
    }
    await tx.run(sql`
      INSERT INTO bond_coupons (account_id, workspace_id, rate_bps, per_year, pay_day, next_on, matures_on, tax_bps, cash_account_id, auto, updated_at)
      VALUES (${input.accountId}, ${ws.workspaceId}, ${input.rateBps}, ${input.perYear}, ${payDay}, ${input.nextOn}, ${input.maturesOn}, ${input.taxBps},
              ${input.cashAccountId}, ${input.auto ? 1 : 0}, ${new Date().toISOString()})
      ON CONFLICT (account_id) DO UPDATE SET rate_bps = excluded.rate_bps, per_year = excluded.per_year, pay_day = excluded.pay_day,
        next_on = excluded.next_on, matures_on = excluded.matures_on, tax_bps = excluded.tax_bps, cash_account_id = excluded.cash_account_id,
        auto = excluded.auto, updated_at = excluded.updated_at`);
  });
}

/** Takes a bond's terms away. The coupons already recorded stay. */
export async function removeBondCoupon(database: Database, ws: WorkspaceContext, accountId: string): Promise<void> {
  if (!(await couponsExist(database.db))) return;
  await database.db.run(sql`DELETE FROM bond_coupons WHERE workspace_id = ${ws.workspaceId} AND account_id = ${accountId}`);
}

/** One coupon of a bond on a day: before tax and the tax withheld, at the par it held that day. Null when it held none. */
export function couponOn(term: BondCouponRow, parUnitsMicro: number, currency: string): { grossMinor: number; taxMinor: number } | null {
  if (parUnitsMicro <= 0) return null;
  const grossMinor = couponGrossMinor({ parUnitsMicro, rateBps: term.rateBps, perYear: term.perYear, currency });
  return grossMinor > 0 ? { grossMinor, taxMinor: couponTaxMinor(grossMinor, term.taxBps) } : null;
}

/**
 * Records every coupon due up to `today` on the bonds set to record their own, each with the move to its next payment
 * in one database transaction — so a coupon is never recorded twice, and a failure leaves its date to try again. A day
 * the bond held nothing records nothing and moves on; a bond in another currency than its account, or with no account
 * to be paid into, is left for its owner to record. Answers how many were recorded.
 */
export async function recordDueCoupons(database: Database, ws: WorkspaceContext, today: string): Promise<number> {
  const terms = Object.values(await listBondCoupons(database, ws)).filter((term) => term.auto && term.cashAccountId);
  let recorded = 0;
  for (const term of terms) {
    const [bond] = await database.db.select({ currency: accounts.currency, archivedAt: accounts.archivedAt }).from(accounts).where(eq(accounts.id, term.accountId));
    const [cash] = await database.db.select({ currency: accounts.currency }).from(accounts).where(eq(accounts.id, term.cashAccountId!));
    if (!bond?.currency || bond.archivedAt || !cash || cash.currency !== bond.currency || bond.currency !== ws.baseCurrency) continue;
    for (const on of dueCouponDates({ nextOn: term.nextOn, perYear: term.perYear, payDay: term.payDay, maturesOn: term.maturesOn, today })) {
      await database.transaction(async (tx) => {
        const held = holdingPositionAfter(await activeTrades(tx, ws, term.accountId), on).unitsMicro;
        const coupon = couponOn(term, held, bond.currency!);
        if (coupon) {
          await writeTradeTx(tx, ws, { accountId: term.accountId, kind: 'income', occurredOn: on, unitsMicro: 0, grossMinor: coupon.grossMinor, feeMinor: 0, taxMinor: coupon.taxMinor, cashAccountId: term.cashAccountId }, null);
          recorded += 1;
        }
        await tx.run(sql`UPDATE bond_coupons SET next_on = ${nextCouponOn(on, term.perYear, term.payDay)} WHERE account_id = ${term.accountId}`);
      });
    }
  }
  return recorded;
}
