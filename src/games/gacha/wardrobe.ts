/**
 * Wardrobe (衣橱): a live preview card plus one tab per cosmetic slot (frame, avatar, name, badges) and the titles list.
 * The preview and tabs sit above the scrolling list and shrink to a slim bar once it scrolls, so every tap stays visible.
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
import { titleReward } from '../../core/titleRewards';
import { audio } from '../../engine/audio';
import { particles } from '../../engine/particles';
import { shake } from '../../engine/shake';
import { pop, pressable, nope } from '../../engine/juice';
import { langToggle, muteButton, iconButton, ICON } from '../../ui/widgets';
import { ITEMS, LOOK_MAX_BADGES, SETS, itemById, type SetDef, type Item, type Look, type Slot } from '../../../shared/cosmetics';
import { applyNameFx, avatarSrc, paintIdentity, renderBadges, renderIdentity } from '../../cosmetics/render';
import { currentLook, equipItem, isEquipped, unequipItem } from '../../cosmetics/equip';
import { SPARK } from './fx';

type Tab = Slot | 'set' | 'title';
const TABS: { id: Tab; zh: string; k: Key }[] = [
  { id: 'frame', zh: '框', k: 'wdFrame' },
  { id: 'avatar', zh: '像', k: 'wdAvatar' },
  { id: 'nameFx', zh: '名', k: 'wdName' },
  { id: 'badge', zh: '章', k: 'wdBadges' },
  { id: 'set', zh: '套', k: 'wdSets' },
  { id: 'title', zh: '称', k: 'wdTitle' },
];

const fmt = (n: number) => n.toLocaleString('en-US');
/** height of the slim preview bar (.wd-card.compact) */
const COMPACT_H = 64;

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

  // ---- live preview: the dark profile card, or the light board row other players see
  let view: 'card' | 'board' = 'card';
  const glyph = h('span');
  const avWrap = h('div', { class: 'wd-av' }, glyph);
  const nameEl = h('span', { class: 'wd-name-t' });
  const badgesSlot = h('span', { class: 'wd-badges' });
  const titleRib = h('div', { class: 'pf-title' });
  const cardStage = h('div', { class: 'wd-stage' }, avWrap, h('div', { class: 'wd-name' }, nameEl, badgesSlot), titleRib);
  const boardStage = h('div', { class: 'wd-board' });
  const viewBtns = (['card', 'board'] as const).map((v) => {
    const b = h('button', { class: 'wd-view-b', 'data-v': v }, tx(v === 'card' ? 'wdViewCard' : 'wdViewBoard'));
    pressable(b, () => {
      if (view === v) return;
      audio.pop(1.1);
      view = v;
      paintPreview();
      pop(view === 'card' ? avWrap : boardStage, 0.5);
    });
    return b;
  });
  const preview = h(
    'div',
    { class: 'pf-card wd-card' },
    h('span', { class: 'pf-corner tl' }), h('span', { class: 'pf-corner tr' }), h('span', { class: 'pf-corner bl' }), h('span', { class: 'pf-corner br' }),
    cardStage,
    boardStage,
    h('div', { class: 'wd-view' }, ...viewBtns),
  );
  const paintPreview = () => {
    const T = titleById(p.profile.title);
    const look = currentLook();
    const name = p.profile.name || t('playerName');
    for (const b of viewBtns) b.classList.toggle('on', b.dataset.v === view);
    cardStage.hidden = view !== 'card';
    boardStage.hidden = view !== 'board';
    if (view === 'board') {
      // the same markup as a leaderboard row (src/screens/leaderboard.ts), so it picks up the real board styles
      const nm = h('span', { class: 'lb-nm' }, name);
      applyNameFx(nm, look, true);
      boardStage.replaceChildren(
        h(
          'div',
          { class: 'lb-row me' },
          h('span', { class: 'lb-rank' }, '–'),
          renderIdentity(look, 'S', { title: T }),
          h('span', { class: 'lb-who' }, h('span', { class: 'lb-name' }, nm, renderBadges(look, 'S'), h('em', null, ' ', tx('lbYou'))), h('span', { class: 'lb-title-t' }, T[i18n.lang])),
        ),
      );
      return;
    }
    paintIdentity(glyph, look, 'L', { title: T });
    nameEl.className = 'wd-name-t';
    delete nameEl.dataset.fx;
    nameEl.textContent = name;
    applyNameFx(nameEl, look, true);
    badgesSlot.replaceChildren(...[renderBadges(look, 'L')].filter((x): x is HTMLElement => !!x));
    titleRib.dataset.t = String(T.tier);
    titleRib.replaceChildren(h('b', null, T.zh), h('span', null, T[i18n.lang]));
  };

  // ---- tabs: how much of each slot you own, and a dot for items you have not looked at yet
  const items = (slot: Slot): Item[] =>
    ITEMS.filter((i) => i.slot === slot && (i.source === 'gacha' || wallet.owns(i.id))).sort((a, b) => b.rarity - a.rarity || a.en.localeCompare(b.en));
  const hasNew = (slot: Slot) => items(slot).some((i) => wallet.isNew(i.id));

  // open on the first slot with something new in it
  let tab: Tab = TABS.find((T): T is { id: Slot; zh: string; k: Key } => T.id !== 'title' && T.id !== 'set' && hasNew(T.id))?.id ?? 'frame';
  let ownedOnly = false;
  /** the player has now seen everything in the tab they are leaving */
  const seenIn = (T: Tab) => (T === 'title' ? [] : T === 'set' ? SETS.flatMap((x) => [...x.items, x.bonus]) : items(T).map((i) => i.id));
  const hasNewIn = (T: Tab) => seenIn(T).some((id) => wallet.isNew(id));
  const leaveTab = () => wallet.markSeen(seenIn(tab));
  const tabCounts = new Map<Tab, HTMLElement>();
  const tabBtns = TABS.map((T) => {
    const ct = h('span', { class: 'wd-tab-ct' });
    tabCounts.set(T.id, ct);
    const b = h('button', { class: 'wd-tab', 'data-tab': T.id }, h('b', null, T.zh), tx(T.k, 'small'), ct, h('i', { class: 'wd-tab-dot' }));
    pressable(b, () => {
      if (tab === T.id) return;
      audio.pop(1.1);
      const prev = tab;
      tab = T.id;
      wallet.markSeen(seenIn(prev));
      renderBody(true);
      scroll.scrollTop = 0;
    });
    return b;
  });
  const tabs = h('div', { class: 'wd-tabs', role: 'tablist' }, ...tabBtns);
  const paintTabs = () => {
    for (const b of tabBtns) {
      const id = b.dataset.tab as Tab;
      b.classList.toggle('on', id === tab);
      b.classList.toggle('new', id !== tab && hasNewIn(id));
      const [have, all] = id === 'title' ? [TITLES.filter(isUnlocked).length, TITLES.length] : id === 'set' ? [SETS.filter(setDone).length, SETS.length] : [items(id).filter((i) => wallet.owns(i.id)).length, items(id).length];
      tabCounts.get(id)!.textContent = `${have}/${all}`;
    }
  };

  const setDone = (x: SetDef) => x.items.every((id) => wallet.owns(id));
  const setHave = (x: SetDef) => x.items.filter((id) => wallet.owns(id)).length;

  // ---- All / Owned
  const filterBtns = ([false, true] as const).map((only) => {
    const b = h('button', { class: 'wd-filter-b' });
    pressable(b, () => {
      if (ownedOnly === only) return;
      audio.pop(1);
      ownedOnly = only;
      renderBody(true);
    });
    return { b, only };
  });
  const filter = h('div', { class: 'wd-filter' }, ...filterBtns.map((f) => f.b));
  const paintFilter = () => {
    for (const { b, only } of filterBtns) {
      b.classList.toggle('on', ownedOnly === only);
      b.replaceChildren(tx(only ? (tab === 'title' || tab === 'set' ? 'wdShowUnlocked' : 'wdShowOwned') : 'wdShowAll'));
    }
  };

  const body = h('div', { class: 'wd-body' });

  // ---- item grids
  const visual = (it: Item): HTMLElement => {
    const look: Look = { [it.slot === 'badge' ? 'badges' : it.slot]: it.slot === 'badge' ? [it.id] : it.id };
    switch (it.slot) {
      case 'avatar':
        return h('span', { class: 'wd-v wd-v-av' }, h('img', { src: avatarSrc(it.id), alt: '', width: '56', height: '56', loading: 'lazy', draggable: 'false' }));
      case 'frame':
        // on the player's own avatar, so the frame is judged on the face it will go round
        return h('span', { class: 'wd-v' }, renderIdentity({ avatar: currentLook().avatar, frame: it.id }, 'M', { title: titleById(p.profile.title) }));
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
      h('span', { class: 'wd-t-name' }, it ? h('i', { class: 'wd-rar', 'aria-hidden': 'true' }) : null, it ? it[i18n.lang] : t(slot === 'avatar' ? 'wdDefault' : 'wdNone')),
      it && copies > 1 ? h('span', { class: 'wd-copies' }, `×${copies}`) : null,
      it && wallet.isNew(it.id) ? h('span', { class: 'wd-new' }, tx('wdNew')) : null,
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
      pop(view === 'card' ? avWrap : boardStage, 0.5);
      renderBody(false);
    });
    return b;
  };

  // ---- titles (moved from the Profile screen)
  const list = h('div', { class: 'ti-list' });
  /** the Jade a title pays: "+10" until it is paid, then a muted tick. Nothing for tier 0 or on a server without rewards. */
  const jadeChip = (T: Title, un: boolean) => {
    const n = titleReward(T);
    if (!n || wallet.titlesOff) return null;
    const paid = wallet.titlesPaid.includes(T.id);
    return h(
      'span',
      { class: `ti-jade${paid ? ' paid' : un ? ' due' : ''}`, 'aria-label': paid ? t('titleJadePaid') : `+${n} ${t('jade')}` },
      paid ? '✓' : `+${n}`,
      h('span', { class: 'mini-coin', html: ICON.jade }),
    );
  };
  const renderTitles = () => {
    /** `near`: a row in the "Next up" strip, with a full-width bar under the text */
    const row = (T: Title, near = false) => {
      const un = isUnlocked(T);
      const on = p.profile.title === T.id;
      const { have, need } = T.count();
      const prog = h('span', { class: 'ti-prog' }, h('span', { class: 'ti-prog-fill', style: `transform:scaleX(${T.progress()})` }));
      const frac = h('span', { class: 'ti-frac' }, h('b', null, fmt(have)), `/${fmt(need)}`);
      const b = h(
        'button',
        { class: `ti ${un ? 'un' : 'lock'}${on ? ' on' : ''}${near ? ' near' : ''}`, 'data-t': String(T.tier), style: `--rc:${RARITIES[T.tier].color}` },
        h('span', { class: 'ti-seal' }, T.zh[0]),
        h(
          'span',
          { class: 'ti-text' },
          h('span', { class: 'ti-name' }, h('b', null, T.zh), ` ${T[i18n.lang]}`, jadeChip(T, un)),
          h('span', { class: 'ti-req' }, T.req[i18n.lang]),
          near ? h('span', { class: 'ti-near-bar' }, prog, frac) : null,
        ),
        on
          ? h('span', { class: 'ti-check', role: 'img', 'aria-label': t('equipped') }, '✓')
          : un
            ? h('span', { class: 'ti-state' }, tx('equip'))
            : near
              ? h('span', { class: 'ti-lock', html: ICON.lock })
              : h('span', { class: 'ti-side' }, frac, prog),
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
        const target = view === 'card' ? titleRib : boardStage;
        pop(target, 1.2);
        const c = center(target);
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
    const section = (zh: string, name: string, items: Title[], count?: string, near = false) =>
      h(
        'div',
        { class: `ti-fam${near ? ' ti-next' : ''}` },
        h('h4', { class: 'ti-fam-h' }, h('b', null, zh), ` ${name}`, count ? h('small', null, ` ${count}`) : null),
        ...items.map((T) => row(T, near)),
      );
    const fams = TITLE_FAMILIES.map((F) => {
      const all = TITLES.filter((T) => T.family === F.id);
      const shown = ownedOnly ? all.filter(isUnlocked) : all;
      return shown.length ? section(F.zh, F[i18n.lang], shown, `${all.filter(isUnlocked).length}/${all.length}`) : null;
    }).filter((x): x is HTMLDivElement => !!x);
    list.replaceChildren(...(next.length && !ownedOnly ? [section('近', t('titlesNextUp'), next, undefined, true)] : []), ...fams);
  };

  // ---- sets: each set's four members (equip in place) and the seal for completing it
  const setsList = h('div', { class: 'wd-sets' });
  const renderSets = () => {
    const sorted = SETS.map((x, i) => ({ x, i, r: setHave(x) / x.items.length }))
      .filter((o) => !ownedOnly || o.r === 1)
      .sort((a, b) => b.r - a.r || a.i - b.i);
    setsList.replaceChildren(
      ...sorted.map(({ x }) => {
        const bonus = itemById(x.bonus);
        const done = setDone(x);
        return h(
          'section',
          { class: `wd-set${done ? ' done' : ''}` },
          h('h4', { class: 'wd-set-h' }, h('b', null, x.zh), ` ${x[i18n.lang]}`, h('small', null, `${setHave(x)}/${x.items.length}`)),
          h('div', { class: 'wd-grid wd-set-grid' }, ...x.items.map((id) => itemById(id)).filter((it): it is Item => !!it).map((it) => tile(it, it.slot)), ...(bonus ? [tile(bonus, 'badge')] : [])),
          done ? null : h('p', { class: 'wd-note wd-set-note' }, t('wdSetBonus')),
        );
      }),
    );
  };

  // ---- body
  function renderBody(animate: boolean) {
    paintTabs();
    paintFilter();
    let kids: HTMLElement[];
    if (tab === 'title') {
      renderTitles();
      kids = [h('div', { class: 'wd-bar' }, filter), list];
    } else if (tab === 'set') {
      renderSets();
      kids = [h('div', { class: 'wd-bar' }, filter), setsList];
    } else {
      const slot: Slot = tab;
      const empty = Object.values(wallet.inventory).every((n) => !(n > 0));
      const shown = items(slot).filter((it) => !ownedOnly || wallet.owns(it.id));
      kids = [
        ...(empty ? [h('p', { class: 'wd-note wd-empty' }, t('wdEmpty'))] : []),
        h(
          'div',
          { class: 'wd-bar' },
          filter,
          slot === 'badge' ? h('p', { class: 'wd-note' }, t('wdBadgesWorn').replace('{n}', String(currentLook().badges?.length ?? 0)).replace('{max}', String(LOOK_MAX_BADGES))) : null,
        ),
        h('div', { class: 'wd-grid' }, ...(slot === 'badge' ? [] : [tile(null, slot)]), ...shown.map((it) => tile(it, slot))),
        ...(ownedOnly && !shown.length && !empty ? [h('p', { class: 'wd-note wd-empty' }, t('wdNoneOwned'))] : []),
      ];
    }
    body.replaceChildren(...kids);
    if (animate) gsap.from(tab === 'title' ? list.children : tab === 'set' ? setsList.children : body.querySelectorAll('.wd-tile'), { y: 14, opacity: 0, duration: 0.3, stagger: 0.015, ease: 'back.out(2)' });
  }

  // The preview shrinks to a slim bar once the list scrolls. It sits outside the scroller, so the list never jumps
  // under the finger when it changes size.
  const head = h('div', { class: 'wd-head' }, preview, tabs);
  const scroll = h('div', { class: 'pf-scroll wd-scroll' }, body);
  scroll.addEventListener(
    'scroll',
    () => {
      const y = scroll.scrollTop;
      if (y < 4 && preview.classList.contains('compact')) {
        preview.classList.remove('compact');
        body.style.paddingBottom = '';
      } else if (y > 24 && !preview.classList.contains('compact')) {
        // pad the list by what the card gives up, so the scroll range stays the same and a short list does not snap
        // back to the top (which would expand the card again)
        body.style.paddingBottom = `${preview.offsetHeight - COMPACT_H}px`;
        preview.classList.add('compact');
      }
    },
    { passive: true },
  );
  const el = h('div', { class: 'screen profile wardrobe' }, top, head, scroll);
  paintPreview();
  renderBody(false);
  const offLang = i18n.onChange(() => {
    paintPreview();
    renderBody(false);
  });
  // the inventory changed (a pull landed, the first fetch finished, items were marked seen): redraw from the cache
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
      leaveTab();
    },
    onKey(e) {
      if (e.key === 'Escape') back().then((sc) => app.go(() => sc));
    },
  };
}
