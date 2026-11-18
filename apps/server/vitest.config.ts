import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // The integration tests start a local Worker (workerd) once per file.
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
