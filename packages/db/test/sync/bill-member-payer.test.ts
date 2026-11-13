import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { createAccount, listAccounts, memberPayerAccounts, saveExpenseTemplate } from '../../src/index';
import { type Device, Household } from './household';

/*
 * A bill paid from one member's own credit card, as the other member's phone holds it (fix/due-row-member-card). The
 * bill reaches the partner with its payer as a member, not an account (spec §4.4): his copy names a placeholder for her,
 * which his account list never shows. So his phone cannot tell it is a card — only whose it is, by the member's name.
 * Invented names and figures throughout.
 */

async function couple() {
  const home = new Household();
  const wife = await home.device('Sari');
  const husband = await home.device('Bima');
  await home.share(wife);
  await home.join(husband, wife);
  await home.settle();
  const cat = (await listAccounts(wife.database, wife.ws)).find((a) => a.systemKey === 'utilities.internet_provider')!.id;
  const card = await createAccount(wife.database, wife.ws, { name: 'Sari Card', kind: 'liability', subtype: 'credit_card', currency: 'IDR' });
  const bill = await saveExpenseTemplate(wife.database, wife.ws, { name: 'Fibre', categoryAccountId: cat, moneyAccountId: card.id, amountMinor: 375_000, dayOfMonth: 7, startsMonth: '2026-09' });
  await home.settle();
  return { wife, husband, card, bill };
}

const moneyAccountOf = async (d: Device, billId: string) =>
  (await d.database.db.values<[string]>(sql`SELECT money_account_id FROM expense_templates WHERE id = ${billId} AND workspace_id = ${d.ws.workspaceId}`))[0]?.[0] ?? '';

describe("a bill on one member's own card, on the other member's phone", () => {
  it("is on the card on the payer's phone, and on an account the partner's list does not hold, named for the payer", async () => {
    const { wife, husband, card, bill } = await couple();

    expect(await moneyAccountOf(wife, bill)).toBe(card.id);
    expect((await listAccounts(wife.database, wife.ws)).find((a) => a.id === card.id)?.subtype).toBe('credit_card');
    expect((await memberPayerAccounts(wife.database, wife.ws)).has(card.id)).toBe(false);

    const there = await moneyAccountOf(husband, bill);
    expect(there).not.toBe(card.id);
    expect((await listAccounts(husband.database, husband.ws, { includeArchived: true })).some((a) => a.id === there)).toBe(false);
    expect((await memberPayerAccounts(husband.database, husband.ws)).get(there)).toBe('Sari');
  });

  it('names nothing on a phone with no shared workspace', async () => {
    const home = new Household();
    const alone = await home.device('Tono');
    expect((await memberPayerAccounts(alone.database, alone.ws)).size).toBe(0);
  });
});
