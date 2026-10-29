import { useEffect, useMemo } from 'react';
import { Sheet } from '../../app/Sheet';
import { InsetGroup, InsetRow } from '../../ui/native';

/**
 * Several pictures chosen from the Amount row's camera: what they are is asked before anything is attached. One
 * picture is a receipt and never comes here. "Read as a list of transactions" leaves for the statement flow;
 * "Attach to this purchase" keeps them as the purchase's photos, as a single one is.
 */
export function PicturesSheet({
  files,
  busy,
  error,
  onList,
  onAttach,
  onClose,
}: {
  files: readonly File[];
  busy: boolean;
  error: string | null;
  onList: () => void;
  onAttach: () => void;
  onClose: () => void;
}) {
  const urls = useMemo(() => files.map((file) => (file.type.startsWith('image/') ? URL.createObjectURL(file) : null)), [files]);
  useEffect(() => () => urls.forEach((url) => url && URL.revokeObjectURL(url)), [urls]);
  return (
    <Sheet grouped title={`${files.length} pictures`} onClose={onClose}>
      <div className="space-y-3 pb-2">
        <div className="flex justify-around gap-2" data-testid="pictures-thumbs">
          {urls.slice(0, 4).map((url, i) => (
            <span key={i} className="h-16 w-16 shrink-0 overflow-hidden rounded-[12px] bg-[var(--ph-fill)]">
              {url && <img src={url} alt="" className="h-full w-full object-cover" />}
            </span>
          ))}
        </div>
        <InsetGroup>
          <InsetRow title={busy ? 'Reading…' : 'Read as a list of transactions'} chevron={!busy} disabled={busy} onClick={onList} testId="pictures-list" />
          <InsetRow title="Attach to this purchase" chevron={false} disabled={busy} onClick={onAttach} testId="pictures-attach" />
        </InsetGroup>
        {error && (
          <p role="alert" className="px-[13px] text-[13px] leading-4 text-[var(--ph-alarm-ink)]">
            {error}
          </p>
        )}
      </div>
    </Sheet>
  );
}
