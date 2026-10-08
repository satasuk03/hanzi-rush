/**
 * Profile "Sign-in options": link Google / Apple / Play Games to the cloud account, or sign this device into the
 * account a provider is already linked to (cloud.signIn). Providers come from src/core/signin.ts.
 */
import { h } from '../core/util';
import { t, tx, type Key } from '../core/i18n';
import { cloud } from '../core/cloud';
import { getCredential, signInProviders, SignInCancelled } from '../core/signin';
import type { SignInProvider } from '../../shared/api';
import { audio } from '../engine/audio';
import { pressable } from '../engine/juice';
import { askCombine, button, modal, toast } from './transfer';

const LOGO: Record<SignInProvider, string> = {
  google:
    '<svg viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>',
  apple:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12.152 6.896c-.948 0-2.415-1.078-3.96-1.04-2.04.027-3.91 1.183-4.961 3.014-2.117 3.675-.546 9.103 1.519 12.09 1.013 1.454 2.208 3.09 3.792 3.039 1.52-.065 2.09-.987 3.935-.987 1.831 0 2.35.987 3.96.948 1.637-.026 2.676-1.48 3.676-2.948 1.156-1.688 1.636-3.325 1.662-3.415-.039-.013-3.182-1.221-3.22-4.857-.026-3.04 2.48-4.494 2.597-4.559-1.429-2.09-3.623-2.324-4.39-2.376-2-.156-3.675 1.09-4.61 1.09zM15.53 3.83c.843-1.012 1.4-2.427 1.245-3.83-1.207.052-2.662.805-3.532 1.818-.78.896-1.454 2.338-1.273 3.714 1.338.104 2.715-.688 3.559-1.701"/></svg>',
  play_games:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M7 7h10a5 5 0 0 1 4.9 6l-.8 3.9a2.6 2.6 0 0 1-4.4 1.3L14.4 16H9.6l-2.3 2.2a2.6 2.6 0 0 1-4.4-1.3L2.1 13A5 5 0 0 1 7 7zm0 3v1.5H5.5v1.5H7v1.5h1.5V13H10v-1.5H8.5V10H7zm9.3.2a1 1 0 1 0 0 2 1 1 0 0 0 0-2zm-2 2a1 1 0 1 0 0 2 1 1 0 0 0 0-2z"/></svg>',
};
const LABEL: Record<SignInProvider, Key> = { google: 'signInGoogle', apple: 'signInApple', play_games: 'signInPlayGames' };

function confirmUnlink(): Promise<boolean> {
  return new Promise((resolve) => {
    const m = modal(h('h2', { class: 'modal-title' }, tx('unlinkTitle')), h('p', { class: 'daily-hint' }, tx('unlinkWarn')));
    m.card.append(button('signInUnlink', 'red', () => (m.close(), resolve(true))), button('cancel', 'plain', () => (m.close(), resolve(false))));
  });
}

/** `head` + the section, hidden until a provider is available here. `onSwitched` = this device changed account. */
export function signInSection(head: Node, onSwitched: () => void) {
  const rows = h('div', { class: 'si-rows' });
  const msg = h('p', { class: 'si-msg' });
  const box = h('div', { class: 'si' }, h('p', { class: 'si-hint' }, tx('signInHint')), rows, msg);
  const el = h('div', { class: 'si-wrap', hidden: '' }, head, box);
  let providers: SignInProvider[] = [];
  let linked = new Set<SignInProvider>();
  let busy = false;

  const say = (k: Key | null) => msg.replaceChildren(...(k ? [tx(k)] : []));

  const start = async (p: SignInProvider) => {
    if (busy) return;
    busy = true;
    say(null);
    try {
      const credential = await getCredential(p);
      say('loading');
      const r = await cloud.signIn(p, credential, askCombine);
      say(null);
      if (r === 'linked') {
        linked.add(p);
        toast(t('signInLinkedOk'));
        render();
      } else if (r === 'ok') {
        toast(t('restoreOk'));
        onSwitched();
      } else if (r !== 'cancelled') {
        say(r === 'notLinked' ? 'signInNotLinked' : r === 'conflict' ? 'signInConflict' : r === 'rate_limited' ? 'tooMany' : r === 'offline' ? 'lbOffline' : 'signInFailed');
      }
    } catch (e) {
      if (e instanceof SignInCancelled) say(null);
      else {
        console.warn('[signin]', p, e);
        say('signInFailed');
      }
    }
    busy = false;
  };

  const unlink = async (p: SignInProvider) => {
    if (busy || !(await confirmUnlink())) return;
    busy = true;
    try {
      await cloud.unlink(p);
      linked.delete(p);
      render();
    } catch {
      say('lbOffline');
    }
    busy = false;
  };

  const render = () => {
    rows.replaceChildren(
      ...providers.map((p) => {
        const logo = h('span', { class: 'si-logo', html: LOGO[p] });
        if (linked.has(p)) {
          const off = h('button', { class: 'si-unlink' }, tx('signInUnlink'));
          pressable(off, () => (audio.pop(1.1), void unlink(p)));
          return h('div', { class: `si-row si-${p} on` }, logo, h('span', { class: 'si-name' }, tx(LABEL[p])), h('span', { class: 'si-ok' }, '✓ ', tx('signInLinked')), off);
        }
        const b = h('button', { class: `si-btn si-${p}` }, logo, tx(LABEL[p]));
        pressable(b, () => (audio.pop(1.1), void start(p)));
        return b;
      }),
    );
    el.hidden = !providers.length;
  };

  /** re-reads the available providers and the linked ones (GET /me) */
  const refresh = async () => {
    providers = await signInProviders();
    linked = new Set(await cloud.identities() ?? []);
    render();
  };
  void refresh();
  return { el, refresh };
}
