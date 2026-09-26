import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.expanses.spike',
  appName: 'Expanses',
  webDir: 'dist',
  ios: {
    // The web layer already pads for safe areas with env(safe-area-inset-*); let it draw edge to edge.
    contentInset: 'never',
  },
};

export default config;
