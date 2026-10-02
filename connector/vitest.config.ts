import { defineConfig } from 'vitest/config';

// The end-to-end suite boots the real engine (engine/dist) and plays over HTTP, so it needs
// a longer budget than the unit tests. Nothing here narrows WHICH tests run.
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    pool: 'forks',
  },
});
