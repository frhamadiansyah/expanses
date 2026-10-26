import { inBook, type JointRow, restoreJointRow } from '@expanses/db';
import { Fragment, useState } from 'react';
import { useApp } from '../../app/context';
import { useInvalidateAll } from '../../lib/queries';
import { ErrorBox, Money } from '../../ui';
import { InsetGroup, InsetRow } from '../../ui/native';
import { memberName } from '../networth/joint-rows';
import { useActiveNetWorthGroup, useJointAccount, useOwnJointRows } from './net-worth-queries';

/*
 * A joint account's rows (0097): what the shared workspace recorded against the account, on the holder's page and the
 * partner's alike, each with who recorded it, and either person can open and change any of them. Rows recorded in any other workspace are not among them.
 */

const DAY_LABEL = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

/** "by Rina", or "by me" for the row this phone's own person recorded. */
export function recordedByLabel(recordedBy: string, me: string, names: Record<string, string>): string {
  return recordedBy === me ? 'by me' : `by ${memberName(names, recordedBy)}`;
}

/** "by Rina", plus " · edited by Andi" for a row the other person changed, or " · deleted by Andi" for one taken away. */
export function rowByLine(row: Pick<JointRow, 'recordedBy' | 'editedBy' | 'deleted' | 'deletedBy'>, me: string, names: Record<string, string>): string {
  const by = recordedByLabel(row.recordedBy, me, names);
  const who = (id: string) => (id === me ? 'me' : memberName(names, id));
  if (row.deleted) return row.deletedBy ? `${by} · deleted by ${who(row.deletedBy)}` : `${by} · deleted`;
  return row.editedBy ? `${by} · edited by ${who(row.editedBy)}` : by;
}

export function JointRowsGroup({ rows, me, names, workspaceBookId }: { rows: readonly JointRow[]; me: string; names: Record<string, string>; workspaceBookId: string }) {
  const { database, ws } = useApp();
  const invalidate = useInvalidateAll();
  const [error, setError] = useState<unknown>(null);
  async function restore(key: string) {
    setError(null);
    try {
      await restoreJointRow(database, inBook(ws, workspaceBookId), key);
      await invalidate();
    } catch (failure) {
      setError(failure);
    }
  }
  const live = rows.filter((row) => !row.deleted);
  return (
    <>
      <ErrorBox error={error} />
      <InsetGroup
        header={`Joint account · ${live.length} ${live.length === 1 ? 'row' : 'rows'}`}
        info="Rows recorded in the shared workspace against this account, the same on both phones. Either person can open and change any of them."
      >
        {rows.length === 0 ? <InsetRow title="None yet" chevron={false} /> : null}
        {rows.map((row) =>
          row.deleted ? (
            <Fragment key={row.key}>
              <InsetRow
                testId="joint-row-deleted"
                title={<span className="text-[var(--ph-ink-3)]">{row.description || (row.kind === 'transfer' ? 'Transfer' : 'Purchase')}</span>}
                subtitle={`${DAY_LABEL(row.occurredOn)} · ${rowByLine(row, me, names)}`}
                value={
                  <span className="text-[var(--ph-ink-3)] line-through">
                    <Money minor={row.amountMinor} currency={row.currency} />
                  </span>
                }
                chevron={false}
              />
              <InsetRow testId="joint-row-restore" title="Restore" action onClick={() => void restore(row.key)} />
            </Fragment>
          ) : (
            <InsetRow
              key={row.key}
              testId="joint-row"
              title={row.description || (row.kind === 'transfer' ? 'Transfer' : 'Purchase')}
              subtitle={`${DAY_LABEL(row.occurredOn)} · ${rowByLine(row, me, names)}`}
              value={<Money minor={row.amountMinor} currency={row.currency} />}
              valueTone="ink"
              chevron={row.transactionId !== null}
              {...(row.transactionId ? { to: '/transactions/$transactionId', params: { transactionId: row.transactionId } } : {})}
            />
          ),
        )}
      </InsetGroup>
    </>
  );
}

/** The holder's account page: the rows, only while the account is joint. */
export function OwnJointRows({ accountId }: { accountId: string }) {
  const group = useActiveNetWorthGroup();
  const joint = useJointAccount(accountId);
  const read = useOwnJointRows(accountId, joint.data === true);
  if (joint.data !== true || !read.data || !group.data) return null;
  return <JointRowsGroup rows={read.data.rows} me={group.data.me} names={read.data.names} workspaceBookId={group.data.workspaceBookId} />;
}
