import { expenseLines } from '@expanses/core';
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { createAccount, nativeBalances, postTransaction, replaceTransaction, saveEarmark, saveExpenseTemplate, saveGoal, setAsideChoiceOf } from '../../src/index';
import { categoryOf, headOf, Household } from './household';

/*
 * Spec §13 `payer-ledger`: a member's correction of the payer's purchase moves the payer's account balance, keeps its
 * set-aside answer and its bill payment (§7.4: `ledgerInput` leaves every fact it does not change `undefined`).
 */
describe("a member corrects the payer's purchase", () => {
  it("moves the payer's own account, and keeps the set-aside answer and the bill payment", async () => {
    const home = new Household();
    const fandri = await home.device('Fandri');
    const dewi = await home.device('Dewi');
    const jenius = await createAccount(fandri.database, fandri.ws, { name: 'Jenius', kind: 'asset', subtype: 'savings', currency: 'IDR', openingBalanceMinor: 10_000_000, openedOn: '2026-01-01' });
    const goalId = await saveGoal(fandri.database, fandri.ws, { name: 'Emergency fund', kind: 'emergency', growthBps: 0, returnBps: 0, stages: [{ name: 'Emergency fund', targetMinor: 30_000_000, targetMonths: null, dueOn: '2027-12-31' }] });
    await saveEarmark(fandri.database, fandri.ws, { goalId, accountId: jenius.id, amountMinor: 8_000_000 });
    const bookId = await home.share(fandri);
    const groceries = await categoryOf(fandri.database, bookId, 'Groceries');
    const bill = await saveExpenseTemplate(fandri.database, fandri.ws, { name: 'Groceries run', categoryAccountId: groceries, moneyAccountId: jenius.id, amountMinor: 5_000_000, dayOfMonth: 5 });
    const lineage = await postTransaction(fandri.database, fandri.ws, {
      occurredOn: '2026-09-10',
      description: 'Monthly groceries',
      lines: expenseLines({ categoryAccountId: groceries, paymentAccountId: jenius.id, amountMinor: 5_000_000, currency: 'IDR' }),
      templateId: bill,
      billMonth: '2026-08',
      setAside: { accountId: jenius.id, goalId, intent: 'spend', overMinor: 3_000_000 },
    });
    expect(await setAsideChoiceOf(fandri.database, fandri.ws, lineage)).not.toBeNull();
    await home.join(dewi, fandri);
    await home.settle();

    // Dewi corrects the amount on her phone, against her placeholder for Fandri.
    const dewiHead = (await headOf(dewi.database, lineage))!;
    const [placeholderRow] = await dewi.database.db.values<[string]>(sql`SELECT account_id FROM book_member_accounts WHERE member_id = ${fandri.memberId}`);
    await replaceTransaction(dewi.database, dewi.ws, dewiHead, {
      occurredOn: '2026-09-10',
      description: 'Monthly groceries',
      lines: expenseLines({ categoryAccountId: groceries, paymentAccountId: placeholderRow![0], amountMinor: 6_000_000, currency: 'IDR' }),
    });
    await home.settle();

    const head = (await headOf(fandri.database, lineage))!;
    expect(head).not.toBe(lineage);
    expect((await nativeBalances(fandri.database, fandri.ws))[jenius.id]).toBe(4_000_000);
    const answer = await setAsideChoiceOf(fandri.database, fandri.ws, head);
    expect(answer).toMatchObject({ accountId: jenius.id, goalId, intent: 'spend' });
    const [payment] = await fandri.database.db.values<[string, string]>(sql`SELECT template_id, bill_month FROM bill_payments WHERE transaction_id = ${head}`);
    expect(payment).toEqual([bill, '2026-08']);
    // Dewi's own accounts never moved; the placeholder took her side of it.
    expect((await nativeBalances(dewi.database, dewi.ws))[dewi.bank] ?? 0).toBe(0);
    const audit = await fandri.database.db.values<[string]>(sql`SELECT payload_json FROM audit_log WHERE action = 'post' AND entity_id = ${head}`);
    expect(JSON.parse(audit[0]![0]).syncAuthor).toBe(dewi.memberId);
  });
});
