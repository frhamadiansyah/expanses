import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  /*
   * PERMANENT. Once a build carrying this id reaches TestFlight, changing it orphans every user's data: the
   * database lives in OPFS under the app's own origin, and the origin is derived from the bundle id. A new id
   * is a new app with an empty database, and its owner cannot tell that from data loss.
   */
  appId: 'com.expanses.app',
  appName: 'Expanses',
  webDir: 'dist',
  ios: {
    // The web layer already pads for safe areas with env(safe-area-inset-*); let it draw edge to edge.
    contentInset: 'never',
  },
};

export default config;
