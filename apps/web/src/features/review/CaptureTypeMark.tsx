import { CAPTURE_TYPES, type CaptureType } from './capture-type';

/**
 * A capture's kind, small, in a line of text: the glyph a row's subtitle starts with, sized to the words beside it.
 * Only paint — the line already says what the capture is — so it is hidden from a screen reader.
 */
export function CaptureTypeMark({ type }: { type: CaptureType }) {
  const { Icon } = CAPTURE_TYPES[type];
  return (
    <>
      <Icon size={12} aria-hidden data-capture-type={type} className="mb-[1px] inline-block align-middle" />{' '}
    </>
  );
}
