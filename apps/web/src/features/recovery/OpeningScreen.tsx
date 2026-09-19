import type { OpenStage } from '../../db/open';

function said(stage: OpenStage): { title: string; body: string } {
  switch (stage.stage) {
    case 'opening':
      return { title: 'Opening your data…', body: 'Starting the database on this device. Nothing leaves it.' };
    case 'snapshotting':
      return { title: 'Taking a copy first…', body: 'Keeping the last good copy of your data before anything changes.' };
    case 'migrating':
      return { title: 'Updating your data…', body: `Step ${stage.done} of ${stage.total}: ${stage.name}` };
    case 'checking':
      return { title: 'Checking your data…', body: 'Making sure everything adds up before you see it.' };
  }
}

/**
 * What is on screen while the database opens. It is usually gone in a blink; it earns its keep on the one
 * open that runs a long update, where a blank page would look like a hung app.
 */
export function OpeningScreen({ stage }: { stage: OpenStage }) {
  const { title, body } = said(stage);
  const progress = stage.stage === 'migrating' && stage.total > 0 ? stage.done / stage.total : null;
  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center p-4 text-center">
      <h1 className="text-lg font-semibold text-slate-900">{title}</h1>
      <p className="mt-2 text-sm text-slate-600">{body}</p>
      {progress !== null && (
        <div
          className="mt-4 h-1.5 w-full overflow-hidden rounded-full bg-slate-200"
          role="progressbar"
          aria-valuenow={Math.round(progress * 100)}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Update progress"
        >
          <div className="h-full rounded-full bg-slate-900 transition-[width] duration-200" style={{ width: `${Math.round(progress * 100)}%` }} />
        </div>
      )}
    </div>
  );
}
