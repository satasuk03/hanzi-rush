/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** API origin. '' / unset = same-origin (web), 'off' = cloud features disabled */
  readonly VITE_API_BASE?: string;
  /** client build version sent as DeviceInfo.appVersion */
  readonly VITE_APP_VERSION?: string;
  /** AdMob rewarded ad unit ids (ca-app-pub-…/…). Unset = no ads in a production build (src/core/ads.ts) */
  readonly VITE_ADMOB_REWARDED_IOS?: string;
  readonly VITE_ADMOB_REWARDED_ANDROID?: string;
  /** '1' = use Google's test ad units even in a production build (testing on a phone) */
  readonly VITE_ADMOB_TEST?: string;
}
