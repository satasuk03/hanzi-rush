/**
 * Profile: a lacquer name card with the player's level ring, XP, equipped title (称号)
 * and lifetime stats, plus the title list. Unlocked titles can be equipped; locked ones show progress.
 */
import gsap from 'gsap';
import './vault.css';
import type { Screen } from '../../core/app';
import { app } from '../../core/app';
import { h, center, formatNum } from '../../core/util';
import { t, tx, i18n, type Key } from '../../core/i18n';
import { store } from '../../core/store';
import { RARITIES } from '../../core/rarity';
import { TITLES, isUnlocked, playerLevel, titleById } from '../../core/meta';
import { audio } from '../../engine/audio';
import { particles } from '../../engine/particles';
import { shake } from '../../engine/shake';
import { pop, pressable, nope, popIn } from '../../engine/juice';
import { langToggle, muteButton, iconButton, ICON } from '../../ui/widgets';
import { sanitizeName } from '../../../shared/api';
import { cloud } from '../../core/cloud';
import { showTransferCode, showRestore, showDeleteAccount } from '../../ui/transfer';
import { ring } from './collection';
import { SPARK } from './fx';

export function create(from: 'home' | 'vault' = 'vault'): Screen {
  const back = () => (from === 'home' ? import('../../screens/home').then((m) => m.homeScreen()) : import('./VaultScreen').then((m) => m.create()));
  const p = store.progress;
  const top = h(
    'div',
    { class: 'topbar' },
    iconButton(ICON.back, 'Back', (e) => back().then((s) => app.go(() => s, { x: e.clientX, y: e.clientY }))),
    h('div', { class: 'spacer' }),
    muteButton(),
    langToggle(),
  );

  // ---- name card
  const lv = playerLevel();
  const name = h('input', { class: 'pf-name', maxlength: '16', spellcheck: 'false', 'aria-label': 'Name' }) as HTMLInputElement;
  name.value = p.profile.name;
  name.placeholder = t('playerName');
  name.addEventListener('change', () => {
    p.profile.name = sanitizeName(name.value);
    name.value = p.profile.name;
    store.save();
    audio.pop(1.2);
  });
  name.addEventListener('keydown', (e) => e.key === 'Enter' && name.blur());
  // typing shouldn't trigger screen shortcuts
  name.addEventListener('keydown', (e) => e.stopPropagation());

  const titleRib = h('div', { class: 'pf-title' });
  const avatarGlyph = h('span', { class: 'pf-glyph' });
  const avatar = h('div', { class: 'pf-avatar', html: ring(lv.into / lv.need, 112, 7, 'url(#pfg)') }, avatarGlyph, h('span', { class: 'pf-lv' }, h('small', null, 'Lv'), String(lv.level)));
  avatar.querySelector('svg')!.insertAdjacentHTML('afterbegin', '<defs><linearGradient id="pfg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff3c0"/><stop offset=".5" stop-color="#f0bf45"/><stop offset="1" stop-color="#b47a1c"/></linearGradient></defs>');
  const xpFill = h('span', { class: 'pf-xp-fill' });
  const card = h(
    'div',
    { class: 'pf-card' },
    h('span', { class: 'pf-corner tl' }), h('span', { class: 'pf-corner tr' }), h('span', { class: 'pf-corner bl' }), h('span', { class: 'pf-corner br' }),
    avatar,
    h('div', { class: 'pf-id' }, name, titleRib,
      h('div', { class: 'pf-xp' }, h('span', { class: 'pf-xp-bar' }, xpFill), h('span', { class: 'pf-xp-t' }, `${formatNum(lv.into)} / ${formatNum(lv.need)} XP`))),
  );

  const syncTitle = () => {
    const T = titleById(p.profile.title);
    titleRib.dataset.t = String(T.tier);
    titleRib.replaceChildren(h('b', null, T.zh), h('span', null, T[i18n.lang]));
    avatarGlyph.textContent = T.zh[0];
    avatarGlyph.dataset.t = String(T.tier);
  };

  // ---- stats
  const s = p.stats;
  const owned = Object.keys(p.cards).length;
  const stat = (k: Key, v: string, glyph: string) => h('div', { class: 'pf-stat' }, h('span', { class: 'pf-stat-g' }, glyph), h('span', { class: 'pf-stat-v' }, v), h('span', { class: 'pf-stat-k' }, tx(k)));
  const stats = h(
    'div',
    { class: 'pf-stats' },
    stat('statWords', formatNum(owned), '藏'),
    stat('statPulls', formatNum(s.pulls), '抽'),
    stat('statGames', formatNum(s.games), '戏'),
    stat('statCorrect', formatNum(s.correct), '对'),
    stat('accuracy', s.questions ? `${Math.round((s.correct / s.questions) * 100)}%` : '—', '准'),
    stat('maxCombo', `×${s.bestCombo}`, '连'),
    stat('statPerfect', formatNum(s.perfect), '全'),
    stat('statCoins', formatNum(s.coinsEarned), '财'),
  );
  const rarRow = h('div', { class: 'pf-rar' }, ...RARITIES.slice().reverse().map((R) => h('span', { class: 'col-r', style: `--rc:${R.color}` }, h('i'), h('b', null, formatNum(s.byRarity[R.i])), R.name)));

  // ---- cloud save (hidden when the backend is disabled)
  const cloudBox = h('div', { class: 'pf-cloud' });
  const cloudDot = h('span', { class: 'pf-cloud-dot' });
  const cloudStatus = h('span', { class: 'pf-cloud-st' });
  const cloudTag = h('span', { class: 'pf-cloud-tag' });
  const cbtn = (label: Key, onTap: () => void, cls = '') => {
    const b = h('button', { class: `pf-cbtn ${cls}` }, tx(label));
    pressable(b, () => {
      audio.pop(1.1);
      onTap();
    });
    return b;
  };
  const reload = () => app.go(() => create(from));
  const btnsOn = h('div', { class: 'pf-cloud-btns' }, cbtn('transferCode', showTransferCode), cbtn('restore', () => showRestore(reload)));
  const btnDel = cbtn('deleteAccount', () => showDeleteAccount(reload), 'danger');
  // cloud save off (account deleted or banned): turning it back on, or restoring another account, are the only actions
  const btnsOff = h('div', { class: 'pf-cloud-btns' }, cbtn('cloudEnable', () => void cloud.enable(), 'wide'), cbtn('restore', () => showRestore(reload), 'wide'));
  // signed out (session revoked elsewhere): a persistent note + the two ways forward
  const noteOut = h('p', { class: 'pf-cloud-note' }, tx('cloudSignedOut'));
  const btnsOut = h('div', { class: 'pf-cloud-btns' }, cbtn('signedOutEnter', () => showRestore(reload)), cbtn('signedOutNew', () => void cloud.enable()));
  cloudBox.append(h('div', { class: 'pf-cloud-line' }, cloudDot, cloudStatus, cloudTag), noteOut, btnsOut, btnsOn, btnDel, btnsOff);
  const syncCloud = () => {
    const s = cloud.status;
    const off = s === 'disabled';
    const out = s === 'signedOut';
    cloudBox.dataset.s = s;
    btnsOn.hidden = btnDel.hidden = off || out;
    btnsOff.hidden = !off;
    noteOut.hidden = btnsOut.hidden = !out;
    const clock = cloud.syncedAt ? new Date(cloud.syncedAt).toLocaleTimeString(i18n.lang === 'th' ? 'th-TH' : 'en-US', { hour: '2-digit', minute: '2-digit' }) : '';
    cloudStatus.replaceChildren(
      s === 'syncing' ? t('cloudSyncing') : s === 'synced' ? `${t('cloudSynced')}${clock ? ` · ${clock}` : ''}` : s === 'pending' ? t('cloudPending') : off ? t('cloudDisabled') : out ? t('signedOutTitle') : t('cloudOffline'),
    );
    cloudTag.textContent = cloud.tag ? `#${cloud.tag}` : '';
  };
  syncCloud();
  const offStatus = cloud.on('status', syncCloud);
  const offApplied = cloud.on('applied', () => (name.value = p.profile.name));

  // ---- titles
  const list = h('div', { class: 'ti-list' });
  const renderTitles = () => {
    list.replaceChildren(
      ...TITLES.map((T) => {
        const un = isUnlocked(T);
        const on = p.profile.title === T.id;
        const prog = T.progress();
        const b = h(
          'button',
          { class: `ti ${un ? 'un' : 'lock'} ${on ? 'on' : ''}`, 'data-t': String(T.tier), style: `--rc:${RARITIES[T.tier].color}` },
          h('span', { class: 'ti-seal' }, T.zh[0]),
          h('span', { class: 'ti-text' }, h('span', { class: 'ti-name' }, h('b', null, T.zh), ` ${T[i18n.lang]}`), h('span', { class: 'ti-req' }, T.req[i18n.lang])),
          un
            ? h('span', { class: 'ti-state' }, tx(on ? 'equipped' : 'equip'))
            : h('span', { class: 'ti-prog' }, h('span', { class: 'ti-prog-fill', style: `transform:scaleX(${prog})` }), h('span', { class: 'ti-lock', html: ICON.lock })),
        );
        pressable(b, () => {
          if (!un) {
            audio.tick(true);
            nope(b);
            return;
          }
          if (on) return pop(b, 0.4);
          p.profile.title = T.id;
          store.save();
          audio.reveal(Math.min(T.tier, 2));
          syncTitle();
          renderTitles();
          pop(titleRib, 1.2);
          const c = center(titleRib);
          particles.burst(c.x, c.y, { count: 18 + T.tier * 6, sprite: SPARK[T.tier], speed: [200, 520], size: [12, 22], g: 300, drag: 2, life: [0.4, 0.8], add: true, stretch: true });
          particles.ring(c.x, c.y, 120, RARITIES[T.tier].color, 8);
          shake(0.2 + T.tier * 0.05);
        });
        return b;
      }),
    );
  };

  const unlockedN = TITLES.filter(isUnlocked).length;
  const el = h(
    'div',
    { class: 'screen profile' },
    top,
    h('div', { class: 'pf-scroll' },
      card,
      rarRow,
      stats,
      cloud.status === 'off' ? null : h('h3', { class: 'pf-h' }, h('span', { class: 'pf-h-zh' }, '云'), tx('cloudSave')),
      cloud.status === 'off' ? null : cloudBox,
      h('h3', { class: 'pf-h' }, h('span', { class: 'pf-h-zh' }, '称号'), tx('titles'), h('small', null, ` ${unlockedN}/${TITLES.length}`)),
      list),
  );
  syncTitle();
  renderTitles();
  const offLang = i18n.onChange(() => {
    syncTitle();
    renderTitles();
    name.placeholder = t('playerName');
  });

  return {
    el,
    theme: 'vault',
    enter() {
      gsap.from(card, { y: -60, rotation: -3, opacity: 0, duration: 0.8, ease: 'elastic.out(1,0.6)' });
      gsap.fromTo(xpFill, { scaleX: 0 }, { scaleX: lv.into / lv.need, duration: 1.2, delay: 0.3, ease: 'power3.out' });
      const fill = avatar.querySelector<SVGCircleElement>('.ring-fill')!;
      gsap.from(fill, { attr: { 'stroke-dashoffset': Number(fill.getAttribute('stroke-dasharray')) }, duration: 1.3, delay: 0.25, ease: 'power3.out' });
      popIn([...stats.children], 0.2, 0.04);
      gsap.from(list.children, { x: -30, opacity: 0, duration: 0.4, stagger: 0.03, delay: 0.3, ease: 'back.out(2)' });
    },
    leave() {
      offLang();
      offStatus();
      offApplied();
    },
    onKey(e) {
      if (e.key === 'Escape') back().then((sc) => app.go(() => sc));
    },
  };
}
