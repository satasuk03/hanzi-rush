/** Cloud-save modals: show the transfer code, redeem one on a new device, merge choice, delete account. */
import gsap from 'gsap';
import { h } from '../core/util';
import { t, tx, type Key } from '../core/i18n';
import { cloud } from '../core/cloud';
import { LIMITS, sanitizeName } from '../../shared/api';
import { ApiError } from '../core/api';
import { storage } from '../core/storage';
import { store } from '../core/store';
import { audio } from '../engine/audio';
import { pressable } from '../engine/juice';

const overlay = () => document.getElementById('overlay')!;

export function toast(msg: string) {
  const el = h('div', { class: 'toast' }, msg);
  overlay().append(el);
  gsap.timeline({ onComplete: () => el.remove() })
    .from(el, { y: 60, opacity: 0, duration: 0.4, ease: 'back.out(2)' })
    .to(el, { y: -20, opacity: 0, duration: 0.3, delay: 1.8 });
}

/** builds the modal shell; `close()` fades it out */
export function modal(...content: Node[]) {
  const card = h('div', { class: 'modal-card tf-card' }, ...content);
  const el = h('div', { class: 'modal' }, card);
  overlay().append(el);
  gsap.from(el, { opacity: 0, duration: 0.25 });
  gsap.from(card, { scale: 0.6, y: 60, duration: 0.6, ease: 'back.out(1.8)' });
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    gsap.to(el, { opacity: 0, duration: 0.2, onComplete: () => el.remove() });
  };
  return { el, card, close };
}

export const button = (label: Key, cls: string, onTap: () => void) => {
  const b = h('button', { class: `tf-btn ${cls}` }, tx(label));
  pressable(b, () => {
    audio.pop();
    onTap();
  });
  return b;
};

const failMsg = (e: unknown): Key => (e instanceof ApiError && e.status === 429 ? 'tooMany' : 'lbOffline');

/** warning + "sign out other devices" before a code is rotated. Resolves null on cancel. */
function askNewCode(): Promise<{ signOutOthers: boolean } | null> {
  return new Promise((resolve) => {
    const box = h('input', { type: 'checkbox' }) as HTMLInputElement;
    const m = modal(h('h2', { class: 'modal-title' }, tx('newCode')), h('p', { class: 'daily-hint' }, tx('newCodeWarn')), h('label', { class: 'tf-check' }, box, tx('signOutOthers')));
    m.card.append(
      button('newCode', 'red', () => (m.close(), resolve({ signOutOthers: box.checked }))),
      button('cancel', 'plain', () => (m.close(), resolve(null))),
    );
  });
}

/** big copyable XXXX-XXXX-XXXX with a "new code" link */
export function showTransferCode() {
  const code = h('div', { class: 'tf-code' }, '…');
  const msg = h('p', { class: 'tf-msg' });
  const m = modal(h('h2', { class: 'modal-title' }, tx('transferCode')), code, msg, h('p', { class: 'daily-hint' }, tx('transferHint')));
  let current = '';

  const show = (c: string) => {
    current = c;
    code.textContent = c;
  };
  const noCode = (...note: Node[]) => {
    current = '';
    code.textContent = '— — —';
    msg.replaceChildren(...note);
  };

  /** shows the current code, creating the very first one; never rotates an existing one */
  const load = async () => {
    msg.replaceChildren();
    code.textContent = '…';
    current = '';
    try {
      const r = await cloud.recoveryState();
      if (r.state === 'ok') show(r.code);
      else if (r.state === 'none') show(await cloud.newRecoveryCode());
      else noCode(tx(r.state === 'replaced' ? 'codeReplaced' : 'codeUnknown'));
    } catch (e) {
      noCode(tx(failMsg(e)));
    }
  };
  const copy = button('copy', 'green', async () => {
    if (!current) return load();
    try {
      await navigator.clipboard.writeText(current);
      toast(t('copied'));
    } catch {
      /* clipboard blocked: the code is on screen */
    }
  });
  const fresh = h('button', { class: 'tf-link' }, tx('newCode'));
  pressable(fresh, async () => {
    const pick = await askNewCode();
    if (!pick) return;
    msg.replaceChildren();
    code.textContent = '…';
    try {
      show(await cloud.newRecoveryCode(pick.signOutOthers));
    } catch (e) {
      noCode(tx(failMsg(e)));
    }
  });
  m.card.append(copy, fresh, button('close', 'plain', m.close));
  load();
}

/** asks how to treat this device's own progress when restoring over it */
export function askCombine(): Promise<'combine' | 'cloud' | 'cancel'> {
  return new Promise((resolve) => {
    const m = modal(h('h2', { class: 'modal-title' }, tx('restore')), h('p', { class: 'daily-hint' }, tx('restoreAsk')));
    m.card.append(
      button('restoreCombine', 'green', () => (m.close(), resolve('combine'))),
      button('restoreCloudOnly', 'plain', () => (m.close(), resolve('cloud'))),
      button('cancel', 'plain', () => (m.close(), resolve('cancel'))),
    );
  });
}

/** enter a transfer code from another device. `onDone` fires after a successful restore. */
export function showRestore(onDone: () => void) {
  const input = h('input', { class: 'tf-input', maxlength: '20', spellcheck: 'false', autocapitalize: 'characters', autocomplete: 'off', placeholder: 'XXXX-XXXX-XXXX', 'aria-label': t('transferCode') }) as HTMLInputElement;
  // typing shouldn't trigger screen shortcuts
  input.addEventListener('keydown', (e) => e.stopPropagation());
  const msg = h('p', { class: 'tf-msg' });
  const m = modal(h('h2', { class: 'modal-title' }, tx('restore')), h('p', { class: 'daily-hint' }, tx('restoreHint')), input, msg);
  let busy = false;
  const submit = async () => {
    if (busy) return;
    busy = true;
    msg.replaceChildren(tx('loading'));
    // the combine/cloud-only choice replaces this modal while it is open; Cancel brings the code entry back
    const choose = async () => {
      m.el.style.display = 'none';
      const c = await askCombine();
      if (c === 'cancel') m.el.style.display = '';
      return c;
    };
    const r = await cloud.recover(input.value, choose);
    busy = false;
    if (r !== 'ok') m.el.style.display = '';
    if (r === 'ok') {
      m.close();
      toast(t('restoreOk'));
      onDone();
    } else if (r === 'cancelled') {
      msg.replaceChildren();
      input.focus();
    }
    else msg.replaceChildren(tx(r === 'rate_limited' ? 'tooMany' : r === 'offline' ? 'lbOffline' : 'restoreBad'));
  };
  input.addEventListener('keydown', (e) => e.key === 'Enter' && submit());
  m.card.append(button('restore', 'green', submit), button('close', 'plain', m.close));
  setTimeout(() => input.focus(), 400);
}

/** confirm + delete the cloud account (local progress is kept). `onDone` fires on success. */
export function showDeleteAccount(onDone: () => void) {
  const msg = h('p', { class: 'tf-msg' });
  const m = modal(h('h2', { class: 'modal-title' }, tx('deleteAccount')), h('p', { class: 'daily-hint' }, tx('deleteWarn')), msg);
  let busy = false;
  m.card.append(
    button('deleteYes', 'red', async () => {
      if (busy) return;
      busy = true;
      try {
        await cloud.deleteAccount();
        m.close();
        toast(t('deleteDone'));
        onDone();
      } catch {
        msg.replaceChildren(tx('lbOffline'));
      }
      busy = false;
    }),
    button('close', 'plain', m.close),
  );
}

/** one-time "you were signed out" notice: reconnect with a code, or start over as a new cloud save */
export function showSignedOut(onRestoreDone: () => void) {
  cloud.markSignedOutSeen();
  const m = modal(h('h2', { class: 'modal-title' }, tx('signedOutTitle')), h('p', { class: 'daily-hint' }, tx('signedOutBody')));
  m.card.append(
    button('signedOutEnter', 'green', () => (m.close(), showRestore(onRestoreDone))),
    button('signedOutNew', 'plain', () => (m.close(), void cloud.enable())),
  );
}

const NAME_ASKED = 'hanzi-rush:name-asked:v1';
export const nameAsked = () => storage.get(NAME_ASKED) === '1';

/**
 * First time a run is ranked and the player has no name: offer to pick one. "Later" is final for the automatic
 * prompt (the profile screen still has the field). `onSaved` fires after a name was stored.
 */
export function showNamePrompt(onSaved: () => void) {
  if (nameAsked() || store.progress.profile.name) return;
  storage.set(NAME_ASKED, '1');
  const input = h('input', { class: 'tf-input tf-name', maxlength: String(LIMITS.nameMaxChars), spellcheck: 'false', autocomplete: 'off', 'aria-label': t('namePromptTitle') }) as HTMLInputElement;
  input.placeholder = t('playerName');
  // typing shouldn't trigger screen shortcuts (Enter/Space on the results screen)
  input.addEventListener('keydown', (e) => e.stopPropagation());
  const m = modal(h('h2', { class: 'modal-title' }, tx('namePromptTitle')), h('p', { class: 'daily-hint' }, tx('namePromptHint')), input);
  m.el.classList.add('name-prompt');
  const save = () => {
    const name = sanitizeName(input.value);
    if (!name) return input.focus();
    store.progress.profile.name = name;
    store.save();
    m.close();
    onSaved();
  };
  input.addEventListener('keydown', (e) => e.key === 'Enter' && save());
  m.card.append(button('nameSave', 'green', save), button('nameLater', 'plain', m.close));
  setTimeout(() => input.focus(), 400);
}
