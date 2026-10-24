import type { DraftRow } from '@expanses/db';

/**
 * Whether a draft's picture is kept with the transaction it is recorded as — the receipt photo on its receipt page.
 *
 * Only a picture the app's own camera took is kept, always: there is no other copy of it on the phone but the one
 * saved to Photos as it was taken, and a receipt photographed in the app is a receipt meant to be kept. A picture that
 * was already in Photos — chosen from the library, shared from another app, or a screenshot the screen scanner read —
 * is let go once the draft is recorded or discarded, since Photos still has it.
 *
 * The draft cannot tell these apart by its source: a chosen or shared picture arrives as a `photo` draft, the same as
 * the camera's. The picture's own name does: the camera (`CapturePlugin.swift`, the image picker's delegate) is the one
 * writer that names its file `captures/camera-<id>.jpg`, and every other door names it `captures/<id>.jpg`. The name
 * travels with the picture wherever it goes — a camera photo folded into a notification's draft is still kept — and
 * needs no column of its own.
 */
export function keepsPicture(draft: Pick<DraftRow, 'imageFile'>): boolean {
  return draft.imageFile !== null && isCameraPicture(draft.imageFile);
}

/** The camera's name for a picture: `camera-` before the id, in the capture folder. */
export function isCameraPicture(file: string): boolean {
  const name = file.slice(file.lastIndexOf('/') + 1);
  return name.startsWith(CAMERA_PREFIX) && name.length > CAMERA_PREFIX.length;
}

/** What the camera puts before a picture's id. Kept in step with `CapturePlugin.swift`. */
export const CAMERA_PREFIX = 'camera-';
