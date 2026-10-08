import gsap from 'gsap';
import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';
import { StatusBar, Style } from '@capacitor/status-bar';
import { SplashScreen } from '@capacitor/splash-screen';
import './style.css';
import { app } from './core/app';
import { store } from './core/store';
import { i18n } from './core/i18n';
import { audio } from './engine/audio';
import { background } from './engine/background';
import { particles } from './engine/particles';
import { flipper } from './engine/flip3d';
import { mountShake, updateShake } from './engine/shake';
import { sprites } from './engine/sprites';
import { homeScreen } from './screens/home';
import { cloud } from './core/cloud';
import { showSignedOut } from './ui/transfer';
import { reminders } from './core/reminders';
import { initTitleRewards } from './core/titleRewards';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

// engines
background.mount($('bg'));
particles.mount($('fx'));
flipper.mount($('gl'));
mountShake($('shake'));
sprites();

// iris medallion
$('iris').innerHTML = '<div class="iris-medal"><span>汉</span></div>';

i18n.set(i18n.lang);
app.mount($('app'), $('iris'));
app.show(homeScreen());
cloud.init();
initTitleRewards();

// a revoked session is announced once, never mid-run (endRun re-emits 'status' when the run is over)
const announceSignedOut = () => {
  if (cloud.signedOutPending && !cloud.runActive) showSignedOut(() => {});
};
cloud.on('status', announceSignedOut);
setTimeout(announceSignedOut, 1500);

// one loop drives everything, synced with GSAP so tweens and particles never drift
gsap.ticker.lagSmoothing(250, 33);
gsap.ticker.add((_time, deltaMs) => {
  const dt = Math.min(deltaMs / 1000, 1 / 20);
  background.update(dt);
  background.render();
  app.update(dt);
  particles.update(dt);
  particles.render();
  flipper.render();
  updateShake(dt);
});

// browsers need a gesture before audio can play
const unlock = () => {
  audio.unlock();
  audio.startMusic();
  removeEventListener('pointerdown', unlock);
  removeEventListener('keydown', unlock);
};
addEventListener('pointerdown', unlock);
addEventListener('keydown', unlock);

// block iOS double-tap zoom / context menus on long-press during fast play
document.addEventListener('dblclick', (e) => e.preventDefault());
document.addEventListener('contextmenu', (e) => e.preventDefault());

// native shell: save on background, silence audio, hardware back, system chrome
if (Capacitor.isNativePlatform()) {
  App.addListener('pause', () => {
    store.save();
    audio.suspend();
    void reminders.sync();
  });
  App.addListener('resume', () => audio.resume());
  if (Capacitor.getPlatform() === 'android') {
    App.addListener('backButton', () => {
      if (!app.back()) App.exitApp();
    });
  }
  StatusBar.setStyle({ style: Style.Dark }).catch(() => {});
  StatusBar.setOverlaysWebView({ overlay: true }).catch(() => {});
  SplashScreen.hide().catch(() => {});
  void reminders.sync();
}
