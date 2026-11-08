import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      include: ['src/lib/domain.ts', 'src/lib/content.ts', 'src/lib/contentstack.ts'],
      reporter: ['text', 'json-summary', 'html', 'lcov'],
      reportsDirectory: './coverage',
      thresholds: {
        statements: 80, lines: 80, functions: 80, branches: 80,
        'src/lib/domain.ts': { statements: 90, lines: 90, functions: 90, branches: 90 },
      },
    },
  },
});
