import { registerPlugin, WebPlugin } from '@capacitor/core';
import { useLayoutEffect } from 'react';
import { isNative } from '../lib/pwa';

/**
 * The app's own Swift plugin (ios/App/App/FormAccessoryBarPlugin.swift): shows or hides the bar iOS puts over the
 * keyboard of a web form (⌃ ⌄ ✓). Not `@capacitor/keyboard`: that plugin, once installed, hides the bar in every form
 * and takes the keyboard handling away from the web view for the whole app.
 */
export interface FormAccessoryBarApi {
  setVisible(options: { visible: boolean }): Promise<void>;
}

class FormAccessoryBarWeb extends WebPlugin implements FormAccessoryBarApi {
  async setVisible(): Promise<void> {}
}

export const FormAccessoryBar = registerPlugin<FormAccessoryBarApi>('FormAccessoryBar', { web: () => new FormAccessoryBarWeb() });

function set(plugin: FormAccessoryBarApi, visible: boolean): void {
  try {
    void plugin.setVisible({ visible }).catch(() => undefined);
  } catch {
    // A shell built before the plugin keeps its bar: the field still works under it.
  }
}

/**
 * Takes the bar off the keyboard and returns how to put it back. In the iOS app only; a browser has no such bar, and
 * anywhere else nothing is asked for.
 */
export function hideFormAccessoryBar(plugin: FormAccessoryBarApi = FormAccessoryBar, native: boolean = isNative()): () => void {
  if (!native) return () => undefined;
  set(plugin, false);
  return () => set(plugin, true);
}

/**
 * No bar while `hidden` holds, and the bar back as soon as it stops holding or the caller goes. A layout effect, so a
 * field focused in the same commit (One line's, opened by the hold's release) already meets a keyboard without it.
 */
export function useHiddenFormAccessoryBar(hidden: boolean): void {
  useLayoutEffect(() => (hidden ? hideFormAccessoryBar() : undefined), [hidden]);
}
