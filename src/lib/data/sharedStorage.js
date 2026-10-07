/**
 * The suite's shared storage adapter -- the SAME block the Tracker and the
 * Overlay carry, byte for byte, between the markers below.
 *
 * Cadence-Admin moved inside the suite on 2026-10-07 (owner: "Yes, move
 * Cadence-Admin inside the suite"), so its data now lives in the suite's store
 * like theirs does, and it reaches that store the same way. Copied rather than
 * shared because the other two are single HTML files that cannot import
 * anything; the copies are pinned identical by the suite's
 * `HMA-Manual/api_manual/tests/test_shared_adapter.py`, so a change made here
 * alone fails there. Change all three together, and bump the version.
 *
 * What the block promises, all of it tested in the Tracker's
 * `tests/storage-adapter.test.mjs`: it asks the store only from a page this
 * machine served; a lapsed sign-in marks the change unsent and goes to sign-in;
 * the first read afterwards sends it before anything else.
 *
 * Only the ADMIN build imports this. The employee's app never talks to the
 * suite, and `test/clientBuild.test.js` asserts the store's path is absent
 * from the client bundle.
 */
/* ==== HMA-SHARED-STORAGE-ADAPTER v4 -- keep identical across apps ==== */
function makeSharedStorage() {
  var API = '/api/local-store/';
  var seeded = {};
  var warned = false;

  /* v2, 2026-10-06: THE STORE IS ONLY EVER ASKED FROM A PAGE THIS MACHINE
     SERVED. `API` is a relative path, so it resolves against wherever the page
     came from -- and the Tracker also deploys to Vercel, where it resolved to
     Vercel's own servers. Every save there PUT the whole record set to Vercel,
     and every page load seeded each stored key the same way. Vercel refused
     them, but by then they had been sent. The Manual's server binds loopback
     and its store refuses anything else, so this applies the same rule from
     this side: anywhere else gets this browser's storage and no request. */
  var onThisMachine = false;
  try {
    onThisMachine =
      (location.protocol === 'http:' || location.protocol === 'https:') &&
      /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
  } catch (e) {}
  /* v3, same day: the offline bar keeps the timing it had in v1, now that the
     requests that used to raise it are gone. From a file the request failed
     outright, so the bar appeared on opening; on Vercel the GET came back a
     plain 404, so only a failed SAVE raised it. Anyone just looking at the
     Vercel copy -- the owner's manager shows it to people -- never saw it.
     v2 showed it on opening everywhere; this puts it back. */
  var fromDisk = false;
  try { fromDisk = location.protocol === 'file:'; } catch (e) {}

  /* v4, 2026-10-06: THE STORE IS BEHIND THE SUITE'S SIGN-IN. Served by the
     suite these pages carry its cookie, so nothing changes while it lasts.
     A sign-in runs 12 hours from signing in, so a page left open overnight
     meets a 401 on its next save. That change is already in this browser's
     storage, so the key is marked UNSENT and the page goes to sign-in; the
     first read after signing back in sends the browser's copy before asking
     for the stored one. Otherwise the older stored copy would win the reload
     and the change would be gone without a word. A save that fails because
     the server stopped is marked the same way, which ends the same quiet loss
     there: until v4 an offline change survived only if the page stayed open
     until something was saved again. */
  var UNSENT = 'hma-unsent:';

  function put(key, value) {
    return fetch(API + encodeURIComponent(key), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: value })
    });
  }

  function signIn() {
    try {
      var path = location.pathname;
      while (path.length > 1 && path.charAt(path.length - 1) === '/') path = path.slice(0, -1);
      location.href = '/?next=' + encodeURIComponent(path);
    } catch (e) {}
  }

  function localGet(key) {
    try {
      var val = localStorage.getItem(key);
      return val !== null ? { value: val } : null;
    } catch (e) { return null; }
  }

  function localSet(key, value) {
    try { localStorage.setItem(key, value); } catch (e) {}
  }

  function localRemove(key) {
    try { localStorage.removeItem(key); } catch (e) {}
  }

  function goOffline() {
    if (warned) return;
    warned = true;
    console.warn(
      '[HMA] Shared local store unreachable -- using this browser\'s storage. ' +
      'Changes saved now are not visible to the other app until the ' +
      'HMA-Manual server is running and they are saved again.'
    );
    try {
      var bar = document.createElement('div');
      bar.textContent =
        'Offline: saving to this browser only. Start the HMA-Manual server to share records.';
      bar.style.cssText =
        'position:fixed;bottom:0;left:0;right:0;z-index:99999;padding:6px 12px;' +
        'background:#8a6d3b;color:#fff;font:13px system-ui,sans-serif;text-align:center';
      if (document.body) document.body.appendChild(bar);
    } catch (e) {}
  }

  return {
    get: function (key) {
      if (!onThisMachine) {
        if (fromDisk) goOffline();
        return Promise.resolve(localGet(key));
      }
      var unsent = localGet(UNSENT + key) ? localGet(key) : null;
      if (unsent) {
        return put(key, unsent.value)
          .then(function (res) {
            if (res.status === 401) { signIn(); return unsent; }
            if (!res.ok) throw new Error('local-store PUT ' + res.status);
            localRemove(UNSENT + key);
            return unsent;
          })
          .catch(function () {
            goOffline();
            return unsent;
          });
      }
      return fetch(API + encodeURIComponent(key), { headers: { 'Accept': 'application/json' } })
        .then(function (res) {
          if (res.status === 401) {
            signIn();
            return localGet(key);
          }
          if (res.status === 404) {
            var local = localGet(key);
            if (local && !seeded[key]) {
              seeded[key] = true;
              return put(key, local.value).then(function () { return local; }, function () { return local; });
            }
            return null;
          }
          if (!res.ok) throw new Error('local-store GET ' + res.status);
          return res.json().then(function (body) { return { value: body.value }; });
        })
        .catch(function () {
          goOffline();
          return localGet(key);
        });
    },

    set: function (key, value) {
      localSet(key, value);
      if (!onThisMachine) {
        goOffline();
        return Promise.resolve();
      }
      return put(key, value).then(function (res) {
        if (res.status === 401) {
          localSet(UNSENT + key, '1');
          signIn();
          return;
        }
        if (!res.ok) throw new Error('local-store PUT ' + res.status);
        localRemove(UNSENT + key);
      }).catch(function () {
        localSet(UNSENT + key, '1');
        goOffline();
      });
    }
  };
}
/* ==== END HMA-SHARED-STORAGE-ADAPTER ==== */

export { makeSharedStorage };
