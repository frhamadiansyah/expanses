import { setWalletOrder } from '@expanses/db';
import { Check, ChevronDown, ChevronUp, GripVertical } from 'lucide-react';
import { useState } from 'react';
import { useBack } from '../../app/BackHeader';
import { useApp } from '../../app/context';
import { usePhone } from '../../app/use-phone';
import { useInvalidateAll } from '../../lib/queries';
import { SUBTYPE_LABELS } from '../../lib/account-types';
import { ErrorBox } from '../../ui';
import { CARD_W, cardHeightFor, InsetGroup, InsetRow, PushedTitle, ROW_PAD_X, ROW_PAD_Y, SCREEN, type WalletCard, WalletFace } from '../../ui/native';
import { DayReorder, movedBy, reorderAttrs, ReorderScope } from '../transactions/DayReorder';
import { useWalletCards } from './useWalletCards';
import { isJointKey, writeJointOrder } from './wallet-joint';

/** The width of a card's thumbnail in its row: the face Wallet draws, scaled down whole. */
const THUMB = 46;
const THUMB_GAP = 12;
const thumbScale = THUMB / CARD_W;

/**
 * The order a card is in, as it is being changed: the order chosen so far, with any card that left Wallet meanwhile
 * dropped and any that arrived put at the end — where Wallet itself would put a newcomer.
 */
export function editedOrder(chosen: readonly string[] | null, cards: readonly string[]): string[] {
  if (chosen === null) return [...cards];
  const known = new Set(cards);
  const kept = chosen.filter((id) => known.has(id));
  const placed = new Set(kept);
  return [...kept, ...cards.filter((id) => !placed.has(id))];
}

/**
 * `/wallet/reorder` — Wallet's cards put in an order by hand (owner's "A2"): one list, money and credit cards mixed, so
 * a credit card may stand in front of a bank account. The order is the one all three views draw: the stack top to
 * bottom, the grid left to right and row by row, the carousel first to last.
 *
 * A card is moved by its ≡ handle (or, on a phone, by pressing and holding the row), the same drag a day's rows take
 * in Transactions (`DayReorder`). Move up and Move down are on every row for a keyboard and a screen reader, out of
 * sight until focused. Done keeps the order and goes back to Wallet; ‹ goes back without keeping it.
 */
export function WalletReorderPage() {
  const { database, ws } = useApp();
  const phone = usePhone();
  const goBack = useBack('/wallet');
  const invalidateAll = useInvalidateAll();
  const { cards, everything, ready } = useWalletCards();
  const [chosen, setChosen] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [said, setSaid] = useState('');

  const byKey = new Map(cards.map((card) => [card.key, card]));
  const order = editedOrder(chosen, cards.map((card) => card.key));
  const shown = order.flatMap((id) => byKey.get(id) ?? []);

  const move = (id: string, by: -1 | 1) => {
    const next = movedBy(order, id, by);
    if (!next) return;
    setChosen(next);
    setSaid(`${byKey.get(id)?.name ?? 'Card'}, ${next.indexOf(id) + 1} of ${next.length}`);
  };

  const done = async () => {
    // Nothing moved: nothing to keep, and a Wallet still in its default order stays in it.
    if (chosen === null || order.join() === cards.map((card) => card.key).join()) {
      goBack();
      return;
    }
    setBusy(true);
    setError(null);
    try {
      // The own cards' places go on the accounts, synced; the partner's joint cards' stay on this device (`walletKeys`).
      await setWalletOrder(database, ws, order.filter((key) => !isJointKey(key)));
      writeJointOrder(order);
      await invalidateAll();
      goBack();
    } catch (caught) {
      setError(caught);
      setBusy(false);
    }
  };

  /** The line under a card's name: what it is, and its last four digits when they are known. */
  const subtitleOf = (card: WalletCard) => {
    // A partner's joint card: whose it is and what it is, as its facts line says.
    if (isJointKey(card.key)) return card.subtitle ?? '';
    const account = everything.find((a) => a.id === card.key);
    return [account ? SUBTYPE_LABELS[account.subtype] : null, card.last4 ? `···· ${card.last4}` : null].filter(Boolean).join(' · ');
  };

  return (
    <div className={SCREEN}>
      <PushedTitle
        title="Reorder cards"
        back="Wallet"
        onBack={goBack}
        actions={[{ key: 'done', label: 'Done', glyph: <Check size={20} aria-hidden />, disabled: busy || !ready, run: () => void done() }]}
      />
      <ErrorBox error={error} />
      {ready && shown.length === 0 && (
        <InsetGroup>
          <InsetRow title={<span className="text-[var(--ph-ink-3)]">No cards yet</span>} />
        </InsetGroup>
      )}
      {shown.length > 0 && (
        <InsetGroup footer="Drag a card by its handle to move it. Stack, Grid and Carousel all follow this order.">
          <ReorderScope enabled>
            <DayReorder enabled phone={phone} onMove={(_moved, next) => setChosen(next)} className="relative">
              {shown.map((card, index) => (
                <li key={card.key} {...reorderAttrs(card.key)} data-testid="reorder-row" className="relative bg-[var(--ph-surface)]">
                  {index > 0 && (
                    <span aria-hidden className="pointer-events-none absolute top-0 bg-[var(--ph-hair)]" style={{ height: 0.5, left: ROW_PAD_X + THUMB + THUMB_GAP, right: ROW_PAD_X }} />
                  )}
                  <div className="flex items-center" style={{ gap: THUMB_GAP, minHeight: 60, padding: `${ROW_PAD_Y}px ${ROW_PAD_X}px` }}>
                    <span aria-hidden className="relative block shrink-0 overflow-hidden" style={{ width: THUMB, height: cardHeightFor(THUMB), borderRadius: Math.round(14.4 * thumbScale) + 1 }}>
                      <WalletFace card={card} band={false} scale={thumbScale} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[17px] leading-[22px] font-medium text-[var(--ph-ink)] md:text-[15px] md:leading-[20px]">{card.name}</span>
                      {subtitleOf(card) && <span className="mt-[2px] block truncate text-[12.5px] leading-[16px] text-[var(--ph-ink-3)]">{subtitleOf(card)}</span>}
                    </span>
                    {/* Out of sight until focused: a keyboard's and a screen reader's way to move a card without dragging. */}
                    <span className="sr-only focus-within:not-sr-only focus-within:flex focus-within:shrink-0 focus-within:items-center focus-within:gap-[2px]">
                      <button type="button" className="ph-focus rounded p-[6px] text-[var(--ph-ink-2)] disabled:opacity-40" aria-label={`Move ${card.name} up`} disabled={index === 0} onClick={() => move(card.key, -1)}>
                        <ChevronUp size={18} aria-hidden />
                      </button>
                      <button
                        type="button"
                        className="ph-focus rounded p-[6px] text-[var(--ph-ink-2)] disabled:opacity-40"
                        aria-label={`Move ${card.name} down`}
                        disabled={index === shown.length - 1}
                        onClick={() => move(card.key, 1)}
                      >
                        <ChevronDown size={18} aria-hidden />
                      </button>
                    </span>
                    <button
                      type="button"
                      data-reorder-handle=""
                      aria-label={`Reorder ${card.name}`}
                      title="Drag to reorder"
                      className="ph-focus -mr-[6px] flex h-[44px] w-[44px] shrink-0 cursor-grab touch-none items-center justify-center rounded text-[var(--ph-ink-3)] active:cursor-grabbing"
                      onKeyDown={(event) => {
                        if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
                        event.preventDefault();
                        move(card.key, event.key === 'ArrowUp' ? -1 : 1);
                      }}
                    >
                      <GripVertical size={20} aria-hidden />
                    </button>
                  </div>
                </li>
              ))}
            </DayReorder>
          </ReorderScope>
        </InsetGroup>
      )}
      <p aria-live="polite" className="sr-only">
        {said}
      </p>
    </div>
  );
}
