/**
 * Minimal in-memory localStorage for the Node test environment.
 *
 * The local adapter persists its store to localStorage; this shim gives it a
 * working backing map so the adapter can be exercised without a browser. Runs
 * (via setupFiles) before any test module imports the adapter, so the global is
 * in place by the time the adapter's module-load seed runs.
 */
class MemoryStorage {
  #map = new Map();
  getItem(key) { return this.#map.has(key) ? this.#map.get(key) : null; }
  setItem(key, value) { this.#map.set(key, String(value)); }
  removeItem(key) { this.#map.delete(key); }
  clear() { this.#map.clear(); }
}

globalThis.localStorage = new MemoryStorage();
