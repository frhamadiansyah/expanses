/**
 * The event's name in a rounded box at the top of the first panel under the tabs, drawn as Cashflow's month box is but display
 * only: no arrows, nothing to tap. It is an h2 (the page's h1 is the dates in the bar), so a screen reader still finds the name as a heading;
 * a long one shortens with an ellipsis.
 */
export function EventNameBox({ name }: { name: string }) {
  return (
    <div className="mb-[10px] flex justify-center" data-testid="shared-event-name">
      <h2 className="max-w-full truncate rounded-full bg-[var(--ph-fill)] px-3 py-[6px] text-[14px] leading-[20px] font-semibold text-[var(--ph-ink)]">{name}</h2>
    </div>
  );
}

