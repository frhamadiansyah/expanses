import { dayMonth, formatMinor, monthName } from '@expanses/core';
import type { AccountRow } from '@expanses/db';
import { Sheet } from '../../app/Sheet';
import { Money } from '../../ui';
import { InsetGroup, InsetRow } from '../../ui/native';
import { CategoryIcon } from '../categories/CategoryIcon';
import type { BillToPay } from './wallet-balance';

/** Under the list: what the row counts, and what it leaves out. */
export const BILLS_TO_PAY_FOOTER =
  'Bills not yet paid this month. A bill drops off once paid; paid with a credit card, it is counted in Owed on cards instead. Skipped and paused bills are left out.';

/** The line under a bill's name: the day it is due, "about" when its amount varies, and what its fund already set aside. */
export function billToPaySubtitle(bill: BillToPay): string {
  return [dayMonth(bill.payBy), bill.about ? 'about' : null, bill.setAsideMinor > 0 ? `${formatMinor(bill.setAsideMinor, bill.currency)} set aside` : null].filter(Boolean).join(' · ');
}

/**
 * The bills Wallet's "Bills still to pay" row is made of: one group for the month, its total beside the month's name,
 * a row per bill opening the bill's own page.
 */
export function BillsToPaySheet({
  bills,
  month,
  totalMinor,
  currency,
  accounts,
  onClose,
}: {
  bills: readonly BillToPay[];
  /** YYYY-MM. */
  month: string;
  /** What the row shows, in the base currency. */
  totalMinor: number;
  currency: string;
  accounts: readonly AccountRow[];
  onClose: () => void;
}) {
  return (
    <Sheet grouped title="Bills still to pay" onClose={onClose}>
      <InsetGroup header={monthName(month, 'long')} trailing={formatMinor(totalMinor, currency)} footer={BILLS_TO_PAY_FOOTER}>
        {bills.map((bill) => (
          <InsetRow
            key={bill.id}
            icon={<CategoryIcon categoryId={bill.categoryAccountId} accounts={accounts} size="row" />}
            title={bill.name}
            subtitle={billToPaySubtitle(bill)}
            value={<Money minor={bill.minor} currency={bill.currency} />}
            valueTone="ink"
            to="/bills/$billId"
            params={{ billId: bill.id }}
            testId="bill-to-pay"
          />
        ))}
      </InsetGroup>
    </Sheet>
  );
}
