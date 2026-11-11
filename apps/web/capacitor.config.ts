import type { CapacitorConfig } from '@capacitor/cli';

/*
 * DIAGNOSTIC BUILDS ONLY. `CICIS_INSPECTABLE=1 npm run cap:sync` makes the web view inspectable in a release
 * (TestFlight) build, so a phone on a cable shows up in Safari › Develop, and puts the read-only console helper
 * `window.__expansesSync` (src/sync/sync-console.ts) in the bundle: vite.config.ts hands the same variable to the web
 * code as `VITE_INSPECTABLE`. Without it — the default — neither is in the build, and capacitor.config.json carries
 * no `webContentsDebuggingEnabled` at all (Capacitor's own default: inspectable in Debug builds only).
 *
 * Never for the App Store: anyone with the unlocked phone and a Mac can read the whole database through the
 * inspector. Run `cap:sync` again without the variable before archiving a build that is not a diagnostic one. See
 * apps/web/README.md.
 */
const inspectable = process.env.CICIS_INSPECTABLE === '1';

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
    // Only with CICIS_INSPECTABLE=1 (see the top of this file).
    ...(inspectable ? { webContentsDebuggingEnabled: true } : {}),
  },
};

export default config;
