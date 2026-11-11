import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  /*
   * PERMANENT. Once a build carrying this id reaches TestFlight, changing it orphans every user's data: the
   * database lives in OPFS under the app's own origin, and the origin is derived from the bundle id. A new id
   * is a new app with an empty database, and its owner cannot tell that from data loss.
   */
  appId: 'com.cicis.app',
  appName: 'cicis',
  webDir: 'dist',
  ios: {
    // The web layer already pads for safe areas with env(safe-area-inset-*); let it draw edge to edge.
    contentInset: 'never',
    /*
     * DIAGNOSTICS, TURN OFF BEFORE THE APP STORE. Makes the web view inspectable in release (TestFlight) builds too, so
     * a phone on a cable shows up in Safari › Develop and the sync log can be read (`window.__expansesSync`,
     * src/sync/sync-console.ts). Capacitor's own default is on for Debug builds only. Set this to false — or remove
     * it — and remove the console helper before any App Store submission.
     */
    webContentsDebuggingEnabled: true,
  },
};

export default config;
