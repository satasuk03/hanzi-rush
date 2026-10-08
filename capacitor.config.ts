import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'app.zeze.hanzirush',
  appName: 'Hanzi Rush',
  webDir: 'dist',
  backgroundColor: '#1b6fd1',
  plugins: {
    SplashScreen: {
      launchShowDuration: 500,
      launchAutoHide: true,
      launchFadeOutDuration: 200,
      backgroundColor: '#1b6fd1',
      showSpinner: false,
    },
    LocalNotifications: {
      smallIcon: 'ic_stat_flame',
      iconColor: '#ff7a1f',
    },
    StatusBar: {
      overlaysWebView: true,
      style: 'DARK',
      backgroundColor: '#00000000',
    },
  },
  ios: {
    contentInset: 'never',
    scrollEnabled: false,
    backgroundColor: '#1b6fd1',
  },
  android: {
    allowMixedContent: false,
    backgroundColor: '#1b6fd1',
  },
};

export default config;
