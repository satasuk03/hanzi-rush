import gsap from 'gsap';
import './style.css';
import { app } from './core/app';
import { i18n } from './core/i18n';
import { audio } from './engine/audio';
import { background } from './engine/background';
import { particles } from './engine/particles';
import { flipper } from './engine/flip3d';
import { mountShake, updateShake } from './engine/shake';
import { sprites } from './engine/sprites';
import { homeScreen } from './screens/home';

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
