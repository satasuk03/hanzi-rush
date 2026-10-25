import { isSignInPopup } from './core/signin';
import { pwa } from './core/pwa';

if (isSignInPopup()) {
  // web sign-in popup (Google) landing back here: the plugin's import-time handler hands the result to the opener and
  // closes this window, so the game itself must not boot
  await import('@capgo/capacitor-social-login');
} else {
  // before the big boot chunk loads, or Chrome's install prompt can fire with nobody listening
  pwa.init();
  await import('./boot');
}
