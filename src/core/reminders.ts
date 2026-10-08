/**
 * Comeback reminders as on-device local notifications (native only, no push server).
 * The whole queue is rebuilt from the save every time the app goes to the background, so it always reflects the
 * latest claim: if the player keeps coming back, they only ever see tonight's nudge when they haven't claimed yet.
 * Permission is asked once, right after the first daily claim, when "come back tomorrow" makes sense.
 */
import { Capacitor } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';
import { store } from './store';
import { storage } from './storage';
import { t, type Key } from './i18n';
import { dailyStatus } from './meta';

const native = Capacitor.isNativePlatform();
const ASKED = 'hanzi-rush:notify-asked';
/** local hour the reminders fire at */
const HOUR = 19;
/** days from today that get a reminder if the player stays away: tonight, tomorrow, then tapering off */
const DAYS = [0, 1, 2, 4, 7];
const ID0 = 100;
const MISS: [Key, Key][] = [
  ['remindMiss1Title', 'remindMiss1Body'],
  ['remindMiss2Title', 'remindMiss2Body'],
  ['remindMiss3Title', 'remindMiss3Body'],
];

async function granted() {
  try {
    return (await LocalNotifications.checkPermissions()).display === 'granted';
  } catch {
    return false;
  }
}

/** what to say `k` days from now, assuming the player does not open the app before then */
function message(k: number, claimedToday: boolean, streak: number): [string, string] {
  // a streak survives until the end of the day after the last claim
  const alive = streak > 0 && k === (claimedToday ? 1 : 0);
  if (alive) return [t('remindStreakTitle').replace('{n}', String(streak)), t('remindStreakBody')];
  if (k <= 1) return [t('remindDailyTitle'), t('remindDailyBody')];
  const [a, b] = MISS[(k + store.progress.daily.total) % MISS.length];
  return [t(a), t(b)];
}

export const reminders = {
  /** cancels and reschedules the whole queue; a no-op on web or without permission */
  async sync() {
    if (!native || !(await granted())) return;
    try {
      await LocalNotifications.cancel({ notifications: DAYS.map((_, i) => ({ id: ID0 + i })) });
      const s = dailyStatus();
      const claimedToday = !s.claimable;
      const now = new Date();
      const notifications = DAYS.flatMap((k, i) => {
        const at = new Date(now.getFullYear(), now.getMonth(), now.getDate() + k, HOUR);
        // tonight only matters if today is still unclaimed and there is time left to act on it
        if (k === 0 && (claimedToday || at.getTime() - now.getTime() < 30 * 60_000)) return [];
        const [title, body] = message(k, claimedToday, s.streak);
        return [{ id: ID0 + i, title, body, schedule: { at, allowWhileIdle: true }, isExactNotification: false }];
      });
      if (notifications.length) await LocalNotifications.schedule({ notifications });
    } catch {
      /* reminders are best-effort */
    }
  },

  /** asks for permission once per install, then schedules */
  async askOnce() {
    if (!native || storage.get(ASKED)) return;
    storage.set(ASKED, '1');
    try {
      const p = await LocalNotifications.requestPermissions();
      if (p.display === 'granted') await reminders.sync();
    } catch {
      /* declined or unavailable */
    }
  },
};
