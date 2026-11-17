import { formatMinor, isoDate } from '@expanses/core';
import type { AccountRow } from '@expanses/db';
import { Link, useNavigate } from '@tanstack/react-router';
import { ChevronRight } from 'lucide-react';
import { SUBTYPE_LABELS } from '../../lib/account-types';
import { useAccounts } from '../../lib/queries';
import { cx, ErrorBox } from '../../ui';
import type { WalletCard } from '../../ui/native';
import { PEEK_BUTTON, SidePeek } from '../../ui/native/SidePeek';
import { useRecentTransactions } from '../accounts/queries';
import { CategoryIcon } from '../categories/CategoryIcon';
import { amountLook, buildRows } from '../transactions/list-model';
import { fromPhoneLine, type JointCard } from './wallet-joint';

/** How many rows the peek lists; the account's own history has them all. */
const RECENT_SHOWN = 4;

const PRIMARY = 'rounded-[6px] bg-[var(--ph-ink)] px-3 py-[4px] text-[13px] font-medium text-[var(--ph-surface)]';

/** What the peek is shown for: the card as Wallet draws it, and the account (or the partner's joint item) behind it. */
export interface PeekSubject {
  card: WalletCard;
  /** An own account or card; absent for the partner's joint item. */
  account?: AccountRow;
  joint?: JointCard;
  /** An account's pockets kept for spending; empty for an account without. */
  pockets: readonly AccountRow[];
}

/** The line under the figure: what it is, its currency (or its pockets'), its last four digits. */
export function peekLine({ card, account, joint, pockets }: PeekSubject): string {
  const subtype = account?.subtype ?? joint?.subtype ?? '';
  const kind = SUBTYPE_LABELS[subtype as keyof typeof SUBTYPE_LABELS] ?? subtype;
  const currencies = pockets.length > 0 ? [...new Set(pockets.map((pocket) => pocket.currency!))].join(', ') : (account?.currency ?? joint?.currency ?? '');
  return [joint ? `${joint.ownerName}’s` : null, kind, currencies, card.last4 ? `···· ${card.last4}` : null].filter(Boolean).join(' · ');
}

/**
 * A Wallet card in Mac Wallet's side peek: its name, its figure as the face prints it, what it is, the round actions
 * an account or a card page offers in a row — Transfer, Move for an account with pockets, Pay and Statement for a credit
 * card, Edit — its last few rows and the way to all of them. Open (or a double-click on its face) is its whole page.
 * The partner's joint item says where its figure came from; its statement, plans and settings stay on its holder's phone.
 */
export function WalletPeek({
  subject,
  top,
  first,
  last,
  onStep,
  onClose,
  onOpen,
}: {
  subject: PeekSubject;
  top: number;
  first: boolean;
  last: boolean;
  onStep: (by: -1 | 1) => void;
  onClose: () => void;
  onOpen: () => void;
}) {
  const navigate = useNavigate();
  const { card, account, joint, pockets } = subject;
  const credit = account?.subtype === 'credit_card' || joint?.side === 'credit';
  const id = account?.id;

  return (
    <SidePeek
      top={top}
      label="Account details"
      testId="wallet-peek"
      titleTestId="peek-title"
      noun="account"
      title={card.name}
      first={first}
      last={last}
      onStep={onStep}
      onClose={onClose}
    >
      <div className="px-[14px] pb-[10px]">
        <div className="text-[11px] text-[var(--ph-ink-3)]">{card.figureLabel}</div>
        <div data-testid="peek-figure" className={cx('text-[22px] font-semibold tabular-nums', credit ? 'text-[var(--ph-alarm)]' : 'text-[var(--ph-ink)]')}>
          {card.figure}
        </div>
        <div data-testid="peek-line" className="text-[12px] text-[var(--ph-ink-3)]">
          {peekLine(subject)}
        </div>
        {joint && (
          <p data-testid="peek-joint" className="mt-[6px] text-[12px] text-[var(--ph-ink-3)]">
            {fromPhoneLine(joint.ownerName, null, joint.asOf, Date.now(), isoDate())}.{' '}
            {joint.side === 'credit'
              ? `Counted at all it owes: its instalment plans stay on ${joint.ownerName}’s phone.`
              : `Its settings stay on ${joint.ownerName}’s phone.`}
          </p>
        )}
      </div>
      <div className="flex flex-wrap gap-2 px-[14px] pb-[12px]">
        {id && !credit && (
          <button
            type="button"
            className={PEEK_BUTTON}
            onClick={() =>
              void navigate({
                to: '/transactions/new',
                search: { mode: 'transfer', account: id },
              })
            }
          >
            Transfer
          </button>
        )}
        {id && !credit && pockets.length > 1 && (
          <button
            type="button"
            className={PEEK_BUTTON}
            onClick={() =>
              void navigate({
                to: '/accounts/$accountId/move',
                params: { accountId: id },
              })
            }
          >
            Move
          </button>
        )}
        {id && credit && (
          // The card page's Pay, filled with what the bank asks for: the card page reads the statement and opens "Pay credit card".
          <button
            type="button"
            className={PRIMARY}
            onClick={() =>
              void navigate({
                to: '/cards/$cardId',
                params: { cardId: id },
                search: { pay: true },
              })
            }
          >
            Pay
          </button>
        )}
        {id && credit && (
          <button
            type="button"
            className={PEEK_BUTTON}
            onClick={() =>
              void navigate({
                to: '/cards/$cardId/statement',
                params: { cardId: id },
              })
            }
          >
            Statement
          </button>
        )}
        {id && (
          <button
            type="button"
            className={PEEK_BUTTON}
            onClick={() =>
              void (credit
                ? navigate({
                    to: '/cards/$cardId/settings',
                    params: { cardId: id },
                  })
                : navigate({
                    to: '/net-worth/assets/$accountId/settings',
                    params: { accountId: id },
                  }))
            }
          >
            Edit
          </button>
        )}
        <button type="button" className={PEEK_BUTTON} onClick={onOpen}>
          Open
        </button>
      </div>
      {id && <PeekRecent accountId={id} ids={pockets.length > 0 ? pockets.map((pocket) => pocket.id) : [id]} />}
    </SidePeek>
  );
}

/** The account's last few rows, as its page's Recent reads them (opening balances left out); a click opens the receipt. */
function PeekRecent({ accountId, ids }: { accountId: string; ids: readonly string[] }) {
  const navigate = useNavigate();
  const accounts = useAccounts().data ?? [];
  const recent = useRecentTransactions(ids);
  const rows = buildRows(recent.data ?? [], [], accounts, [])
    .filter((row) => row.type !== 'opening')
    .slice(0, RECENT_SHOWN);
  return (
    <div className="border-t border-[var(--ph-hair)] pb-3">
      <h3 className="px-[14px] pt-[10px] pb-[4px] text-[11px] font-semibold tracking-[0.04em] text-[var(--ph-ink-3)] uppercase">Recent</h3>
      <ErrorBox error={recent.error} />
      {recent.isSuccess && rows.length === 0 && <p className="px-[14px] py-2 text-[12.5px] text-[var(--ph-ink-3)]">No transactions yet.</p>}
      <ul aria-label="Recent" data-testid="peek-recent">
        {rows.map((row) => {
          const look = amountLook(row, 'balance');
          const transfer = row.type !== 'expense' && row.type !== 'income';
          // The phone's reading of the row (`amountLook`), with its direction written as Mac tables write it: spending
          // with a minus, money in with a plus and in green, a transfer as it moved.
          const abs = Math.abs(row.amountMinor);
          const money = look.plus || look.sign > 0 ? `+${formatMinor(abs, row.currency)}` : look.sign < 0 ? formatMinor(-abs, row.currency) : formatMinor(row.amountMinor, row.currency);
          return (
            <li key={row.id}>
              <button
                type="button"
                data-testid="peek-recent-row"
                onClick={() =>
                  void navigate({
                    to: '/transactions/$transactionId',
                    params: { transactionId: row.id },
                  })
                }
                className="flex w-full items-center gap-[8px] px-[14px] py-[5px] text-left text-[13px] text-[var(--ph-ink)] hover:bg-[var(--ph-fill)]"
              >
                <CategoryIcon categoryId={row.categoryId} accounts={accounts} transfer={transfer} size="xs" />
                <span className="min-w-0 flex-1 truncate">{row.description || row.transferName || row.categoryName || 'Transfer'}</span>
                <span
                  className={cx(
                    'shrink-0 tabular-nums',
                    look.sign > 0 || (look.plus && !look.muted) ? 'text-[var(--ph-up)]' : look.muted ? 'text-[var(--ph-ink-3)]' : undefined,
                  )}
                >
                  {money}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      <Link
        to="/transactions"
        search={{ account: accountId }}
        className="flex items-center justify-between px-[14px] py-[6px] text-[13px] text-[var(--mac-accent)] hover:bg-[var(--ph-fill)]"
      >
        All transactions
        <ChevronRight size={14} aria-hidden />
      </Link>
    </div>
  );
}
