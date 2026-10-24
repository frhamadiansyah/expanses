import type { AccountRow } from '@expanses/db';
import { Link, useNavigate } from '@tanstack/react-router';
import { ChevronRight } from 'lucide-react';
import { type RefObject, useLayoutEffect, useRef, useState } from 'react';
import { usePhone } from '../../app/use-phone';
import { useAccounts } from '../../lib/queries';
import { cx, ErrorBox } from '../../ui';
import { CARD_W, DESKTOP_CARD_W, InsetGroup, InsetRow, Panel, type WalletCard, WalletFace, cardHeightFor } from '../../ui/native';
import { pocketsOf } from '../accounts/pockets';
import { useRecentTransactions } from '../accounts/queries';
import { buildRows } from '../transactions/list-model';
import { TransactionRow } from '../transactions/TransactionRow';

/**
 * Wallet's two other layouts of the same cards: a grid of whole faces, and a carousel that reads one card at a time.
 * The pile is `CardStack`; which of the three is drawn is this device's choice (`wallet-view`). The cards, their
 * order, their art and where a tap goes are the stack's own, handed over unchanged — only the shelf differs.
 */

/** The width of the column a layout is given, measured as the stack measures its shelf; null until it has been. */
function useColumnWidth(node: RefObject<HTMLDivElement | null>): number | null {
  const [width, setWidth] = useState<number | null>(null);
  useLayoutEffect(() => {
    const element = node.current;
    if (!element) return;
    const measure = () => setWidth(element.clientWidth || null);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [node]);
  return width;
}

/** A card's accessible name, as the stack gives it: the name and the figure, so a reader hears every figure. */
const named = (card: WalletCard) => {
  const name = card.label ?? card.name;
  return card.figure && card.figure !== '—' ? `${name}, ${card.figure}` : name;
};

/** The face's own corner, scaled with it, so the box and the art inside it round alike. */
const radiusFor = (scale: number) => Math.round(14.4 * scale);

/** The gap between two faces side by side, and between the carousel's cards. */
const GAP = 12;

/**
 * Two columns of whole faces, each captioned with its name and its figure — a credit card's in the owed red, as
 * every owed figure is drawn. The order is the stack's: back to front, read left to right, top to bottom. On a wide
 * screen the two columns stop at the stack's own desktop card width, rather than two faces as wide as the window.
 */
export function WalletGrid({ cards }: { cards: readonly WalletCard[] }) {
  const shelf = useRef<HTMLDivElement>(null);
  const width = useColumnWidth(shelf);
  const cell = width === null ? null : Math.floor((width - GAP) / 2);
  const scale = (cell ?? CARD_W) / CARD_W;
  const height = cardHeightFor(cell ?? CARD_W);
  return (
    <section aria-label="Cards" data-testid="wallet-grid" className="md:pb-5">
      <div ref={shelf} className="grid grid-cols-2" style={{ columnGap: GAP, rowGap: 16, maxWidth: 2 * DESKTOP_CARD_W + GAP }}>
        {cell !== null &&
          cards.map((card) => (
            <div key={card.key} className="min-w-0">
              <div data-testid="wallet-card" className="relative" style={{ width: cell, height, borderRadius: radiusFor(scale) }}>
                {/* The face prints its own name and figure, so the grid needs no caption under it. */}
                <WalletFace card={card} band={false} scale={scale} figure />
                {/* The tap is the whole face; a link, as in the stack, so a desktop keeps its new tab. */}
                {card.to && (
                  <Link
                    to={card.to}
                    params={card.params}
                    aria-label={named(card)}
                    className="ph-focus-inset absolute inset-0 block"
                    style={{ borderRadius: radiusFor(scale) }}
                    // The opened card is drawn at the top of the page, as the stack raises it.
                    onClick={() => window.scrollTo(0, 0)}
                  />
                )}
              </div>
            </div>
          ))}
      </div>
    </section>
  );
}

/** How much of the next card shows either side of the one in the middle. */
const PEEK = 28;

/**
 * One card at a time: a strip of whole faces that snaps each to the centre with the next one peeking, a dot per card
 * under it, then the facts row the stack draws for its front card and the card's last few rows. The dots, the facts
 * and the rows follow whichever card the strip has nearest its centre, read off the scroll position: card `i` is
 * centred at `i × (card width + gap)`, since the strip's padding centres the first card at rest, so the nearest card
 * is that distance rounded — nothing to observe, nothing to miss.
 */
export function WalletCarousel({ cards, accounts }: { cards: readonly WalletCard[]; accounts: readonly AccountRow[] }) {
  const phone = usePhone();
  const shelf = useRef<HTMLDivElement>(null);
  const strip = useRef<HTMLDivElement>(null);
  const width = useColumnWidth(shelf);
  const cardWidth = width === null ? null : phone ? width - 2 * PEEK : Math.min(DESKTOP_CARD_W, width - 2 * PEEK);
  const scale = (cardWidth ?? CARD_W) / CARD_W;
  const height = cardHeightFor(cardWidth ?? CARD_W);
  const step = (cardWidth ?? CARD_W) + GAP;
  /*
   * On a phone the strip runs edge to edge, out through the screen's 16 px gutter, so the cards either side peek in
   * from the screen's own edges rather than being cut off at the column's: the padding centres a card in the wider strip.
   */
  const BLEED = phone ? 16 : 0;
  const pad = width !== null && cardWidth !== null ? (width + 2 * BLEED - cardWidth) / 2 : PEEK + BLEED;

  const [current, setCurrent] = useState(0);
  const index = Math.min(current, Math.max(cards.length - 1, 0));
  const onScroll = () => {
    const node = strip.current;
    if (!node) return;
    setCurrent(Math.max(0, Math.min(cards.length - 1, Math.round(node.scrollLeft / step))));
  };
  const scrollTo = (i: number) => strip.current?.scrollTo({ left: i * step, behavior: 'smooth' });
  const shown = cards[index];

  return (
    <section aria-label="Cards" data-testid="wallet-carousel" className="md:pb-5">
      <div ref={shelf}>
        <div
          ref={strip}
          onScroll={onScroll}
          data-testid="wallet-strip"
          className="flex snap-x snap-mandatory overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          style={{ gap: GAP, paddingInline: pad, scrollPaddingInline: pad, marginInline: -BLEED }}
        >
          {cardWidth !== null &&
            cards.map((card, i) => (
              <div
                key={card.key}
                data-testid="wallet-card"
                data-current={i === index ? '' : undefined}
                className="relative shrink-0 snap-center"
                style={{ width: cardWidth, height, borderRadius: radiusFor(scale) }}
              >
                <WalletFace card={card} band={false} scale={scale} />
                {/* The card in the middle opens; a tap on a card peeking at the edge brings it to the middle first. */}
                {i === index && card.to ? (
                  <Link to={card.to} params={card.params} aria-label={named(card)} className="ph-focus-inset absolute inset-0 block" style={{ borderRadius: radiusFor(scale) }} onClick={() => window.scrollTo(0, 0)} />
                ) : (
                  <button type="button" aria-label={named(card)} className="ph-focus-inset absolute inset-0 block" style={{ borderRadius: radiusFor(scale) }} onClick={() => scrollTo(i)} />
                )}
              </div>
            ))}
        </div>
        {cards.length > 1 && (
          <div className="mt-[10px] flex items-center justify-center gap-[6px]" role="group" aria-label="Cards shown">
            {cards.map((card, i) => (
              <button
                key={card.key}
                type="button"
                data-testid="wallet-dot"
                aria-label={card.label ?? card.name}
                aria-current={i === index ? 'true' : undefined}
                onClick={() => scrollTo(i)}
                className="ph-focus flex h-[22px] w-[14px] items-center justify-center"
              >
                <span aria-hidden className={cx('block h-[7px] w-[7px] rounded-full', i === index ? 'bg-[var(--ph-ink)]' : 'bg-[var(--ph-ink-3)] opacity-40')} />
              </button>
            ))}
          </div>
        )}
      </div>
      {shown && (
        <>
          {/* The front card's facts, as the stack draws them under its pile: the figure the whole face does not print. */}
          <InsetGroup className="mt-[10px]">
            <InsetRow testId="wallet-facts" title={shown.name} subtitle={[shown.figureLabel, shown.subtitle].filter(Boolean).join(' · ')} value={shown.figure} valueTone="ink" />
          </InsetGroup>
          <Recent key={shown.key} card={shown} accounts={accounts} />
        </>
      )}
    </section>
  );
}

/**
 * The shown card's last few rows, as its own page draws them (`AccountPage`'s Recent): an account with pockets reads
 * its pockets', a credit card its own. A tap opens the receipt; See all opens the list filtered to the account.
 */
function Recent({ card, accounts }: { card: WalletCard; accounts: readonly AccountRow[] }) {
  const navigate = useNavigate();
  const known = useAccounts();
  const pockets = pocketsOf(card.key, accounts);
  const recent = useRecentTransactions(pockets.length > 0 ? pockets.map((pocket) => pocket.id) : [card.key]);
  const rows = buildRows(recent.data ?? [], [], known.data ?? [], []);
  return (
    <Panel header="Recent" testId="wallet-recent" className="mt-4">
      <ErrorBox error={recent.error} />
      {recent.isSuccess && rows.length === 0 ? (
        <p className="py-1 text-[15px] leading-[20px] text-[var(--ph-ink-3)]">No transactions yet.</p>
      ) : (
        <ul className="[&>*+*]:border-t-[0.5px] [&>*+*]:border-[var(--ph-hair)]">
          {rows.map((row) => (
            <TransactionRow
              key={row.id}
              row={row}
              accounts={known.data ?? []}
              testId="wallet-recent-row"
              title="Open the receipt"
              onOpen={() => void navigate({ to: '/transactions/$transactionId', params: { transactionId: row.id } })}
            />
          ))}
          <li>
            <Link to="/transactions" search={{ account: card.key }} className="ph-focus flex items-center justify-between pt-[10px] text-[15px] leading-[20px] text-[var(--ph-tint)]">
              See all
              <ChevronRight size={16} aria-hidden className="text-[var(--ph-chevron)]" />
            </Link>
          </li>
        </ul>
      )}
    </Panel>
  );
}
