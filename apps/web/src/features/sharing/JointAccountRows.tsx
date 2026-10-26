import type { JointRow } from '@expanses/db';
import { Money } from '../../ui';
import { InsetGroup, InsetRow } from '../../ui/native';
import { memberName } from '../networth/joint-rows';
import { useActiveNetWorthGroup, useJointAccount, useOwnJointRows } from './net-worth-queries';

/*
 * A joint account's rows (0095): what the shared workspace recorded against the account, on the holder's page and the
 * partner's alike, each with who recorded it. Rows recorded in any other workspace are not among them.
 */

const DAY_LABEL = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

/** "by Rina", or "by me" for the row this phone's own person recorded. */
export function recordedByLabel(recordedBy: string, me: string, names: Record<string, string>): string {
  return recordedBy === me ? 'by me' : `by ${memberName(names, recordedBy)}`;
}

export function JointRowsGroup({ rows, me, names }: { rows: readonly JointRow[]; me: string; names: Record<string, string> }) {
  return (
    <InsetGroup
      header={`Joint account · ${rows.length} ${rows.length === 1 ? 'row' : 'rows'}`}
      info="Rows recorded in the shared workspace against this account, the same on both phones. Only the person who recorded a row can change it."
    >
      {rows.length === 0 ? <InsetRow title="None yet" chevron={false} /> : null}
      {rows.map((row) => (
        <InsetRow
          key={row.key}
          testId="joint-row"
          title={row.description || (row.kind === 'transfer' ? 'Transfer' : 'Purchase')}
          subtitle={`${DAY_LABEL(row.occurredOn)} · ${recordedByLabel(row.recordedBy, me, names)}`}
          value={<Money minor={row.amountMinor} currency={row.currency} />}
          valueTone="ink"
          chevron={false}
        />
      ))}
    </InsetGroup>
  );
}

/** The holder's account page: the rows, only while the account is joint. */
export function OwnJointRows({ accountId }: { accountId: string }) {
  const group = useActiveNetWorthGroup();
  const joint = useJointAccount(accountId);
  const read = useOwnJointRows(accountId, joint.data === true);
  if (joint.data !== true || !read.data || !group.data) return null;
  return <JointRowsGroup rows={read.data.rows} me={group.data.me} names={read.data.names} />;
}
