/**
 * Integration tests for security measures
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { z } from 'zod/v4';
import { SecurityMiddleware } from '../securityMiddleware.js';
import { globalRateLimiter, RateLimiter } from '../rateLimiter.js';
import { globalRequestLogger, RequestLogger } from '../requestLogger.js';

describe('Security Integration', () => {
  const testAccessToken = 'integration-test-token-123';
  const testSchema = z.object({
    budget_id: z.string().min(1),
    amount: z.number().optional(),
  });

  beforeEach(() => {
    // Reset all security components
    SecurityMiddleware.reset();

    // Configure rate limiter for testing
    globalRateLimiter.config = {
      maxRequests: 3,
      windowMs: 1000,
      enableLogging: false,
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('end-to-end security flow', () => {
    it('should handle a complete successful request flow', { meta: { tier: 'domain', domain: 'security' } }, async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {
        // Mock implementation for testing
      });

      const context = {
        accessToken: testAccessToken,
        toolName: 'ynab:create_transaction',
        operation: 'creating transaction',
        parameters: { budget_id: 'test-budget-123', amount: 1000 },
        startTime: Date.now(),
      };

      const mockOperation = vi.fn().mockResolvedValue({
        content: [{ type: 'text', text: JSON.stringify({ success: true }) }],
      });

      // Execute the operation
      const result = await SecurityMiddleware.withSecurity(context, testSchema, mockOperation);

      // Verify operation was called with validated parameters
      expect(mockOperation).toHaveBeenCalledWith({
        budget_id: 'test-budget-123',
        amount: 1000,
      });

      // Verify successful result
      expect(result.content[0].text).toContain('success');

      // Verify logging occurred
      const logs = globalRequestLogger.getRecentLogs(1);
      expect(logs).toHaveLength(1);
      expect(logs[0].toolName).toBe('ynab:create_transaction');
      expect(logs[0].success).toBe(true);
      expect(logs[0].parameters.budget_id).toBe('test-budget-123');
      expect(logs[0].parameters.amount).toBe(1000);

      // Verify rate limiting is tracking
      expect(logs[0].rateLimitInfo.remaining).toBe(2); // Started with 3, used 1

      // Verify console logging (should show success)
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('[INFO]'));
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('ynab:create_transaction:creating transaction | SUCCESS'),
      );

      consoleSpy.mockRestore();
    });

    it('should handle validation failures with proper logging', { meta: { tier: 'domain', domain: 'security' } }, async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {
        // Mock implementation for testing
      });

      const context = {
        accessToken: testAccessToken,
        toolName: 'ynab:create_transaction',
        operation: 'creating transaction',
        parameters: { budget_id: '', amount: 'invalid' }, // Invalid parameters
        startTime: Date.now(),
      };

      const mockOperation = vi.fn();

      const result = await SecurityMiddleware.withSecurity(context, testSchema, mockOperation);

      // Verify operation was not called
      expect(mockOperation).not.toHaveBeenCalled();

      // Verify error response
      const responseText = JSON.parse(result.content[0].text);
      expect(responseText.error.code).toBe('VALIDATION_ERROR');
      expect(responseText.error.message).toContain('Invalid parameters');

      // Verify error logging
      const logs = globalRequestLogger.getRecentLogs(1);
      expect(logs).toHaveLength(1);
      expect(logs[0].success).toBe(false);
      expect(logs[0].error).toContain('Validation failed');

      // Verify console error logging
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('[ERROR]'));

      consoleSpy.mockRestore();
    });

    it('should handle rate limiting with proper responses and logging', { meta: { tier: 'domain', domain: 'security' } }, async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {
        // Mock implementation for testing
      });

      const context = {
        accessToken: testAccessToken,
        toolName: 'ynab:list_budgets',
        operation: 'listing budgets',
        parameters: { budget_id: 'test-budget' },
        startTime: Date.now(),
      };

      const mockOperation = vi.fn().mockResolvedValue({
        content: [{ type: 'text', text: 'Success' }],
      });

      // Make requests up to the limit (3)
      await SecurityMiddleware.withSecurity(context, testSchema, mockOperation);
      await SecurityMiddleware.withSecurity(context, testSchema, mockOperation);
      await SecurityMiddleware.withSecurity(context, testSchema, mockOperation);

      // Fourth request should be rate limited
      const result = await SecurityMiddleware.withSecurity(context, testSchema, mockOperation);

      // Verify rate limit response
      const responseText = JSON.parse(result.content[0].text);
      expect(responseText.error.code).toBe('RATE_LIMIT_EXCEEDED');
      expect(responseText.error.message).toContain('Rate limit exceeded');
      expect(responseText.error.details.resetTime).toBeDefined();
      expect(responseText.error.details.remaining).toBe(0);

      // Verify all requests were logged
      const logs = globalRequestLogger.getRecentLogs(4);
      expect(logs).toHaveLength(4);

      // First 3 should be successful
      expect(logs[0].success).toBe(true);
      expect(logs[1].success).toBe(true);
      expect(logs[2].success).toBe(true);

      // Fourth should be failed due to rate limiting
      expect(logs[3].success).toBe(false);
      expect(logs[3].error).toContain('Rate limit exceeded');

      // Verify rate limit info progression
      expect(logs[0].rateLimitInfo.remaining).toBe(2);
      expect(logs[1].rateLimitInfo.remaining).toBe(1);
      expect(logs[2].rateLimitInfo.remaining).toBe(0);
      expect(logs[3].rateLimitInfo.isLimited).toBe(true);

      consoleSpy.mockRestore();
    });

    it('should sanitize sensitive data in logs', { meta: { tier: 'domain', domain: 'security' } }, async () => {
      const context = {
        accessToken: testAccessToken,
        toolName: 'ynab:create_transaction',
        operation: 'creating transaction',
        parameters: {
          budget_id: 'test-budget',
          memo: 'Payment with token=secret123456789',
          access_token: 'very-secret-token-abc123',
          api_key: 'secret-api-key-xyz789',
        },
        startTime: Date.now(),
      };

      const extendedSchema = z.object({
        budget_id: z.string(),
        memo: z.string().optional(),
        access_token: z.string().optional(),
        api_key: z.string().optional(),
      });

      const mockOperation = vi.fn().mockResolvedValue({
        content: [{ type: 'text', text: 'Success' }],
      });

      await SecurityMiddleware.withSecurity(context, extendedSchema, mockOperation);

      const logs = globalRequestLogger.getRecentLogs(1);
      const loggedParams = logs[0].parameters;

      // Verify sensitive data is sanitized
      expect(loggedParams.budget_id).toBe('test-budget'); // Non-sensitive data preserved
      expect(loggedParams.memo).toBe('Payment with token=***'); // Token pattern sanitized
      expect(loggedParams.access_token).toBe('***'); // Sensitive parameter name sanitized
      expect(loggedParams.api_key).toBe('***'); // Sensitive parameter name sanitized
    });

    it('should handle multiple users with independent rate limits', { meta: { tier: 'domain', domain: 'security' } }, async () => {
      const token1 = 'user-1-token';
      const token2 = 'user-2-token';

      const context1 = {
        accessToken: token1,
        toolName: 'ynab:test',
        operation: 'test',
        parameters: { budget_id: 'budget-1' },
        startTime: Date.now(),
      };

      const context2 = {
        accessToken: token2,
        toolName: 'ynab:test',
        operation: 'test',
        parameters: { budget_id: 'budget-2' },
        startTime: Date.now(),
      };

      const mockOperation = vi.fn().mockResolvedValue({
        content: [{ type: 'text', text: 'Success' }],
      });

      // Max out user 1's rate limit
      await SecurityMiddleware.withSecurity(context1, testSchema, mockOperation);
      await SecurityMiddleware.withSecurity(context1, testSchema, mockOperation);
      await SecurityMiddleware.withSecurity(context1, testSchema, mockOperation);

      // User 1 should be rate limited
      const user1Result = await SecurityMiddleware.withSecurity(
        context1,
        testSchema,
        mockOperation,
      );
      const user1Response = JSON.parse(user1Result.content[0].text);
      expect(user1Response.error.code).toBe('RATE_LIMIT_EXCEEDED');

      // User 2 should still be allowed
      const user2Result = await SecurityMiddleware.withSecurity(
        context2,
        testSchema,
        mockOperation,
      );
      expect(user2Result.content[0].text).toBe('Success');

      // Verify independent tracking in logs
      const logs = globalRequestLogger.getRecentLogs(5);
      const user1Logs = logs.filter((log) => log.parameters.budget_id === 'budget-1');
      const user2Logs = logs.filter((log) => log.parameters.budget_id === 'budget-2');

      expect(user1Logs).toHaveLength(4); // 3 successful + 1 rate limited
      expect(user2Logs).toHaveLength(1); // 1 successful

      // User 2 should have full rate limit remaining
      expect(user2Logs[0].rateLimitInfo.remaining).toBe(2);
    });

    it('should provide comprehensive security statistics', { meta: { tier: 'domain', domain: 'security' } }, async () => {
      const context = {
        accessToken: testAccessToken,
        toolName: 'ynab:test',
        operation: 'test',
        parameters: { budget_id: 'test-budget' },
        startTime: Date.now(),
      };

      const mockSuccessOperation = vi.fn().mockResolvedValue({
        content: [{ type: 'text', text: 'Success' }],
      });

      const mockFailOperation = vi.fn().mockRejectedValue(new Error('Test error'));

      // Make some successful requests
      await SecurityMiddleware.withSecurity(context, testSchema, mockSuccessOperation);
      await SecurityMiddleware.withSecurity(context, testSchema, mockSuccessOperation);

      // Make a failed request
      try {
        await SecurityMiddleware.withSecurity(context, testSchema, mockFailOperation);
      } catch {
        // Expected
      }

      const stats = SecurityMiddleware.getSecurityStats();

      expect(stats.rateLimitStats).toBeDefined();
      expect(stats.requestStats).toBeDefined();
      expect(stats.requestStats.totalRequests).toBe(3);
      expect(stats.requestStats.successfulRequests).toBe(2);
      expect(stats.requestStats.failedRequests).toBe(1);
      expect(stats.requestStats.averageDuration).toBeGreaterThanOrEqual(0);
      expect(stats.requestStats.toolUsage['ynab:test']).toBe(3);
    });
  });

  describe('performance under load', () => {
    it('should handle rapid requests efficiently', { meta: { tier: 'domain', domain: 'security' } }, async () => {
      const context = {
        accessToken: testAccessToken,
        toolName: 'ynab:performance_test',
        operation: 'performance test',
        parameters: { budget_id: 'test-budget' },
        startTime: Date.now(),
      };

      const mockOperation = vi.fn().mockResolvedValue({
        content: [{ type: 'text', text: 'Success' }],
      });

      const startTime = Date.now();

      // Make multiple rapid requests (within rate limit)
      const promises = [];
      for (let i = 0; i < 3; i++) {
        promises.push(SecurityMiddleware.withSecurity(context, testSchema, mockOperation));
      }

      await Promise.all(promises);

      const endTime = Date.now();
      const totalTime = endTime - startTime;

      // Should complete reasonably quickly (less than 1 second for 3 requests)
      expect(totalTime).toBeLessThan(1000);

      // Verify all requests were processed
      expect(mockOperation).toHaveBeenCalledTimes(3);

      const logs = globalRequestLogger.getRecentLogs(3);
      expect(logs).toHaveLength(3);
      expect(logs.every((log) => log.success)).toBe(true);
    });
  });

  describe('cleanup and maintenance', () => {
    it('should clean up expired rate limit entries', { meta: { tier: 'domain', domain: 'security' } }, async () => {
      // Use a very short window for testing
      const testLimiter = new RateLimiter({
        maxRequests: 5,
        windowMs: 50, // 50ms
        enableLogging: false,
      });

      const testToken = 'cleanup-test-token';

      // Make some requests
      testLimiter.recordRequest(testToken);
      testLimiter.recordRequest(testToken);

      expect(testLimiter.getStatus(testToken).remaining).toBe(3);

      // Wait for window to expire
      await new Promise((resolve) => setTimeout(resolve, 60));

      // Cleanup
      testLimiter.cleanup();

      // Should have full capacity again
      expect(testLimiter.getStatus(testToken).remaining).toBe(5);
    });

    it('should maintain log size limits', { meta: { tier: 'domain', domain: 'security' } }, async () => {
      const testLogger = new RequestLogger({ maxLogEntries: 2 });

      // Add more logs than the limit
      testLogger.logSuccess('tool1', 'op1', {});
      testLogger.logSuccess('tool2', 'op2', {});
      testLogger.logSuccess('tool3', 'op3', {});

      const logs = testLogger.getRecentLogs();
      expect(logs).toHaveLength(2);

      // Should keep the most recent entries
      expect(logs[0].toolName).toBe('tool2');
      expect(logs[1].toolName).toBe('tool3');
    });
  });
});
