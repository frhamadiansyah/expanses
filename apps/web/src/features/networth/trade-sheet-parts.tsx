import { formatMinor, parseMajor } from '@expanses/core';
import { type AccountRow, type RecordTradeInput, recordTrade } from '@expanses/db';
import { Info } from 'lucide-react';
import { type InputHTMLAttributes, type ReactNode, useId, useState } from 'react';
import { useApp } from '../../app/context';
import { MONEY_SUBTYPES } from '../../lib/account-types';
import { moneyHolders, useAccounts, useInvalidateAll, useResolveRates } from '../../lib/queries';
import { cx } from '../../ui';
import { type GroupChild, InsetRow, PickerRow, ROW_PAD_X, ROW_PAD_Y, rowHeight } from '../../ui/native';
import { tradeDoor } from '../goals/set-aside-question';
import { useSetAside } from '../goals/SetAsideQuestion';
import { PaymentSheet } from '../transactions/PaymentSheet';
import { tradeRatesForSave } from './trade-money';

/*
 * The parts the short Buy / Sell sheets of a fund and of gold share: the holding's own line, a money row, the account
 * the money comes from or goes to, a worked-out row with its ⓘ, More options, and the save.
 */

/** A gain with its sign, as the page writes one: +Rp 11.840, −Rp 110.000. */
export const signedMinor = (minor: number, currency: string) => `${minor < 0 ? '−' : '+'}${formatMinor(Math.abs(minor), currency)}`;

/** A typed amount in minor units, or null while it is not one above zero. */
export function typedMinor(text: string, currency: string): number | null {
  if (text.trim() === '') return null;
  try {
    const minor = parseMajor(text, currency);
    return minor > 0 ? minor : null;
  } catch {
    return null;
  }
}

function Separator({ show }: { show: boolean }) {
  if (!show) return null;
  return <span aria-hidden className="pointer-events-none absolute top-0 bg-[var(--ph-hair)]" style={{ height: 0.5, left: ROW_PAD_X, right: ROW_PAD_X }} />;
}

/** The ⓘ beside a label, which shows its explanation under the row. */
function InfoButton({ label, open, onToggle }: { label: string; open: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      aria-label={`About ${label}`}
      aria-expanded={open}
      onClick={onToggle}
      className="ph-focus ph-tap flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full text-[var(--ph-ink-3)]"
    >
      <Info size={16} aria-hidden />
    </button>
  );
}

const Explained = ({ children }: { children: ReactNode }) => <p className="px-[13px] pb-[8px] text-[12.5px] leading-[16px] text-[var(--ph-ink-3)]">{children}</p>;

/**
 * A row typed into: the label (with an ⓘ when it has one) at the left, the figure at the right, and — on a sell — an
 * All pill after it. The field is a plain text field; the caller groups what is typed.
 */
export function TypedRow({
  label,
  info,
  pill,
  position,
  ...props
}: GroupChild & {
  label: string;
  info?: ReactNode;
  /** A pill at the row's right end: All. */
  pill?: { label: string; on: boolean; run: () => void };
} & InputHTMLAttributes<HTMLInputElement>) {
  const id = useId();
  const [explained, setExplained] = useState(false);
  return (
    <div className="relative">
      <Separator show={Boolean(position?.separator)} />
      <div className="flex items-center gap-3" style={{ minHeight: rowHeight(false), padding: `${ROW_PAD_Y}px ${ROW_PAD_X}px` }}>
        <span className="flex shrink-0 items-center gap-[6px]">
          <label htmlFor={id} className="text-[15px] leading-[20px] text-[var(--ph-ink)]">
            {label}
          </label>
          {info && <InfoButton label={label} open={explained} onToggle={() => setExplained((was) => !was)} />}
        </span>
        <input
          {...props}
          id={id}
          autoComplete="off"
          className="ph-focus tabular min-w-0 flex-1 rounded bg-transparent text-right text-[16px] leading-[20px] text-[var(--ph-ink)] placeholder:text-[var(--ph-ink-3)] md:text-[15px]"
        />
        {pill && (
          <button
            type="button"
            aria-pressed={pill.on}
            onClick={pill.run}
            className={cx(
              'ph-focus shrink-0 rounded-full px-[10px] py-[3px] text-[13px] leading-[18px] font-semibold',
              pill.on ? 'bg-[var(--ph-tint)] text-white' : 'bg-[var(--ph-fill)] text-[var(--ph-tint)]',
            )}
          >
            {pill.label}
          </button>
        )}
      </div>
      {info && explained && <Explained>{info}</Explained>}
    </div>
  );
}

/** A worked-out row: the label (and its ⓘ) and the figure, both in the quiet grey of something not typed. */
export function ResultRow({
  label,
  info,
  value,
  valueClass,
  testId,
  position,
}: GroupChild & { label: string; info?: ReactNode; value: ReactNode; valueClass?: string; testId?: string }) {
  const [explained, setExplained] = useState(false);
  return (
    <div className="relative" data-testid={testId}>
      <Separator show={Boolean(position?.separator)} />
      <div className="flex items-center gap-3" style={{ minHeight: rowHeight(false), padding: `${ROW_PAD_Y}px ${ROW_PAD_X}px` }}>
        <span className="flex min-w-0 flex-1 items-center gap-[6px]">
          <span className="text-[15px] leading-[20px] text-[var(--ph-ink-3)]">{label}</span>
          {info && <InfoButton label={label} open={explained} onToggle={() => setExplained((was) => !was)} />}
        </span>
        <span className={cx('tabular shrink-0 text-[15px] leading-[20px] whitespace-nowrap', valueClass ?? 'text-[var(--ph-ink-3)]')}>{value}</span>
      </div>
      {info && explained && <Explained>{info}</Explained>}
    </div>
  );
}

/** More options: the full form, with what this sheet holds already in it. */
export function MoreOptionsRow({ run, position }: GroupChild & { run: () => void }) {
  return <InsetRow position={position} chevron={false} onClick={run} label="More options" title={<span className="font-normal text-[var(--ph-tint)]">More options</span>} />;
}

/** The accounts money can come from or go to, as the full form offers them, and the one chosen now. */
export function useCashSide(defaultId: string | null) {
  const accounts = useAccounts();
  const choices: AccountRow[] = moneyHolders(accounts.data ?? []).filter((account) => MONEY_SUBTYPES.includes(account.subtype));
  const [picked, setPicked] = useState('');
  const cashAccountId = picked || (defaultId && choices.some((a) => a.id === defaultId) ? defaultId : '') || choices[0]?.id || '';
  const cashAccount = choices.find((account) => account.id === cashAccountId);
  return { accounts: accounts.data ?? [], choices, cashAccountId, cashAccount, pick: setPicked };
}

/** "Paid from" or "To": the account, opening the list of them. */
export function CashRow({ label, side, onOpen, position }: GroupChild & { label: string; side: ReturnType<typeof useCashSide>; onOpen: () => void }) {
  return <PickerRow position={position} label={label} value={side.cashAccount?.name ?? null} placeholder="Account" onOpen={onOpen} />;
}

/** The list of accounts in a sheet of its own, as a transaction's Paid with — drawn outside the groups. */
export function CashSheet({ title, side, onClose }: { title: string; side: ReturnType<typeof useCashSide>; onClose: () => void }) {
  return (
    <PaymentSheet
      title={title}
      options={side.choices.map((account) => ({ accountId: account.id, cardId: null, accountName: account.name, last4: null, holderName: null }))}
      accounts={side.accounts}
      chosenAccountId={side.cashAccountId}
      onPick={(option) => side.pick(option.accountId)}
      onClose={onClose}
    />
  );
}

/** The holding the sheet trades: its kind's drawing, its name, and what is held with its price. */
export function HoldingRow({ icon, name, subtitle, position }: GroupChild & { icon: ReactNode; name: string; subtitle: string }) {
  return <InsetRow position={position} icon={icon} title={name} subtitle={subtitle} testId="trade-holding" />;
}

/** The trade's save, as the full form saves one: rates for the day, the set-aside question, then `recordTrade`. */
export function useTradeSave(o: {
  input: RecordTradeInput | null;
  holdingCurrency: string;
  cashCurrency: string | undefined;
  onDone: () => void;
}) {
  const { database, ws } = useApp();
  const invalidate = useInvalidateAll();
  const resolveRates = useResolveRates();
  const setAside = useSetAside(o.input ? tradeDoor(o.input) : null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  async function save() {
    const input = o.input;
    if (!input || !setAside.ready) return;
    setError(null);
    setBusy(true);
    try {
      const ratesToBase = await tradeRatesForSave({
        database, ws, input, holdingCurrency: o.holdingCurrency, cashCurrency: o.cashCurrency ?? ws.baseCurrency, needsRate: null, manualRate: '', resolveRates,
        onMissing: () => undefined, where: 'Rate that day',
      });
      await recordTrade(database, ws, { ...input, ratesToBase, setAside: setAside.choice });
      await invalidate();
      o.onDone();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  return { save, error, busy, setAside, canSave: !busy && o.input !== null && setAside.ready };
}
