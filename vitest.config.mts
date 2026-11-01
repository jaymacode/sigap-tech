import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    include: ['tests/unit/**/*.test.ts', 'tests/integration/**/*.test.ts', 'tests/db/**/*.test.ts'],
    // Tes DB memakai satu database bersama (DROP/CREATE schema), jadi berjalan berurutan.
    fileParallelism: false,
    environment: 'node',
    coverage: {
      provider: 'v8',
      include: ['src/domain/**/*.ts', 'src/server/auth/rbac.ts'],
      thresholds: {
        lines: 90,
        branches: 90,
        functions: 90,
        statements: 90,
      },
    },
  },
});
