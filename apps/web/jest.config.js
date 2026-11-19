const nextJest = require('next/jest');

// next/jest reuses the app's own SWC transform, tsconfig paths and
// next.config.js, so components are compiled exactly like `next build`
// compiles them — no separate Babel config to drift out of sync.
const createJestConfig = nextJest({ dir: './' });

module.exports = createJestConfig({
  testEnvironment: 'jsdom',
  testMatch: ['<rootDir>/__tests__/**/*.test.{ts,tsx}'],
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
});
