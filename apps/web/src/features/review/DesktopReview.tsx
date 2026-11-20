import { DeskNotices } from '../../app/DeskNotices';
import { formatMinor } from '@expanses/core';
import type { AccountRow, CaptureSource, CardRow, DraftEdit, DraftRow } from '@expanses/db';
import { useNavigate } from '@tanstack/react-router';
import { useOpenReceipt } from '../transactions/ReceiptPeekHost';
import { Check, ChevronDown, ChevronRight } from 'lucide-react';
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { canPayWith, canReceiveInto, canTransferBetween, canTransferWith } from '../../lib/account-types';
import { moneyHolders } from '../../lib/queries';
import { cx, ErrorBox } from '../../ui';
import { usePeekDoubleClick } from '../../ui/native/peek-double-click';
import { CategoryIcon } from '../categories/CategoryIcon';
import { useEvents } from '../events/queries';
import { bareFigure } from '../networth/debt-rows';
import { BOX, NOTE } from '../transactions/CashflowBoxes';
import { CategoryPicker } from '../transactions/CategoryPicker';
import { PaymentSheet } from '../transactions/PaymentSheet';
import type { CellColumn } from '../transactions/cell-range';
import { PICKED_CELL } from '../transactions/QuickRowEditor';
import { paymentOptions } from '../transactions/quick-row';
import { CAPTURE_TYPES, type CaptureType, captureTypeOf } from './capture-type';
import { captureRowView, effectiveCategory } from './capture-view';
import type { Correction } from './draft-form';
import { DraftPeek, type PeekPick } from './DraftPeek';
import { useDrafts, useSkippedCaptures } from './queries';
import {
  type DeskColumns,
  type DeskDraftState,
  deskColumns,
  deskState,
  fromTag,
  newestFirst,
  paidWithOf,
  peekAfterGone,
  queueCounts,
  queueKey,
  whenText,
} from './review-desk-model';
import { useReviewCells } from './review-cells';
import { SkippedList } from './SkippedList';

/** What the Recorded and Discarded lists show at most: the latest, newest first. */
const RESOLVED_SHOWN = 200;

const GBTN =
  'inline-flex h-[26px] items-center gap-1 rounded-[6px] border border-[var(--ph-chevron)] bg-[var(--ph-surface)] px-[10px] text-[12.5px] whitespace-nowrap text-[var(--ph-ink)] hover:bg-[var(--ph-fill)] disabled:opacity-50';
const PBTN = 'inline-flex h-[26px] items-center rounded-[6px] bg-[var(--ph-ink)] px-[11px] text-[12.5px] font-medium whitespace-nowrap text-[var(--ph-surface)] disabled:opacity-40';
const H2 = 'flex items-baseline justify-between gap-[10px] px-[14px] pt-[10px] pb-[6px] text-[13px] font-semibold text-[var(--ph-ink)]';
const TH = 'border-b border-[var(--ph-hair)] px-[8px] py-[7px] font-semibold';
const CELL = 'px-[8px] py-[5px] whitespace-nowrap';
const WARN = 'text-[var(--ph-warn)]';
/** A cell's button that opens a picker in place: plain until hovered, as a Mac table's pop-up cell. */
const CELL_PICK = 'flex w-full min-w-0 items-center gap-[6px] rounded-[5px] px-[4px] py-[1px] text-left hover:bg-[var(--ph-fill)]';
const ROW_BTN = 'inline-flex h-[22px] items-center rounded-[6px] px-[9px] text-[12px] whitespace-nowrap';

/** Each capture kind's tag colour: SMS green, notification blue, email purple, screenshot orange (the mockup's). */
const TAG_TONE: Record<CaptureType, string> = {
  sms: 'var(--ph-up)',
  whatsapp: 'var(--ph-up)',
  notification: 'var(--mac-accent)',
  email: 'var(--ph-trip)',
  screenshot: 'var(--ph-warn)',
  photo: 'var(--ph-warn)',
  nfc: 'var(--mac-accent)',
};

type Tab = 'pending' | 'confirmed' | 'dismissed';
const SEGMENTS: { value: Tab; label: string }[] = [
  { value: 'pending', label: 'To review' },
  { value: 'confirmed', label: 'Recorded' },
  { value: 'dismissed', label: 'Discarded' },
];

/** What the page does to a capture: every one of them is Review's own path (`ReviewPage`), handed in. */
export interface ReviewDeskActions {
  /** Records it as the phone's swipe does: the set-aside question, the day's rate, the toast with Undo. */
  onRecord: (draft: DraftRow) => void;
  /** Records each ready row in turn, stopping at one that asks a question. */
  onRecordReady: (drafts: DraftRow[]) => void;
  /** Discards it, with Undo on the toast. */
  onDiscard: (draft: DraftRow) => void;
  /** The phone's whole draft sheet (the Add form), for what the peek does not ask. */
  onOpenForm: (draft: DraftRow) => void;
  /** The plain view of its picture. */
  onView: (draft: DraftRow) => void;
  /** A field changed in place; resolves whether it was written (a refusal is the page's error to say). */
  onEdit: (draft: DraftRow, patch: DraftEdit, learn: Correction[]) => Promise<boolean>;
  /** An account picked for a side: "Which account is this?" answered for its source too, as the draft sheet does. */
  onPickAccount: (draft: DraftRow, side: 'money' | 'to', accountId: string, cardId: string | null) => Promise<boolean>;
}

/** A box's own width, followed as it changes (the peek opening, the window resized): the table lays out by it. */
function useWidth<T extends HTMLElement>(): [(node: T | null) => void, number] {
  const [width, setWidth] = useState(0);
  const observer = useRef<ResizeObserver | null>(null);
  const ref = useCallback((node: T | null) => {
    observer.current?.disconnect();
    observer.current = null;
    if (!node) return;
    setWidth(node.clientWidth);
    observer.current = new ResizeObserver(([entry]) => entry && setWidth(entry.contentRect.width));
    observer.current.observe(node);
  }, []);
  return [ref, width];
}

/**
 * Review on a wide screen (Mac Review, owner 2026-11-17): what the iPhone captured and nobody has recorded yet, as a
 * table to work through. A title bar with To review / Recorded / Discarded, Scan a receipt and "Record N ready"; one box
 * of counts (the sidebar's badge and Cashflow's To review count the same queue); then the captures — when, where from,
 * description, amount, category, paid with — each with Record and Discard. What a row still needs is orange and is
 * filled in place, in the pickers the phone uses. A row opens its side peek: the capture's own words, and the fields.
 * Return records the peeked row when it is ready, ⌫ discards it. Skipped captures fold away at the foot.
 */
export function DesktopReview({
  drafts,
  loaded,
  error,
  busy,
  guesses,
  sourceOf,
  sharedEvents,
  accounts,
  cards,
  bookName,
  scan,
  actions,
  children,
}: {
  /** The queue: every pending draft, whatever door it came in by (Cashflow's typed or pasted rows too), as the sidebar and Cashflow count it. */
  drafts: readonly DraftRow[];
  loaded: boolean;
  error: unknown;
  busy: string | null;
  guesses: Readonly<Record<string, string | null>> | undefined;
  sourceOf: (draft: DraftRow) => CaptureSource | null;
  sharedEvents: Readonly<Record<string, unknown>>;
  accounts: readonly AccountRow[];
  cards: readonly CardRow[];
  bookName: string;
  scan: { busy: boolean; scan: () => void };
  actions: ReviewDeskActions;
  /** The page's sheets and toast. */
  children?: ReactNode;
}) {
  const navigate = useNavigate();
  // A recorded capture's Open transaction: its Mac receipt in the peek's place, with ‹ back to the capture.
  const openReceipt = useOpenReceipt();
  const [tab, setTab] = useState<Tab>('pending');
  const recorded = useDrafts('confirmed', tab === 'confirmed');
  const discarded = useDrafts('dismissed', tab === 'dismissed');
  const events = useEvents().data ?? [];

  const queue = useMemo(() => newestFirst(drafts), [drafts]);
  const states = useMemo(() => new Map(queue.map((draft) => [draft.id, deskState(draft, sourceOf(draft), guesses, sharedEvents)])), [queue, sourceOf, guesses, sharedEvents]);
  const counts = queueCounts([...states.values()]);
  const ready = queue.filter((draft) => states.get(draft.id)?.ready);

  const resolvedQuery = tab === 'confirmed' ? recorded : tab === 'dismissed' ? discarded : null;
  const resolvedAll = useMemo(() => newestFirst(resolvedQuery?.data ?? []), [resolvedQuery?.data]);
  const resolved = resolvedAll.slice(0, RESOLVED_SHOWN);
  const rows = tab === 'pending' ? queue : resolved;
  const ids = rows.map((draft) => draft.id);

  // The side peek: which capture it shows, stepped through the table's order.
  const [peekId, setPeekId] = useState<string | null>(null);
  const peekAt = useRef(0);
  const peek = (id: string | null) => {
    if (id) peekAt.current = Math.max(0, ids.indexOf(id));
    setPeekId(id);
  };
  const step = (by: -1 | 1) => {
    if (!peekId) return;
    const at = ids.indexOf(peekId);
    const next = at < 0 ? undefined : ids[Math.min(ids.length - 1, Math.max(0, at + by))];
    if (next) peek(next);
  };
  // A peeked capture that leaves the queue (recorded, discarded) hands the peek to the row that took its place.
  const idsKey = ids.join('|');
  useEffect(() => {
    if (peekId && !ids.includes(peekId)) setPeekId(peekAfterGone(ids, peekAt.current));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey]);
  const changeTab = (next: Tab) => {
    setTab(next);
    setPeekId(null);
  };

  const bar = useRef<HTMLElement>(null);
  const [peekTop, setPeekTop] = useState(52);
  const peeking = peekId !== null;
  // The page makes room for the peek as it opens, which can move a row from under the pointer: a double-click whose
  // second click lands off the moved row still opens that row's draft form (`usePeekDoubleClick`).
  const doubleClick = usePeekDoubleClick((id) => {
    const draft = tab === 'pending' ? rows.find((one) => one.id === id) : undefined;
    if (draft) actions.onOpenForm(draft);
  });
  useEffect(() => {
    if (!peeking) return;
    const place = () => setPeekTop(Math.max(0, bar.current?.getBoundingClientRect().bottom ?? 52));
    place();
    window.addEventListener('scroll', place, { passive: true });
    window.addEventListener('resize', place);
    return () => {
      window.removeEventListener('scroll', place);
      window.removeEventListener('resize', place);
    };
  }, [peeking]);

  // A picker open in place: the category, the account that paid, a transfer's destination.
  const [picking, setPicking] = useState<{ draftId: string; pick: PeekPick } | null>(null);
  const pickingDraft = picking ? queue.find((draft) => draft.id === picking.draftId) : undefined;

  const peeked = peekId ? rows.find((draft) => draft.id === peekId) : undefined;
  const peekedState = peeked && tab === 'pending' ? (states.get(peeked.id) ?? null) : null;

  // Keys while a row is peeked: Return records it (when the peek may), ⌫ discards, ↑ ↓ step, Esc closes — never while
  // typing, or under a sheet or a picker.
  const keys = useRef<(event: KeyboardEvent) => void>(() => undefined);
  keys.current = (event: KeyboardEvent) => {
    if (!peeked) return;
    const target = event.target as HTMLElement | null;
    const typing = !!target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable);
    if (typing || event.metaKey || event.ctrlKey || event.altKey || document.querySelector('[role="dialog"]')) return;
    const asked = queueKey(event.key);
    if (asked === null) return;
    // Return on a focused button is that button's own press.
    if (asked === 'record' && target?.tagName === 'BUTTON') return;
    event.preventDefault();
    if (asked === 'close') setPeekId(null);
    else if (asked === 'up') step(-1);
    else if (asked === 'down') step(1);
    else if (!peekedState || busy !== null) return;
    else if (asked === 'record' && peekedState.complete) actions.onRecord(peeked);
    else if (asked === 'discard') actions.onDiscard(peeked);
  };
  useEffect(() => {
    const listen = (event: KeyboardEvent) => keys.current(event);
    document.addEventListener('keydown', listen);
    return () => document.removeEventListener('keydown', listen);
  }, []);

  // The blue cells: a range down one column of the queue (`review-cells`); starting one puts the peek away.
  const cells = useReviewCells({
    rows,
    pending: tab === 'pending',
    accounts,
    cards,
    guesses,
    onEdit: (draft, patch) => actions.onEdit(draft, patch, []),
    onPickAccount: (draft, accountId, cardId) => actions.onPickAccount(draft, 'money', accountId, cardId),
    onStart: () => setPeekId(null),
  });

  const [tableRef, tableWidth] = useWidth<HTMLElement>();
  const cols = deskColumns(tableWidth);
  const eventNameOf = (draft: DraftRow) => (draft.eventId ? (events.find((event) => event.id === draft.eventId)?.name ?? null) : null);

  return (
    <div className="min-h-dvh bg-[var(--ov-ground)]" data-testid="review-page" data-desk="true" {...doubleClick}>
      <header ref={bar} className="desk-titlebar sticky top-0 z-10 flex h-[52px] items-center gap-[10px] border-b border-[var(--ph-hair)] bg-[var(--ph-surface)] pr-[14px] pl-[18px]">
        <h1 className="text-[15px] font-semibold text-[var(--ph-ink)]">Review</h1>
        <span className="flex-1" />
        <div role="radiogroup" aria-label="Review view" className="flex rounded-[7px] bg-[var(--ph-fill)] p-[2px] text-[12px]">
          {SEGMENTS.map((segment) => (
            <button
              key={segment.value}
              type="button"
              role="radio"
              aria-checked={tab === segment.value}
              onClick={() => changeTab(segment.value)}
              className={cx(
                'rounded-[5px] px-[11px] py-[3px] whitespace-nowrap',
                tab === segment.value ? 'bg-[var(--ph-selected)] font-medium text-[var(--ph-ink)] shadow-[0_0.5px_1.5px_rgba(0,0,0,0.18)]' : 'text-[var(--ph-ink-2)]',
              )}
            >
              {segment.label}
            </button>
          ))}
        </div>
        <button type="button" disabled={scan.busy} onClick={scan.scan} className={GBTN}>
          {scan.busy ? 'Reading the receipt…' : 'Scan a receipt'}
        </button>
        {tab === 'pending' && ready.length > 0 && (
          <button type="button" disabled={busy !== null} onClick={() => actions.onRecordReady(ready)} className={PBTN}>
            Record {ready.length} ready
          </button>
        )}
      </header>
      {/* The app's notices, under the title bar rather than above it. */}
      <DeskNotices />

      <div className={cx('space-y-[14px] px-[20px] py-[16px]', peeking && 'mr-[322px]')}>
        <ErrorBox error={error} />
        <CountsBox counts={counts} loaded={loaded} />

        <section ref={tableRef} className={cx(BOX, 'overflow-clip')} aria-label={SEGMENTS.find((s) => s.value === tab)!.label} data-testid="review-table">
          <h2 className={H2}>
            {SEGMENTS.find((s) => s.value === tab)!.label}
            <span className={NOTE} data-testid="table-note">
              {cells.hint ??
                (tab === 'pending'
                ? 'Fill the orange cells in place · Return records · ⌫ discards · click a row to see what was captured'
                : resolvedAll.length > resolved.length
                  ? `latest ${resolved.length} of ${resolvedAll.length}`
                  : 'kept so the same capture is not offered again')}
            </span>
          </h2>
          {cells.line}
          <div className="border-t border-[var(--ph-hair)]">
            <table className="w-full table-fixed border-collapse text-[13px]">
              <thead>
                <tr className="bg-[var(--mac-head)] text-left text-[11px] font-semibold text-[var(--ph-ink-3)]">
                  <th className="w-[30px] border-b border-[var(--ph-hair)] py-[7px]">
                    <span className="sr-only">Ready</span>
                  </th>
                  {cols.when && <th className={cx(TH, 'w-[110px]')}>When</th>}
                  {cols.from && <th className={cx(TH, 'w-[100px]')}>From</th>}
                  <th className={TH}>Description</th>
                  <th className={cx(TH, 'w-[100px] text-right')}>Amount</th>
                  <th className={cx(TH, 'w-[150px]')}>Category</th>
                  {cols.paidWith && <th className={cx(TH, 'w-[150px]')}>Paid with</th>}
                  <th className={cx(TH, cols.discard ? 'w-[146px]' : 'w-[76px]')}>
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody {...cells.containerProps}>
                {loaded && rows.length === 0 && (
                  <tr>
                    <td colSpan={9} className="px-3 py-6 text-center text-[13px] text-[var(--ph-ink-3)]">
                      {tab === 'pending'
                        ? 'Nothing waiting. Captured spending appears here before it reaches the accounts.'
                        : tab === 'confirmed'
                          ? 'Nothing recorded from Review yet.'
                          : 'Nothing discarded.'}
                    </td>
                  </tr>
                )}
                {rows.map((draft, index) => (
                  <DraftTableRow
                    key={draft.id}
                    draft={draft}
                    state={tab === 'pending' ? (states.get(draft.id) ?? null) : null}
                    type={captureTypeOf(draft, sourceOf(draft))}
                    categoryId={effectiveCategory(draft, guesses)}
                    accounts={accounts}
                    cards={cards}
                    cols={cols}
                    striped={index % 2 === 1}
                    peeked={peekId === draft.id}
                    pickedCell={cells.pickedColumn(draft.id)}
                    busy={busy}
                    onPeek={() => peek(draft.id)}
                    onOpen={() => (tab === 'pending' ? actions.onOpenForm(draft) : undefined)}
                    onPick={(pick) => setPicking({ draftId: draft.id, pick })}
                    onRecord={() => actions.onRecord(draft)}
                    onDiscard={() => actions.onDiscard(draft)}
                  />
                ))}
              </tbody>
            </table>
          </div>
          {tab === 'pending' && <SkippedFold />}
        </section>
      </div>

      {peeked && (
        <DraftPeek
          key={peeked.id}
          draft={peeked}
          state={peekedState}
          source={sourceOf(peeked)}
          accounts={accounts}
          cards={cards}
          categoryId={effectiveCategory(peeked, guesses)}
          bookName={bookName}
          eventName={eventNameOf(peeked)}
          top={peekTop}
          first={ids.indexOf(peeked.id) <= 0}
          last={ids.indexOf(peeked.id) === ids.length - 1}
          busy={busy !== null}
          error={null}
          onStep={step}
          onClose={() => setPeekId(null)}
          onRecord={() => actions.onRecord(peeked)}
          onDiscard={() => actions.onDiscard(peeked)}
          onOpenForm={() => actions.onOpenForm(peeked)}
          onView={() => actions.onView(peeked)}
          onEdit={(patch, learn) => actions.onEdit(peeked, patch, learn)}
          onPick={(pick) => setPicking({ draftId: peeked.id, pick })}
          onOpenTransaction={
            tab === 'confirmed' && peeked.transactionId
              ? () =>
                  openReceipt
                    ? openReceipt(peeked.transactionId!, { back: peeked.description || 'Capture' })
                    : void navigate({ to: '/transactions/$transactionId', params: { transactionId: peeked.transactionId! } })
              : undefined
          }
        />
      )}

      {cells.choose?.draft && (
        <Picker
          draft={cells.choose.draft}
          pick={cells.choose.pick}
          title={cells.choose.pick === 'category' ? `Category for ${cells.choose.count} captures` : undefined}
          accounts={accounts}
          cards={cards}
          categoryId={null}
          onClose={cells.choose.close}
          onCategory={cells.choose.onCategory}
          onAccount={(_side, accountId, cardId) => cells.choose?.onAccount(accountId, cardId)}
        />
      )}

      {picking && pickingDraft && (
        <Picker
          draft={pickingDraft}
          pick={picking.pick}
          accounts={accounts}
          cards={cards}
          categoryId={effectiveCategory(pickingDraft, guesses)}
          onClose={() => setPicking(null)}
          onCategory={(categoryId) => {
            setPicking(null);
            actions.onEdit(pickingDraft, { categoryAccountId: categoryId }, []);
          }}
          onAccount={(side, accountId, cardId) => {
            setPicking(null);
            actions.onPickAccount(pickingDraft, side, accountId, cardId);
          }}
        />
      )}

      {children}
    </div>
  );
}

/** The counts strip: the queue, what is ready, what each still needs; and a grey line on where captures come from. */
function CountsBox({ counts, loaded }: { counts: ReturnType<typeof queueCounts>; loaded: boolean }) {
  const figure = (label: string, value: number, tone: string | undefined, testId: string) => (
    <div data-testid={testId}>
      <div className="text-[11.5px] whitespace-nowrap text-[var(--ph-ink-3)]">{label}</div>
      <b className={cx('text-[22px] leading-[28px] font-semibold tabular-nums', tone ?? 'text-[var(--ph-ink)]')} data-testid={`${testId}-count`}>
        {loaded ? value : '–'}
      </b>
    </div>
  );
  return (
    <section className={BOX} aria-label="Review counts" data-testid="review-counts">
      <div className="flex flex-wrap items-center gap-x-[26px] gap-y-[6px] px-[16px] py-[12px]">
        {figure('To review', counts.toReview, undefined, 'review-to-review')}
        {figure('Ready to record', counts.ready, 'text-[var(--ph-up)]', 'review-ready')}
        {figure('Need a category', counts.needCategory, counts.needCategory > 0 ? WARN : undefined, 'review-need-category')}
        {figure('Need an account', counts.needAccount, counts.needAccount > 0 ? WARN : undefined, 'review-need-account')}
        {counts.checkAmount > 0 && figure('Amount to check', counts.checkAmount, WARN, 'review-check-amount')}
        <span className="flex-1" />
        <p className="text-[12px] text-[var(--ph-ink-3)]">Captured from SMS, notifications, emails and screenshots on the iPhone · synced here</p>
      </div>
    </section>
  );
}

/** "Skipped · N ▸ show" at the foot of the queue: the phone's Skipped list, folded until asked for. */
function SkippedFold() {
  const skipped = useSkippedCaptures().data ?? [];
  const [open, setOpen] = useState(false);
  if (skipped.length === 0) return null;
  return (
    <div className="border-t border-[var(--ph-hair)]">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((was) => !was)}
        className="w-full px-[14px] pt-[10px] pb-[8px] text-left text-[11px] font-semibold tracking-[0.04em] text-[var(--ph-ink-3)] uppercase hover:text-[var(--ph-ink)]"
      >
        Skipped · {skipped.length}
        <span className="ml-[8px] inline-flex items-center gap-[2px] font-normal tracking-normal normal-case">
          {open ? <ChevronDown size={11} aria-hidden /> : <ChevronRight size={11} aria-hidden />}
          {open ? 'hide' : 'show'}
        </span>
      </button>
      {open && (
        <div className="max-w-2xl px-[14px] pb-[6px]">
          <SkippedList />
        </div>
      )}
    </div>
  );
}

function TickCircle({ ready }: { ready: boolean }) {
  return (
    <span
      role="img"
      aria-label={ready ? 'Ready to record' : 'Not ready'}
      className={cx('flex h-[15px] w-[15px] items-center justify-center rounded-full', ready ? 'bg-[var(--mac-accent)] text-white' : 'ring-[1.5px] ring-[var(--ph-chevron)] ring-inset')}
    >
      {ready && <Check size={10} strokeWidth={3} aria-hidden />}
    </span>
  );
}

function FromTag({ draft, type }: { draft: DraftRow; type: CaptureType | null }) {
  const tag = fromTag(draft, type);
  const tone = type ? TAG_TONE[type] : 'var(--ph-ink-3)';
  const Icon = type ? CAPTURE_TYPES[type].Icon : null;
  return (
    <span
      data-testid="review-from"
      className="inline-flex items-center gap-[4px] rounded-[4px] px-[6px] py-[1px] text-[10.5px] font-semibold"
      style={{ color: tone, background: `color-mix(in srgb, ${tone} 12%, transparent)` }}
    >
      {Icon && <Icon size={10} aria-hidden />}
      {tag.word}
    </span>
  );
}

/** One capture in the table: ready or not, when, from, description, amount, category, paid with, Record and Discard. */
function DraftTableRow({
  draft,
  state,
  type,
  categoryId,
  accounts,
  cards,
  cols,
  striped,
  peeked,
  pickedCell,
  busy,
  onPeek,
  onOpen,
  onPick,
  onRecord,
  onDiscard,
}: {
  draft: DraftRow;
  /** The column of its cell in a range of blue cells, if one is. */
  pickedCell: CellColumn | null;
  /** Where it stands in the queue; null for one recorded or discarded (read only). */
  state: DeskDraftState | null;
  type: CaptureType | null;
  categoryId: string | null;
  accounts: readonly AccountRow[];
  cards: readonly CardRow[];
  cols: DeskColumns;
  striped: boolean;
  peeked: boolean;
  busy: string | null;
  onPeek: () => void;
  onOpen: () => void;
  onPick: (pick: PeekPick) => void;
  onRecord: () => void;
  onDiscard: () => void;
}) {
  const open = state !== null;
  const transfer = draft.kind === 'transfer';
  const category = categoryId ? accounts.find((a) => a.id === categoryId) : undefined;
  const paid = paidWithOf(draft.accountId, draft.cardId, accounts, cards);
  const to = paidWithOf(draft.toAccountId, null, accounts, cards);
  const merged = captureRowView(draft, null).merged;
  const stop = (run: () => void) => (event: { stopPropagation: () => void }) => {
    event.stopPropagation();
    run();
  };
  // Each cell a range may run down is marked for it, and drawn blue while in one.
  const cell = (column: CellColumn) => ({ 'data-cell': column, 'data-cell-row': draft.id, 'data-picked': pickedCell === column || undefined });
  const blue = (column: CellColumn) => pickedCell === column && PICKED_CELL;
  const pickCell = (label: string, pick: PeekPick, face: ReactNode) =>
    open ? (
      <button type="button" aria-label={label} onClick={stop(() => onPick(pick))} onDoubleClick={(event) => event.stopPropagation()} className={CELL_PICK}>
        {face}
      </button>
    ) : (
      <span className="flex min-w-0 items-center gap-[6px] px-[4px]">{face}</span>
    );

  return (
    <tr
      data-testid={open ? 'draft-row' : 'resolved-row'}
      data-draft-id={draft.id}
      data-peek-row={open ? draft.id : undefined}
      data-ready={state?.ready ?? undefined}
      aria-current={peeked ? 'true' : undefined}
      onClick={onPeek}
      onDoubleClick={onOpen}
      className={cx(
        'cursor-default text-[var(--ph-ink)]',
        peeked ? 'bg-[var(--mac-accent-wash)]' : striped && 'bg-[var(--mac-zebra)]',
        busy === draft.id && 'opacity-50',
        peeked && 'shadow-[inset_3px_0_0_var(--mac-accent)]',
      )}
    >
      <td className="py-[5px] pl-[10px]">{open ? <TickCircle ready={state.ready} /> : null}</td>
      {cols.when && (
        <td {...cell('date')} className={cx(CELL, 'text-[var(--ph-ink-3)] tabular-nums', blue('date'))}>
          {whenText(draft, type !== null)}
        </td>
      )}
      {cols.from && (
        <td className={cx(CELL, 'overflow-hidden')}>
          <FromTag draft={draft} type={type} />
        </td>
      )}
      <td {...cell('description')} className={cx(CELL, 'overflow-hidden text-ellipsis', blue('description'))} title={merged ? `${draft.description} · ${merged}` : draft.description}>
        {draft.description}
        {/* Several sightings of one payment folded into this row, as the phone's row says. */}
        {merged && <span className="ml-[6px] text-[11.5px] text-[var(--ph-ink-3)]">{merged}</span>}
      </td>
      <td {...cell('amount')} className={cx(CELL, 'text-right tabular-nums', blue('amount'))} data-testid="draft-amount">
        {draft.amountMinor === 0 ? (
          <span className={WARN}>No amount</span>
        ) : (
          <span className={cx(state?.checkAmount && WARN, draft.kind === 'income' && !state?.checkAmount && 'text-[var(--ph-up)]')} title={state?.checkAmount ? 'Check the amount against what was captured' : undefined}>
            {draft.currency === 'IDR' ? bareFigure(Math.abs(draft.amountMinor), draft.currency) : formatMinor(Math.abs(draft.amountMinor), draft.currency)}
          </span>
        )}
      </td>
      <td {...cell('category')} className={cx(CELL, 'overflow-hidden', blue('category'))}>
        {transfer
          ? pickCell(`To account for ${draft.description}`, 'to', to ? <span className="truncate">→ {to.name}</span> : <span className={WARN}>To which account?</span>)
          : pickCell(
              `Category for ${draft.description}`,
              'category',
              category ? (
                <>
                  <CategoryIcon categoryId={category.id} accounts={accounts} size="xs" />
                  <span className="truncate">{category.name}</span>
                </>
              ) : (
                <span className={WARN}>Choose…</span>
              ),
            )}
      </td>
      {cols.paidWith && (
        <td {...cell('paid')} className={cx(CELL, 'overflow-hidden', blue('paid'))}>
          {pickCell(
            `Account for ${draft.description}`,
            'money',
            paid ? (
              <span className="truncate">
                {paid.name}
                {paid.last4 && <span className="ml-1 text-[11px] text-[var(--ph-ink-3)] tabular-nums">{paid.last4}</span>}
              </span>
            ) : (
              <span className={WARN}>Which account?</span>
            ),
          )}
        </td>
      )}
      <td className={cx(CELL, 'text-right')}>
        {open && (
          <span className="inline-flex items-center gap-[6px]">
            <button
              type="button"
              aria-label={`Record ${draft.description}`}
              disabled={busy !== null || !state.ready}
              onClick={stop(onRecord)}
              onDoubleClick={(event) => event.stopPropagation()}
              className={cx(ROW_BTN, state.ready ? 'bg-[var(--ph-ink)] font-medium text-[var(--ph-surface)]' : 'border border-[var(--ph-chevron)] bg-[var(--ph-surface)] text-[var(--ph-ink-3)]', 'disabled:cursor-default')}
            >
              Record
            </button>
            {cols.discard && (
              <button
                type="button"
                aria-label={`Discard ${draft.description}`}
                disabled={busy !== null}
                onClick={stop(onDiscard)}
                onDoubleClick={(event) => event.stopPropagation()}
                className={cx(ROW_BTN, 'border border-[var(--ph-chevron)] bg-[var(--ph-surface)] text-[var(--ph-ink)] hover:bg-[var(--ph-fill)] disabled:opacity-40')}
              >
                Discard
              </button>
            )}
          </span>
        )}
      </td>
    </tr>
  );
}

/** The phone's pickers, opened in place: Select category, or the Paid with / Received into / From / To sheet. */
function Picker({
  draft,
  pick,
  title,
  accounts,
  cards,
  categoryId,
  onClose,
  onCategory,
  onAccount,
}: {
  draft: DraftRow;
  pick: PeekPick;
  /** The category sheet's name, when it chooses for more than this one capture. */
  title?: string;
  accounts: readonly AccountRow[];
  cards: readonly CardRow[];
  categoryId: string | null;
  onClose: () => void;
  onCategory: (categoryId: string) => void;
  onAccount: (side: 'money' | 'to', accountId: string, cardId: string | null) => void;
}) {
  if (pick === 'category') {
    return (
      <CategoryPicker
        kind={draft.kind === 'income' ? 'income' : 'expense'}
        // A capture's kind is the form's to change: in place, only its category is picked.
        lockKind
        title={title ?? `Category for ${draft.description}`}
        value={categoryId ?? undefined}
        onPick={onCategory}
        onClose={onClose}
      />
    );
  }
  const holders = moneyHolders([...accounts]);
  if (pick === 'to') {
    const from = accounts.find((a) => a.id === draft.accountId);
    const landing = holders.filter((a) => canTransferWith(a, draft.toAccountId) && a.id !== draft.accountId && (!from || canTransferBetween(from, a)));
    return (
      <PaymentSheet
        title="To"
        options={paymentOptions(landing, [])}
        accounts={[...accounts]}
        chosenAccountId={draft.toAccountId ?? ''}
        leadCurrency={from?.currency}
        onPick={(option) => onAccount('to', option.accountId, null)}
        onClose={onClose}
      />
    );
  }
  // One list per question, as the Add form keeps them: paid with, received into, or moved from.
  const namedBy = draft.kind === 'transfer' ? canTransferWith : draft.kind === 'income' ? canReceiveInto : canPayWith;
  const to = accounts.find((a) => a.id === draft.toAccountId);
  const money = holders.filter((a) => namedBy(a, draft.accountId) && (draft.kind !== 'transfer' || !to || a.id === draft.accountId || canTransferBetween(a, to)));
  const expense = draft.kind === 'expense';
  return (
    <PaymentSheet
      title={draft.kind === 'transfer' ? 'From' : draft.kind === 'income' ? 'Received into' : 'Paid with'}
      options={paymentOptions(money, expense ? [...cards] : [], draft.accountId ?? '')}
      accounts={[...accounts]}
      chosenAccountId={draft.accountId ?? ''}
      chosenCardId={draft.cardId ?? ''}
      cards={expense}
      onPick={(option) => onAccount('money', option.accountId, option.cardId)}
      onClose={onClose}
    />
  );
}
