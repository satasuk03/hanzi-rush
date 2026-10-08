import { storage } from './core/storage';
import { isSignInPopup } from './core/signin';

if (isSignInPopup()) {
  // web sign-in popup (Google) landing back here: the plugin's import-time handler hands the result to the opener and
  // closes this window, so the game itself must not boot
  await import('@capgo/capacitor-social-login');
} else {
  // the store reads saved progress at import time, so native storage must hydrate first
  await storage.init();
  await import('./boot');
}
