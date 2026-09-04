import { defineConfig } from 'vitest/config';

// The data layer is framework-free (no DOM), so a Node environment plus a small
// localStorage shim (test/setup.js) is enough — lighter and faster than jsdom.
export default defineConfig({
  /* The app's JSX is transformed by @vitejs/plugin-react, which this config does
   * not load -- the data layer needed no React and the plugin costs startup on
   * every run. The automatic runtime is enough for the one component that is
   * tested here (the printed sheet), and avoids `React is not defined` without
   * pulling the plugin in. */
  esbuild: { jsx: 'automatic' },
  test: {
    environment: 'node',
    setupFiles: ['./test/setup.js'],
    include: ['test/**/*.test.js'],
  },
});
