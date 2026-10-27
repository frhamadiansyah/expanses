import { useParams } from '@tanstack/react-router';
import { useScanReceipt } from '../../capture/use-scan';
import { Button, ErrorBox } from '../../ui';
import { type GroupChild, InsetGroup, InsetRow, LargeTitle, ROW_PAD_X, SCREEN } from '../../ui/native';
import { CAPTURE_GUIDES, isShortcutLink, SCREEN_SCANNER_SHORTCUT_URL } from './guides';

/** One step: its number in a round chip, then the words, which wrap rather than truncate. */
function StepRow({ n, text, position }: GroupChild & { n: number; text: string }) {
  return (
    <div className="relative flex items-start gap-[10px] py-[11px]" style={{ paddingInline: ROW_PAD_X }}>
      {position?.separator && (
        <span aria-hidden className="pointer-events-none absolute top-0 bg-[var(--ph-hair)]" style={{ height: 0.5, left: ROW_PAD_X, right: ROW_PAD_X }} />
      )}
      <span aria-hidden className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full bg-[var(--ph-fill)] text-[12px] leading-none font-semibold text-[var(--ph-ink-2)]">
        {n}
      </span>
      <span className="min-w-0 flex-1 text-[15px] leading-[20px] text-[var(--ph-ink)]">{text}</span>
    </div>
  );
}

/**
 * One way to capture, opened from Settings → Capture: what it does in a line, the guide's steps (`guides.ts`, unchanged)
 * and the button that starts it at the foot. Notifications carries the iOS requirement in a note above the steps.
 */
export function WayPage() {
  const { way } = useParams({ from: '/settings/capture/ways/$way' });
  const scan = useScanReceipt();
  const guide = CAPTURE_GUIDES.find((each) => each.key === way) ?? null;
  if (!guide) {
    return (
      <div className={SCREEN}>
        <LargeTitle title="Ways to capture" back="Capture" backTo="/settings/capture" />
        <InsetGroup>
          <InsetRow title="That way is not here." chevron={false} />
        </InsetGroup>
      </div>
    );
  }

  return (
    <div className={SCREEN}>
      <LargeTitle title={guide.title} subtitle={guide.blurb} back="Capture" backTo="/settings/capture" />
      {guide.note && <div className="mb-[14px] rounded-[11px] bg-[var(--ph-surface)] px-[14px] py-[10px] text-[13px] leading-[17px] text-[var(--ph-ink-2)]">{guide.note}</div>}
      <InsetGroup header="Steps">
        {guide.steps.map((step, index) => (
          <StepRow key={step} n={index + 1} text={step} />
        ))}
      </InsetGroup>

      {way === 'receipt' && (
        <>
          <ErrorBox error={scan.error} />
          <Button className="w-full" disabled={scan.busy} onClick={() => void scan.scan()}>
            {scan.busy ? 'Reading the receipt…' : 'Scan a receipt now'}
          </Button>
        </>
      )}

      <div className="space-y-2">
        {way === 'screen-scanner' && SCREEN_SCANNER_SHORTCUT_URL && isShortcutLink(SCREEN_SCANNER_SHORTCUT_URL) && (
          <Button className="w-full" onClick={() => window.open(SCREEN_SCANNER_SHORTCUT_URL!, '_system')}>
            Add Screen scanner
          </Button>
        )}
        {(way === 'notifications' || way === 'screen-scanner') && (
          <Button
            variant={way === 'notifications' ? 'primary' : 'secondary'}
            className="w-full"
            onClick={() => {
              // The shell may open it directly; a browser tab cannot, and a dead button would be a lie, so the
              // window is asked and failure is silent.
              window.open('shortcuts://', '_system');
            }}
          >
            Open Shortcuts
          </Button>
        )}
      </div>
    </div>
  );
}
