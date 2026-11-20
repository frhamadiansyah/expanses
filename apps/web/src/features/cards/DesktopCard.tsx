import { formatMinor, isCardCashbackKey, monthName } from '@expanses/core';
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
import { DeskBox, DeskFace, DeskTitleBar, FigureRow, BOX_GRID, FIRST_BOX, GBTN, GearLink, PBTN, PEEK_ROOM } from '../accounts/desk-account-parts';
import { CategoryIcon } from '../categories/CategoryIcon';
import { InstallmentList } from '../loans/InstallmentList';
import { useInstallments } from '../loans/queries';
import { creditMinor, owedMinor } from '../networth/debt-rows';
import { OwnJointRows } from '../sharing/JointAccountRows';
import { isEditable } from '../transactions/draft';
import { buildRows, type ListRow } from '../transactions/list-model';
import { ReceiptPeek } from '../transactions/ReceiptPeek';
import { useWalletCards } from '../wallet/useWalletCards';
import { rewardText, standingText } from './CardBack';
import { billBox, cashbackMinor, choiceBack, newestFirst, pickedPay, showsCardColumn, showsPointsColumn, type StatementChoice } from './card-desk-model';
import { type CardPage, statementPointsOf } from './card-page';
import { cardPayLink, statementPayLink } from './card-pay';
import { useAnnualFees } from './fee-due';
import { challengeCoversFee } from './fee-line';
import { useFeeWaivedStatus, waivedLine } from './fee-waived-status';
import { cardBackFigure, dueNowMinor, laterInstalmentsMinor, limitUsage } from './limit-usage';
import { useSpendBonuses } from './spend-bonuses';
import { payableLine, showsPaid, statementCover } from './statement-cover';
import { cycleBack } from './statement-dates';
import { formatPoints, pointsValue, shortDate } from './useCardPoints';

const TH = 'border-b border-[var(--ph-hair)] bg-[var(--mac-head)] px-[10px] py-[6px] text-left text-[11px] font-semibold whitespace-nowrap text-[var(--ph-ink-3)]';
const TD = 'px-[10px] py-[5px] whitespace-nowrap';
/** Rows read to name each statement line's category: more than a card's statements ever hold. */
const READ_LIMIT = 20_000;

const CHOICES: { value: StatementChoice; label: string }[] = [
  { value: 'this', label: 'This statement' },
  { value: 'last', label: 'Last' },
  { value: 'all', label: 'All' },
];

/**
 * A credit card on a wide screen (Mac account pages, owner 2026-11-20): `/cards/$cardId` full width. The title bar holds
 * the name with "Credit card · ···· 4417", the This / Last / All statement switch, Spend (the Add screen on this card),
 * Statement (the statement page, with its check, search and fixes), ⚙ (the card's settings) and the black Pay — today's
 * "Pay credit card" screen, filled with the bill.
 *
 * Boxes: Outstanding — Wallet's face and figure (what is due now, as Wallet and the sidebar print it), the limit bar and
 * what is left to spend; the last statement's bill — what is left to pay, what has been paid since and when it is due, as
 * the phone's card page says it; the miles or points this statement earns, with the annual fee and the cashback put on
 * the card. Then the chosen statement's purchases, newest first, with a Card column when a supplementary card is on the
 * account and a miles or points column when the card works them out. A click opens the Mac receipt in the side peek, a
 * double-click today's edit screen; ⌘-click picks purchases, and Pay then pays just those — the statement's own Pay for
 * chosen purchases (`statementPayLink`).
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
  const [choice, setChoice] = useState<StatementChoice>('this');
  const back = choiceBack(choice);
  const cycle = statementDay && back !== null ? cycleBack(today, statementDay, back) : null;
  const statement = useQuery({
    queryKey: ['card-statement', ws.workspaceId, card.id, cycle?.start ?? '-', today],
    enabled: cycle !== null,
    queryFn: () => cardStatement(database, ws, card.id, cycle!, today),
  });
  const everything = useQuery({
    queryKey: ['card-statement-lines', ws.workspaceId, card.id],
    enabled: choice === 'all' && statementDay !== null,
    queryFn: () => cardStatementLines(database, ws, card.id),
  });
  const currentEnd = statementDay ? cycleBack(today, statementDay, 0).end : today;
  const lines: StatementLine[] =
    choice === 'all' ? newestFirst((everything.data ?? []).filter((line) => line.statementOn <= currentEnd)) : newestFirst(statement.data?.lines ?? []);
  const cover = statement.data && choice !== 'all' ? statementCover(statement.data) : new Map();
  // Each line's transaction, for its category and its edit screen: owner-wide, as the statement is.
  const earliest = lines.reduce((first, line) => (line.occurredOn < first ? line.occurredOn : first), today);
  const txs = useQuery({
    queryKey: ['card-desk-rows', ws.workspaceId, card.id, earliest],
    enabled: lines.length > 0,
    queryFn: () => listTransactions(database, ownerScope(ws), { accountIds: [card.id], from: earliest, limit: READ_LIMIT }),
  });
  const rowOf = new Map(buildRows(txs.data ?? [], [], accounts, []).map((row) => [row.id, row]));
  const cashbackId = (id: string | null) => !!id && isCardCashbackKey(accounts.find((account) => account.id === id)?.systemKey);
  const points = showsPointsColumn(cp) ? statementPointsOf(cp) : null;
  const cardColumn = showsCardColumn(plastic);

  // ── ⌘-picked purchases, and the peek ───────────────────────────────────────────────────────────────────────────────
  const [picked, setPicked] = useState<string[]>([]);
  useEffect(() => setPicked([]), [choice]);
  const chosen = pickedPay(choice === 'all' ? undefined : statement.data, picked);
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
  const openPlan = (line: StatementLine) => line.instalment && void navigate({ to: '/cards/$cardId/settings/instalments/$planId', params: { cardId: card.id, planId: line.instalment.planId } });
  const click = (line: StatementLine, event: MouseEvent) => {
    if (event.metaKey || event.ctrlKey) {
      // ⌘-click picks a purchase the statement still lets be paid (the phone's tick); anything else is left alone.
      if (choice === 'all' || !payableLine(line, cover)) return;
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
    if (tx && isEditable(tx)) void navigate({ to: '/transactions/$transactionId/edit', params: { transactionId: tx.id } });
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
  const titleLine = ['Credit card', primary?.last4 ? `···· ${primary.last4}` : null].filter(Boolean).join(' · ');
  const tableTitle = choice === 'this' ? 'This statement' : choice === 'last' ? 'Last statement' : 'All statements';
  const range = cycle ? `${shortDate(cycle.start)} – ${shortDate(cycle.end)}` : null;
  const payLabel = chosen.purchases.length > 0 ? `Pay ${chosen.purchases.length} purchase${chosen.purchases.length === 1 ? '' : 's'}` : 'Pay';

  return (
    <div className="min-h-dvh bg-[var(--ov-ground)]" data-testid="card-desk" data-desk="true" {...doubleClick}>
      <DeskTitleBar title={card.name} line={titleLine} barRef={(node) => (bar.current = node)}>
        {statementDay !== null && (
          <div role="radiogroup" aria-label="Statement" className="flex rounded-[7px] bg-[var(--ph-fill)] p-[2px] text-[12px]">
            {CHOICES.map((one) => (
              <button
                key={one.value}
                type="button"
                role="radio"
                aria-checked={choice === one.value}
                onClick={() => setChoice(one.value)}
                className={cx(
                  'rounded-[5px] px-[10px] py-[3px] whitespace-nowrap',
                  choice === one.value ? 'bg-[var(--ph-selected)] font-medium text-[var(--ph-ink)] shadow-[0_0.5px_1.5px_rgba(0,0,0,0.18)]' : 'text-[var(--ph-ink-2)]',
                )}
              >
                {one.label}
              </button>
            ))}
          </div>
        )}
        <span role="group" aria-label="Actions" className="flex items-center gap-[8px]">
          <Link to="/transactions/new" search={{ mode: 'expense', account: card.id, fixed: true }} className={GBTN}>
            Spend
          </Link>
          <Link to="/cards/$cardId/statement" params={{ cardId: card.id }} className={GBTN}>
            Statement
          </Link>
          <GearLink to="/cards/$cardId/settings" params={{ cardId: card.id }} />
          <button
            type="button"
            className={PBTN}
            data-testid="card-desk-pay"
            onClick={() => void navigate(chosen.purchases.length > 0 && cycle ? statementPayLink(card.id, cycle, today, chosen.purchases.map((one) => one.transactionId)) : payLink)}
          >
            {payLabel}
          </button>
        </span>
      </DeskTitleBar>
      <DeskNotices />

      <div className={cx('@container space-y-[14px] px-[20px] py-[16px]', peeking && PEEK_ROOM)}>
        <ErrorBox error={balances.error ?? last.error ?? statement.error ?? everything.error ?? txs.error} />
        <div className={BOX_GRID}>
          {/* The phone's card back is these two boxes: what is outstanding, and the bill. */}
          <div data-testid="tile-left-to-pay" className="contents">
            <DeskBox title={<span data-testid="tile-figure-label">{backFigure.label}</span>} note="today" testId="card-outstanding" className={FIRST_BOX}>
              <div className="flex flex-wrap items-start gap-x-[16px] gap-y-[8px] px-[14px] pt-[4px] pb-[14px]">
                {face && <DeskFace card={face} />}
                <div className="min-w-0 flex-1 pt-[4px]">
                  <p data-testid="tile-unpaid-balance" className={cx('text-[22px] leading-[28px] font-semibold whitespace-nowrap tabular-nums', backFigure.label === 'Credit' ? 'text-[var(--ph-up)]' : 'text-[var(--ph-ink)]')}>
                    {formatMinor(backFigure.minor, currency)}
                  </p>
                  {cp.limitMinor !== null && cp.limitMinor > 0 ? (
                    <p className="text-[12px] text-[var(--ph-ink-3)] tabular-nums">of {formatMinor(cp.limitMinor, currency)} limit</p>
                  ) : (
                    <p className="text-[12px] text-[var(--ph-ink-3)]">No limit set</p>
                  )}
                  {usage.usedPct !== null && (
                    <div className="mt-[8px] flex h-[6px] max-w-[220px] overflow-hidden rounded-full bg-[var(--ph-track)]" data-testid="limit-bar">
                      <div className="h-full" style={{ width: `${usage.barUsedPct}%`, background: (usage.usedPct ?? 0) >= 80 ? 'var(--ph-warn)' : 'var(--ph-ink)' }} />
                      {usage.barHeldPct > 0 && (
                        <div
                          className="h-full"
                          title="Held by instalments"
                          style={{ width: `${usage.barHeldPct}%`, backgroundImage: 'repeating-linear-gradient(135deg, var(--ph-ink-2) 0 3px, var(--ph-ink-3) 3px 6px)' }}
                        />
                      )}
                    </div>
                  )}
                  {usage.availableMinor !== null && (
                    <p data-testid="card-available" className={cx('mt-[8px] text-[12px] tabular-nums', usage.availableMinor < 0 ? 'font-medium text-[var(--ph-alarm)]' : 'text-[var(--ph-ink-3)]')}>
                      {usage.availableMinor < 0 ? `Over the limit by ${formatMinor(-usage.availableMinor, currency)}` : `${formatMinor(usage.availableMinor, currency)} left to spend`}
                    </p>
                  )}
                  {usage.heldMinor > 0 && <p className="text-[12px] text-[var(--ph-ink-3)] tabular-nums">{formatMinor(usage.heldMinor, currency)} in instalments not billed yet</p>}
                </div>
              </div>
            </DeskBox>
            <BillBoxView bill={bill} currency={currency} cardId={card.id} />
          </div>
          <DeskBox title={unitLabel} note="this statement" testId="tile-points">
            {cp.program && earned !== null && (
              <div className="px-[14px] pb-[8px]">
                <p data-testid="desk-points" className="text-[22px] leading-[28px] font-semibold text-[var(--ph-ink)] tabular-nums">
                  +{formatPoints(earned)} {unit}
                </p>
                <p className="text-[12px] text-[var(--ph-ink-3)] tabular-nums">
                  {[worth ? `≈ ${formatMinor(worth.valueMinor, worth.currency)}` : null, ledger.data ? `${formatPoints(ledger.data.balance.total)} in ${cp.programme?.name ?? cp.program.name}` : null].filter(Boolean).join(' · ')}
                </p>
              </div>
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
            {!cp.program && (
              <Link to="/cards/$cardId/settings" params={{ cardId: card.id }} data-testid="back-points" className="block border-t border-[var(--ph-hair)] px-[14px] py-[7px] text-[12.5px] text-[var(--ph-ink-3)] hover:bg-[var(--ph-fill)]">
                Rewards are not set up for this card.
              </Link>
            )}
            {cp.program && (
              <Link to="/cards/$cardId/points" params={{ cardId: card.id }} data-testid="desk-points-link" className="block border-t border-[var(--ph-hair)] px-[14px] py-[7px] text-[12.5px] text-[var(--mac-accent)] hover:bg-[var(--ph-fill)]">
                {unitLabel} this statement ›
              </Link>
            )}
          </DeskBox>
        </div>

        <DeskBox
          title={tableTitle}
          testId="card-table"
          note={
            chosen.purchases.length > 0 ? (
              <span className="flex items-baseline gap-[10px]" data-testid="card-picked">
                <span className="text-[var(--ph-ink)]">
                  {chosen.purchases.length} picked · {formatMinor(chosen.totalMinor, currency)} · Pay pays just these
                </span>
                <button type="button" onClick={() => setPicked([])} className="text-[12px] text-[var(--mac-accent)] hover:underline">
                  Clear
                </button>
              </span>
            ) : (
              [range, 'click a row to see it', choice === 'all' ? null : '⌘-click several to pay just those'].filter(Boolean).join(' · ')
            )
          }
        >
          {statementDay === null ? (
            <p className="px-[14px] pb-[12px] text-[13px] text-[var(--ph-ink-3)]">
              Statements are cut on the billing date.{' '}
              <Link to="/cards/$cardId/settings" params={{ cardId: card.id }} className="text-[var(--mac-accent)] hover:underline">
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
            />
          )}
          {statementDay !== null && (choice === 'all' ? everything.isSuccess : statement.isSuccess) && lines.length === 0 && (
            <p className="border-t border-[var(--ph-hair)] px-[14px] py-[12px] text-[13px] text-[var(--ph-ink-3)]">Nothing on this statement.</p>
          )}
        </DeskBox>

        {(plans.data ?? []).length > 0 && (
          <div className="max-w-[720px]">
            <InstallmentList cardAccountId={card.id} currency={currency} />
          </div>
        )}
        <div className="max-w-[720px] empty:hidden">
          <OwnJointRows accountId={card.id} />
        </div>
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
      className="flex items-start gap-[10px] border-t border-[var(--ph-hair)] px-[14px] py-[8px] text-[13px] text-[var(--ph-ink)] hover:bg-[var(--ph-fill)]"
    >
      <span className="shrink-0 pt-[2px]">
        <ProgressRing fraction={item.fraction} reached={item.reached} size={32} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-baseline justify-between gap-x-2">
          <b className="font-semibold">{item.name}</b>
          <span className="tabular-nums">{rewardText(item, unit, currency)}</span>
        </span>
        <span className="block text-[11.5px] text-[var(--ph-ink-3)] tabular-nums">
          {item.kind === 'challenge' && challengeNote ? <span className="font-medium text-[var(--ph-up)]">{challengeNote}</span> : standingText(item, currency)}
          {more > 0 ? ` · + ${more} more` : ''}
        </span>
      </span>
    </Link>
  );
}

/** The last statement's bill: what is left to pay, what has been paid since, and when it is due — or why there is none. */
function BillBoxView({ bill, currency, cardId }: { bill: ReturnType<typeof billBox>; currency: string; cardId: string }) {
  if (bill.state === 'no-terms') {
    return (
      <DeskBox title="Statement" testId="card-bill">
        <p className="px-[14px] pb-[12px] text-[13px] text-[var(--ph-ink-3)]">
          <Link to="/cards/$cardId/settings" params={{ cardId }} className="text-[var(--mac-accent)] hover:underline">
            Add the billing date
          </Link>{' '}
          to see statements.
        </p>
      </DeskBox>
    );
  }
  if (bill.state === 'nothing') {
    return (
      <DeskBox title={`Statement ${shortDate(bill.statementOn)}`} testId="card-bill">
        <p className="px-[14px] pb-[12px] text-[13px] text-[var(--ph-ink-3)]">Nothing billed on {shortDate(bill.statementOn)}</p>
      </DeskBox>
    );
  }
  return (
    <DeskBox title={`Statement ${shortDate(bill.statementOn)}`} note={bill.dueOn ? `due ${shortDate(bill.dueOn)}` : undefined} testId="card-bill">
      <FigureRow label="To pay" value={formatMinor(bill.toPayMinor, currency)} testId="bill-to-pay" />
      <FigureRow label="Paid so far" value={formatMinor(bill.paidMinor, currency)} tone="grey" testId="bill-paid" />
      <FigureRow
        label="Due in"
        testId="bill-due"
        value={bill.state === 'paid' ? 'Paid in full' : (bill.due?.text.replace(/^in /, '') ?? '—')}
        tone={bill.state === 'paid' ? 'up' : bill.due?.tone === 'late' ? 'alarm' : bill.due?.tone === 'soon' ? 'warn' : undefined}
      />
    </DeskBox>
  );
}

/** What a line is, in the Category column: the purchase's category (an instalment's, its purchase's), or a payment. */
function lineCategory(line: StatementLine, row: ListRow | undefined, accounts: readonly AccountRow[]): { id: string | null; name: string; transfer: boolean } {
  if (line.instalment) {
    const id = line.instalment.categoryId ?? null;
    return { id, name: (id && accounts.find((account) => account.id === id)?.name) || 'Instalment', transfer: false };
  }
  if (!line.spending) return { id: null, name: line.owedMinor < 0 ? 'Payment' : 'Transfer', transfer: true };
  if (row && (row.type === 'expense' || row.type === 'income')) return { id: row.categoryId, name: row.categoryName ?? 'Uncategorised', transfer: false };
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
}) {
  return (
    <table className="w-full table-fixed border-collapse text-[13px]" aria-label="Statement purchases">
      <colgroup>
        <col className="w-[66px]" />
        <col />
        <col className="w-[22%]" />
        {cardColumn && <col className="w-[72px]" />}
        <col className="w-[134px]" />
        {points && <col className="w-[96px]" />}
      </colgroup>
      <thead>
        <tr>
          <th className={TH}>Date ↓</th>
          <th className={TH}>Note</th>
          <th className={TH}>Category</th>
          {cardColumn && <th className={TH}>Card</th>}
          <th className={cx(TH, 'text-right')}>Amount</th>
          {points && <th className={cx(TH, 'text-right')}>{unitLabel}</th>}
        </tr>
      </thead>
      <tbody>
        {lines.map((line, index) => {
          const selected = peekKey === line.key || picked.includes(line.transactionId);
          const grey = selected ? 'text-white/80' : 'text-[var(--ph-ink-3)]';
          const category = lineCategory(line, rowOf.get(line.transactionId), accounts);
          const done = showsPaid(line, cover);
          const earned = !line.instalment && points?.[line.transactionId];
          const last4 = plastic.find((piece) => piece.id === line.cardId)?.last4;
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
              className={cx(
                'cursor-default select-none focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--mac-accent)]',
                selected ? 'bg-[var(--mac-accent)] text-white' : cx('text-[var(--ph-ink)]', index % 2 === 1 && 'bg-[var(--mac-zebra)]'),
                line.convertedTo && 'opacity-60',
              )}
            >
              <td className={cx(TD, 'tabular-nums', grey)}>{shortDate(line.occurredOn)}</td>
              <td className={cx(TD, 'truncate')}>
                {line.description}
                {line.instalment && (
                  <span className={cx('ml-[6px] rounded-full px-[6px] text-[11px] tabular-nums', selected ? 'bg-white/20' : 'bg-[var(--ph-fill)] text-[var(--ph-ink-2)]')}>
                    {line.instalment.number} of {line.instalment.of}
                  </span>
                )}
              </td>
              <td className={cx(TD, selected && '[&_[data-testid=category-mark]]:bg-white!')}>
                <span className="flex min-w-0 items-center gap-[7px]">
                  <CategoryIcon categoryId={category.id} accounts={accounts} transfer={category.transfer} size="xs" />
                  <span className="truncate">{category.name}</span>
                </span>
              </td>
              {cardColumn && <td className={cx(TD, 'tabular-nums', grey)}>{last4 ? `•${last4}` : '—'}</td>}
              <td className={cx(TD, 'text-right tabular-nums', !selected && line.owedMinor < 0 && 'text-[var(--ph-up)]', !selected && done && line.owedMinor > 0 && 'text-[var(--ph-ink-3)]', line.convertedTo && 'line-through')}>
                {line.owedMinor < 0 ? `−${formatMinor(-line.owedMinor, currency)}` : formatMinor(line.owedMinor, currency)}
              </td>
              {points && (
                <td className={cx(TD, 'text-right tabular-nums', !selected && 'text-[var(--ph-up)]')} data-testid="card-row-points">
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
