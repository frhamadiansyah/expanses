import { formatMinor } from '@expanses/core';
import { type AccountRow, billOnNextStatement, cardStatement, type CardRow, payCardPurchases, setPostedOn, type StatementLine } from '@expanses/db';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useState } from 'react';
import { useApp } from '../../app/context';
import { isMoneyAccount, useInvalidateAll } from '../../lib/queries';
import { Button, Card, cx, ErrorBox, Field, Input, Select } from '../../ui';
import { cycleBack, dueDateAfter } from './statement-dates';

const day = (date: string) => new Date(`${date}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
const dayYear = (date: string) => new Date(`${date}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

/**
 * A card's statements: what each one charged and closed at, what is left to pay, purchases the bank billed
 * a statement late, and purchases paid before their statement came.
 */
export function StatementPanel({
  card,
  statementDay,
  dueDay,
  accounts,
  plastic,
  today,
}: {
  card: AccountRow;
  statementDay: number;
  dueDay: number;
  accounts: readonly AccountRow[];
  plastic: readonly CardRow[];
  today: string;
}) {
  const { database, ws } = useApp();
  const invalidate = useInvalidateAll();
  const [back, setBack] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const payers = accounts.filter((a) => isMoneyAccount(a) && a.kind === 'asset' && a.currency === card.currency);
  const [fromId, setFromId] = useState('');
  const [paidOn, setPaidOn] = useState(today);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const cycle = cycleBack(today, statementDay, back);
  const lastClosed = cycleBack(today, statementDay, 1);
  const statement = useQuery({
    queryKey: ['card-statement', ws.workspaceId, card.id, cycle.start, today],
    queryFn: () => cardStatement(database, ws, card.id, cycle, today),
  });
  const last = useQuery({
    queryKey: ['card-statement', ws.workspaceId, card.id, lastClosed.start, today],
    queryFn: () => cardStatement(database, ws, card.id, lastClosed, today),
  });

  const currency = card.currency ?? ws.baseCurrency;
  const money = (minor: number) => formatMinor(minor, currency);
  const last4 = (cardId: string | null) => plastic.find((piece) => piece.id === cardId)?.last4;
  const payable = (line: StatementLine) => line.owedMinor > 0 && line.spending && !line.paidBy;
  const lines = statement.data?.lines ?? [];
  const chosen = lines.filter((line) => selected.has(line.transactionId) && payable(line));
  const chosenMinor = chosen.reduce((sum, line) => sum + line.owedMinor, 0);

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

      {last.data && last.data.closingMinor > 0 && (
        <p className="mb-3 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700" data-testid="left-to-pay">
          Statement of {day(lastClosed.end)}: <b className="tabular">{money(last.data.closingMinor)}</b>
          {last.data.paidSinceMinor > 0 && (
            <>
              {' · '}
              <span title="Every payment since the statement date, early ones for newer purchases too: the bank counts them against the amount due first">
                paid since <span className="tabular">{money(last.data.paidSinceMinor)}</span>
              </span>
            </>
          )}
          {' · '}
          {last.data.leftToPayMinor ? (
            <>
              left to pay <b className="tabular">{money(last.data.leftToPayMinor)}</b> by {day(dueDateAfter(lastClosed.end, dueDay))}
            </>
          ) : (
            <b className="text-emerald-700">paid in full</b>
          )}
        </p>
      )}

      {s && (
        <dl className="mb-3 grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
          {(
            [
              ['Owed before', s.openingMinor, ''],
              ['Charges', s.chargesMinor, ''],
              ['Payments & refunds', -s.creditsMinor, 'text-emerald-700'],
              [s.closed ? 'Statement balance' : 'Balance so far', s.closingMinor, 'font-semibold'],
            ] as const
          ).map(([label, minor, tone]) => (
            <div key={label}>
              <dt className="text-xs text-slate-500">{label}</dt>
              <dd className={cx('tabular', tone)}>{minor < 0 ? `−${money(-minor)}` : money(minor)}</dd>
            </div>
          ))}
        </dl>
      )}

      {lines.length === 0 ? (
        <p className="py-4 text-center text-sm text-slate-500">Nothing on this statement.</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {lines.map((line) => {
            const late = line.postedOn !== null && line.occurredOn < cycle.start;
            return (
              <li key={line.transactionId} data-testid="statement-line" className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm">
                <input
                  type="checkbox"
                  className={cx(!payable(line) && 'invisible')}
                  disabled={!payable(line)}
                  checked={selected.has(line.transactionId)}
                  onChange={() => toggle(line.transactionId)}
                  aria-label={`Pay ${line.description}`}
                />
                <span className="tabular w-14 text-slate-500">{day(line.occurredOn)}</span>
                <span className="min-w-0 flex-1 truncate">
                  {line.description}
                  {last4(line.cardId) && <span className="tabular ml-1.5 text-xs font-semibold text-slate-500">···· {last4(line.cardId)}</span>}
                  {line.postedOn && (
                    <span className={cx('ml-2 rounded-full px-1.5 text-[11px] font-semibold', late ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-600')}>
                      {late ? `Billed late · posted ${day(line.postedOn)}` : `Posted ${day(line.postedOn)}`}
                    </span>
                  )}
                  {line.paidBy && <span className="ml-2 rounded-full bg-emerald-50 px-1.5 text-[11px] font-semibold text-emerald-700">Paid {day(line.paidBy.paidOn)}</span>}
                </span>
                <span className={cx('tabular whitespace-nowrap', line.owedMinor < 0 && 'text-emerald-700')}>
                  {line.owedMinor < 0 ? `−${money(-line.owedMinor)}` : money(line.owedMinor)}
                </span>
                <span className="flex w-44 justify-end">
                  {line.spending && line.owedMinor > 0 && !late && (
                    <button
                      type="button"
                      disabled={busy}
                      title="The bank posted it after the statement date, so it is billed on the next one"
                      onClick={() => void run(() => billOnNextStatement(database, ws, card.id, line.transactionId))}
                      className="rounded px-1.5 py-0.5 text-xs text-slate-500 underline underline-offset-2 hover:text-slate-900"
                    >
                      Billed next statement
                    </button>
                  )}
                  {line.postedOn && (
                    <button type="button" disabled={busy} onClick={() => void run(() => setPostedOn(database, ws, line.transactionId, null))} className="rounded px-1.5 py-0.5 text-xs text-slate-500 underline underline-offset-2 hover:text-slate-900">
                      Use purchase date
                    </button>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      )}

      {chosen.length > 0 && (
        <form
          className="mt-3 grid gap-3 rounded-lg bg-slate-50 p-3 md:grid-cols-[1fr_1fr_auto]"
          onSubmit={(event) => {
            event.preventDefault();
            void run(async () => {
              await payCardPurchases(database, ws, { cardAccountId: card.id, fromAccountId: fromId || payers[0]?.id || '', occurredOn: paidOn, purchaseTransactionIds: chosen.map((line) => line.transactionId) });
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
          <div className="flex items-end">
            <Button type="submit" disabled={busy || payers.length === 0}>
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
