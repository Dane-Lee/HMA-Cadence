import { useState } from 'react';
import { useAuth } from '../lib/auth.jsx';
import {
  notificationSupported,
  notificationPermission,
  requestNotificationPermission,
  showReminderNow,
} from '../lib/reminders.js';

/**
 * Employee reminder settings: turn the daily nudge on/off, pick a time, and
 * grant browser notification permission. Reminders fire while the app is open;
 * background push waits on the sanctioned backend (see reminders.js).
 */
export default function EmployeeSettings() {
  const { employee, updateNotificationPrefs } = useAuth();
  const [enabled, setEnabled] = useState(employee?.notification_enabled ?? true);
  const [time, setTime] = useState(employee?.notification_time ?? '07:00');
  const [perm, setPerm] = useState(notificationPermission());
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState(null);
  const [error, setError] = useState(null);

  const supported = notificationSupported();
  const firstName = employee?.name?.split(' ')[0] ?? '';

  async function onEnableToggle(next) {
    setEnabled(next);
    if (next && perm === 'default') {
      const result = await requestNotificationPermission();
      setPerm(result);
    }
  }

  async function onSave() {
    setSaving(true);
    setError(null);
    setStatus(null);
    try {
      if (enabled && perm === 'default') {
        setPerm(await requestNotificationPermission());
      }
      await updateNotificationPrefs({ notification_enabled: enabled, notification_time: time });
      setStatus('Saved.');
      setTimeout(() => setStatus(null), 2000);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  function onTest() {
    const ok = showReminderNow(
      'Test reminder',
      `${firstName ? firstName + ', this' : 'This'} is what your daily nudge looks like.`,
    );
    setStatus(ok ? 'Sent a test notification.' : 'Enable notifications first.');
    setTimeout(() => setStatus(null), 2500);
  }

  return (
    <>
      <h1 className="page-title">Reminders</h1>
      <p className="page-subtitle">A daily nudge to do your exercises.</p>

      <div className="settings-card">
        <label className="settings-row">
          <div>
            <div className="settings-row__label">Daily reminder</div>
            <div className="muted" style={{ fontSize: '.85rem' }}>
              Get a notification to complete your program.
            </div>
          </div>
          <input
            type="checkbox"
            className="switch"
            checked={enabled}
            onChange={(e) => onEnableToggle(e.target.checked)}
          />
        </label>

        <div className="settings-row">
          <div>
            <div className="settings-row__label">Reminder time</div>
            <div className="muted" style={{ fontSize: '.85rem' }}>When to nudge you each day.</div>
          </div>
          <input
            type="time"
            className="input input--time"
            value={time}
            onChange={(e) => setTime(e.target.value)}
            disabled={!enabled}
          />
        </div>
      </div>

      {!supported && (
        <p className="muted" style={{ marginTop: 14, fontSize: '.85rem' }}>
          This device doesn&rsquo;t support notifications, but your preference is still saved.
        </p>
      )}
      {supported && perm === 'denied' && (
        <p className="muted" style={{ marginTop: 14, fontSize: '.85rem' }}>
          Notifications are blocked in your browser settings. Re-enable them there to get reminders.
        </p>
      )}
      {supported && (
        <p className="muted" style={{ marginTop: 14, fontSize: '.8rem' }}>
          Reminders arrive while the app is open. (Always-on background reminders are coming soon.)
        </p>
      )}

      {error && <div className="login-error" style={{ marginTop: 16 }}>{error}</div>}
      {status && <div className="settings-status">{status}</div>}

      <div className="spacer-md" />
      <button className="btn" onClick={onSave} disabled={saving}>
        {saving ? 'Saving…' : 'Save'}
      </button>
      <div className="spacer-sm" />
      <button className="btn btn-secondary" onClick={onTest} disabled={perm !== 'granted'}>
        Send a test reminder
      </button>
    </>
  );
}
