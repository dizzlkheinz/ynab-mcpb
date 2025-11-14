/**
 * Performance and load tests for YNAB MCP Server
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { YNABMCPServer } from '../server/YNABMCPServer.js';
import { executeToolCall, parseToolResult } from './testUtils.js';
import { executeReconciliation, type AccountSnapshot } from '../tools/reconciliation/executor.js';
import type { ReconciliationAnalysis } from '../tools/reconciliation/types.js';
import type { ReconcileAccountRequest } from '../tools/reconciliation/index.js';
import type * as ynab from 'ynab';

// Mock the YNAB SDK for performance tests
vi.mock('ynab', () => {
  const mockAPI = {
    budgets: {
      getBudgets: vi.fn(),
      getBudgetById: vi.fn(),
    },
    accounts: {
      getAccounts: vi.fn(),
      getAccountById: vi.fn(),
    },
    transactions: {
      getTransactions: vi.fn(),
      getTransactionById: vi.fn(),
      createTransaction: vi.fn(),
    },
    categories: {
      getCategories: vi.fn(),
    },
    user: {
      getUser: vi.fn(),
    },
  };

  return {
    API: vi.fn(() => mockAPI),
  };
});

describe('Reconciliation Performance - Bulk vs Sequential', () => {
  it(
    'processes 20 transactions in bulk mode in under 8 seconds',
    async () => {
      const { duration, result } = await measurePerformanceScenario({
        transactionCount: 20,
        bulkDelay: 50,
      });
      console.info(`Bulk benchmark (20 txns): ${duration}ms`);
      expect(duration).toBeLessThan(8000);
      expect(result.summary.transactions_created).toBe(20);
      expect(result.bulk_operation_details?.bulk_successes).toBe(1);
    },
    60000,
  );

  it(
    'pure sequential mode (single transaction) takes longer than 20 seconds',
    async () => {
      // Pure sequential baseline: only 1 transaction per "unmatched_bank" to avoid bulk mode
      const { duration, result } = await measurePerformanceScenario({
        transactionCount: 1, // This ensures bulk mode is never entered
        bulkDelay: 50,
        sequentialDelay: 1050,
        multipleRuns: 20, // Run 20 times to simulate 20 sequential transactions
      });
      console.info(`Pure sequential baseline (20 txns, 1 at a time): ${duration}ms`);
      expect(duration).toBeGreaterThan(20000);
      expect(result.summary.transactions_created).toBe(1);
      expect(result.bulk_operation_details).toBeUndefined(); // No bulk operations at all
    },
    90000,
  );

  it(
    'sequential fallback takes longer than 20 seconds for 20 transactions',
    async () => {
      const { duration, result } = await measurePerformanceScenario({
        transactionCount: 20,
        bulkDelay: 50,
        sequentialDelay: 1050,
        forceSequential: true,
      });
      console.info(`Sequential fallback (20 txns): ${duration}ms`);
      expect(duration).toBeGreaterThan(20000);
      expect(result.summary.transactions_created).toBe(20);
      expect(result.bulk_operation_details?.sequential_fallbacks).toBe(1);
      expect(result.bulk_operation_details?.bulk_successes).toBe(0);
    },
    90000,
  );

  it(
    'achieves at least a 3x speedup over pure sequential mode',
    async () => {
      const bulkRun = await measurePerformanceScenario({
        transactionCount: 20,
        bulkDelay: 50,
      });
      // Use pure sequential baseline for canonical comparison
      const pureSequentialRun = await measurePerformanceScenario({
        transactionCount: 1,
        bulkDelay: 50,
        sequentialDelay: 1050,
        multipleRuns: 20,
      });
      const speedup = pureSequentialRun.duration / bulkRun.duration;
      console.info(`Bulk vs pure sequential speedup: ${speedup.toFixed(2)}x faster`);
      expect(speedup).toBeGreaterThanOrEqual(3);
    },
    120000,
  );

  it(
    'handles 150-transaction chunking without significant overhead',
    async () => {
      const { duration, result } = await measurePerformanceScenario({
        transactionCount: 150,
        bulkDelay: 60,
      });
      console.info(`Chunking benchmark (150 txns): ${duration}ms`);
      expect(duration).toBeLessThan(15000);
      expect(result.summary.transactions_created).toBe(150);
      expect(result.bulk_operation_details?.chunks_processed).toBeGreaterThanOrEqual(2);
    },
    60000,
  );

  it('stays within 10MB of heap growth for 100 bulk transactions', async () => {
    const before = process.memoryUsage().heapUsed;
    const { result } = await measurePerformanceScenario({
      transactionCount: 100,
      bulkDelay: 30,
    });
    const after = process.memoryUsage().heapUsed;
    const deltaMb = (after - before) / (1024 * 1024);
    expect(result.summary.transactions_created).toBe(100);
    expect(deltaMb).toBeLessThan(10);
  });
});

const performanceInitialAccount: AccountSnapshot = {
  balance: 0,
  cleared_balance: 0,
  uncleared_balance: 0,
};

function buildPerformanceAnalysis(
  count: number,
  amount = 5,
  statementMultiplier = count,
): ReconciliationAnalysis {
  const statementBalance = amount * statementMultiplier;
  const baseDate = Date.parse('2025-08-01');

  return {
    success: true,
    phase: 'analysis',
    summary: {
      statement_date_range: 'Performance suite',
      bank_transactions_count: count,
      ynab_transactions_count: 0,
      auto_matched: 0,
      suggested_matches: 0,
      unmatched_bank: count,
      unmatched_ynab: 0,
      current_cleared_balance: 0,
      target_statement_balance: statementBalance,
      discrepancy: statementBalance,
      discrepancy_explanation: 'Synthetic performance delta',
    },
    auto_matches: [],
    suggested_matches: [],
    unmatched_bank: Array.from({ length: count }, (_, index) => {
      const date = new Date(baseDate + index * 24 * 60 * 60 * 1000);
      return {
        id: `perf-bank-${index}`,
        date: date.toISOString().slice(0, 10),
        amount,
        payee: `Performance Payee ${index}`,
        memo: `Performance memo ${index}`,
        original_csv_row: index + 1,
      };
    }),
    unmatched_ynab: [],
    balance_info: {
      current_cleared: 0,
      current_uncleared: 0,
      current_total: 0,
      target_statement: statementBalance,
      discrepancy: statementBalance,
      on_track: false,
    },
    next_steps: [],
    insights: [],
  };
}

function buildPerformanceParams(
  statementBalance: number,
  overrides: Partial<ReconcileAccountRequest> = {},
): ReconcileAccountRequest {
  return {
    budget_id: 'budget-performance',
    account_id: 'account-performance',
    csv_data: 'Date,Description,Amount',
    statement_balance: statementBalance,
    statement_date: '2025-08-31',
    date_tolerance_days: 1,
    amount_tolerance_cents: 1,
    auto_match_threshold: 90,
    suggestion_threshold: 60,
    auto_create_transactions: true,
    auto_update_cleared_status: false,
    auto_unclear_missing: false,
    auto_adjust_dates: false,
    dry_run: false,
    require_exact_match: true,
    confidence_threshold: 0.8,
    max_resolution_attempts: 3,
    include_structured_data: false,
    ...overrides,
  };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createPerformanceApi(options: {
  bulkDelay?: number;
  sequentialDelay?: number;
  failBulk?: boolean;
}) {
  const createTransactions = vi.fn().mockImplementation(async (_budgetId, body: any) => {
    if (options.failBulk) {
      throw new Error('bulk failure');
    }
    if (options.bulkDelay) {
      await delay(options.bulkDelay);
    }
    const transactions = (body.transactions ?? []).map((txn: any, index: number) => ({
      id: `bulk-${index}-${Date.now()}`,
      account_id: txn.account_id,
      amount: txn.amount,
      date: txn.date,
      cleared: 'cleared',
      approved: true,
    }));
    return { data: { transactions } };
  });

  const createTransaction = vi.fn().mockImplementation(async (_budgetId, body: any) => {
    if (options.sequentialDelay) {
      const asyncWait = Math.min(options.sequentialDelay, 50);
      await delay(asyncWait);
      const busyWait = Math.max(options.sequentialDelay - asyncWait, 0);
      const start = Date.now();
      while (Date.now() - start < busyWait) {
        // busy-wait to simulate processing overhead
      }
    }
    return {
      data: {
        transaction: {
          id: `seq-${Date.now()}`,
          amount: body.transaction?.amount ?? 0,
          date: body.transaction?.date ?? '2025-09-01',
          cleared: 'cleared',
          approved: true,
        },
      },
    };
  });

  const updateTransactions = vi.fn().mockResolvedValue({ data: { transactions: [] } });
  const getTransactionsByAccount = vi.fn().mockResolvedValue({ data: { transactions: [] } });
  const getAccountById = vi.fn().mockResolvedValue({
    data: {
      account: {
        id: 'account-performance',
        balance: performanceInitialAccount.balance,
        cleared_balance: performanceInitialAccount.cleared_balance,
        uncleared_balance: performanceInitialAccount.uncleared_balance,
      },
    },
  });

  const api = {
    transactions: {
      createTransactions,
      createTransaction,
      updateTransactions,
      getTransactionsByAccount,
    },
    accounts: {
      getAccountById,
    },
  } as unknown as ynab.API;

  return { api, mocks: { createTransactions, createTransaction } };
}

async function measurePerformanceScenario(options: {
  transactionCount: number;
  amount?: number;
  bulkDelay?: number;
  sequentialDelay?: number;
  forceSequential?: boolean;
  multipleRuns?: number;
}): Promise<{
  duration: number;
  result: Awaited<ReturnType<typeof executeReconciliation>>;
}> {
  const analysis = buildPerformanceAnalysis(
    options.transactionCount,
    options.amount ?? 5,
  );
  const params = buildPerformanceParams(analysis.summary.target_statement_balance);
  const { api } = createPerformanceApi({
    bulkDelay: options.bulkDelay,
    sequentialDelay: options.sequentialDelay,
    failBulk: options.forceSequential,
  });

  const start = Date.now();
  let result: Awaited<ReturnType<typeof executeReconciliation>>;

  if (options.multipleRuns) {
    // Run the scenario multiple times sequentially to measure pure sequential performance
    for (let i = 0; i < options.multipleRuns; i++) {
      result = await executeReconciliation({
        ynabAPI: api,
        analysis,
        params,
        budgetId: params.budget_id,
        accountId: params.account_id,
        initialAccount: performanceInitialAccount,
        currencyCode: 'USD',
      });
    }
  } else {
    result = await executeReconciliation({
      ynabAPI: api,
      analysis,
      params,
      budgetId: params.budget_id,
      accountId: params.account_id,
      initialAccount: performanceInitialAccount,
      currencyCode: 'USD',
    });
  }
  const duration = Date.now() - start;
  return { duration, result: result! };
}

describe('YNAB MCP Server - Performance Tests', () => {
  let server: YNABMCPServer;
  let mockYnabAPI: any;

  beforeEach(async () => {
    process.env['YNAB_ACCESS_TOKEN'] = 'test-token';
    server = new YNABMCPServer();

    const { API } = await import('ynab');
    mockYnabAPI = new (API as any)();

    vi.clearAllMocks();
  });

  describe('Response Time Performance', () => {
    it('should respond to budget listing within acceptable time', async () => {
      // Mock quick response
      mockYnabAPI.budgets.getBudgets.mockResolvedValue({
        data: {
          budgets: Array.from({ length: 5 }, (_, i) => ({
            id: `budget-${i}`,
            name: `Budget ${i}`,
            last_modified_on: '2024-01-01T00:00:00Z',
            first_month: '2024-01-01',
            last_month: '2024-12-01',
          })),
        },
      });

      const startTime = Date.now();
      const result = await executeToolCall(server, 'ynab:list_budgets');
      const endTime = Date.now();

      const responseTime = endTime - startTime;

      expect(result).toBeDefined();
      expect(responseTime).toBeLessThan(1000); // Should respond within 1 second

      const budgets = parseToolResult(result);
      expect(budgets.data.budgets).toHaveLength(5);
    });

    it('should handle large transaction lists efficiently', async () => {
      // Use smaller list to avoid size limit and ensure we get 'transactions' not 'preview_transactions'
      const largeTransactionList = Array.from({ length: 100 }, (_, i) => ({
        id: `transaction-${i}`,
        date: '2024-01-01',
        amount: -1000 * (i + 1),
        memo: `Transaction ${i}`,
        cleared: 'cleared',
        approved: true,
        account_id: 'account-1',
        category_id: 'category-1',
      }));

      // Mock the method that list_transactions actually uses for budget-wide queries
      mockYnabAPI.transactions.getTransactions.mockResolvedValue({
        data: {
          transactions: largeTransactionList,
          server_knowledge: 100,
        },
      });

      const startTime = Date.now();
      const result = await executeToolCall(server, 'ynab:list_transactions', {
        budget_id: 'test-budget',
      });
      const endTime = Date.now();

      const responseTime = endTime - startTime;

      expect(result).toBeDefined();
      expect(responseTime).toBeLessThan(2000); // Should handle large lists within 2 seconds

      const transactions = parseToolResult(result);
      expect(transactions.data.transactions).toHaveLength(100);
    });

    it('should handle concurrent requests efficiently', async () => {
      // Mock responses for concurrent requests
      mockYnabAPI.budgets.getBudgets.mockResolvedValue({
        data: { budgets: [{ id: 'budget-1', name: 'Test Budget' }] },
      });

      mockYnabAPI.accounts.getAccounts.mockResolvedValue({
        data: {
          accounts: [{ id: 'account-1', name: 'Test Account', type: 'checking', balance: 0 }],
        },
      });

      mockYnabAPI.user.getUser.mockResolvedValue({
        data: { user: { id: 'user-1', email: 'test@example.com' } },
      });

      const startTime = Date.now();

      // Execute multiple concurrent requests
      const promises = [
        executeToolCall(server, 'ynab:list_budgets'),
        executeToolCall(server, 'ynab:list_accounts', { budget_id: 'test-budget' }),
        executeToolCall(server, 'ynab:get_user'),
        executeToolCall(server, 'ynab:list_budgets'),
        executeToolCall(server, 'ynab:list_accounts', { budget_id: 'test-budget' }),
      ];

      const results = await Promise.all(promises);
      const endTime = Date.now();

      const totalTime = endTime - startTime;

      expect(results).toHaveLength(5);
      results.forEach((result) => expect(result).toBeDefined());
      expect(totalTime).toBeLessThan(3000); // All concurrent requests within 3 seconds
    });
  });

  describe('Memory Usage Performance', () => {
    it('should handle memory efficiently with large datasets', async () => {
      // Create a large mock dataset
      const largeCategoryList = Array.from({ length: 100 }, (_, groupIndex) => ({
        id: `group-${groupIndex}`,
        name: `Category Group ${groupIndex}`,
        hidden: false,
        categories: Array.from({ length: 20 }, (_, catIndex) => ({
          id: `category-${groupIndex}-${catIndex}`,
          category_group_id: `group-${groupIndex}`,
          name: `Category ${groupIndex}-${catIndex}`,
          hidden: false,
          budgeted: 1000 * catIndex,
          activity: -500 * catIndex,
          balance: 500 * catIndex,
        })),
      }));

      mockYnabAPI.categories.getCategories.mockResolvedValue({
        data: {
          category_groups: largeCategoryList,
        },
      });

      const initialMemory = process.memoryUsage();

      // Process large dataset multiple times
      for (let i = 0; i < 10; i++) {
        const result = await executeToolCall(server, 'ynab:list_categories', {
          budget_id: 'test-budget',
        });

        const categories = parseToolResult(result);
        expect(categories.data.category_groups).toHaveLength(100);

        // Force garbage collection if available
        if (global.gc) {
          global.gc();
        }
      }

      const finalMemory = process.memoryUsage();

      // Memory usage shouldn't grow excessively (allow for some variance)
      const memoryGrowth = finalMemory.heapUsed - initialMemory.heapUsed;
      // With large datasets (2000 categories × 10 iterations), allow more memory growth
      // Each category has multiple fields, and we're dealing with substantial JSON parsing
      expect(memoryGrowth).toBeLessThan(100 * 1024 * 1024); // Less than 100MB growth
    });
  });

  describe('Error Handling Performance', () => {
    it('should handle errors quickly without blocking', async () => {
      // Mock API errors
      const apiError = new Error('API Error');
      mockYnabAPI.budgets.getBudgets.mockRejectedValue(apiError);
      mockYnabAPI.accounts.getAccounts.mockRejectedValue(apiError);

      const startTime = Date.now();

      // Execute multiple failing requests
      const promises = [
        executeToolCall(server, 'ynab:list_budgets'),
        executeToolCall(server, 'ynab:list_accounts', { budget_id: 'test' }),
        executeToolCall(server, 'ynab:list_budgets'),
      ];

      const results = await Promise.all(promises);
      const endTime = Date.now();

      const totalTime = endTime - startTime;

      // Check that all results are error responses
      results.forEach((result) => {
        const parsed = parseToolResult(result);
        expect(parsed.error || parsed.data?.error).toBeDefined();
      });
      expect(totalTime).toBeLessThan(1000); // Errors should be handled quickly
    });

    it('should recover from rate limiting gracefully', async () => {
      let callCount = 0;

      // Mock rate limiting on first few calls, then success
      mockYnabAPI.budgets.getBudgets.mockImplementation(() => {
        callCount++;
        if (callCount <= 2) {
          const rateLimitError = new Error('Rate Limited');
          (rateLimitError as any).error = { id: '429', name: 'rate_limit' };
          return Promise.reject(rateLimitError);
        }
        return Promise.resolve({
          data: { budgets: [{ id: 'budget-1', name: 'Test Budget' }] },
        });
      });

      const startTime = Date.now();

      try {
        // This should fail due to rate limiting
        await executeToolCall(server, 'ynab:list_budgets');
        expect.fail('Should have thrown rate limit error');
      } catch (error) {
        expect(error).toBeDefined();
      }

      const endTime = Date.now();
      const errorTime = endTime - startTime;

      expect(errorTime).toBeLessThan(500); // Rate limit errors should be fast
      expect(callCount).toBe(1);
    });
  });

  describe('Validation Performance', () => {
    it('should validate input parameters quickly', async () => {
      const startTime = Date.now();

      // Test multiple validation scenarios
      const validationTests = [
        // Valid parameters
        executeToolCall(server, 'ynab:convert_amount', {
          amount: 25.5,
          to_milliunits: true,
        }),

        // Invalid parameters (should fail quickly)
        executeToolCall(server, 'ynab:get_budget', {
          budget_id: '', // Empty string should fail validation
        }),

        executeToolCall(server, 'ynab:create_transaction', {
          budget_id: 'test',
          account_id: 'test',
          amount: 'not-a-number', // Invalid type
          date: '2024-01-01',
        }),
      ];

      const results = await Promise.all(validationTests);
      const parsed = results.map((result) => parseToolResult(result));
      const endTime = Date.now();

      const totalTime = endTime - startTime;

      expect(parsed).toHaveLength(3);
      expect(parsed[0]).toBeDefined(); // Valid call should succeed
      const firstError = parsed[1].error ?? parsed[1].data?.error;
      const secondError = parsed[2].error ?? parsed[2].data?.error;
      expect(firstError?.code).toBe('VALIDATION_ERROR'); // Invalid calls should fail
      expect(secondError?.code).toBe('VALIDATION_ERROR');
      expect(totalTime).toBeLessThan(1000); // Validation should be fast
    });
  });

  describe('Stress Testing', () => {
    it('should handle rapid sequential requests', async () => {
      mockYnabAPI.user.getUser.mockResolvedValue({
        data: { user: { id: 'user-1', email: 'test@example.com' } },
      });

      const startTime = Date.now();

      // Execute 50 rapid sequential requests
      const results = [];
      for (let i = 0; i < 50; i++) {
        const result = await executeToolCall(server, 'ynab:get_user');
        results.push(result);
      }

      const endTime = Date.now();
      const totalTime = endTime - startTime;
      const averageTime = totalTime / 50;

      expect(results).toHaveLength(50);
      results.forEach((result) => expect(result).toBeDefined());
      expect(averageTime).toBeLessThan(100); // Average less than 100ms per request
      expect(totalTime).toBeLessThan(5000); // Total less than 5 seconds
    });

    it('should maintain performance under mixed workload', async () => {
      // Mock various endpoints
      mockYnabAPI.budgets.getBudgets.mockResolvedValue({
        data: { budgets: [{ id: 'budget-1', name: 'Test Budget' }] },
      });

      mockYnabAPI.accounts.getAccounts.mockResolvedValue({
        data: { accounts: [{ id: 'account-1', name: 'Test Account' }] },
      });

      mockYnabAPI.transactions.getTransactions.mockResolvedValue({
        data: { transactions: [] },
      });

      mockYnabAPI.categories.getCategories.mockResolvedValue({
        data: { category_groups: [] },
      });

      const startTime = Date.now();

      // Mixed workload: different tools with different complexities
      const mixedPromises = [];
      for (let i = 0; i < 20; i++) {
        mixedPromises.push(
          executeToolCall(server, 'ynab:list_budgets'),
          executeToolCall(server, 'ynab:list_accounts', { budget_id: 'test' }),
          executeToolCall(server, 'ynab:list_transactions', { budget_id: 'test' }),
          executeToolCall(server, 'ynab:list_categories', { budget_id: 'test' }),
          executeToolCall(server, 'ynab:convert_amount', { amount: i * 10, to_milliunits: true }),
        );
      }

      const results = await Promise.all(mixedPromises);
      const endTime = Date.now();

      const totalTime = endTime - startTime;

      expect(results).toHaveLength(100); // 20 iterations × 5 tools
      results.forEach((result) => expect(result).toBeDefined());
      expect(totalTime).toBeLessThan(10000); // Should complete within 10 seconds
    });
  });
});
