/**
 * Test setup and configuration
 */

// Load environment variables from .env for integration tests
import 'dotenv/config';
import { beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { cacheManager } from '../server/cacheManager.js';

// Skip E2E tests by default unless explicitly enabled
const hasAccessToken = !!process.env['YNAB_ACCESS_TOKEN'];
if (!process.env['SKIP_E2E_TESTS']) {
  process.env['SKIP_E2E_TESTS'] = hasAccessToken ? 'false' : 'true';
}

type TierFilter = 'core' | 'domain' | 'full';
interface TestMeta {
  tier?: TierFilter;
  domain?: string;
}

const parseFilterList = (value: string | undefined) =>
  value
    ?.split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean) ?? [];

const tierFilters = parseFilterList(process.env['INTEGRATION_TEST_TIER'] ?? 'full') as TierFilter[];
const domainFilters = parseFilterList(process.env['INTEGRATION_TEST_DOMAINS']);

const shouldRunTier = (tier?: string): boolean => {
  if (!tier) return true;
  if (tierFilters.length === 0 || tierFilters.includes('full')) {
    return true;
  }
  return tierFilters.includes(tier.toLowerCase() as TierFilter);
};

const shouldRunDomain = (domain?: string): boolean => {
  if (!domain || domainFilters.length === 0) {
    return true;
  }
  return domainFilters.includes(domain.toLowerCase());
};

/**
 * Global test setup
 */
beforeAll(async () => {
  // Set test environment variables
  process.env['NODE_ENV'] = 'test';

  // Set default test token if not provided
  if (!process.env['YNAB_ACCESS_TOKEN']) {
    process.env['YNAB_ACCESS_TOKEN'] = 'test-token-for-mocked-tests';
  }

  // Disable console.error for cleaner test output (except for specific tests)
  if (!process.env['VERBOSE_TESTS']) {
    const originalConsoleError = console.error;
    console.error = (...args: any[]) => {
      // Only show errors that are part of test assertions
      if (args[0]?.includes?.('❌') || args[0]?.includes?.('Test')) {
        originalConsoleError(...args);
      }
    };
  }

  console.warn('🧪 Test environment initialized');
});

/**
 * Global test cleanup
 */
afterAll(async () => {
  // Clean up any global resources
  console.warn('🧹 Test environment cleaned up');
});

/**
 * Per-test setup
 */
beforeEach(async () => {
  // Reset environment for each test
  process.env['NODE_ENV'] = 'test';

  // Clear cache state between tests to prevent interference
  cacheManager.clear();

  // Clear any cached modules that might interfere (only if they exist)
  try {
    const modulePath = require.resolve('../server/YNABMCPServer.js');
    if (require.cache[modulePath]) {
      require.cache[modulePath] = undefined;
    }
  } catch {
    // Module doesn't exist yet, which is fine
  }
});

beforeEach((ctx) => {
  const meta = ctx.task.meta as TestMeta;

  if (!shouldRunTier(meta?.tier)) {
    ctx.skip();
    return;
  }

  if (!shouldRunDomain(meta?.domain)) {
    ctx.skip();
  }
});

/**
 * Per-test cleanup
 */
afterEach(async () => {
  // Clean up any test-specific resources
  // This is handled by individual test files
});

/**
 * Test utilities for environment management
 */
export class TestEnvironment {
  private originalEnv: Record<string, string | undefined> = {};
  private originalNodeEnv: string | undefined = undefined;

  /**
   * Set environment variables for a test
   */
  setEnv(vars: Record<string, string>): void {
    for (const [key, value] of Object.entries(vars)) {
      this.originalEnv[key] = process.env[key];
      process.env[key] = value;
    }
  }

  /**
   * Restore original environment variables
   */
  restoreEnv(): void {
    for (const [key, value] of Object.entries(this.originalEnv)) {
      if (value === undefined) {
        process.env[key] = undefined;
      } else {
        process.env[key] = value;
      }
    }
    this.originalEnv = {};

    // Restore original NODE_ENV if it was modified by cache methods
    if (this.originalNodeEnv !== undefined) {
      process.env['NODE_ENV'] = this.originalNodeEnv;
      this.originalNodeEnv = undefined;
    }
  }

  /**
   * Check if running in CI environment
   */
  isCI(): boolean {
    return !!(process.env['CI'] || process.env['GITHUB_ACTIONS'] || process.env['TRAVIS']);
  }

  /**
   * Check if E2E tests should be skipped
   */
  shouldSkipE2E(): boolean {
    return (
      process.env['SKIP_E2E_TESTS'] === 'true' || !process.env['YNAB_ACCESS_TOKEN'] || this.isCI()
    );
  }

  /**
   * Get test timeout based on environment
   */
  getTestTimeout(): number {
    if (this.isCI()) {
      return 60000; // 60 seconds in CI
    }
    return 30000; // 30 seconds locally
  }

  /**
   * Disable cache for testing by setting maxEntries to 0
   */
  disableCache(): void {
    // Store original NODE_ENV value if not already stored
    if (this.originalNodeEnv === undefined) {
      this.originalNodeEnv = process.env['NODE_ENV'];
    }
    // This would require access to CacheManager internals
    // For now, we rely on NODE_ENV=test to disable caching
    process.env['NODE_ENV'] = 'test';
  }

  /**
   * Enable cache for testing specific cache behavior
   */
  enableCache(): void {
    // Store original NODE_ENV value if not already stored
    if (this.originalNodeEnv === undefined) {
      this.originalNodeEnv = process.env['NODE_ENV'];
    }
    // Temporarily enable cache for specific tests
    process.env['NODE_ENV'] = 'development';
  }
}

/**
 * Mock console methods for testing
 */
export class MockConsole {
  private originalMethods: Record<string, (...args: any[]) => void> = {};
  private logs: { method: string; args: any[] }[] = [];

  /**
   * Start mocking console methods
   */
  mock(methods: string[] = ['log', 'error', 'warn', 'info']): void {
    for (const method of methods) {
      this.originalMethods[method] = (console as any)[method];
      (console as any)[method] = (...args: any[]) => {
        this.logs.push({ method, args });
      };
    }
  }

  /**
   * Restore original console methods
   */
  restore(): void {
    for (const [method, originalFn] of Object.entries(this.originalMethods)) {
      (console as any)[method] = originalFn;
    }
    this.originalMethods = {};
    this.logs = [];
  }

  /**
   * Get captured logs
   */
  getLogs(): { method: string; args: any[] }[] {
    return [...this.logs];
  }

  /**
   * Get logs for a specific method
   */
  getLogsFor(method: string): any[][] {
    return this.logs.filter((log) => log.method === method).map((log) => log.args);
  }

  /**
   * Check if a specific message was logged
   */
  hasLog(method: string, message: string): boolean {
    return this.logs.some(
      (log) =>
        log.method === method &&
        log.args.some((arg) => typeof arg === 'string' && arg.includes(message)),
    );
  }
}

/**
 * Test data factory
 */
export class TestDataFactory {
  /**
   * Create mock budget data
   */
  static createMockBudget(overrides: Partial<any> = {}): any {
    return {
      id: 'test-budget-id',
      name: 'Test Budget',
      last_modified_on: '2024-01-01T00:00:00Z',
      first_month: '2024-01-01',
      last_month: '2024-12-01',
      date_format: { format: 'MM/DD/YYYY' },
      currency_format: { iso_code: 'USD', example_format: '$123.45' },
      ...overrides,
    };
  }

  /**
   * Create mock account data
   */
  static createMockAccount(overrides: Partial<any> = {}): any {
    return {
      id: 'test-account-id',
      name: 'Test Account',
      type: 'checking',
      on_budget: true,
      closed: false,
      note: null,
      balance: 100000, // $100.00
      cleared_balance: 95000,
      uncleared_balance: 5000,
      ...overrides,
    };
  }

  /**
   * Create mock transaction data
   */
  static createMockTransaction(overrides: Partial<any> = {}): any {
    return {
      id: 'test-transaction-id',
      date: '2024-01-15',
      amount: -5000, // $5.00 outflow
      memo: 'Test transaction',
      cleared: 'cleared',
      approved: true,
      flag_color: null,
      account_id: 'test-account-id',
      payee_id: 'test-payee-id',
      category_id: 'test-category-id',
      transfer_account_id: null,
      ...overrides,
    };
  }

  /**
   * Create mock category data
   */
  static createMockCategory(overrides: Partial<any> = {}): any {
    return {
      id: 'test-category-id',
      category_group_id: 'test-group-id',
      name: 'Test Category',
      hidden: false,
      note: null,
      budgeted: 10000, // $10.00
      activity: -5000,
      balance: 5000,
      goal_type: null,
      ...overrides,
    };
  }

  /**
   * Create mock payee data
   */
  static createMockPayee(overrides: Partial<any> = {}): any {
    return {
      id: 'test-payee-id',
      name: 'Test Payee',
      transfer_account_id: null,
      ...overrides,
    };
  }

  /**
   * Create mock user data
   */
  static createMockUser(overrides: Partial<any> = {}): any {
    return {
      id: 'test-user-id',
      email: 'test@example.com',
      ...overrides,
    };
  }

  /**
   * Create mock cache statistics
   */
  static createMockCacheStats(overrides: Partial<any> = {}): any {
    return {
      hits: 10,
      misses: 5,
      hitRate: 0.67,
      entryCount: 15,
      maxEntries: 100,
      ttl: 300000,
      ...overrides,
    };
  }

  /**
   * Create mock cache entry structure
   */
  static createMockCacheEntry(key: string, value: any, overrides: Partial<any> = {}): any {
    return {
      key,
      value,
      createdAt: Date.now(),
      expiresAt: Date.now() + 300000,
      ttl: 300000,
      ...overrides,
    };
  }
}

/**
 * Performance measurement utilities
 */
export class PerformanceTracker {
  private measurements: Map<string, number> = new Map();

  /**
   * Start measuring performance
   */
  start(label: string): void {
    this.measurements.set(label, Date.now());
  }

  /**
   * End measurement and return duration
   */
  end(label: string): number {
    const startTime = this.measurements.get(label);
    if (!startTime) {
      throw new Error(`No measurement started for label: ${label}`);
    }

    const duration = Date.now() - startTime;
    this.measurements.delete(label);
    return duration;
  }

  /**
   * Measure a function execution
   */
  async measure<T>(label: string, fn: () => Promise<T>): Promise<{ result: T; duration: number }> {
    this.start(label);
    const result = await fn();
    const duration = this.end(label);
    return { result, duration };
  }

  /**
   * Assert performance threshold
   */
  assertDuration(duration: number, maxDuration: number, label?: string): void {
    if (duration > maxDuration) {
      throw new Error(
        `Performance assertion failed${label ? ` for ${label}` : ''}: ` +
          `${duration}ms > ${maxDuration}ms`,
      );
    }
  }
}

// Export singleton instances for convenience
export const testEnv = new TestEnvironment();
export const mockConsole = new MockConsole();
export const performanceTracker = new PerformanceTracker();
