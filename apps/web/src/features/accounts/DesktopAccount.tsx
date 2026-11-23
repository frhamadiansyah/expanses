import { addMonths, formatMinor, isFxLotAccount, isoDate, monthName, monthPeriod, periodMonthOf } from '@expanses/core';
import { type AccountRow, listTransactions, ownerScope } from '@expanses/db';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { CalendarDays, LineChart, List } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useApp } from '../../app/context';
import { DeskNotices } from '../../app/DeskNotices';
import { Sheet } from '../../app/Sheet';
import { SUBTYPE_LABELS } from '../../lib/account-types';
import { useAccounts, useBalances } from '../../lib/queries';
import { cx, ErrorBox } from '../../ui';
import { rateLine, type RoundAction } from '../../ui/native';
import { usePeekDoubleClick } from '../../ui/native/peek-double-click';
import { PEEK_BUTTON, SidePeek } from '../../ui/native/SidePeek';
import { CategoryIcon } from '../categories/CategoryIcon';
import { useSetAsideView } from '../goals/queries';
import { AssetSettingsPage } from '../networth/AssetSettingsPage';
import { SetAsidePanel } from '../networth/SetAsidePanel';
import { isCardPayment } from '../cards/card-pay';
import { isEditable } from '../transactions/draft';
import { buildRows, type ListRow } from '../transactions/list-model';
import { ReceiptPeek } from '../transactions/ReceiptPeek';
import { useWalletCards } from '../wallet/useWalletCards';
import { useMonthStart } from '../workspaces/queries';
import { type AccountMove, accountMonth, balancesAfter, monthEndBalances, moveOf } from './account-desk-model';
import { ADJUST_FORM, actionsFor, CurrencyFlag, ForeignLine, MONEY_IN_FORM, type NewTxDraft, useOwnRing } from './AccountPage';
import { WithdrawalsLeft } from './WithdrawalsLeft';
import { AdjustBalanceForm } from './AdjustBalanceForm';
import { adjustTitle } from './adjust-model';
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
  MonthsLine,
  PBTN,
  PEEK_ROOM,
  rowClass,
  signedMoney,
  StepPill,
  TD,
  TH,
  THIRD_CARD,
  TOP_GRID,
} from './desk-account-parts';
import { MONEY_IN, MoneyInForm, type MoneyInMode } from './MoneyInForm';
import { spendsFrom } from './pockets';
import { useHeldRates, useOpenings } from './queries';

/** How many months the Balance over time line covers, the one shown last. */
const LINE_MONTHS = 6;
/** Rows read for the line and the table: more than any account moves in six months. */
const READ_LIMIT = 20_000;

const shortDay = (iso: string) => `${Number(iso.slice(8, 10))} ${monthName(iso.slice(0, 7), 'short')}`;

/** One row of the table: the list's own reading of the transaction, what it moved the account by, and the balance after. */
interface DeskRow {
  row: ListRow;
  minor: number;
  after: number;
}

/**
 * A bank, cash or e-wallet account on a wide screen (Mac account pages, owner 2026-11-20): `/accounts/$accountId` full
 * width, like the other Mac pages, in the v1 look (owner 2026-11-23; the card page's kit). The title bar holds the
 * name, the month pill "‹ November 2026 ›", the account's own actions (Transfer, Withdraw or Top up, Adjust, Statement —
 * today's, each opening what the phone's round button opens), the ⚙ that opens its settings in the side peek, and the
 * blue ＋ Record (the Add screen paid with it).
 *
 * Top row: the face Wallet draws with the balance under it — today's figure (Wallet's, the sidebar's and the phone's own), and what goals
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
  const opened = useOpenings([account.id]).data?.[account.id];
  // While the household files jointly, the account wears its owner's ring, as on Net worth and the phone's page.
  const ownRing = useOwnRing();
  const setAside = useSetAsideView(account.id).data;

  // Every row from the line's first month on, owner-wide as the phone's Recent and line are, so the figures agree with
  // the balance; future-dated rows included, since the balance counts them.
  const history = useQuery({
    queryKey: ['account-desk', ws.workspaceId, account.id, from],
    queryFn: () =>
      listTransactions(database, ownerScope(ws), {
        accountIds: [account.id],
        from,
        limit: READ_LIMIT,
      }),
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
    .map((row) => ({
      row,
      minor: minorOf.get(row.id)!,
      after: after.get(row.id)!,
    }));

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
    if (tx && isEditable(tx))
      void navigate({
        to: '/transactions/$transactionId/edit',
        params: { transactionId: id },
      });
  };
  const doubleClick = usePeekDoubleClick((id) => edit(id));

  // ── The actions: today's, as the phone's round buttons are ─────────────────────────────────────────────────────────
  const [adjusting, setAdjusting] = useState(false);
  const [movingIn, setMovingIn] = useState<MoneyInMode | null>(null);
  const [sheetReady, setSheetReady] = useState(false);
  const newTx = (draft: NewTxDraft) =>
    void navigate({
      to: '/transactions/new',
      search: {
        mode: draft.mode,
        ...(draft.account ? { account: draft.account } : {}),
        ...(draft.to ? { to: draft.to } : {}),
      },
    });
  const actions = actionsFor(account, null, ws.baseCurrency, {
    newTx,
    moneyIn: setMovingIn,
    adjust: () => setAdjusting(true),
  });
  // Spend and Receive are one Record here (the Add screen, Expense, Income and Transfer as its tabs), the blue button.
  const records = actions.some((action) => ['add', 'spend', 'receive'].includes(action.key));
  const others = actions.filter((action) => !['add', 'spend', 'receive'].includes(action.key));

  const kind = [SUBTYPE_LABELS[account.subtype], currency].join(' · ');
  const title = parent ? `${parent.name} · ${currency}` : account.name;
  const foreign = currency !== ws.baseCurrency;
  const counted = spendsFrom(account, everything);
  const setAsideFor = setAside && setAside.state !== 'none' ? (setAside.goals.length > 0 && setAside.funds.length > 0 ? 'goals and bills' : setAside.funds.length > 0 ? 'bills' : 'goals') : null;

  return (
    <div className="min-h-dvh bg-[var(--mk-page)]" data-testid="account-desk" data-desk="true" {...doubleClick}>
      <DeskTitleBar
        title={title}
        line={kind}
        barRef={(node) => (bar.current = node)}
        back={
          parent
            ? {
                label: parent.name,
                to: '/accounts/$accountId',
                params: { accountId: parent.id },
              }
            : undefined
        }
      >
        <span role="group" aria-label="Month" className="flex">
          <StepPill
            label={`${monthName(month, 'long')} ${month.slice(0, 4)}`}
            earlier="Earlier month"
            later="Later month"
            laterOff={month >= thisMonth}
            onStep={(by) => setMonth((was) => addMonths(was, by))}
            testId="account-month"
          />
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
      <DeskPageTitle title={title} line={kind} />

      <div className={cx('@container space-y-[16px] px-[32px] pt-[2px] pb-[32px]', peeking && PEEK_ROOM)}>
        <ErrorBox error={balances.error ?? history.error ?? accounts.error} />
        <div className={TOP_GRID}>
          {/* The face, with the balance printed under it: Wallet's figure, the sidebar's and the phone's own. */}
          <section data-testid="balance-card" aria-label="Balance" className="min-w-0">
            {face && <DeskFace card={face} />}
            {/* Without a face (a pocket, an account Wallet draws no card for) the figures sit in a soft card of their own. */}
            <div className={face ? FIGURES_UNDER_FACE : FIGURES_ALONE}>
              <p className="text-[12.5px] font-semibold text-[var(--mk-ink-2)]">Balance</p>
              <div className="flex items-center gap-[10px]">
                <p data-testid="account-balance" className="text-[27px] leading-[33px] font-extrabold tracking-[-0.3px] whitespace-nowrap text-[var(--mk-ink)] tabular-nums">
                  {formatMinor(todayMinor, currency)}
                </p>
                <CurrencyFlag currency={currency} ring={ownRing} />
              </div>
              {/* Money in another currency: what it comes to here at the rate held, and the rate it was opened at (the phone's Details). */}
              {foreign && (
                <p className="text-[12.5px] text-[var(--mk-ink-2)] tabular-nums">
                  <ForeignLine currency={currency} minor={todayMinor} rates={rates.data} />
                </p>
              )}
              {foreign && opened && (
                <p className="text-[12.5px] text-[var(--mk-ink-2)] tabular-nums">
                  Opened at <span>{rateLine(opened.fxRateToBase, currency, ws.baseCurrency)}</span>
                </p>
              )}
              <p className="mt-[2px] text-[12.5px] text-[var(--mk-ink-2)]">{counted ? 'Counts toward spending' : 'Kept as savings, off Wallet’s spending money'}</p>
              {setAside && setAsideFor && (
                <p
                  data-testid="account-setaside"
                  className={cx('mt-[6px] text-[12.5px] tabular-nums', setAside.state === 'short' ? 'font-semibold text-[var(--mk-t-orange)]' : 'text-[var(--mk-ink-2)]')}
                >
                  {formatMinor(setAside.setAsideMinor, currency)} set aside for {setAsideFor} · {formatMinor(setAside.freeMinor, currency)} free
                </p>
              )}
            </div>
          </section>
          <DeskBox title="This month" icon={CalendarDays} note={monthName(month, 'long')} testId="account-month-box">
            <FigureRow label="Money in" value={formatMinor(figures.inMinor, currency)} tone={figures.inMinor > 0 ? 'up' : undefined} testId="month-in" />
            <FigureRow label="Money out" value={formatMinor(figures.outMinor, currency)} testId="month-out" />
            {figures.transferInMinor > 0 && <FigureRow label="Transfers in" value={formatMinor(figures.transferInMinor, currency)} tone="grey" testId="month-transfers-in" />}
            <FigureRow label="Transfers out" value={formatMinor(figures.transferOutMinor, currency)} tone="grey" testId="month-transfers-out" />
            {figures.adjustedMinor !== 0 && <FigureRow label="Adjusted" value={signedMoney(figures.adjustedMinor, currency)} tone="grey" testId="month-adjusted" />}
            {figures.openingMinor !== 0 && <FigureRow label="Opening balance" value={formatMinor(figures.openingMinor, currency)} tone="grey" testId="month-opening" />}
            <FigureRow label="Change" value={signedMoney(figures.changeMinor, currency)} tone={figures.changeMinor > 0 ? 'up' : undefined} strong testId="month-change" />
          </DeskBox>
          <DeskBox title="Balance over time" icon={LineChart} note={`${LINE_MONTHS} months`} testId="account-line" className={THIRD_CARD}>
            <div className="px-[6px]">{history.isSuccess && balances.isSuccess && <MonthsLine points={line} currency={currency} plot={150} />}</div>
          </DeskBox>
        </div>

        <DeskBox
          title="Transactions"
          icon={List}
          testId="account-table"
          className="px-[10px] pb-[4px] [&>h2]:px-[10px]"
          note={
            <span className="flex items-baseline gap-[12px]" title="Click a row to see it · double-click to edit">
              <span>
                {shown.length} {shown.length === 1 ? 'row' : 'rows'}
              </span>
              <Link to="/transactions" search={{ account: account.id }} className="font-semibold text-[var(--mk-blue)] hover:underline">
                See all
              </Link>
            </span>
          }
        >
          <table className="w-full table-fixed border-separate border-spacing-0" aria-label={`${title} transactions`}>
            {/* The figures keep their width whatever the page has; the words share what is left, and truncate. */}
            <colgroup>
              <col className="w-[76px]" />
              <col />
              <col className="w-[20%]" />
              <col className="w-[15%]" />
              <col className="w-[136px]" />
              <col className="w-[144px]" />
            </colgroup>
            <thead>
              <tr>
                <th className={cx(TH, 'pl-[12px]')}>Date</th>
                <th className={TH}>Note</th>
                <th className={TH}>Category</th>
                <th className={TH}>From / to</th>
                <th className={cx(TH, 'text-right')}>Amount</th>
                <th className={cx(TH, 'text-right')}>Balance after</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((one) => (
                <AccountRowView
                  key={one.row.id}
                  one={one}
                  accountId={account.id}
                  accounts={everything}
                  currency={currency}
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
          {history.isSuccess && shown.length === 0 && <p className="px-[10px] py-[12px] text-[13.5px] text-[var(--mk-ink-2)]">Nothing moved in {monthName(month, 'long')}.</p>}
        </DeskBox>
        {/* What is promised out of the account, what is free, and which goals and bills claim it — as on the phone's page. */}
        {setAsideFor && (
          <section aria-label="Set aside" data-testid="account-setaside-panel" className="max-w-[720px]">
            <SetAsidePanel accountId={account.id} />
          </section>
        )}
        {/* Withdrawal rate §7: what the foreign money held cost, and the withdrawals still in it — as on the phone's page. */}
        {isFxLotAccount(account, ws.baseCurrency) && (
          <div className="max-w-[720px]">
            <WithdrawalsLeft account={account} balanceMinor={todayMinor} rates={rates.data} />
          </div>
        )}
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
          confirm={{
            label: 'Save',
            disabled: !sheetReady,
            run: () => (document.getElementById(ADJUST_FORM) as HTMLFormElement | null)?.requestSubmit(),
          }}
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
          confirm={{
            label: 'Save',
            disabled: !sheetReady,
            run: () => (document.getElementById(MONEY_IN_FORM) as HTMLFormElement | null)?.requestSubmit(),
          }}
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
  const other = row.tx.entries.find(
    (entry) => entry.accountId !== accountId && (entry.accountKind === 'asset' || entry.accountKind === 'liability') && Math.sign(entry.amountMinor) === -Math.sign(minor),
  );
  return other ? `${minor < 0 ? '→' : '←'} ${other.accountName}` : '';
}

function AccountRowView({
  one,
  accountId,
  accounts,
  currency,
  selected,
  onOpen,
  onEdit,
}: {
  one: DeskRow;
  accountId: string;
  accounts: readonly AccountRow[];
  currency: string;
  selected: boolean;
  onOpen: () => void;
  onEdit: () => void;
}) {
  const { row, minor, after } = one;
  const category = categoryOf(row);
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
      className={rowClass(selected)}
    >
      <td className={cx(TD, 'pl-[12px] text-[var(--mk-ink-2)] tabular-nums')}>{shortDay(row.date)}</td>
      <td className={cx(TD, 'truncate')} title={note}>
        {note}
      </td>
      <td className={TD}>
        <span className="flex min-w-0 items-center gap-[7px]">
          <CategoryIcon categoryId={category.transfer ? null : row.categoryId} accounts={accounts} transfer={category.transfer} size="xs" />
          <span className="truncate">{category.name}</span>
        </span>
      </td>
      <td className={cx(TD, 'truncate text-[var(--mk-ink-2)]')}>{otherSide(row, accountId, minor)}</td>
      <td className={cx(TD, 'text-right tabular-nums', minor > 0 && 'text-[var(--mk-t-green)]')}>{signedMoney(minor, currency)}</td>
      <td className={cx(TD, 'text-right text-[var(--mk-ink-2)] tabular-nums')} data-testid="balance-after">
        {formatMinor(after, currency)}
      </td>
    </tr>
  );
}
