import { formatMinor, matchesSearch, statementCycleFor } from '@expanses/core';
import { type AccountRow, billOnNextStatement, cardPaymentSource, cardStatement, cardStatementLines, type CardRow, carriesPaidOffMark, setPlanPaidSoFar, setPostedOn, setSettledBeforeApp, setTransactionsCard, type StatementLine } from '@expanses/db';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { ArrowDown, Banknote, CalendarArrowUp, CalendarRange, Check, CircleCheck, CircleX, CreditCard, Ellipsis, Receipt, RotateCcw, Undo2, X } from 'lucide-react';
import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { Sheet } from '../../app/Sheet';
import { usePhone } from '../../app/use-phone';
import { useApp } from '../../app/context';
import { useInvalidateAll } from '../../lib/queries';
import { cx, ErrorBox } from '../../ui';
import { ToastCard } from '../../ui/UndoToast';
import { InsetGroup, InsetRow, Panel } from '../../ui/native';
import { ActionRow, EARLIER, GlyphButton, Line, StepperRow, SUBTITLE, TITLE } from './rows';
import { WorkspaceBadge } from '../workspaces/WorkspaceBadge';
import { useWorkspaceBadges } from '../workspaces/queries';
import { StatementBand } from './StatementBand';
import { cycleBack } from './statement-dates';
import { groupStatementLines } from './statement-groups';
import { isCharge, type LineCover, paidCountText, paidHowText, payableLine, showsPaid, statementCover } from './statement-cover';
import { statementPayLink } from './card-pay';
import { CardSheet } from './CardSheet';
import { type BubbleAction, PaidBubble } from './PaidBubble';
import { isPaymentLine, type PaidEntry, paidFootText, statementPaid } from './statement-payments';
import { SELECT_CIRCLE, SelectBarFrame } from '../transactions/SelectBar';
import { formatPoints } from './useCardPoints';
import { takeCheckedNote } from '../statement-check/batch';

/** Points worked out for one purchase, with its merchant category code, for the statement's points column. */
export interface StatementPoints {
  points: number;
  approximate: boolean;
  mcc: string | null;
  cardFee: boolean;
}

/**
 * The one paid look (owner, 21 Nov 2026): a solid green circle with a white ✓, whether the purchase was paid one by one,
 * covered by a payment, paid off before the app, settled or ticked paid on its plan. How it was paid is not on the row:
 * a tap on the ✓ opens a small bubble that says it (`paidHowText`, mockup A), and the ✓ wears a faint ring meanwhile.
 */
function PaidTick({ open = false }: { open?: boolean }) {
  return (
    <span aria-hidden className={cx('flex h-[18px] w-[18px] items-center justify-center rounded-full bg-[var(--ph-up)] text-white', open && 'shadow-[0_0_0_4px_var(--ph-up-ring)]')}>
      <Check size={11} strokeWidth={3.5} aria-hidden />
    </span>
  );
}

const day = (date: string) => new Date(`${date}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
const dayYear = (date: string) => new Date(`${date}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

/** What Assign card does, said under its list of cards. */
const assignFooter = (count: number) =>
  count === 1 ? 'The purchase under Card not recorded is set to the card picked.' : `The ${count} purchases under Card not recorded are set to the card picked.`;

/**
 * A card's statements: what each one charged and closed at, what is left to pay, purchases the bank billed
 * a statement late, and purchases paid before their statement came.
 */
export function StatementPanel({
  card,
  statementDay,
  accounts,
  plastic,
  today,
  points,
  unit = 'points',
  back,
  onBack,
  query,
  onQuery,
  onOpened,
}: {
  card: AccountRow;
  statementDay: number;
  accounts: readonly AccountRow[];
  plastic: readonly CardRow[];
  today: string;
  /** Points per purchase, when the card has rewards; purchases outside the worked-out cycles show none. */
  points?: Readonly<Record<string, StatementPoints>>;
  unit?: string;
  /** How many statements back from the current one is on screen. Held by the page, whose title links to the check of it. */
  back: number;
  onBack: (back: number | ((was: number) => number)) => void;
  /** The search over every statement, typed in the title bar's field. */
  query: string;
  onQuery: (query: string) => void;
  /** A search hit was opened: the page puts the field away, the bar back. */
  onOpened?: () => void;
}) {
  const { database, ws } = useApp();
  const phone = usePhone();
  const navigate = useNavigate();
  const invalidate = useInvalidateAll();
  const setBack = onBack;
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const setQuery = onQuery;
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  // The paid-off purchase whose ✓ was tapped: the sheet that offers to take it back.
  const [unmarking, setUnmarking] = useState<StatementLine | null>(null);
  // The purchases under Card not recorded, while the sheet that sets their card is up.
  const [assigning, setAssigning] = useState<readonly StatementLine[] | null>(null);
  // The line whose ⋯ was tapped on a phone: the sheet listing what can be done to it.
  const [acting, setActing] = useState<StatementLine | null>(null);
  // The paid line whose ✓ was tapped, and that ✓: the bubble saying how it was paid hangs from it. One at a time.
  const [bubble, setBubble] = useState<{ key: string; anchor: HTMLElement } | null>(null);
  // The sheet the totals box's Paid opens: the statement's payments, kept off its list.
  const [paidOpen, setPaidOpen] = useState(false);

  const cycle = cycleBack(today, statementDay, back);
  const statement = useQuery({
    queryKey: ['card-statement', ws.workspaceId, card.id, cycle.start, today],
    queryFn: () => cardStatement(database, ws, card.id, cycle, today),
  });

  const currency = card.currency ?? ws.baseCurrency;
  const money = (minor: number) => formatMinor(minor, currency);
  // Back from a check: what it came to, said once.
  const [note] = useState(takeCheckedNote);
  const [noteShown, setNoteShown] = useState(note !== null);
  useEffect(() => {
    if (!noteShown) return;
    const timer = window.setTimeout(() => setNoteShown(false), 4000);
    return () => window.clearTimeout(timer);
  }, [noteShown]);
  const last4 = (cardId: string | null) => plastic.find((piece) => piece.id === cardId)?.last4;
  /** A card fee, or an MCC the owner set; nothing for a guessed MCC or a plan's rows. */
  // Short, the way statements print it: 126 PTS.
  const unitShort = unit === 'points' ? 'PTS' : unit.toUpperCase();
  const tagFor = (line: StatementLine) => {
    const info = line.instalment || line.convertedTo ? undefined : points?.[line.transactionId];
    return info?.cardFee ? 'Card fee' : info?.mcc ? `MCC ${info.mcc}` : null;
  };
  // What the card's payments cover, oldest first: worked out by the ledger with the statement, never stored.
  const cover = useMemo<ReadonlyMap<string, LineCover>>(() => (statement.data ? statementCover(statement.data) : new Map()), [statement.data]);
  const coveredWhole = (line: StatementLine) => cover.get(line.key)?.whole === true;
  /*
   * An instalment of a plan with no purchase (0124): its ✓ is the plan's Paid list's. Ticked, it and every one before it
   * are paid; only the latest ticked can be unticked, which leaves the ones before it paid.
   */
  const planRow = (line: StatementLine) => line.instalment?.noPurchase === true;
  const latestTicked = (line: StatementLine) => planRow(line) && line.paidOff && line.instalment!.number === line.instalment!.paidSoFar;
  // A charge that shows as paid either way has its amount greyed; so does a plan's instalment ticked paid.
  const done = (line: StatementLine) => (isCharge(line) && showsPaid(line, cover)) || (planRow(line) && line.paidOff);
  // A plan's instalments and the purchase it replaced are paid through the plan, not ticked off here; a purchase a
  // payment already covers is paid, so it cannot be ticked to be paid twice.
  const payable = (line: StatementLine) => payableLine(line, cover);
  /*
   * What can be marked settled before the app: a purchase there is still something to pay for, or money back (a
   * refund) whose credit was used up before the app — left standing, it would sit on the card as a credit for ever.
   * The receipt asks the ledger the same question (`paidOffMarkOf`), so the two never offer it differently.
   */
  const settleable = (line: StatementLine) => (carriesPaidOffMark(line) || planRow(line)) && !line.paidOff && !coveredWhole(line);
  const settledWord = (line: StatementLine) => (planRow(line) ? 'paid' : line.owedMinor < 0 ? 'settled' : 'paid off');
  /** The swipe's and the ⋯'s word for the mark. */
  const markWord = (line: StatementLine) => (planRow(line) ? 'Paid' : line.owedMinor < 0 ? 'Settled' : 'Paid off');
  /** Whether a line's mark can be taken back here: any paid-off purchase, and a plan's latest ticked instalment. */
  const unmarkable = (line: StatementLine) => line.paidOff && (!planRow(line) || latestTicked(line));
  /** Takes the mark back: a purchase is owed again; a plan's instalment is unticked, those before it stay paid. */
  const unmark = (line: StatementLine) =>
    run(() => (planRow(line) ? setPlanPaidSoFar(database, ws, line.instalment!.planId, line.instalment!.number - 1) : setSettledBeforeApp(database, ws, line.transactionId, false)));
  // Billed a statement late: the bank's posting date put it on a later statement than its purchase date.
  const lateOf = (line: StatementLine) => line.postedOn !== null && line.occurredOn < cycle.start;
  // Whether the fix that moves a purchase to the next statement applies: the phone's icon, the table's and the ⋯ agree.
  const billableNext = (line: StatementLine) => line.spending && line.owedMinor > 0 && !lateOf(line) && !line.instalment && !line.convertedTo;
  // Whether Assign card applies: the account has more than one card, and this purchase names none of them.
  // A plan bought before the card's records has no purchase here to set a card on (TF 136).
  const assignable = (line: StatementLine) => line.spending && !line.instalment?.noPurchase && plastic.length > 1 && !plastic.some((piece) => piece.id === line.cardId);
  const lines = statement.data?.lines ?? [];
  const chosen = lines.filter((line) => selected.has(line.transactionId) && payable(line));
  // Payments are kept off the list (owner, 21 Nov 2026): it holds what was charged and money back. Paid opens them.
  const shown = lines.filter((line) => !isPaymentLine(line));
  // One statement, split by card when the account carries more than one, the way the bank prints it.
  const groups = groupStatementLines(shown, plastic);
  const grouped = groups.length > 0 && groups[0]!.title !== null;

  // Ticking a plan's instalment ticks it and every one before it, as its Paid list does.
  const markPaidOff = (line: StatementLine) =>
    void run(() => (planRow(line) ? setPlanPaidSoFar(database, ws, line.instalment!.planId, line.instalment!.number) : setSettledBeforeApp(database, ws, line.transactionId, true)));

  async function run(work: () => Promise<unknown>) {
    setError(null);
    setBusy(true);
    try {
      await work();
      await invalidate();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  const toggle = (id: string) =>
    setSelected((was) => {
      const next = new Set(was);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const s = statement.data;

  // Searching looks through every statement the card has had, not only the one on screen.
  const searching = query.trim() !== '';
  const everything = useQuery({
    queryKey: ['card-statement-lines', ws.workspaceId, card.id],
    enabled: searching,
    queryFn: () => cardStatementLines(database, ws, card.id),
  });
  // Instalments are worked out for every month of a plan; only statements that exist so far are searched.
  const currentEnd = cycleBack(today, statementDay, 0).end;
  const found = searching
    ? (everything.data ?? [])
        .filter((line) => line.statementOn <= currentEnd)
        .filter((line) =>
          matchesSearch(
            {
              text: [line.description, points?.[line.transactionId]?.mcc ? `MCC ${points[line.transactionId]!.mcc}` : null, plastic.find((piece) => piece.id === line.cardId)?.holderName, line.originalCurrency],
              amountMinor: Math.abs(line.owedMinor),
              last4: last4(line.cardId),
            },
            query,
          ),
        )
        .reverse()
    : [];
  const statementOf = (line: StatementLine) => statementCycleFor(line.statementOn, statementDay);
  // A card is yours, not a workspace's, so its statement holds every workspace and each row says which. The
  // searched rows are asked for alongside the statement's, so a hit found under a different workspace says so too.
  const badgeOf = useWorkspaceBadges([...lines, ...found].map((line) => line.transactionId)).mark;
  function openStatementOf(line: StatementLine) {
    // Count back from the statement today is in to the one this line was billed on.
    let steps = 0;
    let cycle = cycleBack(today, statementDay, 0);
    while (line.statementOn < cycle.start && steps < 600) {
      steps += 1;
      cycle = cycleBack(today, statementDay, steps);
    }
    setBack(steps);
    setQuery('');
    onOpened?.();
  }
  /** A line's amount, signed the way a statement prints it: money back is green and has a minus; a paid charge is grey. */
  const amount = (line: StatementLine, done = false) => (
    <>
      <span className={cx('tabular block whitespace-nowrap', line.owedMinor < 0 && 'text-[var(--ph-up)]', done && 'text-[var(--ph-ink-3)]', line.convertedTo && 'line-through')}>
        {line.owedMinor < 0 ? `−${money(-line.owedMinor)}` : money(line.owedMinor)}
      </span>
      {line.originalCurrency && line.originalAmountMinor !== null && (
        <span className="tabular block text-[11.5px] leading-[14px] whitespace-nowrap text-[var(--ph-ink-3)]" data-testid="statement-original">
          {formatMinor(line.originalAmountMinor, line.originalCurrency)}
        </span>
      )}
    </>
  );

  /*
   * A paid line's ✓ is a button, not a switch: a tap opens the bubble saying how it was paid, and taps it shut again.
   * Its name carries the same words, so a screen reader hears them without opening it. Every way of paying wears it.
   */
  const paidButton = (line: StatementLine, testId: string) => {
    const words = paidHowText(line, cover) ?? 'Paid';
    const open = bubble?.key === line.key;
    return (
      <button
        type="button"
        aria-label={`${line.description}, ${words}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        // A mouse can read the words on hover; a click opens the bubble.
        title={phone ? undefined : words}
        data-testid={testId}
        onClick={(event) => {
          const anchor = event.currentTarget;
          setBubble((was) => (was?.key === line.key ? null : { key: line.key, anchor }));
        }}
        className="ph-focus flex h-[44px] w-[32px] shrink-0 items-center justify-center"
      >
        <PaidTick open={open} />
      </button>
    );
  };

  /** A purchase already paid stays ticked and cannot be unticked; deleting its payment frees it again. */
  const tick = (line: StatementLine) =>
    // Covered by a payment, paid off before the app (or settled, or a plan's instalment ticked paid), paid one by one.
    coveredWhole(line) ? (
      paidButton(line, 'statement-covered')
    ) : line.paidOff ? (
      paidButton(line, 'statement-paid-off')
    ) : line.paidBy ? (
      paidButton(line, 'statement-paid-by')
    ) : (
    // The label is the circle's reach: an 18 px circle inside a 44 pt target, the size of the paid ✓. The checkbox is
    // still the real control, laid invisibly under it; what is drawn is an empty ring, filled with a ✓ once chosen.
    <label className={cx('relative flex h-[44px] w-[32px] shrink-0 items-center justify-center', !payable(line) && 'invisible')}>
      <input
        type="checkbox"
        className="peer ph-focus absolute inset-0 h-full w-full cursor-pointer opacity-0 disabled:cursor-default"
        disabled={!payable(line)}
        checked={selected.has(line.transactionId)}
        onChange={() => toggle(line.transactionId)}
        aria-label={`Pay ${line.description}`}
      />
      {/* A line picked to pay is an ink ring with a ✓, not filled. */}
      <span
        aria-hidden
        className="flex h-[18px] w-[18px] items-center justify-center rounded-full border-[1.5px] border-[var(--ph-ink-3)] text-transparent peer-checked:border-[var(--ph-ink)] peer-checked:text-[var(--ph-ink)] peer-disabled:opacity-60"
      >
        <Check size={11} strokeWidth={3.5} aria-hidden />
      </span>
    </label>
    );

  const categoryNameOf = (id: string | null | undefined) => (id ? (accounts.find((account) => account.id === id)?.name ?? null) : null);
  /** The plan an instalment row belongs to, on its own page: the row is tapped to get there. */
  const openPlan = (line: StatementLine) => {
    if (line.instalment) void navigate({ to: '/cards/$cardId/settings/instalments/$planId', params: { cardId: card.id, planId: line.instalment.planId } });
  };
  /** "1 of 12" beside an instalment row's name. */
  const pill = (line: StatementLine) =>
    line.instalment ? (
      <span data-testid="instalment-pill" className="tabular ml-[6px] rounded-full bg-[var(--ph-fill)] px-[6px] py-[1px] align-[1px] text-[12px] leading-[16px] font-medium text-[var(--ph-ink-2)]">
        {line.instalment.number} of {line.instalment.of}
      </span>
    ) : null;

  /** What else the statement says about a line, after its description: plan, conversion, payment, card, tag. */
  const notes = (line: StatementLine): ReactNode[] => {
    const out: ReactNode[] = [];
    // One purchase split across workspaces is one charge here, as the bank prints it: its line names every part.
    if (line.splitCategories) out.push(line.splitCategories.join(' · '));
    // An instalment row names the purchase's category, as a purchase row on Cashflow does; its "1 of 12" is a pill.
    if (line.instalment) out.push([categoryNameOf(line.instalment.categoryId), 'instalment'].filter(Boolean).join(' · '));
    if (line.convertedTo) out.push(`converted to ${line.convertedTo.months} months, billed monthly`);
    // How a paid line was paid is in its ✓'s bubble; part covered says how much is left to pay.
    const covered = cover.get(line.key);
    if (covered && !covered.whole && covered.coveredMinor > 0) out.push(`${money(covered.coveredMinor)} covered, ${money(covered.leftMinor)} left`);
    // A payment made for chosen purchases says so, so a batch can be told from a bill payment.
    if (line.settles > 0) out.push(`for ${line.settles} purchase${line.settles === 1 ? '' : 's'}`);
    if (!grouped && last4(line.cardId)) out.push(<span className="tabular font-semibold">···· {last4(line.cardId)}</span>);
    const tag = tagFor(line);
    if (tag) out.push(tag);
    return out;
  };

  const pointsOf = (line: StatementLine) =>
    !line.instalment && points?.[line.transactionId] ? `${points[line.transactionId]!.approximate ? '≈ ' : ''}${formatPoints(points[line.transactionId]!.points)} ${unitShort}` : '';

  /** The two fixes a line can take: billed a statement late, or back to the day it was bought. */
  const fixes = (line: StatementLine, late: boolean) => (
    <span className="flex shrink-0 justify-end">
      {billableNext(line) && (
        <GlyphButton
          label="Billed next statement"
          hint="Billed next statement: the bank posted it after the statement date"
          glyph={<CalendarArrowUp size={17} aria-hidden />}
          disabled={busy}
          onClick={() => void run(() => billOnNextStatement(database, ws, card.id, line.transactionId))}
        />
      )}
      {line.postedOn && (
        <GlyphButton
          label="Use purchase date"
          hint={`${late ? 'Billed late' : 'Posted'} on ${day(line.postedOn)}. Use purchase date instead`}
          glyph={<Undo2 size={17} aria-hidden />}
          disabled={busy}
          onClick={() => void run(() => setPostedOn(database, ws, line.transactionId, null))}
        />
      )}
    </span>
  );

  /**
   * A line on a phone: a row. The tick and the two fixes are controls of their own beside the text, so this is
   * drawn from the kit's parts rather than as an `InsetRow`, which holds one target and nothing inside it.
   */
  const statementRow = (line: StatementLine) => {
    const extra = notes(line);
    const earned = points ? pointsOf(line) : '';
    return (
      <Line
        key={line.key}
        tight
        testId="statement-line"
        className={cx('flex items-center gap-[6px]', line.convertedTo && 'opacity-60')}
        // A purchase there is still something to pay for can be marked paid off before the app with a left swipe;
        // a refund whose credit was used before the app is marked settled the same way.
        leftActions={
          settleable(line)
            ? [
                {
                  label: markWord(line),
                  name: `Mark ${line.description} already ${settledWord(line)}`,
                  icon: Check,
                  tone: 'primary',
                  disabled: busy,
                  onPress: () => markPaidOff(line),
                },
              ]
            : undefined
        }
      >
        {tick(line)}
        <span
          className={cx('min-w-0 flex-1 py-[10px]', line.instalment && 'ph-focus-inset cursor-pointer')}
          // An instalment row opens its plan, where its months, what is paid and how it counts are.
          {...(line.instalment
            ? { role: 'link', tabIndex: 0, 'aria-label': `Open the plan for ${line.description}`, onClick: () => openPlan(line), onKeyDown: (e: { key: string }) => e.key === 'Enter' && openPlan(line) }
            : {})}
        >
          <span className={cx('block truncate', TITLE)}>
            {line.description}
            {pill(line)}
            {/* Whose spending this is, when the card has been used from more than one workspace. */}
            <WorkspaceBadge book={badgeOf(line.transactionId)} />
          </span>
          <span className={cx('mt-[2px] block truncate', SUBTITLE)}>
            <span className="tabular">{day(line.occurredOn)}</span>
            {extra.map((note, index) => (
              <span key={index}> · {note}</span>
            ))}
            {points && earned && (
              <span className="tabular text-[var(--ph-up)]" data-testid="statement-points">
                {' · '}
                {earned}
              </span>
            )}
          </span>
        </span>
        <span className="shrink-0 text-right text-[15px] leading-[20px] text-[var(--ph-ink)]">{amount(line, done(line))}</span>
        {/* The row's actions, found without a swipe: the ⋯ at its end lists what the swipe and the ✓ offer, and the receipt. */}
        <GlyphButton label={`Actions for ${line.description}`} glyph={<Ellipsis size={17} aria-hidden />} disabled={busy} onClick={() => setActing(line)} />
      </Line>
    );
  };

  /**
   * The lines on a desktop: a table, which is what a statement is. Every column the phone folds into its subtitle
   * has a column of its own here, and the fixes stay at the row's end.
   */
  const table = (lines: readonly StatementLine[]) => (
    <table className="w-full border-collapse text-[14px]">
      <thead>
        <tr className="text-[11.5px] font-semibold tracking-[0.06em] text-[var(--ph-ink-3)] uppercase">
          <th scope="col" className="w-[44px] border-b-[0.5px] border-[var(--ph-hair)] py-[8px] pl-[6px]">
            <span className="sr-only">Pay</span>
          </th>
          <th scope="col" className="border-b-[0.5px] border-[var(--ph-hair)] px-[8px] py-[8px] text-left">Date</th>
          <th scope="col" className="border-b-[0.5px] border-[var(--ph-hair)] px-[8px] py-[8px] text-left">Description</th>
          {points && <th scope="col" className="border-b-[0.5px] border-[var(--ph-hair)] px-[8px] py-[8px] text-right">{unit}</th>}
          <th scope="col" className="border-b-[0.5px] border-[var(--ph-hair)] px-[8px] py-[8px] text-right">Amount</th>
          <th scope="col" className="w-[92px] border-b-[0.5px] border-[var(--ph-hair)] py-[8px] pr-[4px]">
            <span className="sr-only">Fix</span>
          </th>
        </tr>
      </thead>
      <tbody>
        {lines.map((line) => {
          const late = lateOf(line);
          const extra = notes(line);
          return (
            <tr key={line.key} data-testid="statement-line" className={cx('border-t-[0.5px] border-[var(--ph-hair)] first:border-t-0', line.convertedTo && 'opacity-60')}>
              <td className="pl-[6px] align-middle">{tick(line)}</td>
              <td className="tabular px-[8px] align-middle whitespace-nowrap text-[var(--ph-ink-3)]">{day(line.occurredOn)}</td>
              <td className="px-[8px] py-[8px] align-middle">
                <span className="block text-[15px] leading-[20px] text-[var(--ph-ink)]">
                  {line.instalment ? (
                    <button type="button" className="ph-focus text-left text-[var(--ph-ink)] hover:underline" onClick={() => openPlan(line)}>
                      {line.description}
                    </button>
                  ) : (
                    line.description
                  )}
                  {pill(line)}
                  <WorkspaceBadge book={badgeOf(line.transactionId)} />
                </span>
                {extra.length > 0 && (
                  <span className={cx('block', SUBTITLE)}>
                    {extra.map((note, index) => (
                      <span key={index}>
                        {index > 0 && ' · '}
                        {note}
                      </span>
                    ))}
                  </span>
                )}
              </td>
              {points && (
                <td className="tabular px-[8px] text-right align-middle text-[12.5px] whitespace-nowrap text-[var(--ph-up)]" data-testid="statement-points">
                  {pointsOf(line)}
                </td>
              )}
              <td className="px-[8px] text-right align-middle text-[15px] leading-[20px] text-[var(--ph-ink)]">{amount(line, done(line))}</td>
              <td className="pr-[4px] align-middle">
                <span className="flex justify-end">
                  {/* A mouse has no swipe: the phone's left-swipe Paid off sits with the fixes. */}
                  {settleable(line) && (
                    <GlyphButton
                      label={`Mark ${line.description} already ${settledWord(line)}`}
                      hint={
                        planRow(line)
                          ? 'Paid: this instalment and every one before it'
                          : line.owedMinor < 0
                            ? 'Credit used up before the app: nothing to take off the bill'
                            : 'Already paid off before the app: nothing to pay'
                      }
                      glyph={<CircleCheck size={17} aria-hidden />}
                      disabled={busy}
                      onClick={() => markPaidOff(line)}
                    />
                  )}
                  {fixes(line, late)}
                </span>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );

  const stepper = (
    <StepperRow
      testId="statement-range"
      earlier={{ label: 'Earlier statement', glyph: EARLIER, onClick: () => setBack((b) => b + 1) }}
      later={{ label: 'Later statement', onClick: () => setBack((b) => Math.max(0, b - 1)) }}
      laterDisabled={back === 0}
    >
      {day(cycle.start)} – {dayYear(cycle.end)}
    </StepperRow>
  );

  /*
   * The open bubble's line, and what it says beyond the words: the covering payment's amount and the account it came
   * from, the amount of the payment that paid a purchase one by one, the money back that covered it. Its buttons open
   * that payment, or take a paid-off mark back through the same sheet the ⋯ offers.
   */
  const bubbleLine = bubble ? (lines.find((line) => line.key === bubble.key) ?? null) : null;
  const coverOf = bubbleLine ? cover.get(bubbleLine.key) : undefined;
  const coveredBy = bubbleLine && coverOf?.whole && coverOf.creditCount <= 1 ? coverOf.by : null;
  const paymentId = coveredBy ? (coveredBy.spending ? null : coveredBy.transactionId) : bubbleLine && !coverOf?.whole && !bubbleLine.paidOff ? (bubbleLine.paidBy?.transactionId ?? null) : null;
  const source = useQuery({
    queryKey: ['card-payment-source', ws.workspaceId, card.id, paymentId],
    enabled: paymentId !== null,
    queryFn: () => cardPaymentSource(database, ws, card.id, paymentId!),
  });
  // A line paged or searched away closes its bubble.
  useEffect(() => {
    if (bubble && (!bubbleLine || searching)) setBubble(null);
  }, [bubble, bubbleLine, searching]);
  const from = paymentId && source.data?.fromName ? ` from ${source.data.fromName}` : '';
  const bubbleDetail = coveredBy
    ? coveredBy.spending
      ? `${money(-coveredBy.owedMinor)} · ${coveredBy.description}`
      : `${money(-coveredBy.owedMinor)}${from}`
    : paymentId && source.data
      ? `${money(source.data.amountMinor)}${from}`
      : null;
  const openTx = (transactionId: string) => {
    setBubble(null);
    void navigate({ to: '/transactions/$transactionId', params: { transactionId } });
  };
  const bubbleActions: BubbleAction[] = [];
  if (coveredBy) bubbleActions.push({ label: coveredBy.spending ? 'Open refund' : 'Open payment', onPress: () => openTx(coveredBy.transactionId) });
  else if (paymentId) bubbleActions.push({ label: 'Open payment', onPress: () => openTx(paymentId) });
  if (bubbleLine && !coverOf?.whole && unmarkable(bubbleLine)) {
    const line = bubbleLine;
    bubbleActions.push({
      label: planRow(line) ? 'Not paid' : line.owedMinor < 0 ? 'Not settled' : 'Not paid off',
      tone: 'alarm',
      disabled: busy,
      onPress: () => {
        setBubble(null);
        setUnmarking(line);
      },
    });
  }

  /*
   * What Paid opens: the payments behind the figure and, on a closed statement, the ones made between its dates. Where
   * each came from is asked only once the sheet is open.
   */
  const paid = s ? statementPaid(s) : null;
  const paidCount = paid ? paid.entries.length + paid.during.length : 0;
  const paymentIds = paidOpen && paid ? [...paid.entries, ...paid.during].filter((entry) => !entry.refund).map((entry) => entry.line.transactionId) : [];
  const sources = useQuery({
    queryKey: ['card-payment-sources', ws.workspaceId, card.id, paymentIds],
    enabled: paymentIds.length > 0,
    queryFn: async () => Object.fromEntries(await Promise.all(paymentIds.map(async (id) => [id, await cardPaymentSource(database, ws, card.id, id)] as const))),
  });
  // Another statement, or a search, puts the sheet away.
  useEffect(() => setPaidOpen(false), [cycle.start, searching]);
  const foot = sources.data ? paidFootText(paymentIds.map((id) => sources.data[id]?.fromName ?? null)) : null;
  const openTransaction = (transactionId: string) => {
    setPaidOpen(false);
    void navigate({ to: '/transactions/$transactionId', params: { transactionId } });
  };
  /** One payment or money back in the Paid sheet, and under a payment the bank posted late, the way to put it back. */
  const paidRow = (entry: PaidEntry) => {
    const { line } = entry;
    const from = sources.data?.[line.transactionId]?.fromName;
    const subtitle = [
      day(line.occurredOn),
      entry.refund ? 'counts as paid' : from ? `from ${from}` : null,
      line.settles > 0 ? `for ${line.settles} purchase${line.settles === 1 ? '' : 's'}` : null,
      entry.countedMinor < entry.wholeMinor ? `part of ${money(entry.wholeMinor)}` : null,
      line.postedOn ? `posted ${day(line.postedOn)}` : null,
    ]
      .filter(Boolean)
      .join(' · ');
    const row = (
      <InsetRow
        key={line.key}
        testId="statement-paid-entry"
        icon={entry.refund ? <RotateCcw size={15} strokeWidth={2.5} aria-hidden /> : <ArrowDown size={15} strokeWidth={2.5} aria-hidden />}
        iconColour={entry.refund ? 'var(--ph-up)' : 'var(--ph-dot)'}
        title={line.description}
        subtitle={subtitle}
        value={entry.refund ? `−${money(entry.countedMinor)}` : money(entry.countedMinor)}
        valueTone="ink"
        plain
        onClick={() => openTransaction(line.transactionId)}
      />
    );
    // The bank's posting date moved it to this statement: the fix its ⋯ offered on the list, kept here.
    return line.postedOn
      ? [
          row,
          <ActionRow
            key={`${line.key}-date`}
            label={`Use payment date for ${line.description}`}
            disabled={busy}
            onClick={() => void run(() => setPostedOn(database, ws, line.transactionId, null))}
          />,
        ]
      : [row];
  };

  const subtotal = (minor: number) => (minor < 0 ? `−${money(-minor)}` : money(minor));

  return (
    <div>
      {/* The stepper is the first row of the band's one box; where there is no band (loading, searching) it is a box alone. */}
      {(searching || !s) && <InsetGroup>{stepper}</InsetGroup>}

      {searching && (
        <div data-testid="statement-search-results">
          {found.length === 0 ? (
            <p className="py-4 text-center text-[15px] text-[var(--ph-ink-3)]">{everything.isLoading ? 'Searching…' : 'No purchase or payment matches.'}</p>
          ) : (
            <InsetGroup header="Found" trailing={`${found.length}`}>
              {found.map((line) => (
                <InsetRow
                  key={line.key}
                  // A payment is not drawn on its statement: its hit opens the payment itself.
                  onClick={() => (isPaymentLine(line) ? openTransaction(line.transactionId) : openStatementOf(line))}
                  title={
                    <>
                      {line.description}
                      <WorkspaceBadge book={badgeOf(line.transactionId)} />
                    </>
                  }
                  subtitle={[
                    line.occurredOn.slice(0, 4) === today.slice(0, 4) ? day(line.occurredOn) : dayYear(line.occurredOn),
                    line.instalment ? `instalment ${line.instalment.number} of ${line.instalment.of}` : null,
                    last4(line.cardId) ? `···· ${last4(line.cardId)}` : null,
                    `Statement ${day(statementOf(line).end)}`,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                  value={<span className="block text-right">{amount(line)}</span>}
                  valueTone="ink"
                />
              ))}
            </InsetGroup>
          )}
        </div>
      )}

      {!searching && s && <StatementBand statement={s} currency={currency} lead={stepper} onOpenPaid={paid && paidCount > 0 ? () => setPaidOpen(true) : undefined} paidMinor={paid?.totalMinor} />}

      {searching ? null : shown.length === 0 ? (
        <p className="pb-[18px] text-center text-[15px] text-[var(--ph-ink-3)]">Nothing on this statement.</p>
      ) : (
        groups.map((group) => {
          // How many of the section's charges show paid. A card alone on its account heads its one list Purchases.
          const charges = group.lines.filter(isCharge);
          const count = paidCountText(charges.filter((line) => showsPaid(line, cover)).length, charges.length);
          // One statement, split by card when the account carries more than one, the way the bank prints it.
          const header = group.title ? `${group.title}${group.digits ? ` ${group.digits}` : ''}` : count ? 'Purchases' : undefined;
          const trailing = group.title ? [subtotal(group.totalMinor), count].filter(Boolean).join(' · ') : (count ?? undefined);
          // Purchases whose card was never said are put right all at once, from the top of their own section.
          const assign =
            group.kind === 'unassigned' && plastic.length > 1 ? (
              <ActionRow label="Assign card" icon={<CreditCard size={16} aria-hidden />} disabled={busy} onClick={() => setAssigning(group.lines)} />
            ) : null;
          return (
            <section key={group.key} data-testid="statement-group" aria-label={header}>
              {phone ? (
                <InsetGroup header={header} trailing={trailing}>
                  {assign}
                  {group.lines.map(statementRow)}
                </InsetGroup>
              ) : (
                <Panel header={header} trailing={trailing} pad={false}>
                  {assign && <div className="border-b-[0.5px] border-[var(--ph-hair)]">{assign}</div>}
                  {table(group.lines)}
                </Panel>
              )}
            </section>
          );
        })
      )}

      {assigning && (
        <CardSheet
          title="Assign card"
          cards={plastic}
          footer={assignFooter(new Set(assigning.map((line) => line.transactionId)).size)}
          onPick={(cardId) => {
            // An instalment row names the purchase it came from: each purchase is set once.
            const ids = [...new Set(assigning.map((line) => line.transactionId))];
            setAssigning(null);
            void run(() => setTransactionsCard(database, ws, ids, cardId));
          }}
          onClose={() => setAssigning(null)}
        />
      )}

      {acting && (
        // One line's actions, each only when it applies: the swipe's mark (or its taking back, as the ✓'s bubble does),
        // the two fixes a glyph offers, and the receipt. A choice closes the sheet, then does its work.
        <Sheet grouped title={acting.description} onClose={() => setActing(null)}>
          <InsetGroup wide>
            {settleable(acting) && (
              <ActionRow
                label={markWord(acting)}
                icon={<CircleCheck size={16} aria-hidden />}
                disabled={busy}
                onClick={() => {
                  const line = acting;
                  setActing(null);
                  markPaidOff(line);
                }}
              />
            )}
            {unmarkable(acting) && (
              <ActionRow
                label={planRow(acting) ? 'Not paid' : acting.owedMinor < 0 ? 'Not settled' : 'Not paid off'}
                icon={<CircleX size={16} aria-hidden />}
                disabled={busy}
                onClick={() => {
                  const line = acting;
                  setActing(null);
                  void unmark(line);
                }}
              />
            )}
            {billableNext(acting) && (
              <ActionRow
                label="Billed next statement"
                icon={<CalendarArrowUp size={16} aria-hidden />}
                disabled={busy}
                onClick={() => {
                  const line = acting;
                  setActing(null);
                  void run(() => billOnNextStatement(database, ws, card.id, line.transactionId));
                }}
              />
            )}
            {acting.postedOn && (
              <ActionRow
                label="Use purchase date"
                icon={<Undo2 size={16} aria-hidden />}
                disabled={busy}
                onClick={() => {
                  const line = acting;
                  setActing(null);
                  void run(() => setPostedOn(database, ws, line.transactionId, null));
                }}
              />
            )}
            {assignable(acting) && (
              <ActionRow
                label="Assign card"
                icon={<CreditCard size={16} aria-hidden />}
                disabled={busy}
                onClick={() => {
                  const line = acting;
                  setActing(null);
                  setAssigning([line]);
                }}
              />
            )}
            {acting.instalment && (
              <ActionRow
                label="Open plan"
                icon={<CalendarRange size={16} aria-hidden />}
                onClick={() => {
                  const line = acting;
                  setActing(null);
                  openPlan(line);
                }}
              />
            )}
            {/* A plan bought before the card's records has no purchase to open (TF 136). */}
            {!acting.instalment?.noPurchase && (
              <ActionRow
                label={acting.instalment ? 'Open purchase' : 'Open receipt'}
                icon={<Receipt size={16} aria-hidden />}
                onClick={() => {
                  const line = acting;
                  setActing(null);
                  void navigate({ to: '/transactions/$transactionId', params: { transactionId: line.transactionId } });
                }}
              />
            )}
          </InsetGroup>
        </Sheet>
      )}

      {paidOpen && paid && (
        // The statement's payments: each opens as it does from Cashflow, to be changed or deleted there.
        <Sheet grouped title={`Paid · ${money(paid.totalMinor)}`} onClose={() => setPaidOpen(false)}>
          <div data-testid="statement-paid-sheet">
            {paid.entries.length > 0 && <InsetGroup wide footer={paid.during.length === 0 ? foot : undefined}>{paid.entries.flatMap(paidRow)}</InsetGroup>}
            {paid.during.length > 0 && (
              <InsetGroup wide header="During this statement" footer={[`Paid between its dates, so they came off the bill before it first.`, foot].filter(Boolean).join(' ')}>
                {paid.during.flatMap(paidRow)}
              </InsetGroup>
            )}
          </div>
        </Sheet>
      )}

      {bubbleLine && bubble && (
        <PaidBubble key={bubble.key} anchor={bubble.anchor} words={paidHowText(bubbleLine, cover) ?? 'Paid'} detail={bubbleDetail} actions={bubbleActions} onClose={() => setBubble(null)} />
      )}

      {unmarking && (
        <Sheet grouped title={planRow(unmarking) ? 'Paid' : unmarking.owedMinor < 0 ? 'Already settled' : 'Already paid off'} onClose={() => setUnmarking(null)}>
          <p className="px-[14px] pb-[10px] text-center text-[13px] leading-[18px] text-[var(--ph-ink-3)]">
            {planRow(unmarking)
              ? `${unmarking.description} · ${unmarking.instalment!.number} of ${unmarking.instalment!.of} · ${money(unmarking.owedMinor)} is ticked paid. Not paid puts it back on what is owed.`
              : `${unmarking.description} · ${money(Math.abs(unmarking.owedMinor))} is recorded as ${settledWord(unmarking)} before the app.`}
          </p>
          <button
            type="button"
            data-testid="statement-not-paid-off"
            disabled={busy}
            onClick={() => {
              const line = unmarking;
              setUnmarking(null);
              void unmark(line);
            }}
            className="ph-focus w-full rounded-[11px] bg-[var(--ph-surface)] py-[13px] text-[17px] text-[var(--ph-alarm)]"
          >
            {planRow(unmarking) ? 'Not paid' : unmarking.owedMinor < 0 ? 'Not settled' : 'Not paid off'}
          </button>
        </Sheet>
      )}

      {/* Searching keeps the ticks but stands the bar down: the search field takes the top of the page. */}
      {!searching && chosen.length > 0 && (
        <SelectBarFrame label="Selected purchases" testId="statement-select-bar">
          <button type="button" aria-label="Clear" disabled={busy} onClick={() => setSelected(new Set())} className={`${SELECT_CIRCLE} text-[var(--ph-ink-2)]`}>
            <X size={19} aria-hidden />
          </button>
          <span aria-live="polite" className="min-w-0 flex-1 truncate text-center text-[17px] font-semibold text-[var(--ph-ink)]">
            {chosen.length} selected
          </span>
          {/*
            Pay as the card's own Pay glyph, a circle matching Clear: the name stays for screen readers. It opens the
            same "Pay credit card" screen as the card's Pay, the ticked purchases listed under it (owner, 17 Nov 2026).
          */}
          <button type="button" aria-label="Pay" disabled={busy} onClick={() => void navigate(statementPayLink(card.id, cycle, today, chosen.map((line) => line.transactionId)))} className={`${SELECT_CIRCLE} text-[var(--ph-tint)] disabled:text-[var(--ph-ink-3)]`}>
            <Banknote size={20} aria-hidden />
          </button>
        </SelectBarFrame>
      )}

      <ErrorBox error={error ?? statement.error} />
      {noteShown && note && <ToastCard text={note} />}
    </div>
  );
}
