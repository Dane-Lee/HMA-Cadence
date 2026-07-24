import { defineConfig } from 'vitest/config';

// The data layer is framework-free (no DOM), so a Node environment plus a small
// localStorage shim (test/setup.js) is enough — lighter and faster than jsdom.
export default defineConfig({
  test: {
    environment: 'node',
    setupFiles: ['./test/setup.js'],
    include: ['test/**/*.test.js'],
  },
});
