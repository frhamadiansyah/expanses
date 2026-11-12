import { isoDate } from '@expanses/core';
import { useNavigate, useParams } from '@tanstack/react-router';
import { ArrowLeftRight, Check, Plus, Settings } from 'lucide-react';
import { useState } from 'react';
import { useApp } from '../../app/context';
import { Empty, ErrorBox } from '../../ui';
import { ActionButtons, PushedTitle, type RoundAction, SCREEN, useWalletSlot } from '../../ui/native';
import { BalanceCard } from '../accounts/BalanceCard';
import { ownerRing } from '../networth/joint-rows';
import { useOwnerRings, useSharedNetWorth } from '../networth/queries';
import { JointRowsGroup } from '../sharing/JointAccountRows';
import { useJointRows } from '../sharing/net-worth-queries';
import { useSharingDetail } from '../sharing/queries';
import { currencyFlag } from '../transactions/tx-form';
import { useBooks } from '../workspaces/queries';
import { fromPhoneLine, walletJoint } from './wallet-joint';

/**
 * `/wallet/joint/$itemId` — the partner's joint account or joint card, opened from its card in Wallet (mockup
 * 2026-11-12-wallet-joint-items, A3 and A4). Under the raised card, as an own account's page is: its balance — or what
 * the card owes — as the owner's phone last sent it, and when; Add (and, for money, Transfer), which open the Add
 * screen in the group's workspace with the item filled in; Settings (and a card's Pay) greyed, since those stay on the
 * owner's phone; then the rows recorded against it in the shared workspace, each with who recorded it.
 */
export function JointItemPage() {
  const { itemId = '' } = useParams({ strict: false }) as { itemId?: string };
  const { ws, switchBook } = useApp();
  const navigate = useNavigate();
  const slot = useWalletSlot();
  const shared = useSharedNetWorth();
  const owners = useOwnerRings();
  const books = useBooks();
  const group = shared.data?.group ?? null;
  const card = shared.data ? (walletJoint(shared.data.items, shared.data.group.me, shared.data.names).find((each) => each.itemId === itemId) ?? null) : null;
  const detail = useSharingDetail(group?.workspaceBookId ?? '');
  const rows = useJointRows(group && card ? { workspaceBookId: group.workspaceBookId, itemId: card.itemId, owner: card.owner } : null);
  const [error, setError] = useState<unknown>(null);

  if (!card || !group) {
    if (shared.isPending) return null;
    return (
      <div className={SCREEN}>
        <PushedTitle title="Joint account" back="Wallet" backTo="/wallet" />
        <Empty>This item is no longer joint.</Empty>
      </div>
    );
  }

  const money = card.side === 'money';
  const workspace = (books.data ?? []).find((book) => book.id === group.workspaceBookId)?.name ?? 'the shared workspace';
  // The last time any of the owner's devices was heard from in the shared workspace: how fresh the figure is.
  const seen = (detail.data?.members.find((member) => member.memberId === card.owner)?.devices ?? []).reduce<number | null>(
    (newest, device) => (device.seenAt !== null && (newest === null || device.seenAt > newest) ? device.seenAt : newest),
    null,
  );
  const ring = owners ? ownerRing(owners.rings, card.owner) : null;

  /** The Add screen, in the group's workspace: the app opens that workspace first when another one is open. */
  const open = async (mode: 'expense' | 'transfer') => {
    setError(null);
    try {
      if (ws.bookId !== group.workspaceBookId) await switchBook(group.workspaceBookId);
      await navigate({ to: '/transactions/new', search: { mode, partner: card.itemId } });
    } catch (failure) {
      setError(failure);
    }
  };
  const actions: RoundAction[] = [
    { key: 'add', label: 'Add', glyph: <Plus size={22} aria-hidden />, run: () => void open('expense'), testId: 'joint-add' },
    money
      ? { key: 'transfer', label: 'Transfer', glyph: <ArrowLeftRight size={20} aria-hidden />, run: () => void open('transfer'), testId: 'joint-transfer' }
      : { key: 'pay', label: 'Pay', glyph: <Check size={20} aria-hidden />, disabled: true, testId: 'joint-pay' },
    { key: 'settings', label: 'Settings', glyph: <Settings size={20} aria-hidden />, disabled: true, testId: 'joint-settings' },
  ];

  return (
    <div className={slot ? undefined : SCREEN}>
      {slot ? (
        <div data-testid="wallet-slot" aria-hidden className="mb-5" style={{ width: slot.width, height: slot.height, maxWidth: '100%' }} />
      ) : (
        <PushedTitle title={`${card.name}, ${card.ownerName}’s`} back="Wallet" backTo="/wallet" />
      )}
      <ErrorBox error={error ?? shared.error ?? rows.error} />
      <BalanceCard
        label={money ? 'Balance' : 'Owed'}
        minor={card.minor}
        currency={card.currency}
        series={null}
        testId="joint-item-hero"
        corner={
          <span
            role="img"
            aria-label={card.currency}
            className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--ph-fill)] text-[17px] leading-none"
            style={ring ? { boxShadow: `inset 0 0 0 2.5px ${ring}` } : undefined}
          >
            {currencyFlag(card.currency)}
          </span>
        }
        caption={<span data-testid="joint-item-from">{fromPhoneLine(card.ownerName, seen, card.asOf, Date.now(), isoDate())}</span>}
      />
      <ActionButtons actions={actions} />
      {rows.data ? (
        <JointRowsGroup
          rows={rows.data.rows}
          me={group.me}
          names={rows.data.names}
          workspaceBookId={group.workspaceBookId}
          noun={money ? 'account' : 'card'}
          footer={
            money
              ? `Add and Transfer record in ${workspace}. The account’s settings stay on ${card.ownerName}’s phone.`
              : `Purchases recorded in ${workspace} show on both phones. The statement, Pay and points stay on ${card.ownerName}’s phone.`
          }
        />
      ) : null}
    </div>
  );
}
