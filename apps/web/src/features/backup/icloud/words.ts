import { formatBytes } from '../../recovery/recovery-copy';
import { type CloudCopy, localDay } from './names';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Today, 07:12", "Yesterday, 22:40", "30 Sep 2026, 07:31" — when a copy was taken, in the device's own time. */
export function whenShort(iso: string, now: Date = new Date()): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return iso;
  const time = `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`;
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  if (localDay(at) === localDay(now)) return `Today, ${time}`;
  if (localDay(at) === localDay(yesterday)) return `Yesterday, ${time}`;
  return `${at.getDate()} ${MONTHS[at.getMonth()]} ${at.getFullYear()}, ${time}`;
}

/** The line under a copy in the Restore list: "iPhone · 2.4 MB · with photos". */
export const copyLine = (copy: CloudCopy): string => `${copy.model} · ${formatBytes(copy.bytes)} · ${copy.withPhotos ? 'with photos' : 'without photos'}`;

/** "1 copy", "7 copies". */
export const copiesWord = (count: number): string => `${count} ${count === 1 ? 'copy' : 'copies'}`;
