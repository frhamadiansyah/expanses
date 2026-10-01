import { dayMonth, formatMinor } from '@expanses/core';
import type { AccountRow, CaptureSource, DraftRow } from '@expanses/db';
import { useState } from 'react';
import { Sheet } from '../../app/Sheet';
import { Button } from '../../ui';
import { InsetGroup, InsetRow, SelectRow, SwitchRow, TextRow } from '../../ui/native';
import { CategoryOptions } from '../cards/options';
import { majorText, minorFromTyped } from './capture-view';

type Patch = Partial<
  Pick<DraftRow, 'occurredOn' | 'description' | 'amountMinor' | 'currency' | 'kind' | 'accountId' | 'toAccountId' | 'categoryAccountId'>
>;

/**
 * One draft on the phone: what it was read as, and everything recording it needs.
 *
 * A captured draft is not just an amount waiting for a category any more: it can be money in, or money moved
 * between two of the owner's own accounts, and it may still be missing the account only the owner knows. So the
 * sheet shows what was read — editable, because a wrong figure is corrected here, and correcting it is what
 * teaches the source its layout — and asks only the questions that are still open: an account for a source that
 * has never been answered for, a destination for a transfer, a category for spending or income.
 *
 * The picture stays one tap away (`onView`), the merge can be undone when two sightings were folded too eagerly,
 * and "Keep photo" chooses whether the picture comes along to the ledger. A notification has no picture; it shows
 * its words instead.
 */
export function DraftSheet({
  draft,
  source,
  accounts,
  money,
  busy,
  onEdit,
  onAnswerSource,
  onCorrect,
  onUnmerge,
  onView,
  onRecord,
  onDiscard,
  onClose,
}: {
  draft: DraftRow;
  /** The source this capture was recognised as, when there is one — what "remembered for" names. */
  source: CaptureSource | null;
  /** Every account, for the category picker: a category is an account too. */
  accounts: readonly AccountRow[];
  /** What can pay: money accounts that are not locked deposits, the same list the table's select offers. */
  money: readonly AccountRow[];
  busy: boolean;
  onEdit: (patch: Patch) => void;
  /** The answer to "Which account is this?": remembered for the source, and applied to this draft. */
  onAnswerSource: (accountId: string) => void;
  /** A corrected field: written down on the draft, and shown to the source so the next capture reads it right. */
  onCorrect: (field: 'amount' | 'name' | 'date', value: string) => void;
  /** Splits the last folded-in capture back out into a draft of its own. */
  onUnmerge: () => void;
  /** Opens the full-screen picture at a field's box, or at the picture as a whole. */
  onView: (focus: 'amount' | 'name' | 'date' | null) => void;
  onRecord: (opts: { keepPhoto: boolean }) => void;
  onDiscard: () => void;
  onClose: () => void;
}) {
  const [amount, setAmount] = useState(() => majorText(draft.amountMinor, draft.currency));
  const [description, setDescription] = useState(draft.description);
  const [keepPhoto, setKeepPhoto] = useState(draft.source === 'photo');
  const unsure = draft.confidence !== null && draft.confidence < 70;
  const askingForAccount = Boolean(source && source.accountId === null && draft.accountId === null);

  const complete =
    draft.kind === 'transfer'
      ? Boolean(draft.accountId && draft.toAccountId && draft.accountId !== draft.toAccountId)
      : Boolean(draft.accountId && draft.categoryAccountId);

  /** Writes a corrected amount down: the same sign it had, read back by the reader's own rules. */
  function commitAmount() {
    const minor = minorFromTyped(amount, draft.currency);
    if (minor === null) {
      setAmount(majorText(draft.amountMinor, draft.currency));
      return;
    }
    if (minor === Math.abs(draft.amountMinor)) return;
    const sign = draft.amountMinor < 0 ? -1 : 1;
    onCorrect('amount', amount);
    onEdit({ amountMinor: sign * minor });
  }

  function commitDescription() {
    const name = description.trim();
    if (name === '' || name === draft.description) {
      setDescription(draft.description);
      return;
    }
    onCorrect('name', name);
    onEdit({ description: name });
  }

  const accountLabel = draft.kind === 'transfer' ? 'From' : draft.kind === 'income' ? 'Into' : 'Paid with';
  const categoryKind = draft.amountMinor >= 0 ? 'expense' : 'income';

  return (
    <Sheet title={draft.description} onClose={onClose} grouped>
      <InsetGroup header="What was read">
        {(draft.imageFile || draft.rawPayload) && (
          <InsetRow
            title={draft.imageFile ? 'The picture' : 'What it said'}
            subtitle={draft.imageFile ? 'Tap to see the boxes around everything read' : draft.rawPayload?.split('\n')[0]}
            chevron
            onClick={() => onView(null)}
          />
        )}
        <TextRow
          label={`Amount (${draft.currency})`}
          inputMode="decimal"
          value={amount}
          hint={unsure ? 'The reader was not sure of this figure — check it against the picture.' : undefined}
          onChange={(event) => setAmount(event.target.value)}
          onBlur={commitAmount}
        />
        <TextRow label="Merchant" value={description} onChange={(event) => setDescription(event.target.value)} onBlur={commitDescription} />
        <TextRow
          label="Date"
          type="date"
          value={draft.occurredOn}
          onChange={(event) => onEdit({ occurredOn: event.target.value })}
          onBlur={() => onCorrect('date', draft.occurredOn)}
        />
      </InsetGroup>

      <InsetGroup
        header="Where it goes"
        footer={
          complete
            ? undefined
            : draft.kind === 'transfer'
              ? 'Recording needs both accounts: where the money left, and where it landed.'
              : 'Recording needs both: the account it was paid from, and the category it belongs to.'
        }
      >
        {askingForAccount ? (
          <SelectRow
            label="Which account is this?"
            value={draft.accountId ?? ''}
            onChange={(event) => {
              if (event.target.value) onAnswerSource(event.target.value);
            }}
          >
            <option value="">Choose…</option>
            {money.map((account) => (
              <option key={account.id} value={account.id}>{`${account.name} (${account.currency})`}</option>
            ))}
          </SelectRow>
        ) : (
          <SelectRow label={accountLabel} value={draft.accountId ?? ''} onChange={(event) => onEdit({ accountId: event.target.value })}>
            <option value="">Choose…</option>
            {money.map((account) => (
              <option key={account.id} value={account.id}>{`${account.name} (${account.currency})`}</option>
            ))}
          </SelectRow>
        )}
        {draft.kind === 'transfer' ? (
          <SelectRow label="To" value={draft.toAccountId ?? ''} onChange={(event) => onEdit({ toAccountId: event.target.value })}>
            <option value="">Choose…</option>
            {money
              .filter((account) => account.id !== draft.accountId)
              .map((account) => (
                <option key={account.id} value={account.id}>{`${account.name} (${account.currency})`}</option>
              ))}
          </SelectRow>
        ) : (
          <SelectRow
            label="Category"
            value={draft.categoryAccountId ?? ''}
            onChange={(event) => onEdit({ categoryAccountId: event.target.value })}
          >
            {/* Confirming a draft records real spending, so it may only name the open workspace's categories. */}
            <CategoryOptions accounts={accounts} kind={categoryKind} parentSuffix="(general)" />
          </SelectRow>
        )}
      </InsetGroup>

      {askingForAccount && source && (
        <p className="px-1 text-[12.5px] leading-[16px] text-[var(--ph-ink-3)]">
          Answered once: every capture from {source.label} is filed there from now on.
        </p>
      )}

      {draft.imageFile && (
        <InsetGroup header="The picture">
          <SwitchRow
            label="Keep photo"
            checked={keepPhoto}
            onChange={setKeepPhoto}
            hint={
              draft.source === 'photo'
                ? 'A photographed receipt is kept with the purchase unless you say no.'
                : 'A screenshot is not kept unless you ask.'
            }
          />
        </InsetGroup>
      )}

      {draft.captureIds.length > 1 && (
        <InsetGroup header="Seen in">
          <InsetRow
            title={`${draft.captureIds.length} captures`}
            subtitle="The same payment, seen more than once"
            value={<span className="text-[13px] font-semibold text-[var(--ph-tint)]">Unmerge</span>}
            onClick={onUnmerge}
          />
        </InsetGroup>
      )}

      <div className="flex items-stretch gap-2">
        <Button variant="success" className="flex-1" disabled={busy || !complete} onClick={() => onRecord({ keepPhoto })}>
          Record
        </Button>
        <Button variant="danger" className="flex-1" disabled={busy} onClick={onDiscard}>
          Discard
        </Button>
      </div>
      <p className="text-center text-[12.5px] text-[var(--ph-ink-3)]">
        {formatMinor(Math.abs(draft.amountMinor), draft.currency)} · {dayMonth(draft.occurredOn)}
      </p>
    </Sheet>
  );
}
