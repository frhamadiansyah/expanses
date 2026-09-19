import type { OpenStage } from '../../db/open';

/** What the opening screen shows: one line to read, one line of detail, and a fraction only when there is a real one. */
export interface OpeningCopy {
  title: string;
  body: string;
  /** How much of the update is finished, 0–100, or null when there is nothing honest to put in a bar. */
  percent: number | null;
}

/**
 * What is on screen while the database opens.
 *
 * Kept apart from the component so the words and the arithmetic can be read and tested as themselves —
 * the screen below is only the markup. Two rules hold for every line of it. Nothing claims progress the
 * code cannot account for: `percent` exists only while migrations are running, where it is steps finished
 * out of steps to run, and is null everywhere else rather than a bar animating against nothing. And
 * nothing promises a safety copy that was not taken: `copied` carries whether there really is one to go
 * back to, and the reassurance is only said when it is true.
 */
export function openingCopy(stage: OpenStage): OpeningCopy {
  switch (stage.stage) {
    case 'opening':
      return { title: 'Opening your data…', body: 'Starting the database on this device. Nothing leaves it.', percent: null };
    case 'snapshotting':
      return { title: 'Taking a copy first…', body: 'Keeping the last good copy of your data before anything changes.', percent: null };
    case 'migrating': {
      /*
       * `migrate` reports the count *finished*, and reports it before it picks the next one up — so the
       * step being worked on is one past it, except on the closing call where everything is done and the
       * count is already the total. Showing `done` itself would name the step before the one running.
       */
      const total = Math.max(stage.total, 0);
      const step = total > 0 ? Math.min(stage.done + 1, total) : 0;
      const where = total > 0 ? `Step ${step} of ${total} · ${stage.name} · ` : `${stage.name} · `;
      const kept = stage.copied ? ' Your data was copied before we started.' : '';
      return {
        title: 'Updating your data…',
        body: `${where}Do not close the app.${kept}`,
        percent: total > 0 ? Math.round((Math.min(stage.done, total) / total) * 100) : null,
      };
    }
    case 'checking':
      return { title: 'Checking your data…', body: 'Making sure everything adds up before you see it.', percent: null };
  }
}

/** How long a stage has to last before it is worth repainting the screen for. */
export const PACE_MS = 300;

export interface PacedStages {
  onStage: (stage: OpenStage) => void;
  /** Drops anything still waiting to paint. Called the moment the app itself is on screen. */
  stop: () => void;
}

export interface PacingOptions {
  /** How long a stage has to last before it earns a paint. */
  delay?: number;
  /** What is already on screen when the pacer takes over, so it is never painted a second time. */
  showing?: OpenStage | null;
}

/** Whether two stages would draw the identical screen. */
function sameScreen(a: OpenStage, b: OpenStage | null): boolean {
  if (!b || a.stage !== b.stage) return false;
  if (a.stage !== 'migrating' || b.stage !== 'migrating') return true;
  return a.done === b.done && a.total === b.total && a.name === b.name && a.copied === b.copied;
}

/**
 * Which stages earn a paint of their own.
 *
 * An ordinary launch has nothing to migrate and is over in a blink: painting "Taking a copy first…" and
 * "Checking your data…" on the way past would be three headings flashing by, which reads as a stutter
 * rather than as information. So every stage but one is held for {@link PACE_MS} and painted only if it
 * is still the current one when the timer fires — a fast open therefore never repaints at all, and a
 * snapshot or a check that really is slow still says so.
 *
 * `migrating` is the exception, painted the instant it arrives. It is the only stage that can run for
 * many seconds, it never happens on an ordinary launch — only on the first open after an app update —
 * and it is the one stage where the user is being asked not to close the app. Holding it back for a
 * third of a second would buy nothing and risk saying nothing at all during the work that matters.
 *
 * A stage that would draw the screen already on display is dropped rather than scheduled: the caller
 * paints "Opening your data…" itself before the engine is asked for anything, and the opener then reports
 * that same stage as its first. Repainting identical words is not a flash, but it is work, and it is one
 * more thing that could ever become one.
 */
export function paceStages(render: (stage: OpenStage) => void, options: PacingOptions = {}): PacedStages {
  const delay = options.delay ?? PACE_MS;
  let showing: OpenStage | null = options.showing ?? null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  const clear = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  };
  const paint = (stage: OpenStage) => {
    showing = stage;
    render(stage);
  };
  return {
    onStage: (stage) => {
      if (stopped) return;
      clear();
      if (sameScreen(stage, showing)) return;
      if (stage.stage === 'migrating') {
        paint(stage);
        return;
      }
      timer = setTimeout(() => {
        timer = undefined;
        if (!stopped) paint(stage);
      }, delay);
    },
    stop: () => {
      stopped = true;
      clear();
    },
  };
}
