import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics';
import { isNative } from '../lib/pwa';

/**
 * A light tap under the finger: the hold on ＋ has opened its menu. In the iOS app only; a browser has no such thing,
 * and a phone that cannot give one (or refuses) is left as it is — the menu opening says as much.
 */
export function tapLight(): void {
  if (!isNative()) return;
  try {
    void Haptics.impact({ style: ImpactStyle.Light }).catch(() => undefined);
  } catch {
    // The plugin missing from an older shell is no reason to stop the menu opening.
  }
}

/** A light warning buzz: a save was asked for that cannot be made. In the iOS app only; anywhere else, nothing. */
export function buzzWarning(): void {
  if (!isNative()) return;
  try {
    void Haptics.notification({ type: NotificationType.Warning }).catch(() => undefined);
  } catch {
    // As above: a shell without the plugin is left as it is.
  }
}
