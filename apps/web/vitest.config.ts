import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Next's tsconfig uses "jsx": "preserve", so the React plugin is what
// compiles JSX for the tests. No path aliases are needed: the app uses
// relative imports.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    // Node 25+ has a global `localStorage` of its own (Web Storage, which is
    // undefined without --localstorage-file) and it hides jsdom's, so every
    // component reading window.localStorage broke. Turn Node's off in the
    // test workers so jsdom's applies, as in a browser.
    execArgv: ['--no-experimental-webstorage'],
    setupFiles: ['./vitest.setup.ts'],
    include: ['**/*.test.{ts,tsx}'],
    exclude: ['node_modules/**', '.next/**'],
  },
});
