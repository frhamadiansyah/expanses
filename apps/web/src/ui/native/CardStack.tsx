import type { CatalogCardLook } from '@expanses/catalog';
import { Link, type LinkProps } from '@tanstack/react-router';
import { useLayoutEffect, useRef, useState } from 'react';
import { usePhone } from '../../app/use-phone';
import { useEscape } from '../../app/use-escape';
import { CardFace } from '../../features/cards/CardFace';
import { cx } from '../index';
import { CARD_H, CARD_W, faceIsBehind, stackLayout } from './card-stack';
import { InsetGroup, InsetRow } from './InsetList';

/**
 * Primitive 7: card art, in the Wallet stack the user chose for `/cards` (C3).
 *
 * The art itself is **`CardFace`**, which already redraws a catalogue card from its official colours, finish and
 * motif. Nothing here redraws a card; this is the shelf the faces sit on.
 *
 * C3's known weakness is that only the front card's figures show. The answer built in here is the **strip** —
 * the band of a card its neighbour does not cover, which carries the card's name *and* its figure. All of them
 * read without a tap, on the page whose whole purpose is answering "how many miles have I got?".
 *
 * A covered card's face is handed over as `behind` (`faceIsBehind`), so the band a neighbour leaves showing
 * carries the strip's two lines and nothing else — the card's own printed rows would otherwise sit in the same
 * pixels as the strip, which reads as two texts smeared over one another.
 */

export interface WalletCard {
  key: string;
  issuer: string | null;
  name: string;
  last4: string | null;
  holderName?: string | null;
  network?: string | null;
  look?: CatalogCardLook | null;
  /** The figure on this card's strip — points, miles, or what is owed. Already a whole number of its unit. */
  figure: string;
  figureLabel: string;
  /**
   * The line under the name: the digits, the cycle, what the points are worth — whatever the wall would lose if
   * the card were only a name and a figure. Drawn on the strip as well as under the front card, so a covered
   * card keeps it too.
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

export function CardStack({
  cards,
  onOpen,
  className,
}: {
  cards: readonly WalletCard[];
  /** Where a card goes when it is chosen — `/cards/$cardId`. A lift is a look; this is the journey. */
  onOpen?: (key: string) => void;
  className?: string;
}) {
  const phone = usePhone();
  const [lifted, setLifted] = useState<number | null>(null);
  /*
   * On a phone a card is as wide as the column inside the 16 px gutter, as Wallet draws it — so the stack
   * measures the column it is given rather than assuming 240. The first paint uses 240 until the measure lands.
   */
  const shelf = useRef<HTMLDivElement>(null);
  const [column, setColumn] = useState<number | null>(null);
  useLayoutEffect(() => {
    const node = shelf.current;
    if (!node) return;
    const measure = () => setColumn(node.clientWidth || null);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  // A lifted card is the innermost thing open, so Escape puts it back before it reaches anything behind it.
  useEscape(() => setLifted(null), lifted !== null);

  // A phone has height and no width, so the cards overlap downwards; a 1440px window has the opposite problem,
  // so they fan sideways. One primitive, two geometries — not a phone layout stretched across a desktop.
  const fan = !phone;
  const layout = stackLayout(
    cards.map((card) => card.key),
    { lifted: phone ? lifted : null, fan, cardWidth: phone && column ? column : undefined },
  );
  // Faces are drawn at 240 and scaled to the card's width, so every printed row keeps its place on the card.
  const scale = layout.cardWidth / CARD_W;

  // The facts describe the card in front — the lifted one, once a covered card has been brought forward.
  const described = cards[layout.front];

  return (
    <div className={className} ref={shelf}>
      <div className="relative mx-auto" style={{ width: layout.width, height: layout.height, maxWidth: '100%' }}>
      {layout.cards.map((placed, index) => {
        const card = cards[index]!;
        // A card this stack clips to its strip is drawn `behind`: its own rows would print in the same pixels as
        // the band below, so the face is colour alone and the strip is the only text in that edge.
        const covered = faceIsBehind(placed);
        // A tap on a covered card brings it to the front; on the front card, or on a desktop, it opens it.
        const opens = !phone || index === layout.front;
        const label = card.label ?? `${card.name}${card.last4 ? ` ending ${card.last4}` : ''} · ${card.figureLabel} ${card.figure}`;
        const shell = 'ph-focus absolute overflow-hidden rounded-[0.9rem] text-left transition-[top,left] duration-200';
        /*
         * The box is the band this card actually shows, not the whole card.
         *
         * A card whose box was its whole face would put its own top under the card in front of it, and a tap aimed
         * at what you can see would open the neighbour instead. So the box is the band left showing — below the
         * card in front, so the bottom of this card — and the art is drawn whole inside it, shifted up by `clip`
         * and clipped, which is exactly what the overlap did anyway.
         */
        const box = {
          top: placed.top + placed.clip,
          left: placed.left,
          zIndex: placed.zIndex,
          width: fan ? placed.visible : layout.cardWidth,
          height: fan ? CARD_H : placed.visible,
        } as const;
        const face = (
          <>
            <span
              className="pointer-events-none block origin-top-left"
              style={{ width: CARD_W, height: CARD_H, marginTop: -placed.clip, transform: scale === 1 ? undefined : `scale(${scale})` }}
            >
              <CardFace
                issuer={card.issuer}
                name={card.name}
                last4={card.last4}
                holderName={card.holderName}
                network={card.network}
                look={card.look}
                size="md"
                behind={covered}
              />
            </span>
            {/*
             * The strip: the band this card's neighbour leaves showing. It carries the figure, so a covered
             * card still answers for itself — which is the whole reason the stack survives its own weakness.
             * The second line is what a wall of cards would otherwise lose: the digits, the cycle, the worth.
             *
             * Overlapping downwards the strip is a band across the card's foot, under the card in front; fanned
             * sideways it is a column down the leading edge — the shape of what is left showing in each geometry.
             */}
            {covered && (
              <span
                className={cx(
                  'pointer-events-none absolute inset-0 flex flex-col gap-[1px] px-[10px] py-[9px]',
                  fan ? 'justify-end' : 'justify-center',
                )}
                style={{
                  background: fan
                    ? 'linear-gradient(rgb(0 0 0 / 0), rgb(0 0 0 / 0.62))'
                    : 'linear-gradient(rgb(0 0 0 / 0.3), rgb(0 0 0 / 0.55))',
                }}
              >
                <span className={cx('flex gap-2', fan ? 'flex-col items-start' : 'items-baseline justify-between')}>
                  <span className="min-w-0 max-w-full truncate text-[12.5px] leading-[16px] font-semibold text-[var(--ph-print-light)]">{card.name}</span>
                  <span className="tabular shrink-0 text-[13px] leading-[16px] font-bold whitespace-nowrap text-[var(--ph-print-light)]">{card.figure}</span>
                </span>
                {card.subtitle && !fan && <span className="min-w-0 truncate text-[11px] leading-[14px] text-[var(--ph-print-light)] opacity-80">{card.subtitle}</span>}
              </span>
            )}
          </>
        );
        // An open is a journey, so it is a real link wherever the route is known; a lift is only a look.
        return opens && card.to ? (
          <Link key={card.key} to={card.to} params={card.params} aria-label={label} className={shell} style={box}>
            {face}
          </Link>
        ) : (
          <button
            key={card.key}
            type="button"
            onClick={() => (opens ? onOpen?.(card.key) : setLifted(index === 0 ? null : index))}
            aria-label={label}
            className={shell}
            style={box}
          >
            {face}
          </button>
        );
      })}
      </div>
      {/*
       * The front card has no neighbour above it, so it has no strip to carry its figure — and it is the one
       * card whose figure must not need a tap either. Its facts sit under the stack as a grouped row, the kit's
       * own shape, so a stack of three reads as three figures however the cards are sitting.
       *
       * A lifted card is the one being looked at, so the row describes it instead: lifting a card and reading
       * the front card's figures under it would put one card's name beside another card's art.
       */}
      {described && (
        <InsetGroup className="mx-auto mt-[10px]">
          <InsetRow
            testId="wallet-facts"
            title={described.name}
            subtitle={[described.figureLabel, described.subtitle].filter(Boolean).join(' · ')}
            value={described.figure}
            valueTone="ink"
          />
        </InsetGroup>
      )}
    </div>
  );
}
