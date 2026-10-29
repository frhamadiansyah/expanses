import { dayMonth, formatMinor } from '@expanses/core';
import type { AccountRow } from '@expanses/db';
import { Check, CreditCard, Landmark } from 'lucide-react';
import { Sheet } from '../../app/Sheet';
import { useBalances } from '../../lib/queries';
import { useAccountNumberLast4, useWalletLast4 } from '../cards/card-queries';
import { RowGlyph } from '../transactions/FormRow';
import { type PaidFromRow, paidFromCaptions, paidFromName } from './paid-from';

const LIST = 'overflow-hidden rounded-[11px] bg-[var(--ph-surface)] [&>li+li>button>.ph-row-body]:border-t-[0.5px] [&>li+li>button>.ph-row-body]:border-[var(--ph-hair)]';

/**
 * What the Paid from list and a bill's page know of each account: the digits it is stored with, its balance in its own
 * money, and the line each is captioned by (`paidFromCaptions`). Accounts belong to the owner rather than to a
 * workspace, so no workspace name is offered; twins that nothing else separates are told apart by the day added.
 */
export function usePaidFromLabels(accounts: readonly AccountRow[]): {
  captionOf: (id: string) => string;
  nameOf: (account: AccountRow) => string;
} {
  const numbers = useAccountNumberLast4().data;
  const phones = useWalletLast4().data;
  const balances = useBalances().data;
  const rows: PaidFromRow[] = accounts.map((account) => ({
    id: account.id,
    name: account.name,
    digits: numbers?.[account.id] ?? phones?.[account.id] ?? null,
    // A card's balance is what is owed, which is not what can be spent; only money held shows one.
    balanceText: account.kind === 'asset' && balances ? formatMinor(balances[account.id] ?? 0, account.currency ?? 'IDR') : null,
    workspaceName: null,
    addedText: account.createdAt ? dayMonth(account.createdAt.slice(0, 10)) : null,
  }));
  const captions = paidFromCaptions(rows);
  const all = rows;
  return {
    captionOf: (id) => captions[id] ?? '',
    nameOf: (account) => {
      const row = rows.find((r) => r.id === account.id);
      return row ? paidFromName(row, all) : account.name;
    },
  };
}

/**
 * Paid from, drawn as Paid with is: a sheet of rows, each a circle, the account's name and under it a grey line (its
 * digits, its balance), with a ✓ on the one chosen.
 */
export function PaidFromSheet({ accounts, value, onPick, onClose }: { accounts: readonly AccountRow[]; value: string; onPick: (id: string) => void; onClose: () => void }) {
  const { captionOf } = usePaidFromLabels(accounts);
  return (
    <Sheet grouped title="Paid from" onClose={onClose}>
      <ul className={LIST}>
        {accounts.map((account) => {
          const caption = captionOf(account.id);
          const Glyph = account.subtype === 'credit_card' ? CreditCard : Landmark;
          const chosen = account.id === value;
          return (
            <li key={account.id}>
              <button
                type="button"
                aria-label={caption ? `${account.name}, ${caption}` : account.name}
                aria-pressed={chosen}
                onClick={() => {
                  onPick(account.id);
                  onClose();
                }}
                className="ph-focus-inset flex w-full items-center gap-[10px] pl-[10px] text-left active:bg-[var(--ph-fill)]"
              >
                <RowGlyph>
                  <Glyph size={15} />
                </RowGlyph>
                <span className="ph-row-body flex min-h-12 min-w-0 flex-1 items-center gap-3 py-[6px] pr-[14px]">
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-[15px] text-[var(--ph-ink)]">{account.name}</span>
                    {caption && <span className="tabular truncate text-[12.5px] leading-4 text-[var(--ph-ink-3)]">{caption}</span>}
                  </span>
                  {chosen && <Check size={18} aria-label="Chosen" className="shrink-0 text-[var(--ph-ink)]" />}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </Sheet>
  );
}
