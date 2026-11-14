import { type ReactNode, useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import { PageDots } from '../../ui/native';

export interface HeroSlide {
  key: string;
  label: string;
  node: ReactNode;
}

/**
 * A row of full-width cards that snap under a swipe, with a dot per card below. The active card is the parent's state
 * (`active`), read from the scroll position as it settles, so the list under the hero can follow it. The dots are
 * buttons named for their card, so a card can be reached without swiping. Every card is as tall as the tallest, and
 * none peeks at the edge: each fills the width. A single card is drawn alone, with no dots.
 */
export function HeroSwipe({ label, slides, active, onActive }: { label: string; slides: readonly HeroSlide[]; active: number; onActive: (index: number) => void }) {
  const scroller = useRef<HTMLDivElement>(null);
  // The card a tap on a dot is scrolling to: scroll events on the way there must not report the cards passed.
  const heading = useRef<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const indexAt = useCallback(() => {
    const el = scroller.current;
    if (!el || el.clientWidth === 0) return 0;
    return Math.min(slides.length - 1, Math.max(0, Math.round(el.scrollLeft / el.clientWidth)));
  }, [slides.length]);

  const onScroll = () => {
    const index = indexAt();
    if (heading.current !== null) {
      if (index !== heading.current) return;
      heading.current = null;
    }
    if (index !== active) onActive(index);
  };

  const go = (index: number) => {
    const el = scroller.current;
    onActive(index);
    if (!el) return;
    const reduce = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    heading.current = reduce ? null : index;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => (heading.current = null), 700);
    el.scrollTo({ left: index * el.clientWidth, behavior: reduce ? 'auto' : 'smooth' });
  };

  useEffect(() => () => clearTimeout(timer.current), []);

  // A page that opens on a later card (back from a cost's page lands on Plan) starts scrolled to it, not to the first.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && active > 0) el.scrollLeft = active * el.clientWidth;
    // Once, on arrival: later changes of `active` come from the scroll itself or from a dot.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="w-full md:max-w-2xl">
      <div
        ref={scroller}
        role="region"
        aria-roledescription="carousel"
        aria-label={label}
        tabIndex={0}
        onScroll={onScroll}
        data-testid="hero-swipe"
        className="ph-focus flex w-full snap-x snap-mandatory items-stretch overflow-x-auto overscroll-x-contain rounded-[11px] [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {slides.map((slide, index) => (
          <div
            key={slide.key}
            role="group"
            aria-roledescription="slide"
            aria-label={`${slide.label}, ${index + 1} of ${slides.length}`}
            aria-hidden={index === active ? undefined : true}
            data-testid={`hero-slide-${slide.key}`}
            className="@container flex w-full shrink-0 snap-start snap-always flex-col"
          >
            {slide.node}
          </div>
        ))}
      </div>
      {/* One card has nothing to swipe to: no dots, only the air they took. */}
      {slides.length > 1 ? (
        <PageDots names={slides.map((slide) => slide.label)} index={active} onSelect={go} label="Page" testId="hero-dots" className="mt-2 mb-2" />
      ) : (
        <div className="mb-3" />
      )}
    </div>
  );
}
