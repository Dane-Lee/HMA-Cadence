/**
 * CADENCE-ADMIN KEEPS ITS DATA IN THE SUITE.
 *
 * The owner, 2026-10-07: "Yes, move Cadence-Admin inside the suite". Before
 * this, everything the admin build held -- the roster, the plan keys it issued,
 * the reports it opened, the pain queue -- sat in one localStorage key on its own
 * origin, where the suite could not read it and no backup reached it. The suite
 * now serves this build at /cadence, behind its sign-in, and this module moves
 * that same key into the suite's store before anything renders.
 *
 * Same name in both places, `hma-cadence:local-db`. The shared adapter keeps a
 * copy in this browser as its fallback under that name, which is exactly what
 * `localAdapter.js` reads at import -- so the two never disagree about where
 * "this browser's copy" is.
 *
 * Imported only by the admin build (main.jsx, behind `__ADMIN_BUILD__`).
 */
import { makeSharedStorage } from './sharedStorage.js';
import { adoptStore, STORAGE_KEY } from './adapters/localAdapter.js';

/** The mark the shared adapter keeps while a key's newest value is unsent. */
const UNSENT = 'hma-unsent:';

function markUnsent(key) {
  try {
    localStorage.setItem(UNSENT + key, '1');
  } catch {
    /* storage blocked: the network write still goes */
  }
}

/**
 * Saves that cannot overtake each other.
 *
 * The adapter writes the WHOLE store on every change, and pasting a batch of
 * reports changes it several times in a row. Fired independently those writes
 * race, and the last to ARRIVE wins -- which can be an older store than the
 * last one sent. So one write is in flight at a time and only the newest waiting
 * value follows it.
 *
 * Marked unsent the moment it is queued, and again as each send starts (the
 * shared adapter clears the mark when the store takes a write, which would
 * otherwise leave a still-waiting value unmarked). A page closed with a write
 * pending therefore sends it on the next load, before reading anything.
 */
export function makeSaver(storage, key = STORAGE_KEY) {
  let inFlight = null;
  let waiting = null;

  const flush = () => {
    if (waiting === null) {
      inFlight = null;
      return;
    }
    const body = waiting;
    waiting = null;
    markUnsent(key);
    inFlight = Promise.resolve(storage.set(key, body)).finally(flush);
  };

  const save = (next) => {
    waiting = JSON.stringify(next);
    try {
      localStorage.setItem(key, waiting);
    } catch {
      /* storage blocked: the network write still goes */
    }
    markUnsent(key);
    if (!inFlight) flush();
  };

  /** Resolves once nothing is waiting or in flight. For tests. */
  save.settled = async () => {
    while (inFlight) await inFlight;
  };

  return save;
}

/** Read the suite's copy and hand it to the adapter. Awaited before the first render. */
export async function hydrateFromSuite(storage = makeSharedStorage()) {
  const held = await storage.get(STORAGE_KEY);
  let db = null;
  if (held?.value) {
    try {
      db = JSON.parse(held.value);
    } catch {
      db = null;
    }
  }
  adoptStore(db, makeSaver(storage));
}
