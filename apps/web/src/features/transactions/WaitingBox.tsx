import type { DraftRow } from '@expanses/db';
import { Card } from '../../ui';
import { NotRecorded } from './NotRecorded';
import { Recurring } from './Recurring';

/**
 * What the month is still waiting on: its recurring bills and the drafts not yet recorded, in one box.
 *
 * It sits between the chart and the transaction history, not under the history's heading: neither line is a
 * transaction, and the heading's controls (group, filter, sort) act on the list alone. Each line hides when it has
 * nothing to say, and the box hides with them.
 */
export function WaitingBox({ today, drafts }: { today: string; drafts: readonly DraftRow[] }) {
  return (
    <Card className="divide-y divide-slate-100 py-1 empty:hidden">
      <Recurring today={today} />
      <NotRecorded drafts={drafts} />
    </Card>
  );
}
