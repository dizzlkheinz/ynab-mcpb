/**
 * Unit tests for RequestLogger class
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RequestLogger } from '../requestLogger.js';

describe('RequestLogger', () => {
  let logger: RequestLogger;

  beforeEach(() => {
    logger = new RequestLogger({
      enabled: true,
      logLevel: 'info',
      maxLogEntries: 100,
      sanitizeParameters: true,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('logRequest', () => {
    it('should log a successful request', () => {
      const parameters = { budget_id: 'test-budget', amount: 1000 };

      logger.logSuccess('ynab:create_transaction', 'creating transaction', parameters, 150);

      const logs = logger.getRecentLogs(1);
      expect(logs).toHaveLength(1);
      expect(logs[0].toolName).toBe('ynab:create_transaction');
      expect(logs[0].operation).toBe('creating transaction');
      expect(logs[0].success).toBe(true);
      expect(logs[0].duration).toBe(150);
      expect(logs[0].parameters).toEqual(parameters);
    });

    it('should log a failed request', () => {
      const parameters = { budget_id: 'invalid-budget' };
      const error = 'Budget not found';

      logger.logError('ynab:get_budget', 'getting budget', parameters, error, 75);

      const logs = logger.getRecentLogs(1);
      expect(logs).toHaveLength(1);
      expect(logs[0].toolName).toBe('ynab:get_budget');
      expect(logs[0].success).toBe(false);
      expect(logs[0].error).toBe(error);
      expect(logs[0].duration).toBe(75);
    });

    it('should include rate limit information', () => {
      const rateLimitInfo = { remaining: 150, isLimited: false };

      logger.logSuccess('ynab:list_budgets', 'listing budgets', {}, 100, rateLimitInfo);

      const logs = logger.getRecentLogs(1);
      expect(logs[0].rateLimitInfo).toEqual(rateLimitInfo);
    });

    it('should not log when disabled', () => {
      const disabledLogger = new RequestLogger({ enabled: false });

      disabledLogger.logSuccess('ynab:test', 'test operation', {});

      const logs = disabledLogger.getRecentLogs();
      expect(logs).toHaveLength(0);
    });
  });

  describe('parameter sanitization', () => {
    it('should sanitize sensitive parameter names', () => {
      const parameters = {
        budget_id: 'test-budget',
        access_token: 'secret-token-123',
        api_key: 'secret-key-456',
        password: 'secret-password',
      };

      logger.logSuccess('ynab:test', 'test', parameters);

      const logs = logger.getRecentLogs(1);
      const sanitizedParams = logs[0].parameters;

      expect(sanitizedParams.budget_id).toBe('test-budget');
      expect(sanitizedParams.access_token).toBe('***');
      expect(sanitizedParams.api_key).toBe('***');
      expect(sanitizedParams.password).toBe('***');
    });

    it('should sanitize long alphanumeric strings in values', () => {
      const parameters = {
        memo: 'Payment to merchant with ref: abc123def456ghi789jkl012mno345',
        description: 'Normal description',
      };

      logger.logSuccess('ynab:test', 'test', parameters);

      const logs = logger.getRecentLogs(1);
      const sanitizedParams = logs[0].parameters;

      expect(sanitizedParams.memo).toBe('Payment to merchant with ref: ***');
      expect(sanitizedParams.description).toBe('Normal description');
    });

    it('should sanitize Bearer tokens in strings', () => {
      const parameters = {
        authorization: 'Bearer abc123def456ghi789',
        memo: 'Authorization: Bearer xyz789abc123',
      };

      logger.logSuccess('ynab:test', 'test', parameters);

      const logs = logger.getRecentLogs(1);
      const sanitizedParams = logs[0].parameters;

      // authorization is a sensitive parameter name, so it gets replaced with ***
      expect(sanitizedParams.authorization).toBe('***');
      expect(sanitizedParams.memo).toBe('Authorization: Bearer ***');
    });

    it('should sanitize nested objects', () => {
      const parameters = {
        transaction: {
          amount: 1000,
          memo: 'token=secret123456789',
          metadata: {
            api_key: 'nested-secret-key',
            user_id: 'user123',
          },
        },
      };

      logger.logSuccess('ynab:test', 'test', parameters);

      const logs = logger.getRecentLogs(1);
      const sanitizedParams = logs[0].parameters as any;

      expect(sanitizedParams.transaction.amount).toBe(1000);
      expect(sanitizedParams.transaction.memo).toBe('token=***');
      expect(sanitizedParams.transaction.metadata.api_key).toBe('***');
      expect(sanitizedParams.transaction.metadata.user_id).toBe('user123');
    });

    it('should sanitize arrays', () => {
      const parameters = {
        transactions: [
          { amount: 1000, memo: 'Normal memo' },
          { amount: 2000, memo: 'token=secret123456789' },
        ],
      };

      logger.logSuccess('ynab:test', 'test', parameters);

      const logs = logger.getRecentLogs(1);
      const sanitizedParams = logs[0].parameters as any;

      expect(sanitizedParams.transactions[0].memo).toBe('Normal memo');
      expect(sanitizedParams.transactions[1].memo).toBe('token=***');
    });

    it('should not sanitize when sanitization is disabled', () => {
      const noSanitizeLogger = new RequestLogger({ sanitizeParameters: false });
      const parameters = { access_token: 'secret-token-123' };

      noSanitizeLogger.logSuccess('ynab:test', 'test', parameters);

      const logs = noSanitizeLogger.getRecentLogs(1);
      expect(logs[0].parameters.access_token).toBe('secret-token-123');
    });
  });

  describe('error sanitization', () => {
    it('should sanitize error messages', () => {
      const error = 'Authentication failed with token=secret123456789';

      logger.logError('ynab:test', 'test', {}, error);

      const logs = logger.getRecentLogs(1);
      expect(logs[0].error).toBe('Authentication failed with token=***');
    });

    it('should sanitize Bearer tokens in error messages', () => {
      const error = 'Invalid authorization header: Bearer abc123def456';

      logger.logError('ynab:test', 'test', {}, error);

      const logs = logger.getRecentLogs(1);
      expect(logs[0].error).toBe('Invalid authorization header: Bearer ***');
    });
  });

  describe('log management', () => {
    it('should maintain maximum log entries', () => {
      const smallLogger = new RequestLogger({ maxLogEntries: 3 });

      // Add 5 log entries
      for (let i = 0; i < 5; i++) {
        smallLogger.logSuccess(`ynab:test${i}`, 'test', {});
      }

      const logs = smallLogger.getRecentLogs();
      expect(logs).toHaveLength(3);

      // Should keep the most recent entries
      expect(logs[0].toolName).toBe('ynab:test2');
      expect(logs[1].toolName).toBe('ynab:test3');
      expect(logs[2].toolName).toBe('ynab:test4');
    });

    it('should clear all logs', () => {
      logger.logSuccess('ynab:test1', 'test', {});
      logger.logSuccess('ynab:test2', 'test', {});

      expect(logger.getRecentLogs()).toHaveLength(2);

      logger.clearLogs();

      expect(logger.getRecentLogs()).toHaveLength(0);
    });
  });

  describe('log filtering', () => {
    beforeEach(() => {
      // Add some test logs
      logger.logSuccess('ynab:list_budgets', 'listing', {});
      logger.logError('ynab:get_budget', 'getting', {}, 'Not found');
      logger.logSuccess('ynab:list_accounts', 'listing', {});
      logger.logError('ynab:create_transaction', 'creating', {}, 'Invalid data');
    });

    it('should filter by tool name', () => {
      const filtered = logger.getFilteredLogs({ toolName: 'ynab:list_budgets' });

      expect(filtered).toHaveLength(1);
      expect(filtered[0].toolName).toBe('ynab:list_budgets');
    });

    it('should filter by success status', () => {
      const successLogs = logger.getFilteredLogs({ success: true });
      const errorLogs = logger.getFilteredLogs({ success: false });

      expect(successLogs).toHaveLength(2);
      expect(errorLogs).toHaveLength(2);

      expect(successLogs.every((log) => log.success)).toBe(true);
      expect(errorLogs.every((log) => !log.success)).toBe(true);
    });

    it('should filter by date', () => {
      const now = new Date();
      const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);

      const recentLogs = logger.getFilteredLogs({ since: oneHourAgo });

      expect(recentLogs).toHaveLength(4); // All logs should be recent
    });

    it('should limit results', () => {
      const limited = logger.getFilteredLogs({ limit: 2 });

      expect(limited).toHaveLength(2);
    });

    it('should combine filters', () => {
      const filtered = logger.getFilteredLogs({
        success: false,
        limit: 1,
      });

      expect(filtered).toHaveLength(1);
      expect(filtered[0].success).toBe(false);
    });
  });

  describe('statistics', () => {
    beforeEach(() => {
      // Add test logs with various properties
      logger.logSuccess('ynab:list_budgets', 'listing', {}, 100);
      logger.logError('ynab:get_budget', 'getting', {}, 'Not found', 50);
      logger.logSuccess('ynab:list_budgets', 'listing', {}, 150);
      logger.logSuccess('ynab:create_transaction', 'creating', {}, 200, {
        remaining: 100,
        isLimited: false,
      });
      logger.logError('ynab:update_transaction', 'updating', {}, 'Rate limited', 75, {
        remaining: 0,
        isLimited: true,
      });
    });

    it('should calculate basic statistics', () => {
      const stats = logger.getStats();

      expect(stats.totalRequests).toBe(5);
      expect(stats.successfulRequests).toBe(3);
      expect(stats.failedRequests).toBe(2);
    });

    it('should calculate average duration', () => {
      const stats = logger.getStats();

      // (100 + 50 + 150 + 200 + 75) / 5 = 115
      expect(stats.averageDuration).toBe(115);
    });

    it('should count rate limited requests', () => {
      const stats = logger.getStats();

      expect(stats.rateLimitedRequests).toBe(1);
    });

    it('should track tool usage', () => {
      const stats = logger.getStats();

      expect(stats.toolUsage['ynab:list_budgets']).toBe(2);
      expect(stats.toolUsage['ynab:get_budget']).toBe(1);
      expect(stats.toolUsage['ynab:create_transaction']).toBe(1);
      expect(stats.toolUsage['ynab:update_transaction']).toBe(1);
    });

    it('should handle empty logs', () => {
      const emptyLogger = new RequestLogger();
      const stats = emptyLogger.getStats();

      expect(stats.totalRequests).toBe(0);
      expect(stats.successfulRequests).toBe(0);
      expect(stats.failedRequests).toBe(0);
      expect(stats.averageDuration).toBe(0);
      expect(stats.rateLimitedRequests).toBe(0);
      expect(stats.toolUsage).toEqual({});
    });
  });

  describe('console output', () => {
    it('should output success logs at info level', () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {
        // Mock implementation for testing
      });

      logger.logSuccess('ynab:test', 'test operation', {}, 100);

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('[INFO]'));
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('ynab:test:test operation | SUCCESS | 100ms'),
      );

      consoleSpy.mockRestore();
    });

    it('should output error logs at error level', () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {
        // Mock implementation for testing
      });

      logger.logError('ynab:test', 'test operation', {}, 'Test error', 50);

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('[ERROR]'));
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('ynab:test:test operation | FAILED | 50ms | error:"Test error"'),
      );

      consoleSpy.mockRestore();
    });

    it('should output rate limit warnings', () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {
        // Mock implementation for testing
      });

      logger.logSuccess('ynab:test', 'test', {}, 100, { remaining: 0, isLimited: true });

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('[WARN] Rate limit exceeded for ynab:test'),
      );

      consoleSpy.mockRestore();
    });

    it('should respect log level configuration', () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {
        // Mock implementation for testing
      });

      const errorOnlyLogger = new RequestLogger({ logLevel: 'error' });

      // Success log should not appear at error level
      errorOnlyLogger.logSuccess('ynab:test', 'test', {});

      // Error log should appear
      errorOnlyLogger.logError('ynab:test', 'test', {}, 'Error');

      const logCalls = consoleSpy.mock.calls;
      const hasInfoLog = logCalls.some((call) =>
        call.some((arg) => typeof arg === 'string' && arg.includes('[INFO]')),
      );
      const hasErrorLog = logCalls.some((call) =>
        call.some((arg) => typeof arg === 'string' && arg.includes('[ERROR]')),
      );

      expect(hasInfoLog).toBe(false);
      expect(hasErrorLog).toBe(true);

      consoleSpy.mockRestore();
    });
  });
});
