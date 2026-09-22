import { dayMonth, formatMinor } from '@expanses/core';
import type { AccountRow, DraftRow } from '@expanses/db';
import { Sheet } from '../../app/Sheet';
import { Button } from '../../ui';
import { InsetGroup, InsetRow, SelectRow } from '../../ui/native';
import { CategoryOptions } from '../cards/options';

/**
 * One draft on the phone: what the parser read, and the two answers recording it needs.
 *
 * The date and the amount are read-only here, exactly as they are read-only in the desktop table's own columns —
 * the queue exists to check and file a capture, not to retype it. What a person *does* decide is where it goes,
 * so the account and the category are the two controls, and Record stays refused until both are answered (the
 * desktop finds that out by pressing it; a phone row has no ErrorBox of its own to be told in).
 *
 * Above a swipe row, this is the careful path: the same two writes, one tap later, with the figures in front of
 * the reader first.
 */
export function DraftSheet({
  draft,
  accounts,
  money,
  busy,
  onEdit,
  onRecord,
  onDiscard,
  onClose,
}: {
  draft: DraftRow;
  /** Every account, for the category picker: a category is an account too. */
  accounts: readonly AccountRow[];
  /** What can pay: money accounts that are not locked deposits, the same list the table's select offers. */
  money: readonly AccountRow[];
  busy: boolean;
  onEdit: (patch: { accountId?: string; categoryAccountId?: string }) => void;
  onRecord: () => void;
  onDiscard: () => void;
  onClose: () => void;
}) {
  const complete = Boolean(draft.accountId && draft.categoryAccountId);
  return (
    <Sheet title={draft.description} onClose={onClose} grouped>
      <InsetGroup header="What was read">
        <InsetRow title="Date" value={`${dayMonth(draft.occurredOn)} ${draft.occurredOn.slice(0, 4)}`} valueTone="ink" chevron={false} />
        <InsetRow title={`Amount (${draft.currency})`} value={formatMinor(Math.abs(draft.amountMinor), draft.currency)} valueTone="ink" chevron={false} />
      </InsetGroup>
      <InsetGroup
        header="Where it goes"
        footer={complete ? undefined : 'Recording needs both: the account it was paid from, and the category it belongs to.'}
      >
        <SelectRow label="Paid with" value={draft.accountId ?? ''} onChange={(event) => onEdit({ accountId: event.target.value })}>
          <option value="">Choose…</option>
          {money.map((account) => (
            <option key={account.id} value={account.id}>{`${account.name} (${account.currency})`}</option>
          ))}
        </SelectRow>
        <SelectRow
          label="Category"
          value={draft.categoryAccountId ?? ''}
          onChange={(event) => onEdit({ categoryAccountId: event.target.value })}
        >
          {/* Confirming a draft records real spending, so it may only name the open workspace's categories. */}
          <CategoryOptions accounts={accounts} kind={draft.amountMinor >= 0 ? 'expense' : 'income'} parentSuffix="(general)" />
        </SelectRow>
      </InsetGroup>
      <div className="flex items-stretch gap-2">
        <Button variant="success" className="flex-1" disabled={busy || !complete} onClick={onRecord}>
          Record
        </Button>
        <Button variant="danger" className="flex-1" disabled={busy} onClick={onDiscard}>
          Discard
        </Button>
      </div>
    </Sheet>
  );
}
