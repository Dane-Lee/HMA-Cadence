/**
 * A PLAN HANDED STRAIGHT FROM THE TRACKER (2026-10-07).
 *
 * Both now live in the suite and share its store, so the Tracker's "→ Cadence"
 * button puts the finished plan under this key and opens the Issue page, which
 * takes it from here -- no clipboard and no paste. Before, the specialist copied
 * it in the Tracker and pasted it twice: once to issue the codes, once to put the
 * employee on the roster.
 *
 * TAKEN, NOT READ: the key is emptied as it is picked up, so a reload of the
 * Issue page does not bring the same plan back. One page load takes it once,
 * however many times React asks (StrictMode runs effects twice in dev).
 *
 * The key name is a contract with the Tracker's index.html and with the suite's
 * allow-list in api_manual/app/main.py.
 */
import { makeSharedStorage } from './data/sharedStorage.js';

export const HANDOFF_KEY = 'hma-cadence-handoff';

export async function takeHandoff(storage = makeSharedStorage()) {
  const held = await storage.get(HANDOFF_KEY);
  if (!held?.value) return null;
  await storage.set(HANDOFF_KEY, '');
  try {
    return JSON.parse(held.value);
  } catch {
    return null;
  }
}

let taking = null;

/** `takeHandoff()`, once per page load. */
export function takeHandoffOnce() {
  taking ??= takeHandoff();
  return taking;
}
