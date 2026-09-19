import type { OpenStage } from '../../db/open';
import { openingCopy } from './opening-copy';

/**
 * What is on screen while the database opens. It is usually gone in a blink — `paceStages` in
 * `opening-copy.ts` decides which stages are even worth a paint — and it earns its keep on the one open
 * that runs a long update, where a blank page would look like a hung app.
 *
 * The words and the fraction are `openingCopy`'s; this is only the markup. `role="status"` because the
 * heading changes under a reader that has already moved on, and the bar is drawn only when there is a
 * real fraction behind it.
 */
export function OpeningScreen({ stage }: { stage: OpenStage }) {
  const { title, body, percent } = openingCopy(stage);
  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center p-4 text-center" role="status" aria-live="polite">
      <h1 className="text-lg font-semibold text-slate-900">{title}</h1>
      <p className="mt-2 text-sm text-slate-600">{body}</p>
      {percent !== null && (
        <div
          className="mt-4 h-1.5 w-full overflow-hidden rounded-full bg-slate-200"
          role="progressbar"
          aria-valuenow={percent}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Update progress"
        >
          <div className="h-full rounded-full bg-slate-900 transition-[width] duration-200" style={{ width: `${percent}%` }} />
        </div>
      )}
    </div>
  );
}
