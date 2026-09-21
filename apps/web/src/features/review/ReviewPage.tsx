import { formatMinor } from '@expanses/core';
import { confirmDraft, type DraftRow, dismissDraft, editDraft } from '@expanses/db';
import { Check, X } from 'lucide-react';
import { useState } from 'react';
import { useApp } from '../../app/context';
import { canPayWith } from '../../lib/account-types';
import { moneyHolders, useAccounts, useInvalidateAll } from '../../lib/queries';
import { cx, Empty, ErrorBox, Select } from '../../ui';
import { Figure, LargeTitle, RecordTable, SCREEN } from '../../ui/native';
import { CategoryOptions } from '../cards/options';
import { type Door, spendingDoor } from '../goals/set-aside-question';
import { asksAboutSetAside, SetAsideSheet } from '../goals/SetAsideQuestion';
import { useDrafts } from './queries';

/**
 * Captured spending, waiting to be confirmed.
 *
 * Nothing a parser produces reaches the ledger on its own. That is what makes it safe for a bank to
 * change its statement layout without warning: a broken parser fills this queue with nonsense, which
 * is a nuisance, rather than the books, which would be a problem.
 *
 * It is the kit's `RecordTable` with `detail` saying `none`, which is the kit's way of saying a record here has
 * nowhere to go. A draft has no page of its own: the two selects, Record and Discard are the whole reason to be on
 * this screen, so collapsing each draft to a title and a figure would leave a phone unable to action the queue at
 * all — which is exactly the state it was in before. The table therefore stays a table at 390 px, and scrolls
 * sideways inside its own container rather than losing a column off the right edge.
 */
export function ReviewPage() {
  const { database, ws } = useApp();
  const invalidate = useInvalidateAll();
  const drafts = useDrafts();
  const accounts = useAccounts().data ?? [];
  // Confirming a draft records real spending, so the account it names has to be one that can pay.
  const money = moneyHolders(accounts).filter((a) => canPayWith(a));
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function run(id: string, work: () => Promise<unknown>) {
    setError(null);
    setBusy(id);
    try {
      await work();
      await invalidate();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(null);
    }
  }

  /** A draft whose payment takes promised money: confirmed from the question's sheet once it is answered. */
  const [asking, setAsking] = useState<{ id: string; door: Door } | null>(null);

  /** Confirms in place unless it would take money set aside; then the question comes first, in a sheet. */
  async function record(draft: DraftRow) {
    setError(null);
    const door = spendingDoor(draft.accountId ?? '', Math.max(0, draft.amountMinor));
    let asks = false;
    try {
      asks = await asksAboutSetAside(database, ws, door);
    } catch (e) {
      setError(e);
      return;
    }
    if (asks) setAsking({ id: draft.id, door: door! });
    else await run(draft.id, () => confirmDraft(database, ws, draft.id, { setAside: null }));
  }

  const list = drafts.data ?? [];

  return (
    <div className={SCREEN}>
      <LargeTitle title="Review" subtitle={list.length > 0 ? `${list.length} waiting. Nothing here has been recorded yet — check what was read, then confirm it.` : undefined} />
      <ErrorBox error={error ?? drafts.error} />

      {drafts.isSuccess && list.length === 0 && <Empty>Nothing waiting. Captured spending appears here before it reaches your accounts.</Empty>}

      {list.length > 0 && (
        <RecordTable
          records={list}
          rowTestId={() => 'draft-row'}
          detail={{ kind: 'none' }}
          shape={{
            key: (draft) => draft.id,
            title: (draft) => draft.description,
            subtitle: (draft) => draft.occurredOn,
            value: (draft) => <Figure>{formatMinor(Math.abs(draft.amountMinor), draft.currency)}</Figure>,
          }}
          columns={[
            { key: 'date', heading: 'Date', cell: (draft) => <span className="whitespace-nowrap">{draft.occurredOn}</span> },
            {
              key: 'description',
              heading: 'Description',
              cell: (draft) => (
                <span className={cx('block', busy === draft.id && 'opacity-50')}>
                  {draft.description}
                  {draft.confidence !== null && draft.confidence < 80 && <span className="ml-2 text-[12.5px] text-[var(--ph-warn)]">unsure</span>}
                </span>
              ),
            },
            {
              key: 'amount',
              heading: 'Amount',
              numeric: true,
              cell: (draft) => <Figure>{formatMinor(Math.abs(draft.amountMinor), draft.currency)}</Figure>,
            },
            {
              key: 'account',
              heading: 'Paid with',
              cell: (draft) => (
                <Select
                  aria-label={`Account for ${draft.description}`}
                  value={draft.accountId ?? ''}
                  onChange={(e) => void run(draft.id, () => editDraft(database, ws, draft.id, { accountId: e.target.value }))}
                  className="py-1"
                >
                  <option value="">Choose…</option>
                  {money.map((account) => (
                    <option key={account.id} value={account.id}>{`${account.name} (${account.currency})`}</option>
                  ))}
                </Select>
              ),
            },
            {
              key: 'category',
              heading: 'Category',
              cell: (draft) => (
                <Select
                  aria-label={`Category for ${draft.description}`}
                  value={draft.categoryAccountId ?? ''}
                  onChange={(e) => void run(draft.id, () => editDraft(database, ws, draft.id, { categoryAccountId: e.target.value }))}
                  className="py-1"
                >
                  {/* Confirming a draft records real spending, so it may only name the open workspace's categories. */}
                  <CategoryOptions accounts={accounts} kind={draft.amountMinor >= 0 ? 'expense' : 'income'} parentSuffix="(general)" />
                </Select>
              ),
            },
            {
              key: 'actions',
              heading: '',
              cell: (draft) => (
                /* Glyphs at every width, the corner button's shape — the names they answer to are unchanged. */
                <span className="flex items-center justify-end gap-[6px] whitespace-nowrap">
                  <button
                    type="button"
                    aria-label={`Record ${draft.description}`}
                    disabled={busy !== null}
                    onClick={() => void record(draft)}
                    className="ph-focus flex h-[36px] w-[36px] shrink-0 items-center justify-center rounded-full bg-[var(--ph-fill)] text-[var(--ph-tint)] disabled:opacity-40"
                  >
                    <Check size={18} aria-hidden />
                  </button>
                  <button
                    type="button"
                    aria-label={`Discard ${draft.description}`}
                    disabled={busy !== null}
                    onClick={() => void run(draft.id, () => dismissDraft(database, ws, draft.id))}
                    className="ph-focus flex h-[36px] w-[36px] shrink-0 items-center justify-center rounded-full bg-[var(--ph-fill)] text-[var(--ph-alarm)] disabled:opacity-40"
                  >
                    <X size={18} aria-hidden />
                  </button>
                </span>
              ),
            },
          ]}
        />
      )}
      {asking && (
        <SetAsideSheet
          door={asking.door}
          onSave={async (choice) => {
            await confirmDraft(database, ws, asking.id, { setAside: choice });
            await invalidate();
          }}
          onClose={() => setAsking(null)}
        />
      )}
    </div>
  );
}
