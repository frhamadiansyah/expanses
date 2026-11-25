import { DeskNotices } from '../../app/DeskNotices';
import { isoDate } from '@expanses/core';
import type { AccountRow, CaptureSource, CardRow, DraftEdit, DraftRow } from '@expanses/db';
import { Link, useNavigate } from '@tanstack/react-router';
import { useOpenReceipt } from '../transactions/ReceiptPeekHost';
import { Check, ChevronDown, ChevronRight, Inbox, Plus } from 'lucide-react';
import { type CSSProperties, type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { canPayWith, canReceiveInto, canTransferBetween, canTransferWith } from '../../lib/account-types';
import { moneyHolders } from '../../lib/queries';
import { cx, ErrorBox } from '../../ui';
import { usePeekDoubleClick } from '../../ui/native/peek-double-click';
import { useEvents } from '../events/queries';
import { BOX } from '../transactions/CashflowBoxes';
import { CategoryPicker } from '../transactions/CategoryPicker';
import { PaymentSheet } from '../transactions/PaymentSheet';
import { paymentOptions } from '../transactions/quick-row';
import { pendingPaidLabel, pendingPaidOf, readMarks } from '../transactions/paste-categories';
import { captureTypeOf } from './capture-type';
import { captureRowView, effectiveCategory } from './capture-view';
import type { Correction } from './draft-form';
import { DraftPeek, type PeekPick } from './DraftPeek';
import { useDrafts, useSkippedCaptures } from './queries';
import {
  anyFilter,
  deskState,
  fromTag,
  matchesFilters,
  newestFirst,
  NO_FILTERS,
  paidWithOf,
  type ReviewSort,
  sortDrafts,
  peekAfterGone,
  queueCounts,
  queueKey,
  type ReviewFilters,
  shownLine,
} from './review-desk-model';
import { ChoiceHead, NoteHead, WhenHead } from './ReviewHeadFilters';
import { ColumnHead, type ColumnSort, SORT_WORDS } from '../transactions/ColumnHead';
import { stickyHead, useStuck } from '../transactions/sticky-head';
import { draftFigure, sumFigures, totalFoot } from '../transactions/table-figures';
import { useReviewCells } from './review-cells';
import { TableMenu, type TableMenuItem } from '../transactions/TableMenu';
import { copyToClipboard, pasteFromClipboard } from '../transactions/clipboard';
import { useUndoKeys, useUndoStack } from '../transactions/undo-stack';
import { ResolvedRow, ReviewRow, TickCircle, ToAccountCell } from './ReviewRow';
import { useRowOptions } from '../transactions/row-options';
import { DESK_COLUMNS, DESK_GRID } from '../transactions/QuickRowEditor';
import { SkippedList } from './SkippedList';
import { CARD, CARD_HEAD, CARD_NOTE, DeskBar, DeskTitle, PILL, PILL_BLACK, PILL_BLUE, Seg, StatTile, Tag, TileRow, tileMoney } from '../../ui/desk';
import { macV2 } from '../../ui/mac-detail';
import { Bang, Question } from '../bills/desk-glyphs';
import { type MissingKey, missingTile, readyTotal } from './review-tiles';
import { PEEK_ROOM } from '../../ui/native/panel-frame';

/** What the Recorded and Discarded lists show at most: the latest, newest first. */
const RESOLVED_SHOWN = 200;

const WARN = 'text-[var(--mk-t-orange)]';

type Tab = 'pending' | 'confirmed' | 'dismissed';
const SEGMENTS: { value: Tab; label: string }[] = [
  { value: 'pending', label: 'Waiting' },
  { value: 'confirmed', label: 'Recorded' },
  { value: 'dismissed', label: 'Discarded' },
];

/** Missing something's tag: "1 account · 2 category", each count under the old counts strip's test id. */
const MISSING_WORD: Record<MissingKey, string> = { account: 'account', category: 'category', amount: 'amount' };
const MISSING_TEST_ID: Record<MissingKey, string> = { account: 'review-need-account-count', category: 'review-need-category-count', amount: 'review-check-amount-count' };

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

/**
 * Review on a wide screen (Mac Review, owner 2026-11-17): what the iPhone captured and nobody has recorded yet, as a
 * table to work through. A title bar with Waiting / Recorded / Discarded, Scan a receipt and "Record N"; the three boxes
 * of counts (the sidebar's badge and Cashflow's To review count the same queue); then the captures as Cashflow's
 * waiting rows (owner, 2026-11-24): Date, Note, Category, Paid with and Amount typed in place, the blue circle when
 * ready, a blank cell saying its column's word in grey. No buttons on a row: ⌘Return records it, ⌫ discards it, and a
 * click opens its side peek — the capture's own words, and the fields. The column names filter the rows. Skipped
 * captures fold away at the foot.
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

  const resolvedQuery = tab === 'confirmed' ? recorded : tab === 'dismissed' ? discarded : null;
  const resolvedAll = useMemo(() => newestFirst(resolvedQuery?.data ?? []), [resolvedQuery?.data]);
  const resolved = resolvedAll.slice(0, RESOLVED_SHOWN);
  // A column's name sorts the table (owner 2026-11-25); none picked, the queue's own order, newest first.
  const [sort, setSort] = useState<ReviewSort | null>(null);
  const nameOfDraft = (draft: DraftRow, key: 'category' | 'paid') => {
    if (key === 'category') {
      const id = effectiveCategory(draft, guesses);
      return (id && accounts.find((a) => a.id === id)?.name) || '';
    }
    return paidWithOf(draft.accountId, draft.cardId, accounts, cards)?.name ?? '';
  };
  const listed = sortDrafts(tab === 'pending' ? queue : resolved, sort, nameOfDraft);
  // The header filters (owner 2026-11-24): for the visit only. The rows they leave out are out of reach — not recorded
  // by Record N, not picked, not peeked — until Show all.
  const [filters, setFilters] = useState<ReviewFilters>(NO_FILTERS);
  const [noteOpen, setNoteOpen] = useState(false);
  const filtering = anyFilter(filters);
  const setFilter = (patch: Partial<ReviewFilters>) => setFilters((now) => ({ ...now, ...patch }));
  const rows = filtering
    ? listed.filter((draft) =>
        matchesFilters(
          {
            occurredOn: draft.occurredOn,
            note: draft.description,
            line: [fromTag(draft, captureTypeOf(draft, sourceOf(draft))).word, captureRowView(draft, null).merged ?? ''].join(' '),
            categoryId: effectiveCategory(draft, guesses),
            accountId: draft.accountId,
            amountMinor: draft.amountMinor,
            currency: draft.currency,
          },
          filters,
        ),
      )
    : listed;
  const ids = rows.map((draft) => draft.id);
  // Record N records the ready rows shown, and only those.
  const ready = tab === 'pending' ? rows.filter((draft) => states.get(draft.id)?.ready) : [];
  // What the Category and Paid with headers offer: the ones the rows listed name, by name.
  const categoryChoices = useMemo(() => {
    const named = new Set(listed.map((draft) => effectiveCategory(draft, guesses)).filter((id): id is string => !!id));
    return accounts.filter((a) => named.has(a.id)).map((a) => ({ value: a.id, label: a.name })).sort((a, b) => a.label.localeCompare(b.label));
  }, [listed, guesses, accounts]);
  const paidChoices = useMemo(() => {
    const named = new Set(listed.map((draft) => draft.accountId).filter((id): id is string => !!id));
    return accounts.filter((a) => named.has(a.id)).map((a) => ({ value: a.id, label: a.name })).sort((a, b) => a.label.localeCompare(b.label));
  }, [listed, accounts]);

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
    // A row a filter hides puts the peek away; one gone from the queue hands it on.
    if (peekId && !ids.includes(peekId)) setPeekId(listed.some((draft) => draft.id === peekId) ? null : peekAfterGone(ids, peekAt.current));
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

  // Keys while a row is peeked: ⌘Return records it (when the peek may), ⌫ discards, ↑ ↓ step, Esc closes — never while
  // typing, or under a sheet or a picker.
  const keys = useRef<(event: KeyboardEvent) => void>(() => undefined);
  keys.current = (event: KeyboardEvent) => {
    // ⌘F: the Note header's search.
    if ((event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'f' && !document.querySelector('[role="dialog"]')) {
      event.preventDefault();
      setNoteOpen(true);
      return;
    }
    if (!peeked) return;
    const target = event.target as HTMLElement | null;
    // Space closes the peek (quick look's way, owner 2026-11-25), when no cells are picked and nothing is typed in.
    if (event.key === ' ' && !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey && !document.querySelector('[role="dialog"]')) {
      const typingNow = !!target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable || target.tagName === 'BUTTON');
      if (!typingNow) {
        event.preventDefault();
        setPeekId(null);
        return;
      }
    }
    const typing = !!target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable);
    // ⌘Return records the peeked row (owner, 2026-11-24): Return alone ends a cell's typing, as in Cashflow.
    const command = event.metaKey || event.ctrlKey;
    if (typing || event.altKey || document.querySelector('[role="dialog"]')) return;
    if (command !== (event.key === 'Enter')) return;
    const asked = queueKey(event.key);
    if (asked === null) return;
    // Return on a focused button is that button's own press.
    if (asked === 'record' && target?.tagName === 'BUTTON') return;
    event.preventDefault();
    if (asked === 'close') setPeekId(null);
    else if (asked === 'up') step(-1);
    else if (asked === 'down') step(1);
    else if (!peekedState) return;
    else if (asked === 'record' && peekedState.complete && busy === null) actions.onRecord(peeked);
    else if (asked === 'discard') actions.onDiscard(peeked);
  };
  useEffect(() => {
    const listen = (event: KeyboardEvent) => keys.current(event);
    document.addEventListener('keydown', listen);
    return () => document.removeEventListener('keydown', listen);
  }, []);

  /** ⌘Return in a row's cell: the capture as its cells now hold it, recorded when the peek could record it. */
  const recordRow = (draft: DraftRow) => {
    if (deskState(draft, sourceOf(draft), guesses, sharedEvents).complete) actions.onRecord(draft);
  };

  // What Cashflow's paste keeps on this device of its rows (`paste-categories`): a Paid with not in cicis yet, shown as pasted
  // (adding it is Cashflow's to offer).
  const pasteMarks = readMarks();
  const pendingOf = (draft: DraftRow) => {
    const text = pendingPaidOf(pasteMarks[draft.id], { accountId: draft.accountId ?? '' });
    return text ? { text: pendingPaidLabel(text), adds: [] } : null;
  };

  // The table's Undo and Redo (owner 2026-11-25): ⌘Z puts back the last change made in it, ⇧⌘Z makes it again.
  const undo = useUndoStack();
  useUndoKeys(undo);
  // Quick look (Space on picked cells, as Finder's): the peek follows the cell as the arrows move it.
  const [look, setLook] = useState(false);
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  // The blue cells: a range down one column of the queue (`review-cells`); starting one puts the peek away.
  const cells = useReviewCells({
    undo,
    onLook: (id) => {
      if (look) {
        setLook(false);
        setPeekId(null);
        return;
      }
      setLook(true);
      peek(id);
    },
    onMenu: setMenu,
    rows,
    pending: tab === 'pending',
    accounts,
    cards,
    guesses,
    onEdit: (draft, patch) => actions.onEdit(draft, patch, []),
    onPickAccount: (draft, accountId, cardId) => actions.onPickAccount(draft, 'money', accountId, cardId),
    onStart: () => setPeekId(null),
    // ⌘Return on picked cells records the ready captures they are in, as Record N does.
    onRecord: (picked) => {
      const fit = picked.filter((draft) => states.get(draft.id)?.ready);
      if (fit.length > 0 && busy === null) actions.onRecordReady(fit);
    },
  });

  const lookAt = cells.active ? (cells.range?.focus ?? null) : null;
  useEffect(() => {
    if (!look) return;
    if (!lookAt) setLook(false);
    else if (peekId !== lookAt) peek(lookAt);
  }, [look, lookAt]); // eslint-disable-line react-hooks/exhaustive-deps
  // The right-click menu (owner 2026-11-25): the cells' Copy and Paste, Open (the peek), and Discard for a waiting row.
  const rowMenu = (at: { id: string; x: number; y: number }) => {
    const draft = rows.find((one) => one.id === at.id);
    if (!draft) return null;
    const items: TableMenuItem[] = [];
    if (cells.active) {
      items.push({
        key: 'copy',
        label: 'Copy',
        keys: '⌘C',
        onPick: () => {
          copyToClipboard(cells.copied());
          cells.markCopied();
        },
      });
      if (tab === 'pending') items.push({ key: 'paste', label: 'Paste', keys: '⌘V', onPick: () => void pasteFromClipboard(cells.pasteText) });
    }
    items.push({ key: 'open', label: 'Open', keys: 'Space', divided: true, onPick: () => peek(draft.id) });
    if (tab === 'pending') items.push({ key: 'discard', label: 'Discard', keys: '⌫', danger: true, divided: true, onPick: () => actions.onDiscard(draft) });
    return <TableMenu x={at.x} y={at.y} items={items} onClose={() => setMenu(null)} />;
  };

  // The cells' choices, as Cashflow's rows offer them (money in's categories for a capture of income).
  // The cells wait (disabled) until the accounts are read: a list of no accounts would take nothing typed.
  const rowOptions = useRowOptions(accounts, cards, loaded && accounts.length > 0);
  const eventNameOf = (draft: DraftRow) => (draft.eventId ? (events.find((event) => event.id === draft.eventId)?.name ?? null) : null);

  // v1: three tiles over the queue — Waiting, Ready to record (with what they add up to) and Missing something.
  const missing = missingTile([...states.values()]);
  const readySum = readyTotal(ready);
  const titleLine = loaded ? `${counts.toReview} captured · ${counts.ready} ready to record` : undefined;
  const tableTitle = tab === 'pending' ? 'Captured' : SEGMENTS.find((s) => s.value === tab)!.label;
  const sortOf = (key: ReviewSort['key'], choices: ColumnSort['choices']): ColumnSort => ({ dir: sort?.key === key ? sort.dir : null, choices, onSort: (dir) => setSort({ key, dir }) });
  // Under the Amount column: the rows shown, and what they come to (owner 2026-11-25).
  const foot = totalFoot(sumFigures(rows.map(draftFigure), rows[0]?.currency ?? 'IDR'));
  // The column names stay on top while the queue scrolls under them.
  const head = useStuck<HTMLDivElement>();

  return (
    <div className="min-h-dvh bg-[var(--mk-page)]" data-testid="review-page" data-desk="true" {...doubleClick}>
      <DeskBar crumb="Review" barRef={bar}>
        <Seg label="Review view" options={SEGMENTS} value={tab} onChange={changeTab} />
        <button type="button" onClick={() => void navigate({ to: '/settings/capture' })} className={PILL}>
          Capture settings
        </button>
        <button type="button" disabled={scan.busy} onClick={scan.scan} className={PILL}>
          {scan.busy ? 'Reading the receipt…' : 'Scan a receipt'}
        </button>
        <Link to="/transactions/new" aria-label="Add transaction" className={PILL_BLUE}>
          <Plus size={13} strokeWidth={2.6} aria-hidden /> Add
        </Link>
      </DeskBar>
      {/* The app's notices, under the title bar rather than above it. */}
      <DeskNotices />
      <DeskTitle title="Review" line={titleLine} />

      <div className={cx('@container space-y-[16px] px-[32px] pt-[2px] pb-[32px]', peeking && PEEK_ROOM)}>
        <ErrorBox error={error} />
        {/* v2 keeps the five-count strip; the tiles then leave its test ids to it. */}
        {macV2 && <CountsBox counts={counts} loaded={loaded} />}
        <div className="[&>div]:mb-0">
          <TileRow count={3} testId="review-tiles">
            <StatTile
              icon={Bang}
              colour="orange"
              value={loaded ? counts.toReview : '–'}
              label="Waiting"
              testId="review-tile-waiting"
              valueTestId={macV2 ? undefined : 'review-to-review-count'}
            />
            <StatTile
              icon={Check}
              colour="blue"
              value={loaded ? counts.ready : '–'}
              label="Ready to record"
              testId="review-tile-ready"
              valueTestId={macV2 ? undefined : 'review-ready-count'}
              badge={readySum && readySum.minor > 0 ? <Tag tone="blue">{tileMoney(readySum.minor, readySum.currency)}</Tag> : undefined}
            />
            <StatTile
              icon={Question}
              colour="grey"
              value={loaded ? missing.count : '–'}
              label="Missing something"
              testId="review-tile-missing"
              badge={
                missing.parts.length > 0 ? (
                  <Tag tone="orange" testId="review-missing">
                    {/* One run of text: the tag is a flex box, which would drop the spaces between separate pieces. */}
                    <span>
                      {missing.parts.map((part, at) => (
                        <span key={part.key}>
                          {at > 0 && '\u00a0· '}
                          <span data-testid={macV2 ? undefined : MISSING_TEST_ID[part.key]}>{part.count}</span> {MISSING_WORD[part.key]}
                        </span>
                      ))}
                    </span>
                  </Tag>
                ) : undefined
              }
            />
          </TileRow>
        </div>

        <section className={cx(CARD, 'overflow-clip')} aria-label={tableTitle} data-testid="review-table">
          <h2 className={CARD_HEAD}>
            <Inbox size={17} strokeWidth={1.9} aria-hidden className="shrink-0" />
            <span className="shrink-0">{tableTitle}</span>
            {filtering && (
              <span className="shrink-0 text-[13px] font-medium text-[var(--mk-ink-2)]" data-testid="review-shown">
                {shownLine(rows.length, listed.length)} ·{' '}
                <button type="button" onClick={() => setFilters(NO_FILTERS)} className="font-semibold text-[var(--mk-blue)] hover:underline">
                  Show all
                </button>
              </span>
            )}
            <span className={CARD_NOTE} data-testid="table-note">
              {cells.hint ??
                (tab === 'pending'
                  ? 'Type in the cells · ⌘Return records · ⌫ discards · click a row to see what was captured'
                  : resolvedAll.length > resolved.length
                    ? `latest ${resolved.length} of ${resolvedAll.length}`
                    : 'kept so the same capture is not offered again')}
            </span>
            {tab === 'pending' && ready.length > 0 && (
              <button type="button" disabled={busy !== null} onClick={() => actions.onRecordReady(ready)} title="Records every ready row" className={PILL_BLACK}>
                Record {ready.length}
              </button>
            )}
          </h2>
          {cells.line}
          {/* Cashflow's table (owner, 2026-11-24): its columns, its 40px rows typed in place, the filters in the names. */}
          <div className="px-[10px]" style={{ '--desk-cols': peeking ? DESK_COLUMNS.peek : DESK_COLUMNS.wide } as CSSProperties}>
            <div ref={head.ref} className={cx(DESK_GRID, 'border-b border-[var(--mk-head-line)] px-0.5 text-left text-[12.5px] font-semibold text-[var(--mk-ink-2)]', stickyHead(head.stuck))} data-testid="review-head">
              <span>
                <span className="sr-only">Ready</span>
              </span>
              <span className="min-w-0 px-2 py-[8px]">
                <WhenHead from={filters.from} to={filters.to} today={isoDate()} sort={sortOf('date', SORT_WORDS.date)} onChange={(from, to) => setFilter({ from, to })} />
              </span>
              <span className="min-w-0 px-2 py-[8px]">
                <NoteHead value={filters.note} open={noteOpen} onOpen={() => setNoteOpen(true)} onClose={() => setNoteOpen(false)} onChange={(note) => setFilter({ note })} />
              </span>
              <span className="min-w-0 px-2 py-[8px]">
                <ChoiceHead name="Category" noneLabel="No category" value={filters.category} options={categoryChoices} sort={sortOf('category', SORT_WORDS.words)} onChange={(category) => setFilter({ category })} />
              </span>
              <span className="min-w-0 px-2 py-[8px]">
                <ChoiceHead name="Paid with" noneLabel="No account" value={filters.paid} options={paidChoices} sort={sortOf('paid', SORT_WORDS.words)} onChange={(paid) => setFilter({ paid })} />
              </span>
              <span className="min-w-0 px-2 py-[8px] text-right">
                <ColumnHead
                  name="Amount"
                  align="right"
                  chevron
                  sort={sortOf('amount', SORT_WORDS.amount)}
                  amount={{ filter: filters.amount, currency: rows[0]?.currency ?? listed[0]?.currency ?? 'IDR', onChange: (amount) => setFilter({ amount }) }}
                />
              </span>
              <span />
            </div>
            <ul aria-label={tableTitle} {...cells.containerProps} className="text-[13px]">
              {loaded && rows.length === 0 && filtering && listed.length > 0 && (
                <li className="list-none border-b border-[var(--mk-line)] px-3 py-6 text-center text-[13.5px] text-[var(--mk-ink-2)]">No rows match the filters.</li>
              )}
              {loaded && listed.length === 0 && (
                <li className="list-none border-b border-[var(--mk-line)] px-3 py-6 text-center text-[13.5px] text-[var(--mk-ink-2)]">
                  {tab === 'pending'
                    ? 'Nothing waiting. Captured spending appears here before it reaches the accounts.'
                    : tab === 'confirmed'
                      ? 'Nothing recorded from Review yet.'
                      : 'Nothing discarded.'}
                </li>
              )}
              {rows.map((draft) => {
                const categoryId = effectiveCategory(draft, guesses);
                if (tab !== 'pending')
                  return (
                    <ResolvedRow
                      key={draft.id}
                      draft={draft}
                      categoryId={categoryId}
                      accounts={accounts}
                      cards={cards}
                      pickedCell={cells.cellPick(draft.id)}
                      peeked={peekId === draft.id}
                      onPeek={() => peek(draft.id)}
                    />
                  );
                const state = states.get(draft.id);
                return (
                  <ReviewRow
                    key={draft.id}
                    draft={draft}
                    ready={!!state?.ready}
                    categoryId={categoryId}
                    guessed={!draft.categoryAccountId && categoryId ? 'Category guessed from the last time this was bought here' : null}
                    options={draft.kind === 'income' ? rowOptions.income : rowOptions.expense}
                    pickedCell={cells.cellPick(draft.id)}
                    peeked={peekId === draft.id}
                    busy={busy === draft.id}
                    pendingPaid={pendingOf(draft)}
                    toCell={draft.kind === 'transfer' ? <ToAccountCell draft={draft} accounts={accounts} cards={cards} onPick={(pick) => setPicking({ draftId: draft.id, pick })} /> : null}
                    onPeek={() => peek(draft.id)}
                    onOpen={() => actions.onOpenForm(draft)}
                    onSave={(values) => cells.saveRow(draft, values)}
                    onRecord={(now) => recordRow(now)}
                  />
                );
              })}
            </ul>
            {rows.length > 0 && (
              <div data-testid="table-total" className="flex items-baseline justify-between px-[10px] pt-[10px] pb-[2px] text-[12.5px] text-[var(--mk-ink-2)] tabular-nums">
                <span>{foot.shown}</span>
                {foot.total && (
                  <span>
                    Total <b className="ml-[6px] text-[14px] font-bold text-[var(--mk-ink)]">{foot.total}</b>
                  </span>
                )}
              </div>
            )}
          </div>
          {tab === 'pending' && rows.length > 0 && (
            <p className="flex items-center gap-[18px] px-[20px] pt-[10px] pb-[12px] text-[12.5px] text-[var(--mk-ink-2)]" data-testid="review-legend">
              <span className="inline-flex items-center gap-[6px]">
                <TickCircle ready label={false} /> Ready
              </span>
              <span className="inline-flex items-center gap-[6px]">
                <TickCircle ready={false} label={false} /> Missing something
              </span>
            </p>
          )}
          {tab === 'pending' && <SkippedFold />}
          {tab !== 'pending' && <div className="h-[10px]" />}
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
          onClose={() => {
            setLook(false);
            setPeekId(null);
          }}
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

      {cells.bulkField}
      {menu && rowMenu(menu)}
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
        {/* Plain ink: a row with no category records under Uncategorised, so this is a count to fix later, not a block. */}
        {figure('No category', counts.needCategory, undefined, 'review-need-category')}
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
    <div className="border-t border-[var(--mk-line)]">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((was) => !was)}
        className="w-full px-[20px] pt-[10px] pb-[10px] text-left text-[11.5px] font-bold tracking-[0.04em] text-[var(--mk-ink-2)] uppercase hover:text-[var(--mk-ink)]"
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
      title={draft.kind === 'transfer' ? 'From' : draft.kind === 'income' ? 'Received into' : 'Payment method'}
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
