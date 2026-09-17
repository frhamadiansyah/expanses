import { PageHeader } from '../../ui';
import { BillList } from './BillList';

/**
 * Every recurring bill: what it costs, which day it falls, and which account pays it.
 *
 * Setup, rather than something to do — so it sits with the other setup screens rather than above the
 * transactions. What is owed this month is on Transactions, where the money is.
 */
export function BillsPage() {
  return (
    <div className="space-y-4">
      <PageHeader title="Recurring" />
      <BillList />
    </div>
  );
}
