/**
 * Client-side daily reminders.
 *
 * Uses the Web Notifications API to nudge an employee at their chosen time.
 * This fires only while the PWA is open (a foreground timer) — true background
 * push needs a push service (VAPID keys + a server endpoint), which is deferred
 * to the ATI-sanctioned backend. No PHI is involved: the reminder text is a
 * generic nudge, never exercise or health detail.
 */
import { useEffect } from 'react';

const LAST_FIRED_KEY = 'hma-cadence:last-reminder';

export function notificationSupported() {
  return typeof window !== 'undefined' && 'Notification' in window;
}

export function notificationPermission() {
  return notificationSupported() ? Notification.permission : 'unsupported';
}

/** Ask for permission if needed. Returns the resulting permission string. */
export async function requestNotificationPermission() {
  if (!notificationSupported()) return 'unsupported';
  if (Notification.permission !== 'default') return Notification.permission;
  try {
    return await Notification.requestPermission();
  } catch {
    return Notification.permission;
  }
}

/** Show a reminder immediately (used by the scheduler and the "test" button). */
export function showReminderNow(title, body) {
  if (!notificationSupported() || Notification.permission !== 'granted') return false;
  try {
    new Notification(title, { body, tag: 'hma-cadence-reminder', renotify: true });
    return true;
  } catch {
    return false;
  }
}

/** Milliseconds from `now` until the next occurrence of "HH:MM". */
export function msUntilNext(timeStr, now = new Date()) {
  const [h, m] = (timeStr ?? '07:00').split(':').map(Number);
  const next = new Date(now);
  next.setHours(Number.isFinite(h) ? h : 7, Number.isFinite(m) ? m : 0, 0, 0);
  if (next.getTime() <= now.getTime()) next.setDate(next.getDate() + 1);
  return next.getTime() - now.getTime();
}

/**
 * Schedule a once-per-day foreground reminder at `time` while mounted.
 * De-duplicated via a per-day localStorage marker so reopening the app after
 * the scheduled time doesn't re-fire the same day.
 */
export function useDailyReminder({ enabled, time, firstName }) {
  useEffect(() => {
    if (!enabled || notificationPermission() !== 'granted') return undefined;

    let timer;
    const schedule = () => {
      timer = setTimeout(() => {
        const todayStr = new Date().toISOString().slice(0, 10);
        let alreadyFired = false;
        try { alreadyFired = localStorage.getItem(LAST_FIRED_KEY) === todayStr; } catch { /* ignore */ }
        if (!alreadyFired) {
          showReminderNow(
            'Time for your exercises',
            `${firstName ? firstName + ', a' : 'A'} few minutes now keeps you on track.`,
          );
          try { localStorage.setItem(LAST_FIRED_KEY, todayStr); } catch { /* ignore */ }
        }
        schedule(); // arm tomorrow
      }, msUntilNext(time));
    };

    schedule();
    return () => clearTimeout(timer);
  }, [enabled, time, firstName]);
}
