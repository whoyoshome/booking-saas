import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Next's tsconfig uses "jsx": "preserve", so the React plugin is what
// compiles JSX for the tests. No path aliases are needed: the app uses
// relative imports.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    include: ['**/*.test.{ts,tsx}'],
    exclude: ['node_modules/**', '.next/**'],
  },
});
