import { addMonths, formatMinor, isoDate, monthName, monthPeriod, periodMonthOf } from '@expanses/core';
import { type AccountRow, listTransactions, ownerScope } from '@expanses/db';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useApp } from '../../app/context';
import { DeskNotices } from '../../app/DeskNotices';
import { Sheet } from '../../app/Sheet';
import { SUBTYPE_LABELS } from '../../lib/account-types';
import { useAccounts, useBalances } from '../../lib/queries';
import { cx, ErrorBox } from '../../ui';
import { approxLine, type RoundAction } from '../../ui/native';
import { usePeekDoubleClick } from '../../ui/native/peek-double-click';
import { PEEK_BUTTON, SidePeek } from '../../ui/native/SidePeek';
import { CategoryIcon } from '../categories/CategoryIcon';
import { useSetAsideView } from '../goals/queries';
import { AssetSettingsPage } from '../networth/AssetSettingsPage';
import { isCardPayment } from '../cards/card-pay';
import { isEditable } from '../transactions/draft';
import { buildRows, type ListRow } from '../transactions/list-model';
import { ReceiptPeek } from '../transactions/ReceiptPeek';
import { useWalletCards } from '../wallet/useWalletCards';
import { useMonthStart } from '../workspaces/queries';
import { type AccountMove, accountMonth, balancesAfter, monthEndBalances, moveOf } from './account-desk-model';
import { ADJUST_FORM, actionsFor, MONEY_IN_FORM, type NewTxDraft } from './AccountPage';
import { AdjustBalanceForm } from './AdjustBalanceForm';
import { adjustTitle } from './adjust-model';
import { DeskBox, DeskFace, DeskTitleBar, FigureRow, GBTN, BOX_GRID, FIRST_BOX, GearLink, MonthsLine, PBTN, PEEK_ROOM, signedMoney } from './desk-account-parts';
import { MONEY_IN, MoneyInForm, type MoneyInMode } from './MoneyInForm';
import { spendsFrom } from './pockets';
import { useHeldRates } from './queries';

/** How many months the Balance over time line covers, the one shown last. */
const LINE_MONTHS = 6;
/** Rows read for the line and the table: more than any account moves in six months. */
const READ_LIMIT = 20_000;

const TH = 'border-b border-[var(--ph-hair)] bg-[var(--mac-head)] px-[10px] py-[6px] text-left text-[11px] font-semibold whitespace-nowrap text-[var(--ph-ink-3)]';
const TD = 'px-[10px] py-[5px] whitespace-nowrap';

const shortDay = (iso: string) => `${Number(iso.slice(8, 10))} ${monthName(iso.slice(0, 7), 'short')}`;

/** One row of the table: the list's own reading of the transaction, what it moved the account by, and the balance after. */
interface DeskRow {
  row: ListRow;
  minor: number;
  after: number;
}

/**
 * A bank, cash or e-wallet account on a wide screen (Mac account pages, owner 2026-11-20): `/accounts/$accountId` full
 * width, like the other Mac pages. The title bar holds the name and kind, the month ‹ ›, the account's own actions
 * (Transfer, Withdraw or Top up, Adjust, Statement — today's, each opening what the phone's round button opens), the ⚙
 * that opens its settings in the side peek, and the black ＋ Record (the Add screen paid with it).
 *
 * Boxes: Balance — the face Wallet draws, today's figure (Wallet's, the sidebar's and the phone's own), and what goals
 * and bills have set aside of it; This month — in, out, transfers and the change they add up to; Balance over time —
 * each of the last six months' closing balance. Then every row of the month, newest first, with the balance after it, as
 * a bank statement prints it. A click opens the Mac receipt in the side peek, a double-click today's edit screen. The
 * whole history, with search, ticks and deletes, stays the list See all opens (`/transactions?account=`).
 */
export function DesktopAccount({ account, parent }: { account: AccountRow; parent: AccountRow | undefined }) {
  const { database, ws } = useApp();
  const navigate = useNavigate();
  const accounts = useAccounts();
  const everything = accounts.data ?? [];
  const balances = useBalances();
  const { cards } = useWalletCards();
  const face = cards.find((card) => card.key === account.id);
  const currency = account.currency ?? ws.baseCurrency;
  const todayMinor = balances.data?.[account.id] ?? 0;
  const today = isoDate();
  const startDay = useMonthStart();
  const thisMonth = periodMonthOf(today, startDay);
  const [month, setMonth] = useState(thisMonth);
  const period = monthPeriod(month, startDay);
  const months = Array.from({ length: LINE_MONTHS }, (_, index) => addMonths(month, index - (LINE_MONTHS - 1))).map((m) => ({ month: m, to: monthPeriod(m, startDay).to }));
  const from = monthPeriod(months[0]!.month, startDay).from;
  const rates = useHeldRates([currency]);
  const setAside = useSetAsideView(account.id).data;

  // Every row from the line's first month on, owner-wide as the phone's Recent and line are, so the figures agree with
  // the balance; future-dated rows included, since the balance counts them.
  const history = useQuery({
    queryKey: ['account-desk', ws.workspaceId, account.id, from],
    queryFn: () => listTransactions(database, ownerScope(ws), { accountIds: [account.id], from, limit: READ_LIMIT }),
  });
  const ids = new Set([account.id]);
  const rows = buildRows(history.data ?? [], [], everything, []).filter((row) => row.tx);
  const moves: AccountMove[] = rows.flatMap((row) => {
    const minor = moveOf(row.tx!, ids);
    return minor === 0 ? [] : [{ id: row.id, on: row.date, minor, type: row.type }];
  });
  const after = balancesAfter(moves, todayMinor);
  const minorOf = new Map(moves.map((move) => [move.id, move.minor]));
  const figures = accountMonth(moves, period);
  const line = monthEndBalances(moves, todayMinor, months);
  // The month's rows, newest first; an opening balance is how the account was started, not something that happened to
  // it, so it stays out of the table as it stays out of the list (the box names it).
  const shown: DeskRow[] = rows
    .filter((row) => row.date >= period.from && row.date <= period.to && row.type !== 'opening' && minorOf.has(row.id))
    .map((row) => ({ row, minor: minorOf.get(row.id)!, after: after.get(row.id)! }));

  // ── The peek: one row's receipt, or the account's settings ─────────────────────────────────────────────────────────
  const [peekId, setPeekId] = useState<string | null>(null);
  const [settings, setSettings] = useState(false);
  const peeked = peekId ? shown.find((one) => one.row.id === peekId) : undefined;
  const peeking = peeked !== undefined || settings;
  const order = shown.map((one) => one.row.id);
  const at = peekId ? order.indexOf(peekId) : -1;
  const step = (by: -1 | 1) => {
    const next = order[Math.min(order.length - 1, Math.max(0, at + by))];
    if (next) setPeekId(next);
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
    if (!peeking) return;
    const target = event.target as HTMLElement | null;
    const typing = !!target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable);
    if (typing || document.querySelector('[role="dialog"]')) return;
    if (event.key === 'Escape') {
      setPeekId(null);
      setSettings(false);
    } else if (peekId && event.key === 'ArrowUp') step(-1);
    else if (peekId && event.key === 'ArrowDown') step(1);
    else return;
    event.preventDefault();
  };
  useEffect(() => {
    const listen = (event: KeyboardEvent) => keys.current(event);
    document.addEventListener('keydown', listen);
    return () => document.removeEventListener('keydown', listen);
  }, []);
  // Today's edit screen; a row that cannot be changed here (another workspace's, a trade) keeps its receipt, which says why.
  const edit = (id: string) => {
    const tx = shown.find((one) => one.row.id === id)?.row.tx;
    if (tx && isEditable(tx)) void navigate({ to: '/transactions/$transactionId/edit', params: { transactionId: id } });
  };
  const doubleClick = usePeekDoubleClick((id) => edit(id));

  // ── The actions: today's, as the phone's round buttons are ─────────────────────────────────────────────────────────
  const [adjusting, setAdjusting] = useState(false);
  const [movingIn, setMovingIn] = useState<MoneyInMode | null>(null);
  const [sheetReady, setSheetReady] = useState(false);
  const newTx = (draft: NewTxDraft) =>
    void navigate({ to: '/transactions/new', search: { mode: draft.mode, ...(draft.account ? { account: draft.account } : {}), ...(draft.to ? { to: draft.to } : {}) } });
  const actions = actionsFor(account, null, ws.baseCurrency, { newTx, moneyIn: setMovingIn, adjust: () => setAdjusting(true) });
  // Spend and Receive are one Record here (the Add screen, Expense, Income and Transfer as its tabs), the black button.
  const records = actions.some((action) => ['add', 'spend', 'receive'].includes(action.key));
  const others = actions.filter((action) => !['add', 'spend', 'receive'].includes(action.key));

  const kind = [SUBTYPE_LABELS[account.subtype], currency].join(' · ');
  const title = parent ? `${parent.name} · ${currency}` : account.name;
  const foreign = currency !== ws.baseCurrency ? approxLine(todayMinor, currency, ws.baseCurrency, rates.data?.rates ?? {}) : null;
  const counted = spendsFrom(account, everything);
  const setAsideFor = setAside && setAside.state !== 'none' ? (setAside.goals.length > 0 && setAside.funds.length > 0 ? 'goals and bills' : setAside.funds.length > 0 ? 'bills' : 'goals') : null;

  return (
    <div className="min-h-dvh bg-[var(--ov-ground)]" data-testid="account-desk" data-desk="true" {...doubleClick}>
      <DeskTitleBar title={title} line={kind} barRef={(node) => (bar.current = node)}>
        <span className="flex items-center gap-[2px] text-[12.5px] text-[var(--ph-ink)]" role="group" aria-label="Month">
          <button type="button" aria-label="Earlier month" onClick={() => setMonth((was) => addMonths(was, -1))} className="rounded-[5px] p-[3px] text-[var(--ph-ink-3)] hover:bg-[var(--ph-fill)]">
            <ChevronLeft size={15} aria-hidden />
          </button>
          <span data-testid="account-month" className="min-w-[104px] text-center whitespace-nowrap tabular-nums">
            {monthName(month, 'long')} {month.slice(0, 4)}
          </span>
          <button
            type="button"
            aria-label="Later month"
            disabled={month >= thisMonth}
            onClick={() => setMonth((was) => addMonths(was, 1))}
            className="rounded-[5px] p-[3px] text-[var(--ph-ink-3)] hover:bg-[var(--ph-fill)] disabled:opacity-30"
          >
            <ChevronRight size={15} aria-hidden />
          </button>
        </span>
        <span role="group" aria-label="Actions" className="flex items-center gap-[8px]">
          {others.map((action) => (
            <TitleAction key={action.key} action={action} />
          ))}
          <GearLink
            to="/net-worth/assets/$accountId/settings"
            params={{ accountId: account.id }}
            pressed={settings}
            onPeek={() => {
              setPeekId(null);
              setSettings((was) => !was);
            }}
          />
          {records && (
            <button type="button" className={PBTN} onClick={() => newTx({ mode: 'expense', account: account.id })}>
              <span aria-hidden>＋</span>Record
            </button>
          )}
        </span>
      </DeskTitleBar>
      <DeskNotices />

      <div className={cx('@container space-y-[14px] px-[20px] py-[16px]', peeking && PEEK_ROOM)}>
        <ErrorBox error={balances.error ?? history.error ?? accounts.error} />
        <div className={BOX_GRID}>
          <DeskBox title="Balance" note="today" testId="balance-card" className={FIRST_BOX}>
            <div className="flex flex-wrap items-start gap-x-[16px] gap-y-[8px] px-[14px] pt-[4px] pb-[14px]">
              {face && <DeskFace card={face} />}
              <div className="min-w-0 pt-[4px]">
                <p data-testid="account-balance" className="text-[22px] leading-[28px] font-semibold whitespace-nowrap text-[var(--ph-ink)] tabular-nums">
                  {formatMinor(todayMinor, currency)}
                </p>
                {foreign && <p className="text-[12px] text-[var(--ph-ink-3)] tabular-nums">{foreign}</p>}
                <p className="mt-[2px] text-[12px] text-[var(--ph-ink-3)]">{counted ? 'counts toward spending' : 'kept as savings, off Wallet’s spending money'}</p>
                {setAside && setAsideFor && (
                  <p data-testid="account-setaside" className={cx('mt-[8px] text-[12px] tabular-nums', setAside.state === 'short' ? 'text-[var(--ph-warn)]' : 'text-[var(--ph-ink-3)]')}>
                    {formatMinor(setAside.setAsideMinor, currency)} set aside for {setAsideFor} · {formatMinor(setAside.freeMinor, currency)} free
                  </p>
                )}
              </div>
            </div>
          </DeskBox>
          <DeskBox title="This month" note={monthName(month, 'long')} testId="account-month-box">
            <FigureRow label="Money in" value={formatMinor(figures.inMinor, currency)} tone={figures.inMinor > 0 ? 'up' : undefined} testId="month-in" />
            <FigureRow label="Money out" value={formatMinor(figures.outMinor, currency)} testId="month-out" />
            {figures.transferInMinor > 0 && <FigureRow label="Transfers in" value={formatMinor(figures.transferInMinor, currency)} tone="grey" testId="month-transfers-in" />}
            <FigureRow label="Transfers out" value={formatMinor(figures.transferOutMinor, currency)} tone="grey" testId="month-transfers-out" />
            {figures.adjustedMinor !== 0 && <FigureRow label="Adjusted" value={signedMoney(figures.adjustedMinor, currency)} tone="grey" testId="month-adjusted" />}
            {figures.openingMinor !== 0 && <FigureRow label="Opening balance" value={formatMinor(figures.openingMinor, currency)} tone="grey" testId="month-opening" />}
            <FigureRow label="Change" value={signedMoney(figures.changeMinor, currency)} tone={figures.changeMinor > 0 ? 'up' : undefined} testId="month-change" />
          </DeskBox>
          <DeskBox title="Balance over time" note={`${LINE_MONTHS} months`} testId="account-line">
            {history.isSuccess && balances.isSuccess && <MonthsLine points={line} currency={currency} />}
          </DeskBox>
        </div>

        <DeskBox
          title="Transactions"
          testId="account-table"
          note={
            <span className="flex items-baseline gap-[12px]">
              <span>click a row to see it · double-click to edit</span>
              <Link to="/transactions" search={{ account: account.id }} className="text-[12px] text-[var(--mac-accent)] hover:underline">
                See all
              </Link>
            </span>
          }
        >
          <table className="w-full table-fixed border-collapse text-[13px]" aria-label={`${title} transactions`}>
            {/* The figures keep their width whatever the page has; the words share what is left, and truncate. */}
            <colgroup>
              <col className="w-[66px]" />
              <col />
              <col className="w-[19%]" />
              <col className="w-[14%]" />
              <col className="w-[134px]" />
              <col className="w-[138px]" />
            </colgroup>
            <thead>
              <tr>
                <th className={TH}>Date ↓</th>
                <th className={TH}>Note</th>
                <th className={TH}>Category</th>
                <th className={TH}>From / to</th>
                <th className={cx(TH, 'text-right')}>Amount</th>
                <th className={cx(TH, 'text-right')}>Balance after</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((one, index) => (
                <AccountRowView
                  key={one.row.id}
                  one={one}
                  accountId={account.id}
                  accounts={everything}
                  currency={currency}
                  striped={index % 2 === 1}
                  selected={peekId === one.row.id}
                  onOpen={() => {
                    setSettings(false);
                    setPeekId(one.row.id);
                  }}
                  onEdit={() => edit(one.row.id)}
                />
              ))}
            </tbody>
          </table>
          {history.isSuccess && shown.length === 0 && <p className="border-t border-[var(--ph-hair)] px-[14px] py-[12px] text-[13px] text-[var(--ph-ink-3)]">Nothing moved in {monthName(month, 'long')}.</p>}
        </DeskBox>
      </div>

      {peeked && (
        <ReceiptPeek
          key={peeked.row.id}
          top={peekTop}
          testId="receipt-peek"
          transactionId={peeked.row.id}
          first={at <= 0}
          last={at === order.length - 1}
          onStep={step}
          onClose={() => setPeekId(null)}
        />
      )}
      {settings && (
        <SidePeek
          top={peekTop}
          label="Account settings"
          testId="settings-peek"
          title="Settings"
          noun="account"
          onClose={() => setSettings(false)}
          actions={
            <button
              type="button"
              className={cx(PEEK_BUTTON, 'py-[1px] text-[12px]')}
              onClick={() => {
                // Every row saves as it is left; Save finishes the one being typed in and puts the settings away.
                if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
                window.setTimeout(() => setSettings(false), 0);
              }}
            >
              Save
            </button>
          }
        >
          <div className="flex-1 bg-[var(--ph-ground)] px-[10px] pt-[4px] pb-[16px]">
            <AssetSettingsPage accountId={account.id} inPeek />
          </div>
        </SidePeek>
      )}

      {adjusting && (
        <Sheet
          grouped
          tall
          title={adjustTitle}
          onClose={() => setAdjusting(false)}
          confirm={{ label: 'Save', disabled: !sheetReady, run: () => (document.getElementById(ADJUST_FORM) as HTMLFormElement | null)?.requestSubmit() }}
        >
          <AdjustBalanceForm account={account} formId={ADJUST_FORM} onCanSave={setSheetReady} onDone={() => setAdjusting(false)} />
        </Sheet>
      )}
      {movingIn && (
        <Sheet
          grouped
          tall
          title={MONEY_IN[movingIn].title}
          onClose={() => setMovingIn(null)}
          confirm={{ label: 'Save', disabled: !sheetReady, run: () => (document.getElementById(MONEY_IN_FORM) as HTMLFormElement | null)?.requestSubmit() }}
        >
          <MoneyInForm into={account} mode={movingIn} formId={MONEY_IN_FORM} onCanSave={setSheetReady} onDone={() => setMovingIn(null)} />
        </Sheet>
      )}
    </div>
  );
}

/** One of the account's own actions in the title bar: a link where the phone's round button is a journey, else a button. */
function TitleAction({ action }: { action: RoundAction }) {
  if ('to' in action && action.to) {
    return (
      <Link to={action.to} params={action.params} search={action.search} className={GBTN} data-testid={action.testId}>
        {action.label}
      </Link>
    );
  }
  return (
    <button type="button" className={GBTN} onClick={action.run} data-testid={action.testId}>
      {action.label}
    </button>
  );
}

/** What a row is, in the Category column: its category, or what kind of move it is. */
function categoryOf(row: ListRow): { name: string; transfer: boolean } {
  if (row.type === 'expense' || row.type === 'income') return { name: row.categoryName ?? 'Uncategorised', transfer: false };
  if (row.type === 'correction') return { name: 'Balance adjustment', transfer: true };
  if (row.type === 'debt') return { name: 'Lend & borrow', transfer: true };
  if (row.tx && isCardPayment(row.tx)) return { name: 'Card payment', transfer: true };
  return { name: row.transferName ?? 'Transfer', transfer: true };
}

/** Where the money went to or came from, for a move between two accounts: "→ GoPay", "← BCA Tahapan". */
function otherSide(row: ListRow, accountId: string, minor: number): string {
  if (row.type !== 'transfer' || !row.tx) return '';
  const other = row.tx.entries.find((entry) => entry.accountId !== accountId && (entry.accountKind === 'asset' || entry.accountKind === 'liability') && Math.sign(entry.amountMinor) === -Math.sign(minor));
  return other ? `${minor < 0 ? '→' : '←'} ${other.accountName}` : '';
}

function AccountRowView({
  one,
  accountId,
  accounts,
  currency,
  striped,
  selected,
  onOpen,
  onEdit,
}: {
  one: DeskRow;
  accountId: string;
  accounts: readonly AccountRow[];
  currency: string;
  striped: boolean;
  selected: boolean;
  onOpen: () => void;
  onEdit: () => void;
}) {
  const { row, minor, after } = one;
  const category = categoryOf(row);
  const grey = selected ? 'text-white/80' : 'text-[var(--ph-ink-3)]';
  const note = row.description || row.transferName || row.categoryName || category.name;
  return (
    <tr
      data-testid="account-row"
      data-peek-row={row.id}
      aria-selected={selected}
      tabIndex={0}
      title="Click to see it · double-click to edit"
      onClick={onOpen}
      onDoubleClick={onEdit}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return;
        if (event.key === 'Enter') {
          event.preventDefault();
          onEdit();
        } else if (event.key === ' ') {
          event.preventDefault();
          onOpen();
        }
      }}
      className={cx(
        'cursor-default select-none focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--mac-accent)]',
        selected ? 'bg-[var(--mac-accent)] text-white' : cx('text-[var(--ph-ink)]', striped && 'bg-[var(--mac-zebra)]'),
      )}
    >
      <td className={cx(TD, 'tabular-nums', grey)}>{shortDay(row.date)}</td>
      <td className={cx(TD, 'truncate')} title={note}>{note}</td>
      <td className={cx(TD, selected && '[&_[data-testid=category-mark]]:bg-white!')}>
        <span className="flex min-w-0 items-center gap-[7px]">
          <CategoryIcon categoryId={category.transfer ? null : row.categoryId} accounts={accounts} transfer={category.transfer} size="xs" />
          <span className="truncate">{category.name}</span>
        </span>
      </td>
      <td className={cx(TD, 'truncate', grey)}>{otherSide(row, accountId, minor)}</td>
      <td className={cx(TD, 'text-right tabular-nums', minor > 0 && !selected && 'text-[var(--ph-up)]')}>{signedMoney(minor, currency)}</td>
      <td className={cx(TD, 'text-right tabular-nums', grey)} data-testid="balance-after">
        {formatMinor(after, currency)}
      </td>
    </tr>
  );
}
