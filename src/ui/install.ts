/** Daily "add to home screen" modal: one Install button where the browser allows it, numbered steps everywhere else. */
import { h } from '../core/util';
import { tx, type Key } from '../core/i18n';
import { pwa, type InstallPath } from '../core/pwa';
import { modal, button } from './transfer';

const SHARE = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12M7.5 7.5 12 3l4.5 4.5"/><path d="M6 11H5v10h14V11h-1"/></svg>';

const STEPS: Partial<Record<InstallPath, Key[]>> = {
  ios: ['pwaIos1', 'pwaIos2', 'pwaIos3'],
  android: ['pwaAndroid1', 'pwaAndroid2', 'pwaAndroid3'],
  inApp: ['pwaInApp1', 'pwaInApp2', 'pwaInApp3'],
};

const steps = (path: InstallPath) =>
  h(
    'ol',
    { class: 'pwa-steps' },
    ...(STEPS[path] ?? []).map((k, i) => h('li', {}, h('b', { class: 'pwa-n' }, String(i + 1)), tx(k), path === 'ios' && i === 0 ? h('span', { class: 'pwa-share', html: SHARE }) : null)),
  );

/** shows the offer when it is due today; returns whether it showed */
export function maybeOfferInstall() {
  if (!pwa.due()) return false;
  pwa.markOffered();

  const icon = h('img', { class: 'pwa-icon', src: '/icons/icon-192.png', alt: '' });
  const body = h('div', { class: 'pwa-body' });
  const m = modal(icon, h('h2', { class: 'modal-title' }, tx('pwaTitle')), h('p', { class: 'daily-hint' }, tx('pwaPitch')), body);
  m.card.classList.add('pwa-card');

  const close = () => (off(), m.close());
  const render = () => {
    const path = pwa.path();
    if (path === 'prompt') {
      body.replaceChildren(
        button('pwaInstall', 'green', () => {
          close();
          void pwa.prompt();
        }),
        button('pwaLater', 'plain', close),
      );
    } else {
      body.replaceChildren(steps(path), ...(path === 'ios' ? [h('p', { class: 'pwa-note' }, tx('pwaIosSave'))] : []), button('pwaGotIt', 'plain', close));
    }
  };
  render();
  const off = pwa.onPrompt(render);
  return true;
}
