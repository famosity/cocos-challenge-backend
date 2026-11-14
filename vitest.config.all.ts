import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    root: './',
    include: ['**/*.spec.ts', '**/*.e2e-spec.ts', 'test/**/*.integration-test.ts', 'test/database.db-test.ts'],
    fileParallelism: false,
    reporters: ['verbose'],
    coverage: {
      provider: 'v8',
      reporter: ['text'],
      include: ['src/**/*.ts'],
      exclude: ['**/*.spec.ts', 'src/main.ts', 'src/common/json-logger.ts'],
    },
  },
});
