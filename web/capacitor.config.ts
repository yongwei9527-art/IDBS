import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.laboratory.managementsystem',
  appName: '实验室管理系统',
  webDir: '../public/v5',
  server: {
    androidScheme: 'https',
    cleartext: true
  }
};

export default config;
