import type { CatalogCardLook } from '@expanses/catalog';
import { Link, type LinkProps } from '@tanstack/react-router';
import { type CSSProperties, type ReactNode, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useEscape } from '../../app/use-escape';
import { usePhone } from '../../app/use-phone';
import { CardFace } from '../../features/cards/CardFace';
import { cx } from '../index';
import { CARD_H, CARD_W, DESKTOP_CARD_W, faceIsBehind, stackLayout } from './card-stack';
import { InsetGroup, InsetRow } from './InsetList';
import { WalletSlotContext } from './wallet-slot';

/**
 * Primitive 7: card art, in the Wallet stack the user chose for `/cards` (C3).
 *
 * The art itself is **`CardFace`**, which already redraws a catalogue card from its official colours, finish and
 * motif. Nothing here redraws a card; this is the shelf the faces sit on.
 *
 * It is Apple Wallet's pile: every card is its own whole face at one width, and each card is laid over the one
 * before it with a soft shadow along its edge, so what shows of a covered card is its top band. That band is the
 * card's own print — its bank and name on the left and, in place of Wallet's field, the card's figure on the
 * right — so every figure reads without a tap.
 *
 * The pile runs back to front, as Wallet's does: the rearmost card at the top, the front card last and whole.
 * Tapping any card opens it — that same element rises to the top at the same width, the others slide off the
 * bottom of the screen, and its page fades in below it. The ✕, the raised card or Escape put it back in its slot,
 * and the others come back into theirs.
 */

export interface WalletCard {
  key: string;
  issuer: string | null;
  name: string;
  last4: string | null;
  holderName?: string | null;
  network?: string | null;
  look?: CatalogCardLook | null;
  /** The figure on this card's band — points, miles, or what is owed. Already a whole number of its unit. */
  figure: string;
  figureLabel: string;
  /**
   * The line under the name: the digits, the cycle, what the points are worth — whatever the wall would lose if
   * the card were only a name and a figure. Drawn in the facts row beside the card in front.
   */
  subtitle?: string;
  /**
   * Where this card goes. Given a route it is drawn as a real link, so a desktop keeps its middle-click and its
   * "open in a new tab" — the same reason the kit's rows and corner buttons are links when they are journeys.
   */
  to?: LinkProps['to'];
  params?: LinkProps['params'];
  /** The card's accessible name, when the composed one is not what the screen means. */
  label?: string;
}

/** Wallet's own beat for a card moving: long enough to follow, with the settle of a spring. */
const MOVE_MS = 420;
const MOVE_EASE = 'cubic-bezier(0.2, 0.8, 0.2, 1)';

function reducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function CardStack({
  cards,
  raised = null,
  onOpen,
  onClose,
  children,
  label,
  className,
}: {
  cards: readonly WalletCard[];
  /** The key of the open card, raised to the top, or null for the stack at rest. */
  raised?: string | null;
  /** Opens a card that has no route of its own. A card with a route is a link and opens by going there. */
  onOpen?: (key: string) => void;
  /** Puts the raised card back in its slot: the ✕, the raised card itself, Escape. */
  onClose?: () => void;
  /** The open card's page, laid out under the raised card. It leaves the card a slot (`useWalletSlot`). */
  children?: ReactNode;
  /** Names the stack as a region. The open card's page is outside it: it is the card's page, not the wall. */
  label?: string;
  className?: string;
}) {
  const phone = usePhone();
  /*
   * On a phone a card is as wide as the column inside the 16 px gutter, as Wallet draws it — so the stack
   * measures the column it is given. A desktop draws Wallet's own card width, and never wider than its column.
   */
  const shelf = useRef<HTMLDivElement>(null);
  const [column, setColumn] = useState<{ width: number; left: number } | null>(null);
  useLayoutEffect(() => {
    const node = shelf.current;
    if (!node) return;
    const measure = () => setColumn(node.clientWidth ? { width: node.clientWidth, left: node.getBoundingClientRect().left } : null);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    window.addEventListener('resize', measure);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, []);

  const keys = cards.map((card) => card.key);
  const raisedIndex = raised === null ? -1 : keys.indexOf(raised);
  const cardWidth = phone ? (column?.width ?? CARD_W) : Math.min(column?.width ?? DESKTOP_CARD_W, DESKTOP_CARD_W);
  const layout = stackLayout(keys, { raised: raisedIndex < 0 ? null : raisedIndex, cardWidth });
  const isRaised = layout.raised !== null;
  const raisedKey = isRaised ? raised : null;
  // Faces are drawn at 240 and scaled to the card's width, so every printed row keeps its place on the card.
  const scale = layout.cardWidth / CARD_W;
  // The face's own corner, scaled with it, so a box and the art inside it round alike.
  const radius = Math.round(14.4 * scale);
  // The page's dots choose which plastic card on the account the raised card shows.
  const [shown, setShown] = useState<{ last4: string | null; holderName?: string | null } | null>(null);
  useEffect(() => setShown(null), [raisedKey]);

  /*
   * FLIP: where every card was is read the moment the stack is asked to change state — during that render, while
   * the page still shows the old one — and once the new places are committed each card is sent back to where it
   * was by a transform and let go. So a card travels, continuously, from its slot to the top and back, whatever
   * positioning each end uses; nothing is redrawn and nothing cuts.
   */
  const elements = useRef(new Map<string, HTMLDivElement>());
  const committed = useRef<string | null | undefined>(undefined);
  const before = useRef<Map<string, { rect: DOMRect; opacity: string }> | null>(null);
  const scrollAtRest = useRef(0);
  if (committed.current !== undefined && committed.current !== raisedKey && before.current === null) {
    before.current = new Map([...elements.current].map(([key, node]) => [key, { rect: node.getBoundingClientRect(), opacity: getComputedStyle(node).opacity }]));
  }
  useLayoutEffect(() => {
    const was = committed.current;
    committed.current = raisedKey;
    const rects = before.current;
    before.current = null;
    if (was === undefined || was === raisedKey || !rects) return;
    // A raised card goes to the top of the screen, as in Wallet; closing it returns the reader to where they were.
    if (was === null) {
      scrollAtRest.current = window.scrollY;
      window.scrollTo(0, 0);
    } else if (raisedKey === null) {
      window.scrollTo(0, scrollAtRest.current);
      elements.current.get(was)?.querySelector<HTMLElement>('a,button')?.focus({ preventScroll: true });
    }
    if (reducedMotion()) return;
    const moving: [HTMLDivElement, string][] = [];
    for (const [key, node] of elements.current) {
      const from = rects.get(key);
      if (!from) continue;
      const to = node.getBoundingClientRect();
      const dx = from.rect.left - to.left;
      const dy = from.rect.top - to.top;
      if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) continue;
      // What React set is where the card lands; it starts from where it was, as it was, and is let go.
      const opacity = node.style.opacity;
      node.style.transition = 'none';
      node.style.transform = `translate(${dx}px, ${dy}px)`;
      node.style.opacity = from.opacity;
      moving.push([node, opacity]);
    }
    if (moving.length === 0) return;
    void document.body.offsetHeight;
    for (const [node, opacity] of moving) {
      node.style.transition = `transform ${MOVE_MS}ms ${MOVE_EASE}, opacity ${MOVE_MS}ms ease-out`;
      node.style.transform = '';
      node.style.opacity = opacity;
    }
  }, [raisedKey]);

  // Escape puts the raised card back, as the ✕ does.
  useEscape(() => onClose?.(), isRaised);

  // The facts describe the card in front: the last card, whole at the bottom of the pile.
  const described = isRaised ? undefined : cards[layout.front];

  return (
    <div className={className}>
      <section aria-label={label} className={cx(!isRaised && 'md:flex md:items-start md:gap-6 md:pb-5')}>
        <div ref={shelf} className={cx(!isRaised && 'md:w-[380px] md:max-w-full md:shrink-0')}>
          <div className="relative" style={{ width: layout.width, height: layout.height, maxWidth: '100%' }}>
            {layout.cards.map((placed, index) => {
              const card = cards[index]!;
              const covered = faceIsBehind(placed);
              // One link per card, named by the card and its figure, so a reader hears every figure moving through.
              const name = card.label ?? card.name;
              const named = card.figure && card.figure !== '—' ? `${name}, ${card.figure}` : name;
              /*
               * The control is the part of the card that shows — the whole face in front, the band or the pile's
               * edge otherwise — laid over the art, so a tap, a pointer and a focus ring all land on what can be
               * seen, and never on the part of a card the next one covers.
               */
              const whole = placed.visible >= layout.cardHeight;
              const style: CSSProperties = {
                height: placed.visible,
                borderRadius: whole ? radius : `${radius}px ${radius}px 0 0`,
                pointerEvents: 'auto',
              };
              const hit = 'ph-focus-inset absolute top-0 left-0 block w-full text-left';
              /*
               * Every card is drawn whole, at one width; the card after it is laid over it, so what shows is its top
               * band. While another card is open the rest wait below the bottom of the screen, faded and inert — out
               * of sight, out of the tab order and out of the accessibility tree — and come back up into their slots.
               */
              const hidden = placed.place === 'hidden';
              const box: CSSProperties = hidden
                ? { position: 'fixed', left: column?.left ?? 16, top: '100vh', zIndex: 1, opacity: 0 }
                : { position: 'absolute', left: 0, top: placed.top, zIndex: placed.place === 'raised' ? 15 : placed.zIndex };
              return (
                <div
                  key={card.key}
                  ref={(node) => {
                    if (node) elements.current.set(card.key, node);
                    else elements.current.delete(card.key);
                  }}
                  data-testid="wallet-card"
                  data-place={placed.place}
                  data-front={index === layout.front ? '' : undefined}
                  inert={hidden}
                  aria-hidden={hidden || undefined}
                  style={{
                    ...box,
                    width: layout.cardWidth,
                    height: layout.cardHeight,
                    borderRadius: radius,
                    // The seam where this card meets the one beneath it: what makes a pile of bands read as cards.
                    boxShadow: 'var(--ph-card-edge)',
                    pointerEvents: 'none',
                  }}
                >
                  <Face
                    card={placed.place === 'raised' && shown ? { ...card, last4: shown.last4, holderName: shown.holderName } : card}
                    band={covered}
                    scale={scale}
                  />
                  {placed.place === 'raised' ? (
                    // The raised card is the page's header; tapping it closes it, as in Wallet.
                    <button type="button" aria-label={name} className={hit} style={style} onClick={() => onClose?.()} />
                  ) : card.to ? (
                    <Link to={card.to} params={card.params} aria-label={named} className={hit} style={style} />
                  ) : (
                    <button type="button" aria-label={named} className={hit} style={style} onClick={() => onOpen?.(card.key)} />
                  )}
                </div>
              );
            })}
          </div>
        </div>
        {/*
         * The front card's face is its art, so its figure sits beside the stack on a desktop and under it on a
         * phone: one grouped row, the kit's own shape, so every card's figure reads without a tap.
         */}
        {described && (
          <InsetGroup className="mt-[10px] md:mt-0 md:min-w-0 md:flex-1">
            <InsetRow
              testId="wallet-facts"
              title={described.name}
              subtitle={[described.figureLabel, described.subtitle].filter(Boolean).join(' · ')}
              value={described.figure}
              valueTone="ink"
            />
          </InsetGroup>
        )}
      </section>
      {isRaised && (
        <WalletSlotContext.Provider value={{ width: layout.cardWidth, height: layout.cardHeight, setShown }}>
          {/* The page fades in under the raised card. */}
          <div className="ph-fade-in">{children}</div>
        </WalletSlotContext.Provider>
      )}
    </div>
  );
}

/** One card's art, drawn at 240 and scaled to the stack's card width, whole or as its top band. */
function Face({ card, band, scale }: { card: WalletCard; band: boolean; scale: number }) {
  return (
    <span
      className="pointer-events-none absolute top-0 left-0 block origin-top-left overflow-hidden"
      style={{ width: CARD_W, height: CARD_H, transform: scale === 1 ? undefined : `scale(${scale})`, borderRadius: 14.4 }}
    >
      <CardFace
        issuer={card.issuer}
        name={card.name}
        last4={card.last4}
        holderName={card.holderName}
        network={card.network}
        look={card.look}
        size="md"
        band={band ? card.figure : undefined}
      />
    </span>
  );
}
