/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** API origin. '' / unset = same-origin (web), 'off' = cloud features disabled */
  readonly VITE_API_BASE?: string;
  /** client build version sent as DeviceInfo.appVersion */
  readonly VITE_APP_VERSION?: string;
}
