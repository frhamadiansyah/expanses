import { formatMinor, minorToMajorString, parseMajor } from '@expanses/core';
import { type AccountRow, type CheckDraftRow, creditKindOf } from '@expanses/db';
import { MoreHorizontal } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { Sheet } from '../../app/Sheet';
import { Button, Card, cx } from '../../ui';
import { InsetGroup, SegmentedControl, SelectRow, TextRow } from '../../ui/native';
import { CategoryIcon, UnknownCategoryMark } from '../categories/CategoryIcon';
import { CategoryPicker } from '../transactions/CategoryPicker';
import { DayHeader } from '../transactions/DayHeader';
import { topUpWallets } from '../transactions/tx-form';
import { isTopUpRow, missingByDay, needsCategory, needsWallet, originalLabel, topUpFigures } from './check-model';

/**
 * The statement's rows missing from cicis, drawn like the Cashflow list (S9): a card per day, the category's circle,
 * the category as the title and "merchant · card" underneath. A tap chooses the category, which fills every row of
 * the same merchant; ⋯ corrects the amount or date the screenshot gave. A credit says whether it is money back or a
 * card payment.
 *
 * Top-ups on a card's purchase asks where the money went (the Top-up sheet), and the row then reads as the transfer
 * it will be, as Cashflow draws one: "Visa 4821 → GoPay 5521", what landed, the fee under it. Only the category spreads
 * to the same merchant: another row given Top-ups that way waits for its own wallet, and a tap opens its sheet.
 */
export function MissingRows({
  rows,
  currency,
  card,
  cardLast4,
  walletDigits,
  accounts,
  onPick,
  onTopUp,
  onCorrect,
  onKind,
  footer,
}: {
  rows: readonly CheckDraftRow[];
  currency: string;
  card: AccountRow;
  /** The digits of the card the statement is for, when one card says it. */
  cardLast4: string | null;
  /** A wallet's own digits, by account. */
  walletDigits: Readonly<Record<string, string>>;
  accounts: readonly AccountRow[];
  onPick: (index: number, categoryId: string) => void;
  onTopUp: (index: number, topUp: { walletAccountId: string; feeMinor: number }) => void;
  onCorrect: (index: number, patch: { on: string; amountMinor: number }) => void;
  onKind: (index: number, kind: 'refund' | 'payment') => void;
  footer: ReactNode;
}) {
  const [tab, setTab] = useState<'all' | 'gaps'>('all');
  const [picking, setPicking] = useState<CheckDraftRow | null>(null);
  const [toppingUp, setToppingUp] = useState<CheckDraftRow | null>(null);
  const [editing, setEditing] = useState<CheckDraftRow | null>(null);
  const cardName = card.name;
  const cardLabel = cardLast4 ? `${cardName} ${cardLast4}` : cardName;
  const missing = rows.filter((r) => r.outcome.status === 'missing');
  const gaps = missing.filter((r) => (needsCategory(r) && r.categoryId === null) || needsWallet(r, accounts));
  const shown = tab === 'gaps' ? gaps : missing;
  const nameOf = (id: string | null) => (id ? (accounts.find((a) => a.id === id)?.name ?? null) : null);

  return (
    <>
      <SegmentedControl
        label="Missing rows"
        className="mb-[12px]"
        value={tab}
        onChange={(key) => setTab(key as 'all' | 'gaps')}
        segments={[
          { key: 'all', label: `All ${missing.length}` },
          { key: 'gaps', label: `Needs a category · ${gaps.length}` },
        ]}
      />
      {shown.length === 0 && <p className="py-4 text-center text-[15px] text-[var(--ph-ink-3)]">Every row has a category.</p>}
      {missingByDay(shown).map((day) => (
        <Card key={day.date} className="mb-3">
          <DayHeader date={day.date} net={day.net} currency={currency} />
          <ul className="divide-y divide-slate-100">
            {day.rows.map((row) => {
              const payment = row.outcome.status === 'missing' && row.outcome.as === 'payment';
              if (isTopUpRow(row, accounts)) {
                return <TopUpRow key={row.index} row={row} currency={currency} cardLabel={cardLabel} accounts={accounts} walletDigits={walletDigits} onOpen={() => setToppingUp(row)} onEdit={() => setEditing(row)} />;
              }
              const name = nameOf(row.categoryId);
              const source = row.categorySource === 'known' ? 'known · ' : row.categorySource === 'same-merchant' ? 'same merchant · ' : '';
              const original = originalLabel(row);
              return (
                <li key={row.index} data-testid="missing-row" className="list-none">
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      disabled={payment}
                      onClick={() => setPicking(row)}
                      className="ph-focus flex min-w-0 flex-1 items-center gap-3 py-2 text-left"
                    >
                      {payment || row.categoryId ? <CategoryIcon categoryId={row.categoryId} accounts={accounts} transfer={payment} /> : <UnknownCategoryMark />}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">
                          {payment ? 'Card payment' : name ? name : <span className="text-[var(--ph-warn)]">Choose category</span>}
                        </span>
                        <span className="block truncate text-xs text-[var(--ph-ink-3)]">
                          {source && <span className="text-[var(--ph-tint)]">{source}</span>}
                          {row.description}
                          {' · '}
                          {cardName}
                        </span>
                      </span>
                      <span className="shrink-0 text-right">
                        <span className={cx('tabular block text-sm font-semibold whitespace-nowrap', row.direction === 'out' ? 'text-[var(--ph-alarm)]' : 'text-[var(--ph-up)]')}>
                          {formatMinor(row.amountMinor, currency)}
                        </span>
                        {original && (
                          <span data-testid="missing-original" className="tabular block text-[11.5px] leading-[14px] whitespace-nowrap text-[var(--ph-ink-3)]">
                            {original}
                          </span>
                        )}
                      </span>
                    </button>
                    <button
                      type="button"
                      aria-label={`Correct ${row.description}`}
                      onClick={() => setEditing(row)}
                      className="ph-focus flex h-11 w-9 shrink-0 items-center justify-center text-[var(--ph-ink-3)]"
                    >
                      <MoreHorizontal size={18} aria-hidden />
                    </button>
                  </div>
                  {creditKindOf(row) !== null && <CreditKindSwitch row={row} onKind={onKind} className="pb-[8px]" />}
                </li>
              );
            })}
          </ul>
        </Card>
      ))}
      {footer}
      {picking && (
        <CategoryPicker
          kind="expense"
          lockKind
          title={picking.description}
          value={picking.categoryId ?? undefined}
          onPick={(categoryId) => {
            onPick(picking.index, categoryId);
            // Top-ups on a card's purchase: where it went and the fee are asked at once.
            const picked = { ...picking, categoryId, topUp: picking.categoryId === categoryId ? picking.topUp : null };
            if (isTopUpRow(picked, accounts)) setToppingUp(picked);
          }}
          onClose={() => setPicking(null)}
        />
      )}
      {toppingUp && (
        <TopUpSheet
          row={toppingUp}
          currency={currency}
          cardLabel={cardLabel}
          wallets={topUpWallets(card, accounts)}
          onDone={(topUp) => onTopUp(toppingUp.index, topUp)}
          onChangeCategory={() => {
            setPicking(toppingUp);
            setToppingUp(null);
          }}
          onClose={() => setToppingUp(null)}
        />
      )}
      {editing && <CorrectSheet row={editing} currency={currency} onSave={(patch) => onCorrect(editing.index, patch)} onClose={() => setEditing(null)} />}
    </>
  );
}

/**
 * A missing card row under Top-ups, drawn as the transfer it will be — Cashflow's row: "Top-up", both sides with their
 * digits, what lands, the fee under it. One still waiting for its wallet says so where the sides would be.
 */
function TopUpRow({
  row,
  currency,
  cardLabel,
  accounts,
  walletDigits,
  onOpen,
  onEdit,
}: {
  row: CheckDraftRow;
  currency: string;
  cardLabel: string;
  accounts: readonly AccountRow[];
  walletDigits: Readonly<Record<string, string>>;
  onOpen: () => void;
  onEdit: () => void;
}) {
  const wallet = row.topUp ? accounts.find((a) => a.id === row.topUp!.walletAccountId) : undefined;
  const walletLabel = wallet ? (walletDigits[wallet.id] ? `${wallet.name} ${walletDigits[wallet.id]}` : wallet.name) : null;
  const { landsMinor, feeMinor } = topUpFigures(row);
  return (
    <li data-testid="missing-row" className="list-none">
      <div className="flex items-center gap-1">
        <button type="button" onClick={onOpen} className="ph-focus flex min-w-0 flex-1 items-center gap-3 py-2 text-left">
          <CategoryIcon categoryId={null} accounts={accounts} transfer />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium">Top-up</span>
            <span data-testid="top-up-sides" className="block truncate text-xs text-[var(--ph-ink-3)]">
              {walletLabel ? `${cardLabel} → ${walletLabel}` : <span className="text-[var(--ph-warn)]">Choose the wallet · {row.description}</span>}
            </span>
          </span>
          <span className="shrink-0 text-right">
            <span className="tabular block text-sm font-semibold whitespace-nowrap text-[var(--ph-ink)]">{formatMinor(landsMinor, currency)}</span>
            {feeMinor > 0 && (
              <span data-testid="amount-extra" className="tabular block text-[11.5px] leading-[14px] whitespace-nowrap text-[var(--ph-ink-3)]">
                +{formatMinor(feeMinor, currency)}
              </span>
            )}
          </span>
        </button>
        <button
          type="button"
          aria-label={`Correct ${row.description}`}
          onClick={onEdit}
          className="ph-focus flex h-11 w-9 shrink-0 items-center justify-center text-[var(--ph-ink-3)]"
        >
          <MoreHorizontal size={18} aria-hidden />
        </button>
      </div>
    </li>
  );
}

/**
 * Where a card's top-up went, and the fee in its charge: Into lists the digital wallets in the card's currency, the Fee
 * starts empty (none), and what lands is the charge less it. The summary says how the one charge splits.
 */
function TopUpSheet({
  row,
  currency,
  cardLabel,
  wallets,
  onDone,
  onChangeCategory,
  onClose,
}: {
  row: CheckDraftRow;
  currency: string;
  cardLabel: string;
  wallets: readonly AccountRow[];
  onDone: (topUp: { walletAccountId: string; feeMinor: number }) => void;
  onChangeCategory: () => void;
  onClose: () => void;
}) {
  const [walletId, setWalletId] = useState(row.topUp?.walletAccountId ?? (wallets.length === 1 ? wallets[0]!.id : ''));
  const [fee, setFee] = useState(() => (row.topUp?.feeMinor ? minorToMajorString(row.topUp.feeMinor, currency) : ''));
  let feeMinor: number | null = 0;
  if (fee.trim()) {
    try {
      feeMinor = parseMajor(fee, currency);
    } catch {
      feeMinor = null;
    }
  }
  const feeValid = feeMinor !== null && feeMinor >= 0 && feeMinor < row.amountMinor;
  const wallet = wallets.find((w) => w.id === walletId);
  const valid = !!wallet && feeValid;
  const fees = feeValid ? feeMinor! : 0;
  return (
    <Sheet grouped title="Top-up" onClose={onClose}>
      <p className="mb-[10px] text-center text-[13px] text-[var(--ph-ink-3)]">
        {formatMinor(row.amountMinor, currency)} charged to {cardLabel}
      </p>
      <InsetGroup footer={feeValid ? undefined : 'The fee must be less than the amount charged.'}>
        <SelectRow label="Into" value={walletId} onChange={(event) => setWalletId(event.target.value)}>
          <option value="">Choose a wallet</option>
          {wallets.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name}
            </option>
          ))}
        </SelectRow>
        <TextRow label="Fee" value={fee} onChange={(event) => setFee(event.target.value)} inputMode="decimal" />
      </InsetGroup>
      <div data-testid="top-up-summary" className="mb-[12px] rounded-[12px] bg-[var(--ph-surface)] px-[12px] py-[10px] text-[13px] leading-[20px]">
        <div className="flex justify-between gap-2">
          <span>Lands in {wallet?.name ?? '…'}</span>
          <b className="tabular">{formatMinor(row.amountMinor - fees, currency)}</b>
        </div>
        <div className="flex justify-between gap-2">
          <span>Fee · Fees &amp; charges</span>
          <b className="tabular">{formatMinor(fees, currency)}</b>
        </div>
        <div className="flex justify-between gap-2 text-[var(--ph-ink-3)]">
          <span>Card charged · Top-ups</span>
          <span className="tabular">{formatMinor(row.amountMinor, currency)}</span>
        </div>
      </div>
      <Button
        className="min-h-12 w-full text-[17px]"
        disabled={!valid}
        onClick={() => {
          if (!valid) return;
          onDone({ walletAccountId: wallet!.id, feeMinor: fees });
          onClose();
        }}
      >
        Done
      </Button>
      <button type="button" onClick={onChangeCategory} className="ph-focus mt-[6px] flex min-h-11 w-full items-center justify-center text-[15px] font-medium text-[var(--ph-ink-2)]">
        Change category
      </button>
    </Sheet>
  );
}

/** Money back or a card payment: the owner's word on a credit the reading may have taken for the other. */
export function CreditKindSwitch({ row, onKind, className }: { row: CheckDraftRow; onKind: (index: number, kind: 'refund' | 'payment') => void; className?: string }) {
  const kind = creditKindOf(row);
  if (kind === null) return null;
  return (
    <SegmentedControl
      label={`What ${row.description} is`}
      className={className}
      value={kind}
      onChange={(key) => onKind(row.index, key as 'refund' | 'payment')}
      segments={[
        { key: 'refund', label: 'Refund' },
        { key: 'payment', label: 'Card payment' },
      ]}
    />
  );
}

/** The amount or date the screenshot gave, corrected by hand. Nothing is learned from it yet (plan ruling). */
function CorrectSheet({
  row,
  currency,
  onSave,
  onClose,
}: {
  row: CheckDraftRow;
  currency: string;
  onSave: (patch: { on: string; amountMinor: number }) => void;
  onClose: () => void;
}) {
  const [amount, setAmount] = useState(() => minorToMajorString(row.amountMinor, currency));
  const [on, setOn] = useState(row.on);
  let amountMinor: number | null = null;
  try {
    amountMinor = parseMajor(amount, currency);
  } catch {
    amountMinor = null;
  }
  const valid = amountMinor !== null && amountMinor > 0 && /^\d{4}-\d{2}-\d{2}$/.test(on);
  return (
    <Sheet
      grouped
      title="Correct the row"
      onClose={onClose}
      confirm={{
        label: 'Save',
        disabled: !valid,
        run: () => {
          if (!valid) return;
          onSave({ on, amountMinor: amountMinor! });
          onClose();
        },
      }}
    >
      <InsetGroup header={row.description} footer="As the statement prints it. The screenshot is not kept.">
        <TextRow label={`Amount (${currency})`} value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" />
        <TextRow label="Date" type="date" value={on} onChange={(e) => setOn(e.target.value)} />
      </InsetGroup>
    </Sheet>
  );
}
