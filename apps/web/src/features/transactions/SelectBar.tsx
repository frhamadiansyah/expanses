import { Button, ErrorBox } from '../../ui';

/**
 * The list's select mode, at the foot of the screen: how many rows are ticked, what can be done to all of them at
 * once, and the way out.
 *
 * It floats where the Undo toast floats — above the phone's tab bar, at the foot of a wide screen — so the toast that
 * follows an action lands in the very spot the bar has just left. Its own error line, because the page's sits above
 * the chart and a refusal said up there, while a thumb is down here, is a refusal nobody sees.
 */
export function SelectBar({
  count,
  canRemove,
  busy,
  error,
  onAdd,
  onRemove,
  onCancel,
}: {
  count: number;
  /** Whether any ticked row is in an event at all; nothing else could be taken out of one. */
  canRemove: boolean;
  busy: boolean;
  error: unknown;
  onAdd: () => void;
  onRemove: () => void;
  onCancel: () => void;
}) {
  return (
    <div
      role="toolbar"
      aria-label="Selected transactions"
      data-testid="select-bar"
      className="fixed inset-x-4 bottom-[calc(5.5rem+env(safe-area-inset-bottom))] z-40 mx-auto flex max-w-md flex-col gap-2 rounded-2xl bg-[var(--ph-surface)] p-3 shadow-xl ring-1 ring-slate-200 md:bottom-6"
    >
      <div className="flex items-center justify-between gap-3">
        <span aria-live="polite" className="text-sm font-semibold text-[var(--ph-ink)]">
          {count === 0 ? 'None selected' : `${count} selected`}
        </span>
        <Button variant="ghost" className="min-h-11" onClick={onCancel}>
          Cancel
        </Button>
      </div>
      <div className="flex gap-2">
        <Button className="min-h-11 flex-1" disabled={count === 0 || busy} onClick={onAdd}>
          Add to event…
        </Button>
        <Button variant="secondary" className="min-h-11 flex-1" disabled={!canRemove || busy} onClick={onRemove}>
          Remove from event
        </Button>
      </div>
      <ErrorBox error={error} />
    </div>
  );
}
