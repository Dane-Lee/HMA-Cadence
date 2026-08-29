import { useCallback, useEffect, useState } from 'react';

import { db } from '../lib/data/index.js';
import { prepareReturn, sendReturn } from '../lib/return/sendReturn.js';

/**
 * "Send your progress to Dane" — the employee's end of the return channel.
 *
 * Deliberately quiet. This is the only part of the app that asks the employee
 * to do something for someone else's benefit, and a card that nags on a day
 * they have nothing to report is a card they learn to scroll past.
 *
 * `refreshKey` changes whenever the parent records activity, so the card
 * re-reads rather than going stale behind a completed exercise.
 */
export default function ReturnReportCard({ employeeId, refreshKey, autoPrompt, onDismissPrompt }) {
  const [state, setState] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [justSent, setJustSent] = useState(false);

  const load = useCallback(async () => {
    if (!employeeId) return;
    try {
      setState(await prepareReturn({ employeeId, db }));
    } catch (err) {
      setError(err.message);
    }
  }, [employeeId]);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  async function onSend() {
    setBusy(true);
    setError(null);
    try {
      const result = await sendReturn({
        employeeId,
        db,
        // Not window.open: a popup blocker eats that on a phone, and a mailto
        // navigation does not actually leave the page.
        openUrl: (url) => {
          window.location.href = url;
        },
      });
      if (!result.ok) {
        setError(
          result.reason === 'unpaired'
            ? 'This phone is not paired yet — scan the QR on your sheet first.'
            : 'There is nothing to report yet.',
        );
      } else {
        setJustSent(true);
        onDismissPrompt?.();
      }
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (!state) return null;

  // No address in this build: sending is impossible, so say so rather than
  // offering a button that opens an unaddressed email. Same call the Tracker
  // made showing "→ Cadence" disabled instead of hiding it — an employee who
  // cannot report should know that is a setup gap, not something they did.
  if (state.status === 'unconfigured') {
    return (
      <div className="card report-card">
        <div className="report-card__title">Progress reports aren’t set up yet</div>
        <p className="muted report-card__body">
          Your exercises are still being saved on this phone. Ask Dane to finish setting up
          reporting — nothing you have done will be lost.
        </p>
      </div>
    );
  }

  if (state.status === 'empty') return null;

  if (state.status === 'sent' && !justSent) {
    return (
      <div className="card report-card">
        <div className="muted report-card__body">
          Progress sent{state.sentAt ? ` ${relativeDay(state.sentAt)}` : ''}. Nothing new to
          report yet.
        </div>
      </div>
    );
  }

  return (
    <div className={`card report-card${autoPrompt ? ' report-card--prompt' : ''}`}>
      <div className="report-card__title">
        {justSent ? 'Report ready to send ✓' : autoPrompt ? 'Send that to Dane now?' : 'Send your progress'}
      </div>
      <p className="muted report-card__body">
        {justSent
          ? 'Your email app should have opened. Press send there to finish — nothing leaves this phone until you do.'
          : 'This puts your exercise history into an email for Dane. Nothing is sent until you press send in your email app.'}
      </p>
      {!justSent && (
        <div className="report-card__actions">
          <button className="btn" onClick={onSend} disabled={busy}>
            {busy ? 'Preparing…' : 'Send report'}
          </button>
          {autoPrompt && (
            <button className="btn-ghost btn-inline" onClick={onDismissPrompt} disabled={busy}>
              Later
            </button>
          )}
        </div>
      )}
      {error && <div className="login-error report-card__body">{error}</div>}
    </div>
  );
}

function relativeDay(iso) {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  return `${days} days ago`;
}
