import { dayMonth, formatMinor } from '@expanses/core';
import { confirmDraft, type DraftRow, dismissDraft, editDraft, reopenDraft, voidTransaction } from '@expanses/db';
import { Check, X } from 'lucide-react';
import { useState } from 'react';
import { useApp } from '../../app/context';
import { usePhone } from '../../app/use-phone';
import { canPayWith } from '../../lib/account-types';
import { moneyHolders, useAccounts, useInvalidateAll } from '../../lib/queries';
import { cx, Empty, ErrorBox, Select } from '../../ui';
import { Figure, LargeTitle, RecordTable, SCREEN } from '../../ui/native';
import { UndoToast } from '../../ui/UndoToast';
import { CategoryOptions } from '../cards/options';
import { type Door, spendingDoor } from '../goals/set-aside-question';
import { asksAboutSetAside, SetAsideSheet } from '../goals/SetAsideQuestion';
import { DraftSheet } from './DraftSheet';
import { useDrafts } from './queries';

/**
 * Captured spending, waiting to be confirmed.
 *
 * Nothing a parser produces reaches the ledger on its own. That is what makes it safe for a bank to
 * change its statement layout without warning: a broken parser fills this queue with nonsense, which
 * is a nuisance, rather than the books, which would be a problem.
 *
 * A desktop reads the queue as a table, every column in place, exactly as it did before. A phone reads it as rows
 * — a chevron into the sheet that holds what a row had no width for, and the two answers themselves one gesture
 * away: right to record, left to discard. The gesture is only safe because it asks what the Record button asks —
 * a purchase that takes promised money still gets its question first, and a draft with no account or category has
 * no answer to give, so it opens the sheet — and because either write can be taken back from the toast: a record
 * is voided through the ledger and the draft returns to the queue, which is the one way back for both directions.
 */
export function ReviewPage() {
  const { database, ws } = useApp();
  const invalidate = useInvalidateAll();
  const phone = usePhone();
  const drafts = useDrafts();
  const accounts = useAccounts().data ?? [];
  // Confirming a draft records real spending, so the account it names has to be one that can pay.
  const money = moneyHolders(accounts).filter((a) => canPayWith(a));
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState<string | null>(null);
  /** The draft the phone's sheet is open on, by id — the row that was tapped. */
  const [editing, setEditing] = useState<string | null>(null);
  /** What the phone just did, and the way back — the bills list's own toast, for the same reason. */
  const [toast, setToast] = useState<{ text: string; undo: () => Promise<void> } | null>(null);

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

  /** The name an account or a category goes by on a row, or what the draft is still missing. */
  const nameOf = (id: string | null, missing: string) => accounts.find((account) => account.id === id)?.name ?? missing;

  /** Puts a resolved draft back: what a record posted is voided first, then the draft itself returns to the queue. */
  async function undo(draft: DraftRow, transactionId: string | null) {
    if (transactionId) await voidTransaction(database, ws, transactionId);
    await reopenDraft(database, ws, draft.id);
    await invalidate();
  }

  /** Says what the phone just did, with the way back on the toast. */
  function resolved(draft: DraftRow, what: 'recorded' | 'discarded', transactionId: string | null) {
    setEditing(null);
    setToast({
      text: `${what === 'recorded' ? 'Recorded' : 'Discarded'} ${draft.description}`,
      undo: () => undo(draft, transactionId),
    });
  }

  /** A draft whose payment takes promised money: confirmed from the question's sheet once it is answered. */
  const [asking, setAsking] = useState<{ id: string; door: Door; undoable: boolean } | null>(null);

  /** Confirms in place unless it would take money set aside; then the question comes first, in a sheet. */
  async function record(draft: DraftRow, undoable = false) {
    setError(null);
    const door = spendingDoor(draft.accountId ?? '', Math.max(0, draft.amountMinor));
    let asks = false;
    try {
      asks = await asksAboutSetAside(database, ws, door);
    } catch (e) {
      setError(e);
      return;
    }
    if (asks) {
      setAsking({ id: draft.id, door: door!, undoable });
      return;
    }
    await run(draft.id, async () => {
      const transactionId = await confirmDraft(database, ws, draft.id, { setAside: null });
      if (undoable) resolved(draft, 'recorded', transactionId);
    });
  }

  /** Says a draft is not something to record. It stays, so the same capture is not offered again. */
  async function discard(draft: DraftRow, undoable = false) {
    await run(draft.id, async () => {
      await dismissDraft(database, ws, draft.id);
      if (undoable) resolved(draft, 'discarded', null);
    });
  }

  /**
   * What a swipe right does. A draft the parser could not finish — no account, no category — carries a question of
   * its own, and no gesture may answer it: the sheet opens on the row instead.
   */
  function swipeRecord(draft: DraftRow) {
    if (!draft.accountId || !draft.categoryAccountId) setEditing(draft.id);
    else void record(draft, true);
  }

  const list = drafts.data ?? [];
  const editingDraft = list.find((draft) => draft.id === editing) ?? null;

  return (
    <div className={SCREEN}>
      <LargeTitle
        title="Review"
        subtitle={
          list.length === 0
            ? undefined
            : phone
              ? `${list.length} waiting. Swipe right to record a row, left to discard it, or tap it to check it first.`
              : `${list.length} waiting. Nothing here has been recorded yet — check what was read, then confirm it.`
        }
      />
      <ErrorBox error={error ?? drafts.error} />

      {drafts.isSuccess && list.length === 0 && <Empty>Nothing waiting. Captured spending appears here before it reaches your accounts.</Empty>}

      {list.length > 0 && (
        <RecordTable
          records={list}
          rowTestId={() => 'draft-row'}
          /* A row opens the sheet on a phone, and the sheet holds what the row had no width for. A desktop reads
             the very same fields as columns and has nowhere to open. */
          detail={{ kind: 'screen', open: (draft) => setEditing(draft.id) }}
          rowSwipe={(draft) => ({
            onSwipeRight: () => swipeRecord(draft),
            rightHint: 'Record',
            leftAction: (
              <button
                type="button"
                aria-label={`Discard ${draft.description}`}
                onClick={() => void discard(draft, true)}
                className="w-[76px] bg-[var(--ph-ink-3)] text-[15px] font-semibold text-white"
              >
                Discard
              </button>
            ),
          })}
          shape={{
            key: (draft) => draft.id,
            title: (draft) => (
              <>
                {draft.description}
                {draft.confidence !== null && draft.confidence < 80 && <span className="ml-2 text-[12.5px] font-normal text-[var(--ph-warn)]">unsure</span>}
              </>
            ),
            // The two answers read back as names, so a row says where the capture is headed before it is opened.
            subtitle: (draft) =>
              `${dayMonth(draft.occurredOn)} · ${nameOf(draft.accountId, 'no account yet')} · ${nameOf(draft.categoryAccountId, 'no category yet')}`,
            value: (draft) => <Figure>{formatMinor(Math.abs(draft.amountMinor), draft.currency)}</Figure>,
            /* Everything a row says out loud; the buttons are the sheet's and the swipe's, and they are all a
               reader can reach than a row cannot print. */
            covers: ['date', 'description', 'amount', 'account', 'category'],
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
                    onClick={() => void discard(draft)}
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

      {editingDraft && (
        <DraftSheet
          draft={editingDraft}
          accounts={accounts}
          money={money}
          busy={busy !== null}
          onEdit={(patch) => void run(editingDraft.id, () => editDraft(database, ws, editingDraft.id, patch))}
          onRecord={() => void record(editingDraft, true)}
          onDiscard={() => void discard(editingDraft, true)}
          onClose={() => setEditing(null)}
        />
      )}

      {asking && (
        <SetAsideSheet
          door={asking.door}
          onSave={async (choice) => {
            const transactionId = await confirmDraft(database, ws, asking.id, { setAside: choice });
            await invalidate();
            const draft = list.find((row) => row.id === asking.id);
            if (asking.undoable && draft) resolved(draft, 'recorded', transactionId);
          }}
          onClose={() => setAsking(null)}
        />
      )}

      {toast && (
        <UndoToast
          text={toast.text}
          onUndo={() =>
            void run('undo', async () => {
              const takeBack = toast.undo;
              setToast(null);
              await takeBack();
            })
          }
          onDone={() => setToast(null)}
        />
      )}
    </div>
  );
}
