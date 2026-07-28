import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.laboratory.managementsystem',
  appName: 'Laboratory Management System',
  webDir: '../public/v5',
  server: {
    androidScheme: 'https',
    cleartext: true
  },
  plugins: {
    CapacitorHttp: {
      enabled: true
    },
    SystemBars: {
      // Android 12 can dispatch insets before the WebView has created
      // document.documentElement. The bundled injector then logs a startup
      // exception. The app shell already uses env(safe-area-inset-*), so keep
      // Capacitor's early JavaScript injector disabled.
      insetsHandling: 'disable'
    }
  }
};

export default config;
