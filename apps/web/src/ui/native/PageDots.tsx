/**
 * The page control every swipe or carousel shows under it: 7px dots about 14px apart, the page in view in ink and
 * the rest in one grey. Each dot sits in a 44px-tall tap target that spills above and below the 14px strip, so the
 * strip takes no more room than the dots. No margin of its own: callers put `mt-2` above and `mb-2` below.
 */
export function PageDots({
  names,
  index,
  onSelect,
  label,
  testId,
  dotButtonTestId,
  className = '',
  ariaLabelOf,
  titleOf,
  semantics = 'current',
}: {
  names: readonly string[];
  index: number;
  onSelect?: (index: number) => void;
  label: string;
  testId?: string;
  /** A test id for each dot's button. */
  dotButtonTestId?: string;
  className?: string;
  ariaLabelOf?: (index: number) => string;
  titleOf?: (index: number) => string | undefined;
  /** `current` marks the page in view with aria-current; `pressed` marks it with aria-pressed. */
  semantics?: 'current' | 'pressed';
}) {
  return (
    <div role="group" aria-label={label} data-testid={testId} className={`flex h-[14px] items-center justify-center ${className}`}>
      {names.map((name, i) => {
        const active = i === index;
        return (
          <button
            // biome-ignore lint/suspicious/noArrayIndexKey: names may repeat; position is the identity
            key={`${i}-${name}`}
            type="button"
            aria-label={ariaLabelOf ? ariaLabelOf(i) : name}
            aria-current={semantics === 'current' && active ? 'true' : undefined}
            aria-pressed={semantics === 'pressed' ? active : undefined}
            title={titleOf?.(i)}
            data-testid={dotButtonTestId}
            onClick={onSelect ? () => onSelect(i) : undefined}
            className="ph-focus flex h-11 w-[14px] shrink-0 items-center justify-center"
          >
            <span
              aria-hidden
              data-testid="page-dot"
              className="block h-[7px] w-[7px] rounded-full transition-colors"
              style={{ background: active ? 'var(--ph-ink)' : 'var(--ph-chevron)' }}
            />
          </button>
        );
      })}
    </div>
  );
}
