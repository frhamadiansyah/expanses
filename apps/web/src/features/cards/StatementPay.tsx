import { formatMinor } from '@expanses/core';
import { cardStatement, payCardPurchases } from '@expanses/db';
import { useQuery } from '@tanstack/react-query';
import { useRef } from 'react';
import { useApp } from '../../app/context';
import { InsetGroup, InsetRow } from '../../ui/native';
import type { PaysPurchases } from '../transactions/TransactionCard';
import { type StatementPayPurchase, statementPayChoice, statementPayFixed, statementPayInput, statementPayNote } from './card-pay';

/** Where the statement's Pay was opened from: the card, the purchases ticked, and the statement they were ticked on. */
export interface StatementPayAddress {
  pay: string;
  purchases: string;
  start: string;
  end: string;
  today: string;
}

/**
 * The ticked purchases, read again from the statement they were ticked on — the statement page's own read, the same
 * key — so the screen lists, and pays, exactly what the statement listed.
 */
export function useStatementPay(address: StatementPayAddress | null) {
  const { database, ws } = useApp();
  const statement = useQuery({
    queryKey: ['card-statement', ws.workspaceId, address?.pay ?? '', address?.start ?? '', address?.today ?? ''],
    queryFn: () => cardStatement(database, ws, address!.pay, { start: address!.start, end: address!.end }, address!.today),
    enabled: !!address,
  });
  /*
   * Read once, as the card reads its seed once: Save's own refresh reads them back paid, and the screen must not turn
   * into "already paid" under the save that paid them.
   */
  const first = useRef<{ purchases: StatementPayPurchase[]; currency: string } | null>(null);
  if (!first.current && address && statement.data) first.current = { purchases: statementPayChoice(statement.data, address.purchases.split(',')), currency: statement.data.currency };
  return {
    pending: !!address && !first.current && statement.isPending,
    error: statement.error,
    purchases: first.current?.purchases ?? [],
    currency: first.current?.currency ?? ws.baseCurrency,
  };
}

/**
 * Under the card's rows: "Paying 2 purchases", then each one's words and what is left of it to pay. One purchase with
 * its amount typed says under it what that does: what it keeps to pay, or what extra goes to the card.
 */
export function PayingPurchases({ purchases, currency, amount }: { purchases: readonly StatementPayPurchase[]; currency: string; amount: string }) {
  const note = statementPayNote(purchases, amount, currency);
  return (
    <div data-testid="paying-purchases">
      <InsetGroup wide header={`Paying ${purchases.length} purchase${purchases.length === 1 ? '' : 's'}`} footer={note ? <span data-testid="paying-note">{note}</span> : undefined}>
        {purchases.map((p) => (
          <InsetRow key={p.transactionId} plain title={p.description} value={formatMinor(p.leftMinor, currency)} />
        ))}
      </InsetGroup>
    </div>
  );
}

/**
 * The screen's Save: `payCardPurchases`, called as the old "Pay N purchases" sheet called it, with the note; one
 * purchase with its amount typed adds that amount.
 */
export function useStatementPaySave(address: StatementPayAddress | null, purchases: readonly StatementPayPurchase[], currency: string): PaysPurchases | undefined {
  const { database, ws } = useApp();
  if (!address) return undefined;
  return {
    list: (draft) => <PayingPurchases purchases={purchases} currency={currency} amount={draft.amount} />,
    fixed: statementPayFixed(purchases),
    save: async (draft, setAside) => {
      await payCardPurchases(database, ws, statementPayInput({ cardAccountId: address.pay, purchases, today: address.today, currency }, draft, setAside));
    },
  };
}
