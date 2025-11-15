import { defineConfig } from 'vitest/config';

const integrationFiles = ['src/**/*.integration.test.ts'];

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    setupFiles: ['src/__tests__/setup.ts'],
    exclude: ['src/__tests__/testRunner.ts'],
    // Use projects to target unit/integration/e2e groups (Vitest v3)
    projects: [
      {
        test: {
          name: 'unit',
          include: ['src/**/*.{test,spec}.ts'],
          exclude: [
            'src/**/*.integration.test.ts',
            'src/**/*.e2e.test.ts',
            'src/server/__tests__/YNABMCPServer.test.ts',
          ],
        },
      },
      {
        test: {
          name: 'integration:core',
          include: integrationFiles,
          env: {
            INTEGRATION_TEST_TIER: 'core',
          },
          testTimeout: 30000,
          hookTimeout: 10000,
        },
      },
      {
        test: {
          name: 'integration:domain',
          include: integrationFiles,
          env: {
            INTEGRATION_TEST_TIER: 'domain',
          },
          testTimeout: 60000,
          hookTimeout: 15000,
        },
      },
      {
        test: {
          name: 'integration:full',
          include: integrationFiles,
          env: {
            INTEGRATION_TEST_TIER: 'full',
          },
          testTimeout: 120000,
          hookTimeout: 30000,
          fileParallelism: false,
          maxWorkers: 1,
        },
      },
      {
        test: {
          name: 'e2e',
          include: ['src/**/*.e2e.test.ts'],
        },
      },
    ],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.{test,spec}.ts',
        'src/**/*.d.ts',
        'src/index.ts', // Entry point excluded from coverage
        'src/__tests__/**/*.ts', // Test utilities excluded from coverage
      ],
      reporter: ['text', 'json', 'html'],
      reportsDirectory: './coverage',
      thresholds: {
        global: {
          branches: 80,
          functions: 80,
          lines: 80,
          statements: 80,
        },
      },
    },
    reporters: ['verbose', 'html', './vitest-reporters/split-json-reporter.ts'],
    outputFile: {
      html: './test-results/index.html',
    },
  },
  resolve: {
    alias: {
      '@': '/src',
    },
  },
});
