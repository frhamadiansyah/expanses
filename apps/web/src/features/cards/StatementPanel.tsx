import { formatMinor, matchesSearch, statementCycleFor } from '@expanses/core';
import { type AccountRow, billOnNextStatement, cardStatement, cardStatementLines, type CardRow, payCardPurchases, setPostedOn, type StatementLine } from '@expanses/db';
import { useQuery } from '@tanstack/react-query';
import { CalendarArrowUp, ChevronLeft, ChevronRight, Search, Undo2 } from 'lucide-react';
import { useState } from 'react';
import { useApp } from '../../app/context';
import { canPayWith } from '../../lib/account-types';
import { moneyHolders, useInvalidateAll } from '../../lib/queries';
import { Button, Card, cx, ErrorBox, Field, Input, Select } from '../../ui';
import { WorkspaceBadge } from '../workspaces/WorkspaceBadge';
import { useWorkspaceBadges } from '../workspaces/queries';
import { StatementBand } from './StatementBand';
import { cycleBack } from './statement-dates';
import { groupStatementLines } from './statement-groups';
import { spendingDoor } from '../goals/set-aside-question';
import { useSetAside } from '../goals/SetAsideQuestion';
import { formatPoints } from './useCardPoints';

/** Points worked out for one purchase, with its merchant category code, for the statement's points column. */
export interface StatementPoints {
  points: number;
  approximate: boolean;
  mcc: string | null;
  cardFee: boolean;
}

const day = (date: string) => new Date(`${date}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
const dayYear = (date: string) => new Date(`${date}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

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
}: {
  card: AccountRow;
  statementDay: number;
  accounts: readonly AccountRow[];
  plastic: readonly CardRow[];
  today: string;
  /** Points per purchase, when the card has rewards; purchases outside the worked-out cycles show none. */
  points?: Readonly<Record<string, StatementPoints>>;
  unit?: string;
}) {
  const { database, ws } = useApp();
  const invalidate = useInvalidateAll();
  const [back, setBack] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState('');
  // A bill is settled from money the owner can move — not from a deposit that is locked, nor from a holding.
  const payers = moneyHolders(accounts).filter((a) => canPayWith(a) && a.kind === 'asset' && a.currency === card.currency);
  const [fromId, setFromId] = useState('');
  const [paidOn, setPaidOn] = useState(today);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const cycle = cycleBack(today, statementDay, back);
  const statement = useQuery({
    queryKey: ['card-statement', ws.workspaceId, card.id, cycle.start, today],
    queryFn: () => cardStatement(database, ws, card.id, cycle, today),
  });

  const currency = card.currency ?? ws.baseCurrency;
  const money = (minor: number) => formatMinor(minor, currency);
  const last4 = (cardId: string | null) => plastic.find((piece) => piece.id === cardId)?.last4;
  /** A card fee, or an MCC the owner set; nothing for a guessed MCC or a plan's rows. */
  // Short, the way statements print it: 126 PTS.
  const unitShort = unit === 'points' ? 'PTS' : unit.toUpperCase();
  const tagFor = (line: StatementLine) => {
    const info = line.instalment || line.convertedTo ? undefined : points?.[line.transactionId];
    return info?.cardFee ? 'Card fee' : info?.mcc ? `MCC ${info.mcc}` : null;
  };
  // A plan's instalments and the purchase it replaced are paid through the plan, not ticked off here.
  const payable = (line: StatementLine) => line.owedMinor > 0 && line.spending && !line.paidBy && !line.instalment && !line.convertedTo;
  const lines = statement.data?.lines ?? [];
  const chosen = lines.filter((line) => selected.has(line.transactionId) && payable(line));
  // One statement, split by card when the account carries more than one, the way the bank prints it.
  const groups = groupStatementLines(lines, plastic);
  const grouped = groups.length > 0 && groups[0]!.title !== null;
  const chosenMinor = chosen.reduce((sum, line) => sum + line.owedMinor, 0);
  const payFrom = fromId || payers[0]?.id || '';
  const setAside = useSetAside(spendingDoor(payFrom, chosenMinor));

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
  const badgeOf = useWorkspaceBadges([...lines, ...found].map((line) => line.transactionId)).of;
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
  }
  return (
    <Card>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-slate-600">Statements</h2>
        <div className="flex items-center gap-1">
          <Button variant="ghost" className="px-2 py-1" aria-label="Earlier statement" onClick={() => setBack((b) => b + 1)}>
            <ChevronLeft size={16} aria-hidden />
          </Button>
          <span className="tabular min-w-44 text-center text-sm font-medium" data-testid="statement-range">
            {day(cycle.start)} – {dayYear(cycle.end)}
          </span>
          <Button variant="ghost" className="px-2 py-1" aria-label="Later statement" disabled={back === 0} onClick={() => setBack((b) => Math.max(0, b - 1))}>
            <ChevronRight size={16} aria-hidden />
          </Button>
        </div>
      </div>

      <label className="relative mb-3 block">
        <Search size={15} aria-hidden className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-slate-400" />
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search every statement: description, category, card digits or amount"
          aria-label="Search statements"
          autoComplete="off"
          className="h-9 w-full rounded-lg border border-slate-300 bg-white pr-2.5 pl-8 text-base md:text-sm focus:border-slate-900 focus:outline-none"
        />
      </label>

      {searching && (
        <div data-testid="statement-search-results">
          {found.length === 0 ? (
            <p className="py-4 text-center text-sm text-slate-500">{everything.isLoading ? 'Searching…' : 'No purchase or payment matches.'}</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {found.map((line) => (
                <li key={line.key}>
                  <button
                    type="button"
                    onClick={() => openStatementOf(line)}
                    className="flex w-full items-center gap-3 rounded-md px-1 py-2 text-left text-sm hover:bg-slate-50"
                    title="Open this statement"
                  >
                    <span className="tabular w-24 shrink-0 text-slate-500">{line.occurredOn.slice(0, 4) === today.slice(0, 4) ? day(line.occurredOn) : dayYear(line.occurredOn)}</span>
                    <span className="min-w-0 flex-1 truncate">
                      {line.description}
                      <WorkspaceBadge book={badgeOf(line.transactionId)} />
                      {line.instalment && <span className="ml-1.5 text-xs text-slate-500">· instalment {line.instalment.number} of {line.instalment.of}</span>}
                      {last4(line.cardId) && <span className="tabular ml-1.5 text-xs font-semibold text-slate-500">···· {last4(line.cardId)}</span>}
                    </span>
                    <span className="shrink-0 text-xs text-slate-500">Statement {day(statementOf(line).end)}</span>
                    <span className="w-28 shrink-0 text-right">
                      <span className={cx('tabular block whitespace-nowrap', line.owedMinor < 0 && 'text-emerald-700')}>{line.owedMinor < 0 ? `−${money(-line.owedMinor)}` : money(line.owedMinor)}</span>
                      {line.originalCurrency && line.originalAmountMinor !== null && (
                        <span className="tabular block text-[11px] text-slate-500">{formatMinor(line.originalAmountMinor, line.originalCurrency)}</span>
                      )}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {!searching && s && <StatementBand statement={s} currency={currency} />}

      {searching ? null : lines.length === 0 ? (
        <p className="py-4 text-center text-sm text-slate-500">Nothing on this statement.</p>
      ) : (
        <div className="space-y-3">
          {groups.map((group) => (
            <section key={group.key} data-testid="statement-group" aria-label={group.title ? `${group.title}${group.digits ? ` ${group.digits}` : ''}` : undefined}>
              {/* A filled strip, with the subtotal over the amounts, so the same columns run down the whole statement. */}
              {group.title && (
                <div className="mb-1 flex items-baseline gap-x-3 rounded-lg bg-slate-50 px-2 py-1.5 text-sm">
                  <span className="min-w-0 flex-1 truncate font-semibold">
                    {group.title}
                    {group.digits && <span className="tabular ml-1.5 font-normal text-slate-500">{group.digits}</span>}
                  </span>
                  <span className={cx('tabular w-28 text-right font-semibold', group.totalMinor < 0 && 'text-emerald-700')}>
                    {group.totalMinor < 0 ? `−${money(-group.totalMinor)}` : money(group.totalMinor)}
                  </span>
                  <span className="w-16" aria-hidden />
                </div>
              )}
              <ul className="divide-y divide-slate-100">
                {group.lines.map((line) => {
                  const late = line.postedOn !== null && line.occurredOn < cycle.start;
                  return (
                    <li key={line.key} data-testid="statement-line" className={cx('flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm', line.convertedTo && 'text-slate-400')}>
                      {/* A purchase already paid stays ticked and cannot be unticked; deleting its payment frees it again. */}
                      <input
                        type="checkbox"
                        className={cx(!payable(line) && !line.paidBy && 'invisible', line.paidBy && 'accent-emerald-600')}
                        disabled={!payable(line)}
                        checked={line.paidBy !== null || selected.has(line.transactionId)}
                        onChange={() => toggle(line.transactionId)}
                        title={line.paidBy ? `Paid on ${day(line.paidBy.paidOn)}` : undefined}
                        aria-label={line.paidBy ? `${line.description}, paid on ${day(line.paidBy.paidOn)}` : `Pay ${line.description}`}
                      />
                      <span className="tabular w-14 text-slate-500">{day(line.occurredOn)}</span>
                      <span className="min-w-0 flex-1 truncate">
                        {line.description}
                        {/* Whose spending this is, when the card has been used from more than one workspace. */}
                        <WorkspaceBadge book={badgeOf(line.transactionId)} />
                        {line.instalment && (
                          <span className="ml-1.5 text-xs text-slate-500">
                            · instalment {line.instalment.number} of {line.instalment.of}
                          </span>
                        )}
                        {line.convertedTo && <span className="ml-1.5 text-xs">· converted to {line.convertedTo.months} months, billed monthly</span>}
                        {/* Which purchases you have settled yourself, kept apart from what the bank has billed. */}
                        {line.paidBy && (
                          <span className="ml-1.5 text-xs text-slate-500">
                            · {s?.closed ? 'paid' : 'paid ahead'} {day(line.paidBy.paidOn)}
                          </span>
                        )}
                        {/* A payment made for chosen purchases says so, so a batch can be told from a bill payment. */}
                        {line.settles > 0 && (
                          <span className="ml-1.5 text-xs text-slate-500">
                            · for {line.settles} purchase{line.settles === 1 ? '' : 's'}
                          </span>
                        )}
                        {!grouped && last4(line.cardId) && <span className="tabular ml-1.5 text-xs font-semibold text-slate-500">···· {last4(line.cardId)}</span>}
                        {tagFor(line) && <span className="ml-2 text-[11px] text-slate-500">{tagFor(line)}</span>}
                      </span>
                      {points && (
                        <span className="tabular w-20 text-right text-xs text-emerald-700" data-testid="statement-points">
                          {!line.instalment && points[line.transactionId] ? `${points[line.transactionId]!.approximate ? '≈ ' : ''}${formatPoints(points[line.transactionId]!.points)} ${unitShort}` : ''}
                        </span>
                      )}
                      <span className="w-28 text-right">
                        <span className={cx('tabular block whitespace-nowrap', line.owedMinor < 0 && 'text-emerald-700', line.convertedTo && 'line-through')}>
                          {line.owedMinor < 0 ? `−${money(-line.owedMinor)}` : money(line.owedMinor)}
                        </span>
                        {line.originalCurrency && line.originalAmountMinor !== null && (
                          <span className="tabular block text-[11px] whitespace-nowrap text-slate-500" data-testid="statement-original">
                            {formatMinor(line.originalAmountMinor, line.originalCurrency)}
                          </span>
                        )}
                      </span>
                      <span className="flex w-16 justify-end gap-0.5">
                        {line.spending && line.owedMinor > 0 && !late && !line.instalment && !line.convertedTo && (
                          <button
                            type="button"
                            disabled={busy}
                            aria-label="Billed next statement"
                            title="Billed next statement: the bank posted it after the statement date"
                            onClick={() => void run(() => billOnNextStatement(database, ws, card.id, line.transactionId))}
                            className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-900"
                          >
                            <CalendarArrowUp size={16} aria-hidden />
                          </button>
                        )}
                        {line.postedOn && (
                          <button
                            type="button"
                            disabled={busy}
                            aria-label="Use purchase date"
                            title={`${late ? 'Billed late' : 'Posted'} on ${day(line.postedOn)}. Use purchase date instead`}
                            onClick={() => void run(() => setPostedOn(database, ws, line.transactionId, null))}
                            className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-900"
                          >
                            <Undo2 size={16} aria-hidden />
                          </button>
                        )}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      )}

      {!searching && chosen.length > 0 && (
        <form
          className="mt-3 grid gap-3 rounded-lg bg-slate-50 p-3 md:grid-cols-[1fr_1fr_auto]"
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
                setAside: setAside.choice,
              });
              setSelected(new Set());
            });
          }}
        >
          <p className="text-sm md:col-span-3">
            Pay {chosen.length} purchase{chosen.length === 1 ? '' : 's'} now: <b className="tabular">{money(chosenMinor)}</b>
          </p>
          <Field label="Paid from">
            <Select value={fromId || payers[0]?.id || ''} onChange={(event) => setFromId(event.target.value)}>
              {payers.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Paid on">
            <Input type="date" value={paidOn} onChange={(event) => setPaidOn(event.target.value)} required />
          </Field>
          {setAside.node && <div className="md:col-span-3">{setAside.node}</div>}
          <div className="flex items-end">
            <Button type="submit" disabled={busy || payers.length === 0 || !setAside.ready}>
              Pay {money(chosenMinor)}
            </Button>
          </div>
          {payers.length === 0 && <p className="text-xs text-slate-500 md:col-span-3">Add a {currency} bank account to pay the card from.</p>}
        </form>
      )}
      <ErrorBox error={error ?? statement.error} />
    </Card>
  );
}
