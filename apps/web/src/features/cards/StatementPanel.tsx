import { formatMinor, matchesSearch, statementCycleFor } from '@expanses/core';
import { type AccountRow, billOnNextStatement, cardStatement, cardStatementLines, type CardRow, carriesPaidOffMark, payCardPurchases, setPostedOn, setSettledBeforeApp, setTransactionsCard, type StatementLine } from '@expanses/db';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { CalendarArrowUp, Check, CircleCheck, CircleX, CreditCard, Ellipsis, Receipt, Undo2, X } from 'lucide-react';
import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { Sheet } from '../../app/Sheet';
import { usePhone } from '../../app/use-phone';
import { useApp } from '../../app/context';
import { canPayWith } from '../../lib/account-types';
import { moneyHolders, useInvalidateAll } from '../../lib/queries';
import { cx, ErrorBox } from '../../ui';
import { ToastCard } from '../../ui/UndoToast';
import { InsetGroup, InsetRow, Panel, SelectRow, TextRow } from '../../ui/native';
import { ActionRow, ColumnGroup, EARLIER, GlyphButton, Line, StepperRow, SubmitRow, SUBTITLE, TITLE } from './rows';
import { WorkspaceBadge } from '../workspaces/WorkspaceBadge';
import { useWorkspaceBadges } from '../workspaces/queries';
import { StatementBand } from './StatementBand';
import { cycleBack } from './statement-dates';
import { groupStatementLines } from './statement-groups';
import { isCharge, type LineCover, paidCountText, showsPaid, statementCover } from './statement-cover';
import { CardSheet } from './CardSheet';
import { spendingDoor } from '../goals/set-aside-question';
import { useSetAside } from '../goals/SetAsideQuestion';
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

/** The soft green ✓ of a purchase a payment covered (mockup `.tick.cov`), at a row's size or the legend's. */
function CoveredTick({ small = false }: { small?: boolean }) {
  return (
    <span
      aria-hidden
      className={cx('flex items-center justify-center rounded-full border-[1.5px] border-[var(--ph-covered-edge)] bg-[var(--ph-covered-fill)] text-[var(--ph-covered-ink)]', small ? 'h-[14px] w-[14px]' : 'h-[18px] w-[18px]')}
    >
      <Check size={small ? 9 : 11} strokeWidth={3.5} aria-hidden />
    </span>
  );
}

/** The solid ink ✓ of a purchase paid one by one, drawn for the legend as the row's checked box draws it. */
function OwnTick() {
  return (
    <span aria-hidden className="flex h-[14px] w-[14px] items-center justify-center rounded-full border-[1.5px] border-[var(--ph-ink)] bg-[var(--ph-ink)] text-[var(--ph-surface)]">
      <Check size={9} strokeWidth={3.5} aria-hidden />
    </span>
  );
}

/** Under a statement with a covered purchase: what its two kinds of ✓ mean. */
function CoverLegend() {
  return (
    <span data-testid="statement-legend" className="flex flex-wrap items-center gap-x-[14px] gap-y-[4px] text-[12px]">
      <span className="flex items-center gap-[5px]">
        <OwnTick />
        paid one by one
      </span>
      <span className="flex items-center gap-[5px]">
        <CoveredTick small />
        covered by a payment
      </span>
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
  // A bill is settled from money the owner can move — not from a deposit that is locked, nor from a holding.
  const payers = moneyHolders(accounts).filter((a) => canPayWith(a) && a.kind === 'asset' && a.currency === card.currency);
  const [fromId, setFromId] = useState('');
  const [paidOn, setPaidOn] = useState(today);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  // The Pay sheet the select bar's Pay opens.
  const [paying, setPaying] = useState(false);
  // The paid-off purchase whose ✓ was tapped: the sheet that offers to take it back.
  const [unmarking, setUnmarking] = useState<StatementLine | null>(null);
  // The purchases under Card not recorded, while the sheet that sets their card is up.
  const [assigning, setAssigning] = useState<readonly StatementLine[] | null>(null);
  // The line whose ⋯ was tapped on a phone: the sheet listing what can be done to it.
  const [acting, setActing] = useState<StatementLine | null>(null);
  // The covered purchase whose soft ✓ was tapped: the sheet naming the payment that covered it.
  const [explaining, setExplaining] = useState<StatementLine | null>(null);

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
  // A purchase a payment partly covered is paid for what is left of it, never the whole again.
  const leftOf = (line: StatementLine) => cover.get(line.key)?.leftMinor ?? line.owedMinor;
  // The payment that completed a purchase's cover; money back says so, and credit from before names none.
  const coveredNote = (line: StatementLine) => {
    const by = cover.get(line.key)?.by ?? null;
    return by === null ? 'covered by an earlier credit' : `covered by ${by.spending ? 'refund' : 'payment'} ${day(by.occurredOn)}`;
  };
  // A charge that shows as paid either way has its amount greyed.
  const done = (line: StatementLine) => isCharge(line) && showsPaid(line, cover);
  // A plan's instalments and the purchase it replaced are paid through the plan, not ticked off here; a purchase a
  // payment already covers is paid, so it cannot be ticked to be paid twice.
  const payable = (line: StatementLine) => line.owedMinor > 0 && line.spending && !line.paidBy && !line.paidOff && !line.instalment && !line.convertedTo && !coveredWhole(line);
  /*
   * What can be marked settled before the app: a purchase there is still something to pay for, or money back (a
   * refund) whose credit was used up before the app — left standing, it would sit on the card as a credit for ever.
   * The receipt asks the ledger the same question (`paidOffMarkOf`), so the two never offer it differently.
   */
  const settleable = (line: StatementLine) => carriesPaidOffMark(line) && !line.paidOff && !coveredWhole(line);
  const settledWord = (line: StatementLine) => (line.owedMinor < 0 ? 'settled' : 'paid off');
  // Billed a statement late: the bank's posting date put it on a later statement than its purchase date.
  const lateOf = (line: StatementLine) => line.postedOn !== null && line.occurredOn < cycle.start;
  // Whether the fix that moves a purchase to the next statement applies: the phone's icon, the table's and the ⋯ agree.
  const billableNext = (line: StatementLine) => line.spending && line.owedMinor > 0 && !lateOf(line) && !line.instalment && !line.convertedTo;
  // Whether Assign card applies: the account has more than one card, and this purchase names none of them.
  const assignable = (line: StatementLine) => line.spending && plastic.length > 1 && !plastic.some((piece) => piece.id === line.cardId);
  const lines = statement.data?.lines ?? [];
  const chosen = lines.filter((line) => selected.has(line.transactionId) && payable(line));
  // One statement, split by card when the account carries more than one, the way the bank prints it.
  const groups = groupStatementLines(lines, plastic);
  const grouped = groups.length > 0 && groups[0]!.title !== null;
  const chosenMinor = chosen.reduce((sum, line) => sum + leftOf(line), 0);
  const payFrom = fromId || payers[0]?.id || '';
  const setAside = useSetAside(spendingDoor(payFrom, chosenMinor));

  const markPaidOff = (line: StatementLine) => void run(() => setSettledBeforeApp(database, ws, line.transactionId, true));

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

  /** A purchase already paid stays ticked and cannot be unticked; deleting its payment frees it again. */
  const tick = (line: StatementLine) =>
    coveredWhole(line) ? (
      // Covered by a payment: a soft green ✓ that is not a switch. A tap says which payment covered it.
      <button
        type="button"
        aria-label={`${line.description}, ${coveredNote(line)}`}
        data-testid="statement-covered"
        onClick={() => setExplaining(line)}
        className="ph-focus flex h-[44px] w-[32px] shrink-0 items-center justify-center"
      >
        <CoveredTick />
      </button>
    ) : line.paidOff ? (
      // Paid off before the app: nothing to pay, so the Add form's ✓ in the box's place. A tap offers to take it back.
      <button
        type="button"
        aria-label={`${line.description}, already ${settledWord(line)}`}
        title={line.owedMinor < 0 ? 'Already settled' : 'Already paid off'}
        data-testid="statement-paid-off"
        disabled={busy}
        onClick={() => setUnmarking(line)}
        className="ph-focus flex h-[44px] w-[32px] shrink-0 items-center justify-center"
      >
        <span className="flex h-[18px] w-[18px] items-center justify-center rounded-full bg-[var(--ph-up)] text-white">
          <Check size={11} strokeWidth={3.5} aria-hidden />
        </span>
      </button>
    ) : (
    // The label is the circle's reach: an 18 px circle inside a 44 pt target, the size of the ✓ a paid-off line wears. The
    // checkbox is still the real control, laid invisibly under it; what is drawn is an empty ring, filled with a ✓ once chosen.
    <label className={cx('relative flex h-[44px] w-[32px] shrink-0 items-center justify-center', !payable(line) && !line.paidBy && 'invisible')}>
      <input
        type="checkbox"
        className="peer ph-focus absolute inset-0 h-full w-full cursor-pointer opacity-0 disabled:cursor-default"
        disabled={!payable(line)}
        checked={line.paidBy !== null || selected.has(line.transactionId)}
        onChange={() => toggle(line.transactionId)}
        title={line.paidBy ? `Paid on ${day(line.paidBy.paidOn)}` : undefined}
        aria-label={line.paidBy ? `${line.description}, paid on ${day(line.paidBy.paidOn)}` : `Pay ${line.description}`}
      />
      <span
        aria-hidden
        className={cx(
          'flex h-[18px] w-[18px] items-center justify-center rounded-full border-[1.5px] border-[var(--ph-ink-3)] text-transparent peer-disabled:opacity-60',
          // Paid one by one is a solid ink ✓, set apart from the soft green one a covering payment gives; a line picked
          // to pay is an ink ring with a ✓, not filled.
          line.paidBy ? 'peer-checked:border-[var(--ph-ink)] peer-checked:bg-[var(--ph-ink)] peer-checked:text-[var(--ph-surface)]' : 'peer-checked:border-[var(--ph-ink)] peer-checked:text-[var(--ph-ink)]',
        )}
      >
        <Check size={11} strokeWidth={3.5} aria-hidden />
      </span>
    </label>
    );

  /** What else the statement says about a line, after its description: plan, conversion, payment, card, tag. */
  const notes = (line: StatementLine): ReactNode[] => {
    const out: ReactNode[] = [];
    // One purchase split across workspaces is one charge here, as the bank prints it: its line names every part.
    if (line.splitCategories) out.push(line.splitCategories.join(' · '));
    if (line.instalment) out.push(`instalment ${line.instalment.number} of ${line.instalment.of}`);
    if (line.convertedTo) out.push(`converted to ${line.convertedTo.months} months, billed monthly`);
    // Which purchases have been settled one by one, kept apart from what the bank has billed.
    if (line.paidBy) out.push(`${s?.closed ? 'paid' : 'paid ahead'} ${day(line.paidBy.paidOn)}`);
    // Covered by a payment oldest first: whole says by which, part says how much is left to pay.
    const covered = cover.get(line.key);
    if (covered?.whole) out.push(coveredNote(line));
    else if (covered && covered.coveredMinor > 0) out.push(`${money(covered.coveredMinor)} covered, ${money(covered.leftMinor)} left`);
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
                  label: line.owedMinor < 0 ? 'Settled' : 'Paid off',
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
        <span className="min-w-0 flex-1 py-[10px]">
          <span className={cx('block truncate', TITLE)}>
            {line.description}
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
                  {line.description}
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
                      hint={line.owedMinor < 0 ? 'Credit used up before the app: nothing to take off the bill' : 'Already paid off before the app: nothing to pay'}
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
                  onClick={() => openStatementOf(line)}
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

      {!searching && s && <StatementBand statement={s} currency={currency} lead={stepper} />}

      {searching ? null : lines.length === 0 ? (
        <p className="pb-[18px] text-center text-[15px] text-[var(--ph-ink-3)]">Nothing on this statement.</p>
      ) : (
        groups.map((group, index) => {
          // How many of the section's charges show paid, either ✓. A card alone on its account heads its one list Purchases.
          const charges = group.lines.filter(isCharge);
          const count = paidCountText(charges.filter((line) => showsPaid(line, cover)).length, charges.length);
          // One statement, split by card when the account carries more than one, the way the bank prints it.
          const header = group.title ? `${group.title}${group.digits ? ` ${group.digits}` : ''}` : count ? 'Purchases' : undefined;
          const trailing = group.title ? [subtotal(group.totalMinor), count].filter(Boolean).join(' · ') : (count ?? undefined);
          // Under the list, once a covered ✓ shows: what the two kinds mean.
          const legend = index === groups.length - 1 && lines.some(coveredWhole) ? <CoverLegend /> : undefined;
          // Purchases whose card was never said are put right all at once, from the top of their own section.
          const assign =
            group.kind === 'unassigned' && plastic.length > 1 ? (
              <ActionRow label="Assign card" icon={<CreditCard size={16} aria-hidden />} disabled={busy} onClick={() => setAssigning(group.lines)} />
            ) : null;
          return (
            <section key={group.key} data-testid="statement-group" aria-label={header}>
              {phone ? (
                <InsetGroup header={header} trailing={trailing} footer={legend}>
                  {assign}
                  {group.lines.map(statementRow)}
                </InsetGroup>
              ) : (
                <Panel header={header} trailing={trailing} footer={legend} pad={false}>
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
        // One line's actions, each only when it applies: the swipe's mark (or its taking back, as the ✓'s sheet does),
        // the two fixes a glyph offers, and the receipt. A choice closes the sheet, then does its work.
        <Sheet grouped title={acting.description} onClose={() => setActing(null)}>
          <InsetGroup wide>
            {settleable(acting) && (
              <ActionRow
                label={acting.owedMinor < 0 ? 'Settled' : 'Paid off'}
                icon={<CircleCheck size={16} aria-hidden />}
                disabled={busy}
                onClick={() => {
                  const line = acting;
                  setActing(null);
                  markPaidOff(line);
                }}
              />
            )}
            {acting.paidOff && (
              <ActionRow
                label={acting.owedMinor < 0 ? 'Not settled' : 'Not paid off'}
                icon={<CircleX size={16} aria-hidden />}
                disabled={busy}
                onClick={() => {
                  const line = acting;
                  setActing(null);
                  void run(() => setSettledBeforeApp(database, ws, line.transactionId, false));
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
            <ActionRow
              label="Open receipt"
              icon={<Receipt size={16} aria-hidden />}
              onClick={() => {
                const line = acting;
                setActing(null);
                void navigate({ to: '/transactions/$transactionId', params: { transactionId: line.transactionId } });
              }}
            />
          </InsetGroup>
        </Sheet>
      )}

      {explaining && (
        // A covered ✓ explains itself and links to the payment; it is not a switch.
        <Sheet grouped title={explaining.description} onClose={() => setExplaining(null)}>
          {(() => {
            const by = cover.get(explaining.key)?.by ?? null;
            const kind = by?.spending ? 'refund' : 'payment';
            return (
              <InsetGroup wide footer={by ? `Paid with the card’s ${kind} of ${money(-by.owedMinor)}. Deleting that ${kind} makes it owed again.` : 'Paid with credit left on the card from an earlier statement.'}>
                <InsetRow plain title="Amount" value={money(explaining.owedMinor)} />
                {by && (
                  <InsetRow
                    plain
                    title="Covered by"
                    value={`${kind === 'refund' ? 'Refund' : 'Payment'} ${day(by.occurredOn)}`}
                    valueTone="tint"
                    onClick={() => {
                      setExplaining(null);
                      void navigate({ to: '/transactions/$transactionId', params: { transactionId: by.transactionId } });
                    }}
                  />
                )}
              </InsetGroup>
            );
          })()}
        </Sheet>
      )}

      {unmarking && (
        <Sheet grouped title={unmarking.owedMinor < 0 ? 'Already settled' : 'Already paid off'} onClose={() => setUnmarking(null)}>
          <p className="px-[14px] pb-[10px] text-center text-[13px] leading-[18px] text-[var(--ph-ink-3)]">
            {unmarking.description} · {money(Math.abs(unmarking.owedMinor))} is recorded as {settledWord(unmarking)} before the app.
          </p>
          <button
            type="button"
            data-testid="statement-not-paid-off"
            disabled={busy}
            onClick={() => {
              const line = unmarking;
              setUnmarking(null);
              void run(() => setSettledBeforeApp(database, ws, line.transactionId, false));
            }}
            className="ph-focus w-full rounded-[11px] bg-[var(--ph-surface)] py-[13px] text-[17px] text-[var(--ph-alarm)]"
          >
            {unmarking.owedMinor < 0 ? 'Not settled' : 'Not paid off'}
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
          <button
            type="button"
            disabled={busy}
            onClick={() => setPaying(true)}
            className="ph-focus flex h-11 shrink-0 items-center justify-center rounded-full bg-[var(--ph-surface)] px-5 text-[17px] font-semibold text-[var(--ph-tint)] shadow-[0_1px_3px_rgb(0_0_0/0.08)] disabled:text-[var(--ph-ink-3)]"
          >
            Pay
          </button>
        </SelectBarFrame>
      )}

      {paying && chosen.length > 0 && (
        <Sheet grouped title={`Pay ${chosen.length} purchase${chosen.length === 1 ? '' : 's'}`} onClose={() => setPaying(false)}>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              // Enter submits too: the question is a condition on it.
              if (!setAside.ready) return;
              void run(async () => {
                await payCardPurchases(database, ws, {
                  cardAccountId: card.id,
                  fromAccountId: payFrom,
                  occurredOn: paidOn,
                  purchaseTransactionIds: chosen.map((line) => line.transactionId),
                  // A purchase a payment partly covered pays only what is left of it.
                  amountsMinor: Object.fromEntries(chosen.filter((line) => leftOf(line) !== line.owedMinor).map((line) => [line.transactionId, leftOf(line)])),
                  // The ledger checks those amounts against its own cover as of the day this statement was read.
                  today,
                  setAside: setAside.choice,
                });
                setSelected(new Set());
                setPaying(false);
              });
            }}
          >
            <InsetGroup wide>
              {chosen.map((line) => (
                <InsetRow key={line.transactionId} plain title={line.description} value={money(leftOf(line))} />
              ))}
            </InsetGroup>
            <ColumnGroup
              footer={payers.length === 0 ? `Add a ${currency} bank account to pay the card from.` : undefined}
              columns={[
                [
                  <SelectRow label="Paid from" value={payFrom} onChange={(event) => setFromId(event.target.value)}>
                    {payers.map((account) => (
                      <option key={account.id} value={account.id}>
                        {account.name}
                      </option>
                    ))}
                  </SelectRow>,
                ],
                [<TextRow label="Paid on" type="date" value={paidOn} onChange={(event) => setPaidOn(event.target.value)} required />],
              ]}
              submit={<SubmitRow label={`Pay ${money(chosenMinor)}`} disabled={busy || payers.length === 0 || !setAside.ready} />}
            />
            {setAside.node}
            <ErrorBox error={error} />
          </form>
        </Sheet>
      )}
      <ErrorBox error={error ?? statement.error} />
      {noteShown && note && <ToastCard text={note} />}
    </div>
  );
}
