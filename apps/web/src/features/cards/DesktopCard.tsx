import { formatMinor, isCardCashbackKey, monthName, ordinal } from '@expanses/core';
import { type AccountRow, cardStatement, cardStatementLines, type CardRow, listTransactions, ownerScope, type StatementLine } from '@expanses/db';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import { type MouseEvent, useEffect, useRef, useState } from 'react';
import { type SpendBonusItem } from '@expanses/core';
import { useApp } from '../../app/context';
import { ProgressRing } from '../../ui/native';
import { DeskNotices } from '../../app/DeskNotices';
import { useBalances } from '../../lib/queries';
import { cx, ErrorBox } from '../../ui';
import { usePeekDoubleClick } from '../../ui/native/peek-double-click';
import { Award, Check, FileText, List } from 'lucide-react';
import { Tag } from '../../ui/desk';
import {
  DeskBox,
  DeskFace,
  DeskTitleBar,
  DeskPageTitle,
  FigureRow,
  FIGURES_ALONE,
  FIGURES_UNDER_FACE,
  GBTN,
  GearLink,
  PBTN,
  PEEK_ROOM,
  rowClass,
  StepPill,
  TD,
  TH,
  THIRD_CARD,
  TOP_GRID,
} from '../accounts/desk-account-parts';
import { CategoryIcon } from '../categories/CategoryIcon';
import { InstallmentList } from '../loans/InstallmentList';
import { useInstallments } from '../loans/queries';
import { creditMinor, owedMinor } from '../networth/debt-rows';
import { isEditable } from '../transactions/draft';
import { buildRows, type ListRow } from '../transactions/list-model';
import { ReceiptPeek } from '../transactions/ReceiptPeek';
import { useWalletCards } from '../wallet/useWalletCards';
import { rewardText, standingText } from './CardBack';
import { billBox, cashbackMinor, newestFirst, pickedPay, showsCardColumn, showsPointsColumn } from './card-desk-model';
import { earnRateText, statementRowsNote } from './card-desk-v1';
import { type CardPage, statementPointsOf } from './card-page';
import { cardPayLink, statementPayLink } from './card-pay';
import { useAnnualFees } from './fee-due';
import { challengeCoversFee } from './fee-line';
import { useFeeWaivedStatus, waivedLine } from './fee-waived-status';
import { cardBackFigure, dueNowMinor, laterInstalmentsMinor, limitUsage } from './limit-usage';
import { useSpendBonuses } from './spend-bonuses';
import { isCharge, paidHowText, payableLine, showsPaid, statementCover } from './statement-cover';
import { cycleBack, dueIn } from './statement-dates';
import { formatPoints, pointsValue, shortDate } from './useCardPoints';

/** Rows read to name each statement line's category: more than a card's statements ever hold. */
const READ_LIMIT = 20_000;

/**
 * A credit card on a wide screen (Mac account pages, owner 2026-11-20), in the v1 look (owner 2026-11-23; screen 12 of
 * docs/mockups/2026-11-21-mac-redesign-sidebar.html): `/cards/$cardId` full width. The title bar: the card's name, the
 * statement stepper "‹ 19 Nov – 18 Dec ›" (this statement, the last, and on back) with All beside it, Statement (the
 * statement page, with its check, search and fixes), ⚙ (the card's settings), "Pay credit card" — today's Pay screen,
 * filled with the bill — and the blue "＋ New expense" (the Add screen on this card).
 *
 * The top row: the card's face with what is outstanding under it (what is due now, as Wallet and the sidebar print it),
 * the limit bar and the credit left; the last statement's bill — billed, paid since, left to pay, when it is due and when
 * the open one closes; the miles or points — the programme's balance, this statement's, the earn rate, the year's, with
 * the annual fee, the cashback and the nearest spend bonus. Then the chosen statement's lines, newest first: a green ✓ and
 * how each was paid, a Card column when a supplementary card is on the account and a miles or points column when the card
 * works them out. A click opens the Mac receipt in the side peek, a double-click today's edit screen, ↑↓ step the peek;
 * ⌘-click picks purchases, and Pay then pays just those (`statementPayLink`).
 */
export function DesktopCard({ page }: { page: CardPage }) {
  const { database, ws } = useApp();
  const navigate = useNavigate();
  const { card, cp, all: accounts, plastic, today, currency, ledger } = page;
  const balances = useBalances();
  const { cards: wallet } = useWalletCards();
  const face = wallet.find((one) => one.key === card.id);
  const owed = owedMinor(balances.data ?? {}, card.id);
  const credit = creditMinor(balances.data ?? {}, card.id);

  // ── Outstanding: the phone card back's own figures ─────────────────────────────────────────────────────────────────
  const plans = useInstallments(card.id);
  // Each plan's instalments not billed yet, as the phone's card back adds them (`laterInstalmentsMinor`).
  const heldMinor = (plans.data ?? []).reduce((sum, plan) => sum + Math.max(0, laterInstalmentsMinor(plan, today)), 0);
  const usage = limitUsage(owed - credit, cp.limitMinor, heldMinor);
  const backFigure = cardBackFigure(dueNowMinor(owed, usage.heldMinor), credit);

  // ── The bill: the last statement cut ───────────────────────────────────────────────────────────────────────────────
  const statementDay = cp.terms?.statementDay ?? null;
  const lastCycle = statementDay ? cycleBack(today, statementDay, 1) : null;
  const last = useQuery({
    queryKey: ['card-statement', ws.workspaceId, card.id, lastCycle?.start ?? '-', today],
    enabled: lastCycle !== null,
    queryFn: () => cardStatement(database, ws, card.id, lastCycle!, today),
  });
  const bill = billBox(last.data, cp.terms, today);
  const payLink = cardPayLink(card.id, (bill.state === 'due' ? bill.toPayMinor : 0) || owed, currency);

  // The Debt-free plan's and Wallet's Pay land here with `?pay=1`: once the bill is read, on to the Pay screen in this
  // page's place, as the phone's card page does.
  const { pay } = useSearch({ strict: false }) as { pay?: true };
  const forwarded = useRef(false);
  const billRead = lastCycle === null || last.isSuccess || last.isError;
  useEffect(() => {
    if (pay !== true || !billRead || forwarded.current) return;
    forwarded.current = true;
    void navigate({ ...payLink, replace: true });
  }, [pay, billRead]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── The statement on show ──────────────────────────────────────────────────────────────────────────────────────────
  // How many statements back the table shows (0 the one still open, 1 the last cut), or null for every statement's
  // lines (All). Leaving All lands back on the statement shown before it.
  const [back, setBackState] = useState<number | null>(0);
  const [lastBack, setLastBack] = useState(0);
  const setBack = (value: number | null) => {
    if (value !== null) setLastBack(value);
    setBackState(value);
  };
  const all = back === null;
  const cycle = statementDay && back !== null ? cycleBack(today, statementDay, back) : null;
  const statement = useQuery({
    queryKey: ['card-statement', ws.workspaceId, card.id, cycle?.start ?? '-', today],
    enabled: cycle !== null,
    queryFn: () => cardStatement(database, ws, card.id, cycle!, today),
  });
  const everything = useQuery({
    queryKey: ['card-statement-lines', ws.workspaceId, card.id],
    enabled: all && statementDay !== null,
    queryFn: () => cardStatementLines(database, ws, card.id),
  });
  const currentEnd = statementDay ? cycleBack(today, statementDay, 0).end : today;
  const lines: StatementLine[] = all ? newestFirst((everything.data ?? []).filter((line) => line.statementOn <= currentEnd)) : newestFirst(statement.data?.lines ?? []);
  const cover = statement.data && !all ? statementCover(statement.data) : new Map();
  // Each line's transaction, for its category and its edit screen: owner-wide, as the statement is.
  const earliest = lines.reduce((first, line) => (line.occurredOn < first ? line.occurredOn : first), today);
  const txs = useQuery({
    queryKey: ['card-desk-rows', ws.workspaceId, card.id, earliest],
    enabled: lines.length > 0,
    queryFn: () =>
      listTransactions(database, ownerScope(ws), {
        accountIds: [card.id],
        from: earliest,
        limit: READ_LIMIT,
      }),
  });
  const rowOf = new Map(buildRows(txs.data ?? [], [], accounts, []).map((row) => [row.id, row]));
  const cashbackId = (id: string | null) => !!id && isCardCashbackKey(accounts.find((account) => account.id === id)?.systemKey);
  const points = showsPointsColumn(cp) ? statementPointsOf(cp) : null;
  const cardColumn = showsCardColumn(plastic, card.id);

  // ── ⌘-picked purchases, and the peek ───────────────────────────────────────────────────────────────────────────────
  const [picked, setPicked] = useState<string[]>([]);
  useEffect(() => setPicked([]), [back]);
  const chosen = pickedPay(all ? undefined : statement.data, picked);
  const [peekKey, setPeekKey] = useState<string | null>(null);
  const peekLine = peekKey ? lines.find((line) => line.key === peekKey) : undefined;
  const peeking = peekLine !== undefined;
  const opens = lines.filter((line) => !line.instalment?.noPurchase);
  const at = peekKey ? opens.findIndex((line) => line.key === peekKey) : -1;
  const step = (by: -1 | 1) => {
    const next = opens[Math.min(opens.length - 1, Math.max(0, at + by))];
    if (next) setPeekKey(next.key);
  };
  const bar = useRef<HTMLElement | null>(null);
  const [peekTop, setPeekTop] = useState(52);
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
  const keys = useRef<(event: KeyboardEvent) => void>(() => undefined);
  keys.current = (event: KeyboardEvent) => {
    const target = event.target as HTMLElement | null;
    const typing = !!target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable);
    if (typing || document.querySelector('[role="dialog"]')) return;
    if (event.key === 'Escape' && (peeking || picked.length > 0)) {
      setPeekKey(null);
      setPicked([]);
    } else if (peeking && event.key === 'ArrowUp') step(-1);
    else if (peeking && event.key === 'ArrowDown') step(1);
    else return;
    event.preventDefault();
  };
  useEffect(() => {
    const listen = (event: KeyboardEvent) => keys.current(event);
    document.addEventListener('keydown', listen);
    return () => document.removeEventListener('keydown', listen);
  }, []);
  const openPlan = (line: StatementLine) =>
    line.instalment &&
    void navigate({
      to: '/cards/$cardId/settings/instalments/$planId',
      params: { cardId: card.id, planId: line.instalment.planId },
    });
  const click = (line: StatementLine, event: MouseEvent) => {
    if (event.metaKey || event.ctrlKey) {
      // ⌘-click picks a purchase the statement still lets be paid (the phone's tick); anything else is left alone.
      if (all || !payableLine(line, cover)) return;
      setPeekKey(null);
      setPicked((was) => (was.includes(line.transactionId) ? was.filter((id) => id !== line.transactionId) : [...was, line.transactionId]));
      return;
    }
    setPicked([]);
    if (line.instalment?.noPurchase) openPlan(line);
    else setPeekKey(line.key);
  };
  const edit = (key: string) => {
    const line = lines.find((one) => one.key === key);
    if (!line) return;
    if (line.instalment) return void openPlan(line);
    const tx = rowOf.get(line.transactionId)?.tx;
    if (tx && isEditable(tx))
      void navigate({
        to: '/transactions/$transactionId/edit',
        params: { transactionId: tx.id },
      });
  };
  const doubleClick = usePeekDoubleClick((key) => edit(key));

  // ── Miles or points this statement ─────────────────────────────────────────────────────────────────────────────────
  const unit = cp.programme?.unit ?? cp.program?.unit ?? 'points';
  const unitLabel = unit === 'miles' ? 'Miles' : unit === 'cashback' ? 'Cashback' : 'Points';
  const earned = cp.current?.earn.totalPoints ?? null;
  const worth = earned !== null ? pointsValue(earned, cp) : null;
  const bonuses = useSpendBonuses(cp, accounts, today);
  const feeStatus = useFeeWaivedStatus(card.id, today);
  const fee = useAnnualFees(today).find((one) => one.card.cardId === card.id);
  const current = statementDay ? cycleBack(today, statementDay, 0) : null;
  const thisStatement = useQuery({
    queryKey: ['card-statement', ws.workspaceId, card.id, current?.start ?? '-', today],
    enabled: current !== null,
    queryFn: () => cardStatement(database, ws, card.id, current!, today),
  });
  const cashback = cashbackMinor(thisStatement.data?.lines ?? [], (id) => cashbackId(rowOf.get(id)?.categoryId ?? null));

  const primary = [...plastic].sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary))[0];
  // v1's line: "···· 4417 · Statement closes on the 28th · Pay by the 15th".
  const titleLine = [
    primary?.last4 ? `···· ${primary.last4}` : 'Credit card',
    statementDay ? `Statement closes on the ${ordinal(statementDay)}` : null,
    cp.terms?.dueDay ? `Pay by the ${ordinal(cp.terms.dueDay)}` : null,
  ]
    .filter(Boolean)
    .join(' · ');
  const tableTitle = back === null ? 'All statements' : back === 0 ? 'This statement' : back === 1 ? 'Last statement' : 'Statement';
  const range = cycle ? `${shortDate(cycle.start)} – ${shortDate(cycle.end)}` : null;
  const payLabel = chosen.purchases.length > 0 ? `Pay ${chosen.purchases.length} purchase${chosen.purchases.length === 1 ? '' : 's'}` : 'Pay credit card';
  const programmeName = cp.programme?.name ?? cp.program?.name ?? null;
  const earnRate = earnRateText(cp.rules, unit, currency);
  const closes = current ? dueIn(today, current.end) : null;

  return (
    <div className="min-h-dvh bg-[var(--mk-page)]" data-testid="card-desk" data-desk="true" {...doubleClick}>
      <DeskTitleBar title={card.name} line={titleLine} barRef={(node) => (bar.current = node)}>
        {statementDay !== null && (
          <span role="group" aria-label="Statement" className="flex items-center gap-[6px]">
            {/* ‹ › steps a statement at a time (This, Last, and on back); All shows every statement's lines at once. */}
            <StepPill
              label={back === null ? 'All statements' : range}
              earlier="Earlier statement"
              later="Later statement"
              laterOff={back === 0}
              onStep={(by) => setBack(back === null ? lastBack : Math.max(0, back - by))}
              testId="card-statement-range"
            />
            <button
              type="button"
              aria-pressed={back === null}
              title="Every statement's lines"
              onClick={() => setBack(back === null ? lastBack : null)}
              className={cx(GBTN, 'px-[13px]', back === null && 'bg-[var(--mk-black)] text-[var(--mk-black-ink)] hover:bg-[var(--mk-black)]')}
            >
              All
            </button>
          </span>
        )}
        <span role="group" aria-label="Actions" className="flex items-center gap-[8px]">
          <Link to="/cards/$cardId/statement" params={{ cardId: card.id }} className={GBTN}>
            Statement
          </Link>
          <GearLink to="/cards/$cardId/settings" params={{ cardId: card.id }} />
          <button
            type="button"
            className={GBTN}
            data-testid="card-desk-pay"
            onClick={() =>
              void navigate(
                chosen.purchases.length > 0 && cycle
                  ? statementPayLink(
                      card.id,
                      cycle,
                      today,
                      chosen.purchases.map((one) => one.transactionId),
                    )
                  : payLink,
              )
            }
          >
            {payLabel}
          </button>
          <Link to="/transactions/new" search={{ mode: 'expense', account: card.id, fixed: true }} className={PBTN}>
            <span aria-hidden>＋</span>New expense
          </Link>
        </span>
      </DeskTitleBar>
      <DeskNotices />
      <DeskPageTitle title={card.name} line={titleLine} />

      <div className={cx('@container space-y-[16px] px-[32px] pt-[2px] pb-[32px]', peeking && PEEK_ROOM)}>
        <ErrorBox error={balances.error ?? last.error ?? statement.error ?? everything.error ?? txs.error} />
        <div className={TOP_GRID}>
          {/* The phone's card back is these two: what is outstanding (on the face's column), and the bill. */}
          <div data-testid="tile-left-to-pay" className="contents">
            <section data-testid="card-outstanding" aria-label={backFigure.label} className="min-w-0">
              {face && <DeskFace card={face} />}
              {/* Without a face (a pocket, an account Wallet draws no card for) the figures sit in a soft card of their own. */}
              <div className={face ? FIGURES_UNDER_FACE : FIGURES_ALONE}>
                <p data-testid="tile-figure-label" className="text-[12.5px] font-semibold text-[var(--mk-ink-2)]">
                  {backFigure.label}
                </p>
                <p
                  data-testid="tile-unpaid-balance"
                  className={cx(
                    'text-[27px] leading-[33px] font-extrabold tracking-[-0.3px] whitespace-nowrap tabular-nums',
                    backFigure.label === 'Credit' ? 'text-[var(--mk-t-green)]' : 'text-[var(--mk-ink)]',
                  )}
                >
                  {formatMinor(backFigure.minor, currency)}
                </p>
                {usage.usedPct !== null && (
                  <div className="mt-[8px] flex h-[6px] max-w-[300px] overflow-hidden rounded-[3px] bg-[var(--mk-track)]" data-testid="limit-bar">
                    <div
                      className="h-full"
                      style={{
                        width: `${usage.barUsedPct}%`,
                        background: (usage.usedPct ?? 0) >= 80 ? 'var(--mk-c-orange)' : 'var(--mk-c-blue)',
                      }}
                    />
                    {usage.barHeldPct > 0 && (
                      <div
                        className="h-full"
                        title="Held by instalments"
                        style={{
                          width: `${usage.barHeldPct}%`,
                          backgroundImage: 'repeating-linear-gradient(135deg, var(--mk-ink-2) 0 3px, var(--mk-ink-3) 3px 6px)',
                        }}
                      />
                    )}
                  </div>
                )}
                {usage.availableMinor !== null && (
                  <p data-testid="card-available" className={cx('mt-[7px] text-[12.5px] tabular-nums', usage.availableMinor < 0 ? 'font-semibold text-[var(--mk-t-red)]' : 'text-[var(--mk-ink-2)]')}>
                    {usage.availableMinor < 0 ? `Over the limit by ${formatMinor(-usage.availableMinor, currency)}` : `Credit left ${formatMinor(usage.availableMinor, currency)}`}
                    {cp.limitMinor !== null && cp.limitMinor > 0 && <span className="text-[var(--mk-ink-2)]"> · of {formatMinor(cp.limitMinor, currency)}</span>}
                  </p>
                )}
                {usage.availableMinor === null && <p className="mt-[4px] text-[12.5px] text-[var(--mk-ink-2)]">No limit set</p>}
                {usage.heldMinor > 0 && <p className="text-[12.5px] text-[var(--mk-ink-2)] tabular-nums">{formatMinor(usage.heldMinor, currency)} in instalments not billed yet</p>}
              </div>
            </section>
            <BillBoxView bill={bill} currency={currency} cardId={card.id} range={lastCycle ? `${shortDate(lastCycle.start)} – ${shortDate(lastCycle.end)}` : null} closes={closes} />
          </div>
          <DeskBox
            title={programmeName ? `${programmeName} ${unit}` : unitLabel}
            icon={Award}
            testId="tile-points"
            className={THIRD_CARD}
            note={
              cp.program ? (
                <Link to="/cards/$cardId/points" params={{ cardId: card.id }} data-testid="desk-points-link" className="font-semibold text-[var(--mk-blue)] hover:underline">
                  Points ›
                </Link>
              ) : undefined
            }
          >
            {cp.program && (
              <div className="px-[20px] pb-[8px]">
                {ledger.data && (
                  <p className="text-[30px] leading-[36px] font-extrabold tracking-[-0.3px] text-[var(--mk-ink)] tabular-nums" data-testid="desk-points-balance">
                    {formatPoints(ledger.data.balance.total)}
                    <small className="ml-[4px] text-[14px] font-semibold tracking-normal text-[var(--mk-ink-2)]">{unit}</small>
                  </p>
                )}
                {earned !== null && (
                  <p className="mt-[6px] flex flex-wrap items-center gap-x-[8px] gap-y-[2px]">
                    <Tag tone="green" testId="desk-points">
                      +{formatPoints(earned)} this statement
                    </Tag>
                    {worth && <span className="text-[12px] text-[var(--mk-ink-2)] tabular-nums">≈ {formatMinor(worth.valueMinor, worth.currency)}</span>}
                  </p>
                )}
              </div>
            )}
            {!cp.program && (
              <Link
                to="/cards/$cardId/settings"
                params={{ cardId: card.id }}
                data-testid="back-points"
                className="mx-[20px] mb-[6px] block text-[13px] text-[var(--mk-ink-2)] hover:text-[var(--mk-ink)]"
              >
                Rewards are not set up for this card.
              </Link>
            )}
            {cp.program && earnRate && <FigureRow label="Earn rate" value={earnRate} />}
            {cp.program && ledger.data && (
              <FigureRow label={ledger.data.roi.anchoredOn === 'fee' ? 'Earned this card year' : 'Earned in 12 months'} value={`${formatPoints(ledger.data.roi.pointsEarned)} ${unit}`} />
            )}
            <FigureRow
              label="Annual fee"
              tone="grey"
              value={cp.terms?.annualFeeMinor ? `${formatMinor(cp.terms.annualFeeMinor, currency)}${fee?.on ? ` · ${monthName(fee.on.slice(0, 7), 'short')}` : ''}` : '—'}
            />
            <FigureRow label="Cashback" tone={cashback > 0 ? 'up' : 'grey'} value={cashback > 0 ? formatMinor(cashback, currency) : '—'} testId="desk-cashback" />
            {bonuses.items[0] && (
              <DeskBonus
                cardId={card.id}
                item={bonuses.items[0]}
                more={bonuses.items.length - 1}
                unit={unit}
                currency={currency}
                challengeNote={feeStatus.data?.waived && challengeCoversFee(feeStatus.data.challengeYear, feeStatus.data.year) ? waivedLine(feeStatus.data, currency) : null}
              />
            )}
          </DeskBox>
        </div>

        <DeskBox
          title={tableTitle}
          icon={List}
          testId="card-table"
          className="px-[10px] pb-[4px] [&>h2]:px-[10px]"
          note={
            chosen.purchases.length > 0 ? (
              <span className="flex items-baseline gap-[10px]" data-testid="card-picked">
                <span className="text-[var(--mk-ink)]">
                  {chosen.purchases.length} picked · {formatMinor(chosen.totalMinor, currency)} · Pay pays just these
                </span>
                <button type="button" onClick={() => setPicked([])} className="font-semibold text-[var(--mk-blue)] hover:underline">
                  Clear
                </button>
              </span>
            ) : (
              <span title={back === null ? 'Click a row to see it · double-click to edit' : 'Click a row to see it · ⌘-click several to pay just those · double-click to edit'}>
                {[back === null ? null : range, lines.length > 0 ? statementRowsNote(lines, cover, back === null) : null].filter(Boolean).join(' · ')}
              </span>
            )
          }
        >
          {statementDay === null ? (
            <p className="px-[10px] pb-[12px] text-[13.5px] text-[var(--mk-ink-2)]">
              Statements are cut on the billing date.{' '}
              <Link to="/cards/$cardId/settings" params={{ cardId: card.id }} className="font-semibold text-[var(--mk-blue)] hover:underline">
                Add the billing date
              </Link>
            </p>
          ) : (
            <StatementTable
              lines={lines}
              accounts={accounts}
              plastic={plastic}
              currency={currency}
              rowOf={rowOf}
              cover={cover}
              points={points}
              unitLabel={unitLabel}
              cardColumn={cardColumn}
              peekKey={peekKey}
              picked={picked}
              onClick={click}
              onEdit={edit}
              all={all}
            />
          )}
          {statementDay !== null && (back === null ? everything.isSuccess : statement.isSuccess) && lines.length === 0 && (
            <p className="px-[10px] py-[12px] text-[13.5px] text-[var(--mk-ink-2)]">Nothing on this statement.</p>
          )}
        </DeskBox>

        {(plans.data ?? []).length > 0 && (
          <div className="max-w-[720px]">
            <InstallmentList cardAccountId={card.id} currency={currency} />
          </div>
        )}
      </div>

      {peekLine && (
        <ReceiptPeek
          key={peekLine.key}
          top={peekTop}
          testId="receipt-peek"
          transactionId={peekLine.transactionId}
          first={at <= 0}
          last={at === opens.length - 1}
          onStep={step}
          onClose={() => setPeekKey(null)}
        />
      )}
    </div>
  );
}

/**
 * The nearest spend bonus, as the phone card's back shows it — its ring, its name, what it pays, and what is left or
 * reached — wrapped rather than cut in the box's width; a click opens the card's list of them.
 */
function DeskBonus({ cardId, item, more, unit, currency, challengeNote }: { cardId: string; item: SpendBonusItem; more: number; unit: string; currency: string; challengeNote: string | null }) {
  return (
    <Link
      to="/cards/$cardId/bonuses"
      params={{ cardId }}
      data-testid="back-bonus"
      className="mx-[10px] flex items-start gap-[10px] rounded-[10px] border-t border-[var(--mk-line)] px-[10px] py-[8px] text-[13px] text-[var(--mk-ink)] hover:bg-[var(--mk-hover)]"
    >
      <span className="shrink-0 pt-[2px]">
        <ProgressRing fraction={item.fraction} reached={item.reached} size={30} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-baseline justify-between gap-x-2">
          <b className="font-semibold">{item.name}</b>
          <span className="font-semibold tabular-nums">{rewardText(item, unit, currency)}</span>
        </span>
        <span className="block text-[12px] text-[var(--mk-ink-2)] tabular-nums">
          {item.kind === 'challenge' && challengeNote ? <span className="font-semibold text-[var(--mk-t-green)]">{challengeNote}</span> : standingText(item, currency)}
          {more > 0 ? ` · + ${more} more` : ''}
        </span>
      </span>
    </Link>
  );
}

/**
 * The last statement's bill, as v1's Statement card: what it billed, what has been paid since (green), what is left to
 * pay; a tag with the day to pay by (or Paid in full, or how late), and one with when the open statement closes.
 */
function BillBoxView({ bill, currency, cardId, range, closes }: { bill: ReturnType<typeof billBox>; currency: string; cardId: string; range: string | null; closes: ReturnType<typeof dueIn> | null }) {
  if (bill.state === 'no-terms') {
    return (
      <DeskBox title="Statement" icon={FileText} testId="card-bill">
        <p className="px-[20px] text-[13.5px] text-[var(--mk-ink-2)]">
          <Link to="/cards/$cardId/settings" params={{ cardId }} className="font-semibold text-[var(--mk-blue)] hover:underline">
            Add the billing date
          </Link>{' '}
          to see statements.
        </p>
      </DeskBox>
    );
  }
  // The open statement's closing day: "Closes in 7 days", "Closes tomorrow".
  const closesTag = closes && <Tag tone="grey">Closes {closes.text}</Tag>;
  if (bill.state === 'nothing') {
    return (
      <DeskBox title="Statement" icon={FileText} note={range} testId="card-bill">
        <p className="px-[20px] text-[13.5px] text-[var(--mk-ink-2)]">Nothing billed on {shortDate(bill.statementOn)}</p>
        {closesTag && <p className="mt-[10px] flex flex-wrap gap-[8px] px-[20px]">{closesTag}</p>}
      </DeskBox>
    );
  }
  const late = bill.state === 'due' && bill.due?.tone === 'late';
  const soon = bill.state === 'due' && bill.due?.tone === 'soon';
  return (
    <DeskBox title="Statement" icon={FileText} note={range} testId="card-bill">
      <FigureRow label="Billed" value={formatMinor(bill.billMinor, currency)} />
      <FigureRow label="Paid" value={formatMinor(bill.paidMinor, currency)} tone={bill.paidMinor > 0 ? 'up' : 'grey'} testId="bill-paid" />
      <FigureRow label="Left to pay" value={formatMinor(bill.toPayMinor, currency)} strong testId="bill-to-pay" />
      <p className="mt-[10px] flex flex-wrap gap-[8px] px-[20px]">
        <span data-testid="bill-due" className="contents">
          {bill.state === 'paid' ? (
            <Tag tone="green">Paid in full</Tag>
          ) : late ? (
            <Tag tone="red">
              {bill.dueOn ? `Due ${shortDate(bill.dueOn)} · ` : ''}
              {bill.due?.text}
            </Tag>
          ) : bill.dueOn ? (
            <Tag tone={soon ? 'orange' : 'blue'}>
              Pay by {shortDate(bill.dueOn)}
              {soon && bill.due ? ` · ${bill.due.text}` : ''}
            </Tag>
          ) : null}
        </span>
        {closesTag}
      </p>
    </DeskBox>
  );
}

/** What a line is, in the Category column: the purchase's category (an instalment's, its purchase's), or a payment. */
function lineCategory(line: StatementLine, row: ListRow | undefined, accounts: readonly AccountRow[]): { id: string | null; name: string; transfer: boolean } {
  if (line.instalment) {
    const id = line.instalment.categoryId ?? null;
    return {
      id,
      name: (id && accounts.find((account) => account.id === id)?.name) || 'Instalment',
      transfer: false,
    };
  }
  if (!line.spending)
    return {
      id: null,
      name: line.owedMinor < 0 ? 'Payment' : 'Transfer',
      transfer: true,
    };
  if (row && (row.type === 'expense' || row.type === 'income'))
    return {
      id: row.categoryId,
      name: row.categoryName ?? 'Uncategorised',
      transfer: false,
    };
  return { id: null, name: row?.transferName ?? 'Purchase', transfer: true };
}

function StatementTable({
  lines,
  accounts,
  plastic,
  currency,
  rowOf,
  cover,
  points,
  unitLabel,
  cardColumn,
  peekKey,
  picked,
  onClick,
  onEdit,
  all,
}: {
  lines: readonly StatementLine[];
  accounts: readonly AccountRow[];
  plastic: readonly CardRow[];
  currency: string;
  rowOf: ReadonlyMap<string, ListRow>;
  cover: ReturnType<typeof statementCover>;
  points: ReturnType<typeof statementPointsOf> | null;
  unitLabel: string;
  cardColumn: boolean;
  peekKey: string | null;
  picked: readonly string[];
  onClick: (line: StatementLine, event: MouseEvent) => void;
  onEdit: (key: string) => void;
  /** Every statement's lines: no one cover says which are paid, so an unpaid charge draws no ring. */
  all: boolean;
}) {
  return (
    <table className="w-full table-fixed border-separate border-spacing-0" aria-label="Statement purchases">
      <colgroup>
        <col className="w-[38px]" />
        <col className="w-[72px]" />
        <col />
        <col className="w-[21%]" />
        {cardColumn && <col className="w-[72px]" />}
        <col className="w-[23%]" />
        <col className="w-[136px]" />
        {points && <col className="w-[90px]" />}
      </colgroup>
      <thead>
        <tr>
          <th className={TH}>
            <span className="sr-only">Paid</span>
          </th>
          <th className={TH}>Date</th>
          <th className={TH}>Note</th>
          <th className={TH}>Category</th>
          {cardColumn && <th className={TH}>Card</th>}
          <th className={TH}>Paid</th>
          <th className={cx(TH, 'text-right')}>Amount</th>
          {points && <th className={cx(TH, 'text-right')}>{unitLabel}</th>}
        </tr>
      </thead>
      <tbody>
        {lines.map((line) => {
          const isPicked = picked.includes(line.transactionId);
          const selected = peekKey === line.key || isPicked;
          const category = lineCategory(line, rowOf.get(line.transactionId), accounts);
          const paid = showsPaid(line, cover) || !!line.feeSettled;
          const how = paid ? (paidHowText(line, cover) ?? 'Paid') : null;
          const earned = !line.instalment && points?.[line.transactionId];
          const last4 = plastic.find((piece) => piece.id === line.cardId)?.last4;
          // Left out of reports (an annual fee and its reversal, owner 22 Nov 2026): still on the bill, marked ⊘.
          const leftOut = !line.instalment && !!rowOf.get(line.transactionId)?.excluded;
          return (
            <tr
              key={line.key}
              data-testid="card-row"
              data-peek-row={line.key}
              aria-selected={selected}
              tabIndex={0}
              title="Click to see it · ⌘-click several to pay just those · double-click to edit"
              onClick={(event) => onClick(line, event)}
              onDoubleClick={() => onEdit(line.key)}
              onKeyDown={(event) => {
                if (event.target !== event.currentTarget) return;
                if (event.key === 'Enter') {
                  event.preventDefault();
                  onEdit(line.key);
                }
              }}
              className={cx(rowClass(selected), line.convertedTo && 'opacity-60')}
            >
              <td className={cx(TD, 'pl-[12px]')}>
                {paid ? (
                  <Check size={16} strokeWidth={2.6} className="text-[var(--mk-c-green)]" aria-label={how ?? 'Paid'} data-testid="card-row-paid" />
                ) : isPicked ? (
                  <span aria-label="Picked to pay" className="flex h-[16px] w-[16px] items-center justify-center rounded-full bg-[var(--mk-blue)] text-white">
                    <Check size={11} strokeWidth={3.4} aria-hidden />
                  </span>
                ) : isCharge(line) && !all ? (
                  <span aria-hidden className="block h-[16px] w-[16px] rounded-full border-[1.6px] border-[var(--mk-ink-3)]" />
                ) : null}
              </td>
              <td className={cx(TD, 'text-[var(--mk-ink-2)] tabular-nums')}>{shortDate(line.occurredOn)}</td>
              <td className={cx(TD, 'truncate')} title={line.description}>
                {line.description}
                {line.instalment && (
                  <span className="ml-[6px] rounded-full bg-[var(--mk-t-grey-bg)] px-[7px] py-[1px] text-[11.5px] font-semibold text-[var(--mk-t-grey)] tabular-nums">
                    {line.instalment.number} of {line.instalment.of}
                  </span>
                )}
              </td>
              <td className={TD}>
                <span className="flex min-w-0 items-center gap-[7px]">
                  <CategoryIcon categoryId={category.id} accounts={accounts} transfer={category.transfer} size="xs" />
                  <span className="truncate">{category.name}</span>
                </span>
              </td>
              {cardColumn && <td className={cx(TD, 'text-[var(--mk-ink-2)] tabular-nums')}>{last4 ? `•${last4}` : '—'}</td>}
              <td className={cx(TD, 'truncate text-[12px] font-semibold text-[var(--mk-t-green)]')} title={how ?? undefined}>
                {how}
              </td>
              <td className={cx(TD, 'text-right tabular-nums', line.owedMinor < 0 && 'text-[var(--mk-t-green)]', line.convertedTo && 'line-through')}>
                {leftOut && (
                  <span className="mr-[5px] text-[var(--mk-ink-2)]" title="Left out of reports" aria-label="Left out of reports">
                    ⊘
                  </span>
                )}
                {line.owedMinor < 0 ? `−${formatMinor(-line.owedMinor, currency)}` : formatMinor(line.owedMinor, currency)}
              </td>
              {points && (
                <td className={cx(TD, 'text-right text-[var(--mk-t-green)] tabular-nums')} data-testid="card-row-points">
                  {earned ? `${earned.approximate ? '≈ ' : ''}${earned.points < 0 ? '−' : '+'}${formatPoints(Math.abs(earned.points))}` : ''}
                </td>
              )}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
