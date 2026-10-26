import type { CatalogCardLook } from '@expanses/catalog';
import { Link, type LinkProps } from '@tanstack/react-router';
import { RotateCw } from 'lucide-react';
import { type CSSProperties, Fragment, type ReactNode, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useEscape } from '../../app/use-escape';
import { usePhone } from '../../app/use-phone';
import { CardFace } from '../../features/cards/CardFace';
import type { FaceRef } from '../../features/cards/debit-art/faces';
import { cx } from '../index';
import { arriveFrom, flightKeyframes, flyInto, leaveFrom, MOVE_MS, PILE_LAG_MS, PILE_STAGGER_MS, type Pose, poseFrom, poseTransform, reducedMotion, springProgress } from './card-motion';
import { CARD_H, CARD_W, DESKTOP_CARD_W, faceIsBehind, PILE_FLOOR_DESKTOP, PILE_FLOOR_PHONE, PILE_PEEK, pileHeight, type StackedCard, stackLayout } from './card-stack';
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
 * Tapping any card opens it — that same element rises to the top at the same width on Wallet's spring, the others
 * follow a beat behind, sliding down into a tight pile and off the bottom of the screen, and once the card has
 * landed its page comes up below it. The ✕, the raised card or Escape put it back in its slot, and the others rise
 * back into theirs. A card opened from the grid or the carousel flies from where it was tapped (`card-motion`).
 */

export interface WalletCard {
  key: string;
  issuer: string | null;
  name: string;
  last4: string | null;
  holderName?: string | null;
  network?: string | null;
  look?: CatalogCardLook | null;
  /**
   * What a money card is — "Debit ···· 1102", "Cash", "E-wallet" — for a face the app draws from the account's name
   * rather than a card product. Absent for a credit card, which keeps its catalogue art.
   */
  kind?: string;
  /** The drawn face of the account's bank or app, when it has one (debit-art): then the card is drawn, not `kind`. */
  face?: FaceRef | null;
  /** The figure on this card's band — points, miles, or what is owed. Already a whole number of its unit. */
  figure: string;
  figureLabel: string;
  /**
   * The ink a caption writes the figure in, where a layout captions the card rather than printing the band: `alarm`
   * for what a credit card owes, as every owed figure is drawn; the page's ink otherwise, and when unset.
   */
  figureTone?: 'ink' | 'alarm';
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

/** The pose a card rests in: none in its slot or raised; in the pile, narrower and centred under its top edge. */
function restPose(placed: StackedCard, width: number): Pose {
  return placed.pile ? { x: (width * (1 - placed.pile.scale)) / 2, y: 0, scale: placed.pile.scale } : { x: 0, y: 0, scale: 1 };
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
   * The raised card's back: a page that has one (an account's balance) says it is flippable, and a tap on the card then
   * turns it over — on a rotation, or on a cross-fade for a reader who asked for less motion — rather than putting it
   * down (✕ and Escape still do). The back is an element of the card the page draws into, so it is the card's own size.
   */
  const [flippable, setFlippable] = useState(false);
  const [flipped, setFlipped] = useState(false);
  const [backHost, setBackHost] = useState<HTMLElement | null>(null);
  const backRef = useCallback((node: HTMLElement | null) => setBackHost(node), []);
  // Whether a page has a back is that page's to say (it says no as it goes); a card put down is put down face up.
  useEffect(() => setFlipped(false), [raisedKey]);
  const still = reducedMotion();

  /*
   * A card that changes between its band and its whole face on the way — the covered card raised, the raised card
   * put back under the next one, the front card dropping into the pile — is drawn whole for the flight, with its band
   * laid over it on a ghost that travels with it and fades out (or in). So nothing is redrawn mid-flight; the band
   * dissolves. The ghost is a sibling of the card rather than inside it, so a card is still one face to whoever
   * reads it. `flight` is the place the cards are leaving, kept until they land.
   */
  const [seen, setSeen] = useState(raisedKey);
  const [flight, setFlight] = useState<{ from: string | null } | null>(null);
  if (seen !== raisedKey) {
    setSeen(raisedKey);
    setFlight(reducedMotion() ? null : { from: seen });
  }
  const leaving = flight ? stackLayout(keys, { raised: flight.from === null ? null : keys.indexOf(flight.from), cardWidth: layout.cardWidth }) : null;

  /*
   * FLIP: where every card was is read the moment the stack is asked to change state — during that render, while
   * the page still shows the old one, and wherever a flight still under way has got the card to — and once the new
   * places are committed each card is sent from there to its new place on Wallet's spring. So a card travels,
   * continuously, from its slot to the top and back, whatever positioning each end uses. The flight is keyframes on
   * `transform` (and a held `opacity`) alone, so the compositor plays it and nothing is laid out while it runs.
   */
  const section = useRef<HTMLElement>(null);
  const elements = useRef(new Map<string, HTMLDivElement>());
  const ghosts = useRef(new Map<string, HTMLDivElement>());
  const committed = useRef<string | null | undefined>(undefined);
  const before = useRef<Map<string, { rect: DOMRect; hidden: boolean }> | null>(null);
  const scrollAtRest = useRef(0);
  const flights = useRef(0);
  if (committed.current !== undefined && committed.current !== raisedKey && before.current === null) {
    before.current = new Map([...elements.current].map(([key, node]) => [key, { rect: node.getBoundingClientRect(), hidden: node.dataset.place === 'hidden' }]));
  }
  useLayoutEffect(() => {
    const was = committed.current;
    committed.current = raisedKey;
    const rects = before.current;
    before.current = null;
    if (was === raisedKey) return;
    const id = ++flights.current;
    const motion = !reducedMotion();
    const animations: Animation[] = [];
    const moving: HTMLElement[] = [];
    if (was === undefined) {
      // Drawn with a card already open: one opened from the grid or the carousel flies up from where it was tapped —
      // once the stack has measured its column, since until then the card is not yet the width it lands at.
      arrival.current = raisedKey && motion ? arriveFrom([raisedKey]) : null;
    } else {
      // A raised card goes to the top of the screen, as in Wallet; closing it returns the reader to where they were.
      // Both are read into the flight: every rectangle is the screen's, so the scroll is part of the one movement.
      if (was === null) {
        scrollAtRest.current = window.scrollY;
        window.scrollTo(0, 0);
      } else if (raisedKey === null) {
        window.scrollTo(0, scrollAtRest.current);
        elements.current.get(was)?.querySelector<HTMLElement>('a,button')?.focus({ preventScroll: true });
      }
      if (motion && rects) {
        const progress = springProgress();
        // A flight still under way is let go of where it is: `rects` already holds where it had got to.
        for (const node of [...elements.current.values(), ...ghosts.current.values()]) for (const running of node.getAnimations({ subtree: true })) running.cancel();
        const order = layout.cards.map((placed) => placed.key).filter((key) => key !== raisedKey && key !== was);
        // Every landing place is read before anything is written, so the page is laid out once, not once a card.
        const landing = layout.cards.map((placed) => elements.current.get(placed.key)?.getBoundingClientRect());
        layout.cards.forEach((placed, index) => {
          const node = elements.current.get(placed.key);
          const from = rects.get(placed.key);
          const to = landing[index];
          if (!node || !from || !to) return;
          const rest = restPose(placed, layout.cardWidth);
          const start = poseFrom(from.rect, to, rest, layout.cardWidth);
          if (Math.abs(start.x - rest.x) < 0.5 && Math.abs(start.y - rest.y) < 0.5 && Math.abs(start.scale - rest.scale) < 0.002) return;
          /*
           * The card that was tapped, or put back, leads; the rest follow a beat behind it, the nearest first, as
           * Wallet's pile does.
           */
          const lead = placed.key === raisedKey || placed.key === was;
          const rank = lead ? 0 : Math.min(order.length - 1 - order.indexOf(placed.key), 5);
          const timing: KeyframeAnimationOptions = { duration: MOVE_MS, delay: lead ? 0 : PILE_LAG_MS + rank * PILE_STAGGER_MS, easing: 'linear', fill: 'backwards' };
          const frames = flightKeyframes(start, rest, progress, from.hidden || placed.place === 'hidden' ? 1 : undefined);
          node.style.willChange = 'transform';
          animations.push(node.animate(frames, timing));
          moving.push(node);
          const ghost = ghosts.current.get(placed.key);
          if (ghost) {
            ghost.style.willChange = 'transform';
            animations.push(ghost.animate(frames, timing));
            moving.push(ghost);
            // The band fades out as the card leaves the pile, and in as it lands under the next one.
            const band = ghost.firstElementChild as HTMLElement | null;
            const showing = Boolean(leaving && faceIsBehind(leaving.cards[index]!));
            if (band) animations.push(band.animate([{ opacity: showing ? 1 : 0 }, { opacity: showing ? 0 : 1 }], showing ? { duration: 200, delay: 30, easing: 'ease-out', fill: 'both' } : { duration: 220, delay: MOVE_MS * 0.3, easing: 'ease-in-out', fill: 'both' }));
          }
        });
      }
    }
    takeOff(id, animations, moving);
  }, [raisedKey]);

  const arrival = useRef<ReturnType<typeof arriveFrom>>(null);
  useLayoutEffect(() => {
    const from = arrival.current;
    const node = from ? elements.current.get(from.key) : undefined;
    if (!from || !node || column === null) return;
    arrival.current = null;
    const flown = flyInto(node, from.rect, { width: layout.cardWidth });
    if (flown) takeOff(++flights.current, [flown], [node]);
  }, [column]);

  /** Marks the stack as moving until every animation of flight `id` has finished, then lets the flight go. */
  function takeOff(id: number, animations: Animation[], moving: HTMLElement[]) {
    const land = () => {
      if (id !== flights.current) return;
      section.current?.removeAttribute('data-moving');
      for (const node of moving) node.style.willChange = '';
      setFlight(null);
    };
    if (animations.length === 0) {
      land();
      return;
    }
    // While anything moves the stack says so, so a test — or anything else — can wait for the cards to land.
    section.current?.setAttribute('data-moving', '');
    for (const node of moving) node.style.willChange = 'transform';
    Promise.all(animations.map((animation) => animation.finished)).then(land, () => {});
  }

  // A raised card that goes with the stack — put down from the grid or the carousel — says where it was, so the
  // layout drawn next can fly it home.
  useLayoutEffect(() => {
    const cards = elements.current;
    return () => {
      const key = committed.current;
      const node = key ? cards.get(key) : undefined;
      if (key && node?.isConnected) leaveFrom(key, node.getBoundingClientRect());
    };
  }, []);

  /*
   * The pile stands on the tab bar (on a desktop, a margin) above the home indicator: its top line is the pile's
   * height above that, so the front card shows `PILE_PEEK` of itself and the cards behind it their stepped edges.
   */
  const others = isRaised ? keys.length - 1 : 0;
  const pile = pileHeight(others);
  const floor = phone ? PILE_FLOOR_PHONE : PILE_FLOOR_DESKTOP;
  const pileTop = `100vh - env(safe-area-inset-bottom, 0px) - ${floor + pile}px`;

  // Escape puts the raised card back, as the ✕ does.
  useEscape(() => onClose?.(), isRaised);

  // The facts describe the card in front: the last card, whole at the bottom of the pile.

  return (
    <div className={className}>
      <section ref={section} aria-label={label} className={cx(!isRaised && 'md:pb-5')}>
        <div ref={shelf} className={cx(!isRaised && 'md:w-[380px] md:max-w-full md:shrink-0')}>
          <div className="relative" style={{ width: layout.width, height: layout.height, maxWidth: '100%' }}>
            {layout.cards.map((placed, index) => {
              const card = cards[index]!;
              const covered = faceIsBehind(placed);
              // On its way between its band and its whole face: drawn whole, under a ghost of its band (above).
              const was = leaving?.cards[index];
              const turning = was !== undefined && faceIsBehind(was) !== covered;
              const drawn = placed.place === 'raised' && shown ? { ...card, last4: shown.last4, holderName: shown.holderName } : card;
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
               * band. While another card is open the rest wait in their pile at the foot of the screen, their edges
               * peeking, inert — out of the tab order and out of the accessibility tree — and come back up into their
               * slots. Under the pile's own z-order the tab bar stays on top of it.
               */
              const hidden = placed.place === 'hidden';
              const pose = poseTransform(restPose(placed, layout.cardWidth));
              const box: CSSProperties = hidden
                ? {
                    position: 'fixed',
                    left: column?.left ?? 16,
                    top: `calc(${pileTop} + ${placed.pile?.top ?? 0}px)`,
                    // Back to front as in the stack, and always under the tab bar (z 20), however many cards there are.
                    zIndex: Math.min(1 + index, 18),
                    opacity: PILE_PEEK > 0 ? undefined : 0,
                    transform: pose === 'none' ? undefined : pose,
                    /*
                     * Landed, each card in the pile is cut off at the pile's floor — its strip and no more — so nothing
                     * of it shows round or through the tab bar; in flight it is whole. The cut leaves room above for
                     * the seam it casts. Measured before the card's own scale, which draws it.
                     */
                    clipPath: flight || !placed.pile ? undefined : `inset(-12px -12px ${Math.max(0, layout.cardHeight - (pile - placed.pile.top) / placed.pile.scale)}px -12px)`,
                  }
                : { position: 'absolute', left: 0, top: placed.top, zIndex: placed.place === 'raised' ? 15 : placed.zIndex };
              const frame: CSSProperties = { ...box, width: layout.cardWidth, height: layout.cardHeight, borderRadius: radius, transformOrigin: '0 0', pointerEvents: 'none' };
              return (
                <Fragment key={card.key}>
                  <div
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
                      ...frame,
                      /*
                       * The seam a covering card casts up onto the card it covers — never on a card that has nothing
                       * above it. That is the rearmost card of the stack, at the top, and a card raised out of it: the
                       * two cases where the shadow has no card to land on and lands on the page instead, which is
                       * what made a pile lying on the ground look like a pile hovering over it. The pile below the
                       * screen is a pile too, so its cards keep their seams.
                       */
                      boxShadow: placed.place !== 'raised' && index > 0 && !(hidden && index === (raisedIndex === 0 ? 1 : 0)) ? 'var(--ph-card-edge)' : undefined,
                    }}
                  >
                    <CardTurn raised={placed.place === 'raised'} flipped={flipped} still={still} backRef={backRef}>
                      <Face card={drawn} band={turning ? false : covered} scale={scale} />
                    </CardTurn>
                    {placed.place === 'raised' ? (
                      flippable ? (
                        // A page with a back: the raised card turns over to it, and back to the card.
                        flipped ? (
                          // The balance side is read by touch (its line), so only a small button turns it over: the rest of the card is the page's.
                          <button
                            type="button"
                            aria-label={`${name}, show card`}
                            aria-pressed
                            className="ph-focus ph-under-dialog absolute top-2 right-2 flex h-8 w-8 items-center justify-center rounded-full bg-[var(--ph-fill)] text-[var(--ph-ink)]"
                            style={{ pointerEvents: 'auto' }}
                            onClick={() => setFlipped(false)}
                          >
                            <RotateCw size={15} aria-hidden />
                          </button>
                        ) : (
                          <>
                            <button type="button" aria-label={`${name}, show balance`} aria-pressed={false} className={cx(hit, 'ph-under-dialog')} style={style} onClick={() => setFlipped(true)} />
                            {/* The same small mark as the back's, so the card reads as one that turns. */}
                            <span aria-hidden className="pointer-events-none absolute top-2 right-2 flex h-8 w-8 items-center justify-center rounded-full bg-black/25 text-white">
                              <RotateCw size={15} />
                            </span>
                          </>
                        )
                      ) : (
                        // The raised card is the page's header; tapping it closes it, as in Wallet.
                        <button type="button" aria-label={name} className={hit} style={style} onClick={() => onClose?.()} />
                      )
                    ) : card.to ? (
                      <Link to={card.to} params={card.params} aria-label={named} className={hit} style={style} />
                    ) : (
                      <button type="button" aria-label={named} className={hit} style={style} onClick={() => onOpen?.(card.key)} />
                    )}
                  </div>
                  {turning && (
                    <div
                      ref={(node) => {
                        if (node) ghosts.current.set(card.key, node);
                        else ghosts.current.delete(card.key);
                      }}
                      aria-hidden
                      data-ghost=""
                      style={{ ...frame, overflow: 'hidden' }}
                    >
                      <span className="absolute inset-0 block" style={{ opacity: was && faceIsBehind(was) ? 1 : 0 }}>
                        <Face card={drawn} band scale={scale} />
                      </span>
                    </div>
                  )}
                </Fragment>
              );
            })}
            {isRaised && others > 0 && PILE_PEEK > 0 && (
              /*
               * The peeking pile is one control, as in Wallet: a tap on it puts the open card back with the rest.
               * Laid over the pile's edges, above the cards and under the tab bar.
               */
              <button
                type="button"
                aria-label="All cards"
                data-testid="wallet-pile"
                onClick={() => onClose?.()}
                className="ph-focus-inset block"
                style={{ position: 'fixed', left: column?.left ?? 16, top: `calc(${pileTop})`, width: layout.cardWidth, height: pile, zIndex: 19, borderRadius: `${radius}px ${radius}px 0 0` }}
              />
            )}
          </div>
        </div>
      </section>
      {isRaised && (
        <WalletSlotContext.Provider value={{ width: layout.cardWidth, height: layout.cardHeight, setShown, backHost, flipped, setFlippable }}>
          {/* The page comes up under the raised card once it has all but landed, as a pass's details do in Wallet. */}
          {/* It leaves room at its foot for the pile, so its last rows scroll clear of it. */}
          <div className="ph-card-page-in" style={pile > 0 && PILE_PEEK > 0 ? { paddingBottom: pile + 8 } : undefined}>
            {children}
          </div>
        </WalletSlotContext.Provider>
      )}
    </div>
  );
}

/** How long the card takes to turn over. */
const TURN_MS = 400;

/**
 * A card's two sides: the face the stack draws, and (on the raised card only) a back the open page draws into. Every
 * card is wrapped alike, so a card keeps its face's element as it is raised. The turn is a rotation about the card's
 * vertical axis; for a reader who asked for less motion it is a cross-fade. The side turned away is `visibility:
 * hidden` — switched when the card is edge-on, or at once for a fade — so it is out of the tab order and the
 * accessibility tree, and what shows is always what is read.
 */
function CardTurn({ raised, flipped, still, backRef, children }: { raised: boolean; flipped: boolean; still: boolean; backRef: (node: HTMLElement | null) => void; children: ReactNode }) {
  const motion = raised ? `${still ? 200 : TURN_MS}ms` : '0ms';
  const half = still ? 0 : TURN_MS / 2;
  const side = (shown: boolean): CSSProperties => ({
    position: 'absolute',
    inset: 0,
    backfaceVisibility: 'hidden',
    // Inherited, never forced visible: a stack hidden behind a sheet stays hidden, and out of its hit-testing.
    visibility: shown ? 'inherit' : 'hidden',
    // Shown at once; hidden once the turn has passed the edge.
    transition: raised ? `visibility 0s linear ${shown ? 0 : half}ms, opacity ${still ? motion : '0ms'} ease` : undefined,
    opacity: still && !shown ? 0 : 1,
  });
  return (
    <div style={{ position: 'absolute', inset: 0, perspective: raised && !still ? 1200 : undefined }}>
      <div
        data-testid="card-turn"
        data-flipped={flipped ? '' : undefined}
        style={{
          position: 'absolute',
          inset: 0,
          transformStyle: raised && !still ? 'preserve-3d' : undefined,
          transition: raised && !still ? `transform ${motion} cubic-bezier(0.4, 0, 0.2, 1)` : undefined,
          transform: raised && !still && flipped ? 'rotateY(180deg)' : undefined,
        }}
      >
        <div style={side(!flipped)}>{children}</div>
        {raised && <div ref={backRef} data-testid="card-back" style={{ ...side(flipped), transform: still ? undefined : 'rotateY(180deg)' }} />}
      </div>
    </div>
  );
}

/**
 * One card's art, drawn at 240 and scaled to the stack's card width, whole or as its top band. Wallet's grid and
 * carousel draw the same art through this, so a card is one drawing however the cards are laid out.
 */
export function Face({ card, band, scale, figure = false }: { card: WalletCard; band: boolean; scale: number; figure?: boolean }) {
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
        kind={card.kind}
        face={card.face}
        size="md"
        // A covered card's band prints its bank and name only: the figure is on the card's page, and in the link's name for a reader.
        band={band ? '' : undefined}
        figure={figure ? card.figure : undefined}
      />
    </span>
  );
}
