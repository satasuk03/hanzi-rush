/**
 * Wardrobe (衣橱): a live preview card plus one tab per cosmetic slot (frame, avatar, name, badges) and the titles list.
 * Everything reads the cached inventory, so it works offline; wallet.on() redraws when the inventory changes.
 */
import gsap from 'gsap';
import './vault.css';
import './wardrobe.css';
import type { Screen } from '../../core/app';
import { app } from '../../core/app';
import { h, center } from '../../core/util';
import { t, tx, i18n, type Key } from '../../core/i18n';
import { store } from '../../core/store';
import { RARITIES } from '../../core/rarity';
import { TITLES, TITLE_FAMILIES, isUnlocked, titleById, type Title } from '../../core/meta';
import { wallet } from '../../core/wallet';
import { audio } from '../../engine/audio';
import { particles } from '../../engine/particles';
import { shake } from '../../engine/shake';
import { pop, pressable, nope } from '../../engine/juice';
import { langToggle, muteButton, iconButton, ICON } from '../../ui/widgets';
import { ITEMS, LOOK_MAX_BADGES, type Item, type Look, type Slot } from '../../../shared/cosmetics';
import { applyNameFx, avatarSrc, paintIdentity, renderBadges, renderIdentity } from '../../cosmetics/render';
import { currentLook, equipItem, isEquipped, unequipItem } from '../../cosmetics/equip';
import { SPARK } from './fx';

type Tab = Slot | 'title';
const TABS: { id: Tab; zh: string; k: Key }[] = [
  { id: 'frame', zh: '框', k: 'wdFrame' },
  { id: 'avatar', zh: '像', k: 'wdAvatar' },
  { id: 'nameFx', zh: '名', k: 'wdName' },
  { id: 'badge', zh: '章', k: 'wdBadges' },
  { id: 'title', zh: '称', k: 'wdTitle' },
];

export function create(from: 'home' | 'vault' = 'vault'): Screen {
  const p = store.progress;
  const back = () => import('./profile').then((m) => m.create(from));
  const top = h(
    'div',
    { class: 'topbar' },
    iconButton(ICON.back, 'Back', (e) => back().then((s) => app.go(() => s, { x: e.clientX, y: e.clientY }))),
    h('div', { class: 'spacer' }),
    muteButton(),
    langToggle(),
  );

  // ---- live preview
  const glyph = h('span');
  const avWrap = h('div', { class: 'wd-av' }, glyph);
  const nameEl = h('span', { class: 'wd-name-t' });
  const badgesSlot = h('span', { class: 'wd-badges' });
  const titleRib = h('div', { class: 'pf-title' });
  const preview = h(
    'div',
    { class: 'pf-card wd-card' },
    h('span', { class: 'pf-corner tl' }), h('span', { class: 'pf-corner tr' }), h('span', { class: 'pf-corner bl' }), h('span', { class: 'pf-corner br' }),
    avWrap,
    h('div', { class: 'wd-name' }, nameEl, badgesSlot),
    titleRib,
  );
  const paintPreview = () => {
    const T = titleById(p.profile.title);
    const look = currentLook();
    paintIdentity(glyph, look, 'L', { title: T });
    nameEl.className = 'wd-name-t';
    delete nameEl.dataset.fx;
    nameEl.textContent = p.profile.name || t('playerName');
    applyNameFx(nameEl, look, true);
    badgesSlot.replaceChildren(...[renderBadges(look, 'L')].filter((x): x is HTMLElement => !!x));
    titleRib.dataset.t = String(T.tier);
    titleRib.replaceChildren(h('b', null, T.zh), h('span', null, T[i18n.lang]));
  };

  // ---- tabs
  let tab: Tab = 'frame';
  const tabBtns = TABS.map((T) => {
    const b = h('button', { class: 'wd-tab', 'data-tab': T.id }, h('b', null, T.zh), tx(T.k, 'small'));
    pressable(b, () => {
      if (tab === T.id) return;
      audio.pop(1.1);
      tab = T.id;
      renderBody(true);
    });
    return b;
  });
  const tabs = h('div', { class: 'wd-tabs', role: 'tablist' }, ...tabBtns);

  const body = h('div', { class: 'wd-body' });

  // ---- item grids
  const items = (slot: Slot): Item[] =>
    ITEMS.filter((i) => i.slot === slot && i.source !== 'grant' && (i.source !== 'event' || wallet.owns(i.id))).sort((a, b) => b.rarity - a.rarity || a.en.localeCompare(b.en));

  const visual = (it: Item): HTMLElement => {
    const look: Look = { [it.slot === 'badge' ? 'badges' : it.slot]: it.slot === 'badge' ? [it.id] : it.id };
    switch (it.slot) {
      case 'avatar':
        return h('span', { class: 'wd-v wd-v-av' }, h('img', { src: avatarSrc(it.id), alt: '', width: '56', height: '56', loading: 'lazy', draggable: 'false' }));
      case 'frame':
        return h('span', { class: 'wd-v' }, renderIdentity(look, 'M', { title: titleById(p.profile.title) }));
      case 'nameFx': {
        const s = h('span', { class: 'wd-v wd-v-fx' }, t('wdSample'));
        applyNameFx(s, look, false);
        return s;
      }
      default:
        return h('span', { class: 'wd-v' }, renderBadges(look, 'L') ?? it.zh[0]);
    }
  };

  const tile = (it: Item | null, slot: Slot) => {
    const own = it ? wallet.owns(it.id) : true;
    const on = it ? isEquipped(it.id) : slot !== 'badge' && !currentLook()[slot];
    const R = it ? RARITIES[it.rarity] : null;
    const copies = it ? wallet.inventory[it.id] ?? 0 : 0;
    const b = h(
      'button',
      { class: `wd-tile ${own ? 'own' : 'lock'} ${on ? 'on' : ''}`, style: R ? `--rc:${R.color}` : '--rc:#cdbb9e', 'aria-pressed': String(on), 'aria-label': it ? it.en : t('wdDefault') },
      it ? visual(it) : h('span', { class: 'wd-v wd-v-none' }, slot === 'avatar' ? renderIdentity({}, 'M', { title: titleById(p.profile.title) }) : h('i', null, '∅')),
      h('span', { class: 'wd-t-name' }, it ? it[i18n.lang] : t(slot === 'avatar' ? 'wdDefault' : 'wdNone')),
      it && copies > 1 ? h('span', { class: 'wd-copies' }, `×${copies}`) : null,
      on ? h('span', { class: 'wd-check' }, '✓') : null,
      !own ? h('span', { class: 'wd-lock', html: ICON.lock }) : null,
    );
    pressable(b, () => {
      if (!own) {
        audio.tick(true);
        nope(b);
        return;
      }
      if (!it) {
        const cur = currentLook()[slot as Exclude<Slot, 'badge'>];
        if (cur) unequipItem(cur);
        audio.pop(0.9);
      } else if (on) {
        unequipItem(it.id);
        audio.pop(0.9);
      } else if (equipItem(it.id)) audio.reveal(Math.min(it.rarity, 2));
      paintPreview();
      pop(avWrap, 0.5);
      renderBody(false);
    });
    return b;
  };

  // ---- titles (moved from the Profile screen)
  const list = h('div', { class: 'ti-list' });
  const renderTitles = () => {
    const row = (T: Title) => {
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
        paintPreview();
        renderTitles();
        pop(titleRib, 1.2);
        const c = center(titleRib);
        particles.burst(c.x, c.y, { count: 18 + T.tier * 6, sprite: SPARK[T.tier], speed: [200, 520], size: [12, 22], g: 300, drag: 2, life: [0.4, 0.8], add: true, stretch: true });
        particles.ring(c.x, c.y, 120, RARITIES[T.tier].color, 8);
        shake(0.2 + T.tier * 0.05);
      });
      return b;
    };

    // "next up": the closest locked titles that have been started
    const next = TITLES.map((T) => ({ T, f: T.progress() }))
      .filter((x) => x.f > 0 && x.f < 1)
      .sort((a, b) => b.f - a.f)
      .slice(0, 3)
      .map((x) => x.T);
    const section = (zh: string, name: string, items: Title[], count?: string) =>
      h('div', { class: 'ti-fam' }, h('h4', { class: 'ti-fam-h' }, h('b', null, zh), ` ${name}`, count ? h('small', null, ` ${count}`) : null), ...items.map(row));
    list.replaceChildren(
      ...(next.length ? [section('近', t('titlesNextUp'), next)] : []),
      ...TITLE_FAMILIES.map((F) => {
        const items = TITLES.filter((T) => T.family === F.id);
        return section(F.zh, F[i18n.lang], items, `${items.filter(isUnlocked).length}/${items.length}`);
      }),
    );
  };

  // ---- body
  function renderBody(animate: boolean) {
    for (const b of tabBtns) b.classList.toggle('on', b.dataset.tab === tab);
    let kids: HTMLElement[];
    if (tab === 'title') {
      renderTitles();
      kids = [list];
    } else {
      const slot: Slot = tab;
      const empty = Object.values(wallet.inventory).every((n) => !(n > 0));
      kids = [
        ...(empty ? [h('p', { class: 'wd-note wd-empty' }, t('wdEmpty'))] : []),
        ...(slot === 'badge' ? [h('p', { class: 'wd-note' }, t('wdBadgesWorn').replace('{n}', String(currentLook().badges?.length ?? 0)).replace('{max}', String(LOOK_MAX_BADGES)))] : []),
        h('div', { class: 'wd-grid' }, ...(slot === 'badge' ? [] : [tile(null, slot)]), ...items(slot).map((it) => tile(it, slot))),
      ];
    }
    body.replaceChildren(...kids);
    if (animate) gsap.from(tab === 'title' ? list.children : body.querySelectorAll('.wd-tile'), { y: 14, opacity: 0, duration: 0.3, stagger: 0.015, ease: 'back.out(2)' });
  }

  const el = h('div', { class: 'screen profile wardrobe' }, top, h('div', { class: 'pf-scroll' }, preview, tabs, body));
  paintPreview();
  renderBody(false);
  const offLang = i18n.onChange(() => {
    paintPreview();
    renderBody(false);
  });
  // the inventory changed (a pull landed, the first fetch finished): redraw from the cache
  const offWallet = wallet.on(() => renderBody(false));
  void wallet.refresh();

  return {
    el,
    theme: 'vault',
    enter() {
      gsap.from(preview, { y: -40, opacity: 0, duration: 0.6, ease: 'elastic.out(1,0.7)' });
      gsap.from(body.querySelectorAll('.wd-tile'), { y: 14, opacity: 0, duration: 0.3, stagger: 0.015, delay: 0.2, ease: 'back.out(2)' });
    },
    leave() {
      offLang();
      offWallet();
    },
    onKey(e) {
      if (e.key === 'Escape') back().then((sc) => app.go(() => sc));
    },
  };
}
