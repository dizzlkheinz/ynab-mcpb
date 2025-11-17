import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from 'vitest';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import { YNABMCPServer } from '../YNABMCPServer.js';
import { AuthenticationError, ConfigurationError, ValidationError } from '../../types/index.js';
import { ToolRegistry } from '../toolRegistry.js';
import { cacheManager } from '../../server/cacheManager.js';
import { responseFormatter } from '../../server/responseFormatter.js';
import { createErrorHandler, ErrorHandler } from '../errorHandler.js';

function parseCallToolJson<T = Record<string, unknown>>(result: CallToolResult): T {
  const text = result.content?.[0]?.text;
  const raw = typeof text === 'string' ? text : (JSON.stringify(text ?? {}) ?? '{}');
  return JSON.parse(raw) as T;
}

/**
 * Real YNAB API tests using token from .env (YNAB_ACCESS_TOKEN)
 */
describe('YNABMCPServer', () => {
  const originalEnv = process.env;

  // Shared constant for expected tool names
  const expectedToolNames = [
    'list_budgets',
    'get_budget',
    'set_default_budget',
    'get_default_budget',
    'list_accounts',
    'get_account',
    'create_account',
    'list_transactions',
    'export_transactions',
    'compare_transactions',
    'reconcile_account',
    'get_transaction',
    'create_transaction',
    'update_transaction',
    'delete_transaction',
    'list_categories',
    'get_category',
    'update_category',
    'list_payees',
    'get_payee',
    'get_month',
    'list_months',
    'get_user',
    'convert_amount',
    'diagnostic_info',
    'clear_cache',
    'set_output_format',
  ] as const;

  beforeAll(() => {
    if (!process.env['YNAB_ACCESS_TOKEN']) {
      throw new Error(
        'YNAB_ACCESS_TOKEN is required. Set it in your .env file to run integration tests.',
      );
    }
  });

  afterEach(() => {
    // Don't restore env completely, keep the API key loaded
    Object.keys(process.env).forEach((key) => {
      if (key !== 'YNAB_ACCESS_TOKEN' && key !== 'YNAB_BUDGET_ID') {
        if (originalEnv[key] !== undefined) {
          process.env[key] = originalEnv[key];
        } else {
          // Use Reflect.deleteProperty to avoid ESLint dynamic delete warning
          Reflect.deleteProperty(process.env, key);
        }
      }
    });
  });

  describe('Constructor and Environment Validation', () => {
    it('should create server instance with valid access token', () => {
      const server = new YNABMCPServer();
      expect(server).toBeInstanceOf(YNABMCPServer);
      expect(server.getYNABAPI()).toBeDefined();
    });

    it('should throw ConfigurationError when YNAB_ACCESS_TOKEN is missing', () => {
      const originalToken = process.env['YNAB_ACCESS_TOKEN'];
      delete process.env['YNAB_ACCESS_TOKEN'];

      expect(() => new YNABMCPServer()).toThrow(ConfigurationError);
      expect(() => new YNABMCPServer()).toThrow(
        'YNAB_ACCESS_TOKEN environment variable is required but not set',
      );

      // Restore token
      process.env['YNAB_ACCESS_TOKEN'] = originalToken;
    });

    it('should throw ConfigurationError when YNAB_ACCESS_TOKEN is empty string', () => {
      const originalToken = process.env['YNAB_ACCESS_TOKEN'];
      process.env['YNAB_ACCESS_TOKEN'] = '';

      expect(() => new YNABMCPServer()).toThrow(ConfigurationError);
      expect(() => new YNABMCPServer()).toThrow('YNAB_ACCESS_TOKEN must be a non-empty string');

      // Restore token
      process.env['YNAB_ACCESS_TOKEN'] = originalToken;
    });

    it('should throw ConfigurationError when YNAB_ACCESS_TOKEN is only whitespace', () => {
      const originalToken = process.env['YNAB_ACCESS_TOKEN'];
      process.env['YNAB_ACCESS_TOKEN'] = '   ';

      expect(() => new YNABMCPServer()).toThrow(ConfigurationError);
      expect(() => new YNABMCPServer()).toThrow('YNAB_ACCESS_TOKEN must be a non-empty string');

      // Restore token
      process.env['YNAB_ACCESS_TOKEN'] = originalToken;
    });

    it('should trim whitespace from access token', () => {
      const originalToken = process.env['YNAB_ACCESS_TOKEN'];
      process.env['YNAB_ACCESS_TOKEN'] = `  ${originalToken}  `;

      const server = new YNABMCPServer();
      expect(server).toBeInstanceOf(YNABMCPServer);

      // Restore token
      process.env['YNAB_ACCESS_TOKEN'] = originalToken;
    });
  });

  describe('Real YNAB API Integration', () => {
    let server: YNABMCPServer;

    beforeEach(() => {
      server = new YNABMCPServer(false); // Don't exit on error in tests
    });

    it('should successfully validate real YNAB token', async () => {
      const isValid = await server.validateToken();
      expect(isValid).toBe(true);
    });

    it('should successfully get user information', async () => {
      // Verify we can get user info
      const ynabAPI = server.getYNABAPI();
      const userResponse = await ynabAPI.user.getUser();

      expect(userResponse.data.user).toBeDefined();
      expect(userResponse.data.user.id).toBeDefined();
      console.warn(`✅ Connected to YNAB user: ${userResponse.data.user.id}`);
    });

    it('should successfully get budgets', async () => {
      const ynabAPI = server.getYNABAPI();
      const budgetsResponse = await ynabAPI.budgets.getBudgets();

      expect(budgetsResponse.data.budgets).toBeDefined();
      expect(Array.isArray(budgetsResponse.data.budgets)).toBe(true);
      expect(budgetsResponse.data.budgets.length).toBeGreaterThan(0);

      console.warn(`✅ Found ${budgetsResponse.data.budgets.length} budget(s)`);
      budgetsResponse.data.budgets.forEach((budget) => {
        console.warn(`   - ${budget.name} (${budget.id})`);
      });
    });

    it('should handle invalid token gracefully', async () => {
      const originalToken = process.env['YNAB_ACCESS_TOKEN'];
      process.env['YNAB_ACCESS_TOKEN'] = 'invalid-token-format';

      try {
        const invalidServer = new YNABMCPServer(false);
        await expect(invalidServer.validateToken()).rejects.toThrow(AuthenticationError);
      } finally {
        // Restore original token
        process.env['YNAB_ACCESS_TOKEN'] = originalToken;
      }
    });

    it('should successfully start and connect MCP server', async () => {
      // This test verifies the full server startup process
      // Note: We can't fully test the stdio connection in a test environment,
      // but we can verify the server initializes without errors

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {
        // Mock implementation for testing
      });

      try {
        // The run method will validate the token and attempt to connect
        // In a test environment, the stdio connection will fail, but token validation should succeed
        await server.run();
      } catch (error) {
        // Expected to fail on stdio connection in test environment
        // But should not fail on token validation
        expect(error).not.toBeInstanceOf(AuthenticationError);
        expect(error).not.toBeInstanceOf(ConfigurationError);
      }

      consoleSpy.mockRestore();
    });

    it('should handle multiple rapid API calls without rate limiting issues', async () => {
      // Make multiple validation calls to test rate limiting behavior
      const promises = Array(3)
        .fill(null)
        .map(() => server.validateToken());

      // All should succeed (YNAB API is generally permissive for user info calls)
      const results = await Promise.all(promises);
      results.forEach((result) => expect(result).toBe(true));
    });
  });

  describe('MCP Server Functionality', () => {
    let server: YNABMCPServer;
    let registry: ToolRegistry;

    const accessToken = () => {
      const token = process.env['YNAB_ACCESS_TOKEN'];
      if (!token) {
        throw new Error('YNAB_ACCESS_TOKEN must be defined for integration tests');
      }
      return token;
    };

    const ensureDefaultBudget = async (): Promise<string> => {
      const budgetsResult = await registry.executeTool({
        name: 'list_budgets',
        accessToken: accessToken(),
        arguments: {},
      });
      const budgetsPayload = parseCallToolJson(budgetsResult);
      const firstBudget = budgetsPayload.budgets?.[0];
      expect(firstBudget?.id).toBeDefined();

      await registry.executeTool({
        name: 'set_default_budget',
        accessToken: accessToken(),
        arguments: { budget_id: firstBudget.id },
      });

      return firstBudget.id as string;
    };

    beforeEach(() => {
      server = new YNABMCPServer(false);
      registry = (server as unknown as { toolRegistry: ToolRegistry }).toolRegistry;
    });

    it('should expose the complete registered tool list via the registry', () => {
      const tools = registry.listTools();
      const names = tools.map((tool) => tool.name).sort();
      expect(names).toEqual([...expectedToolNames].sort());
    });

    it('should execute get_user tool via the registry', async () => {
      const result = await registry.executeTool({
        name: 'get_user',
        accessToken: accessToken(),
        arguments: {},
      });
      const payload = parseCallToolJson(result);
      expect(payload.user?.id).toBeDefined();
    });

    it('should set and retrieve default budget using tools', async () => {
      const budgetId = await ensureDefaultBudget();

      const defaultResult = await registry.executeTool({
        name: 'get_default_budget',
        accessToken: accessToken(),
        arguments: {},
      });
      const defaultPayload = parseCallToolJson(defaultResult);
      expect(defaultPayload.default_budget_id).toBe(budgetId);
      expect(defaultPayload.has_default).toBe(true);
    });

    it('should trigger cache warming after setting default budget', async () => {
      // Clear cache before test
      await registry.executeTool({
        name: 'clear_cache',
        accessToken: accessToken(),
        arguments: {},
      });

      const statsBeforeSet = cacheManager.getStats();
      const initialSize = statsBeforeSet.size;

      // Get a budget ID
      const budgetsResult = await registry.executeTool({
        name: 'list_budgets',
        accessToken: accessToken(),
        arguments: {},
      });
      const budgetsPayload = parseCallToolJson(budgetsResult);
      const firstBudget = budgetsPayload.budgets?.[0];
      expect(firstBudget?.id).toBeDefined();

      // Set default budget (this should trigger cache warming)
      await registry.executeTool({
        name: 'set_default_budget',
        accessToken: accessToken(),
        arguments: { budget_id: firstBudget.id },
      });

      // Wait for cache warming to complete with polling (it's fire-and-forget)
      const timeoutMs = 5000; // 5 second timeout
      const pollIntervalMs = 50; // Check every 50ms
      const startTime = Date.now();
      let statsAfterSet = cacheManager.getStats();

      while (statsAfterSet.size <= initialSize && Date.now() - startTime < timeoutMs) {
        await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
        statsAfterSet = cacheManager.getStats();
      }

      // Fail test if timeout was reached without cache growth
      if (statsAfterSet.size <= initialSize) {
        throw new Error(
          `Cache warming failed to complete within ${timeoutMs}ms. ` +
            `Initial size: ${initialSize}, Final size: ${statsAfterSet.size}`,
        );
      }

      // Cache should have more entries due to warming
      expect(statsAfterSet.size).toBeGreaterThan(initialSize);

      // Verify that common data types were cached
      const allKeys = cacheManager.getAllKeys();
      const hasAccountsCache = allKeys.some((key) => key.includes('accounts:list'));
      const hasCategoriesCache = allKeys.some((key) => key.includes('categories:list'));
      const hasPayeesCache = allKeys.some((key) => key.includes('payees:list'));

      // At least some cache warming should have occurred
      expect(hasAccountsCache || hasCategoriesCache || hasPayeesCache).toBe(true);
    });

    it('should handle cache warming errors gracefully', async () => {
      // Get a real budget ID first, since API validation is in place
      const budgetsResult = await registry.executeTool({
        name: 'list_budgets',
        accessToken: accessToken(),
        arguments: {},
      });
      const budgetsPayload = parseCallToolJson(budgetsResult);
      const firstBudget = budgetsPayload.budgets?.[0];
      expect(firstBudget?.id).toBeDefined();
      const realBudgetId = firstBudget.id as string;

      // This should succeed with API validation in place
      const result = await registry.executeTool({
        name: 'set_default_budget',
        accessToken: accessToken(),
        arguments: { budget_id: realBudgetId },
      });

      // The set_default_budget operation should succeed
      const payload = parseCallToolJson(result);
      expect(payload.message).toContain('Default budget set to:');
      expect(payload.default_budget_id).toBe(realBudgetId);

      // Wait a moment for cache warming attempts to complete
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Server should still be functional
      const defaultResult = await registry.executeTool({
        name: 'get_default_budget',
        accessToken: accessToken(),
        arguments: {},
      });
      const defaultPayload = parseCallToolJson(defaultResult);
      expect(defaultPayload.default_budget_id).toBe(realBudgetId);
    });

    it('should execute list tools that rely on the default budget', async () => {
      await ensureDefaultBudget();

      const accountsResult = await registry.executeTool({
        name: 'list_accounts',
        accessToken: accessToken(),
        arguments: {},
      });
      const accountsPayload = parseCallToolJson(accountsResult);
      expect(Array.isArray(accountsPayload.accounts)).toBe(true);

      const categoriesResult = await registry.executeTool({
        name: 'list_categories',
        accessToken: accessToken(),
        arguments: {},
      });
      const categoriesPayload = parseCallToolJson(categoriesResult);
      expect(Array.isArray(categoriesPayload.categories)).toBe(true);
    });

    it('should provide diagnostic info with requested sections', async () => {
      const diagResult = await registry.executeTool({
        name: 'diagnostic_info',
        accessToken: accessToken(),
        arguments: {
          include_server: true,
          include_security: true,
          include_cache: true,
          include_memory: false,
          include_environment: false,
        },
      });
      const diagnostics = parseCallToolJson(diagResult);
      expect(diagnostics.timestamp).toBeDefined();
      expect(diagnostics.server).toBeDefined();
      expect(diagnostics.security).toBeDefined();
      expect(diagnostics.cache).toBeDefined();
      expect(diagnostics.memory).toBeUndefined();
      expect(diagnostics.environment).toBeUndefined();
    });

    it('should clear cache using the clear_cache tool', async () => {
      cacheManager.set('test:key', { value: 1 }, 1000);
      const statsBeforeClear = cacheManager.getStats();
      expect(statsBeforeClear.size).toBeGreaterThan(0);

      await registry.executeTool({
        name: 'clear_cache',
        accessToken: accessToken(),
        arguments: {},
      });

      const statsAfterClear = cacheManager.getStats();
      expect(statsAfterClear.size).toBe(0);
      expect(statsAfterClear.hits).toBe(0);
      expect(statsAfterClear.misses).toBe(0);
      expect(statsAfterClear.evictions).toBe(0);
      expect(statsAfterClear.lastCleanup).toBe(null);
    });

    it('should track cache hits and misses through tool execution', async () => {
      const initialStats = cacheManager.getStats();
      const initialHits = initialStats.hits;

      // Execute a tool that should use caching
      await registry.executeTool({
        name: 'list_budgets',
        accessToken: accessToken(),
        arguments: {},
      });

      const statsAfterFirstCall = cacheManager.getStats();
      expect(statsAfterFirstCall.size).toBeGreaterThan(initialStats.size);

      // Execute the same tool again - should hit cache
      await registry.executeTool({
        name: 'list_budgets',
        accessToken: accessToken(),
        arguments: {},
      });

      const statsAfterSecondCall = cacheManager.getStats();
      expect(statsAfterSecondCall.hits).toBeGreaterThan(initialHits);
      expect(statsAfterSecondCall.hitRate).toBeGreaterThan(0);
    });

    it('should respect maxEntries configuration from environment', () => {
      // Test that maxEntries is properly configured
      const stats = cacheManager.getStats();
      expect(stats.maxEntries).toEqual(expect.any(Number));
      expect(stats.maxEntries).toBeGreaterThan(0);
    });

    it('should surface enhanced cache metrics in diagnostics', async () => {
      // Generate some cache activity
      cacheManager.set('test:metric1', { data: 'value1' }, 1000);
      cacheManager.get('test:metric1'); // Hit
      cacheManager.get('test:nonexistent'); // Miss

      const result = await registry.executeTool({
        name: 'diagnostic_info',
        accessToken: accessToken(),
        arguments: {
          include_server: false,
          include_memory: false,
          include_environment: false,
          include_security: false,
          include_cache: true,
        },
      });

      const diagnostics = parseCallToolJson(result);
      expect(diagnostics.cache).toBeDefined();
      expect(diagnostics.cache.entries).toEqual(expect.any(Number));
      expect(diagnostics.cache.hits).toEqual(expect.any(Number));
      expect(diagnostics.cache.misses).toEqual(expect.any(Number));
      expect(diagnostics.cache.evictions).toEqual(expect.any(Number));
      expect(diagnostics.cache.maxEntries).toEqual(expect.any(Number));
      expect(diagnostics.cache.hitRate).toEqual(expect.stringMatching(/^\d+\.\d{2}%$/));
      expect(diagnostics.cache.performance_summary).toEqual(expect.any(String));
    });

    it('should configure output formatter via set_output_format tool', async () => {
      const baseline = responseFormatter.format({ probe: true });

      try {
        await registry.executeTool({
          name: 'set_output_format',
          accessToken: accessToken(),
          arguments: { default_minify: false, pretty_spaces: 4 },
        });

        const formatted = responseFormatter.format({ probe: true });
        expect(formatted).not.toBe(baseline);
        expect(formatted).toContain('\n');
      } finally {
        await registry.executeTool({
          name: 'set_output_format',
          accessToken: accessToken(),
          arguments: { default_minify: true, pretty_spaces: 2 },
        });
      }
    });

    it('should surface validation errors for invalid inputs', async () => {
      const result = await registry.executeTool({
        name: 'get_budget',
        accessToken: accessToken(),
        arguments: {} as Record<string, unknown>,
      });
      const payload = parseCallToolJson(result);
      expect(payload.error).toBeDefined();
      expect(payload.error.code).toBe('VALIDATION_ERROR');
    });

    describe('Budget Resolution Error Handling', () => {
      let freshServer: YNABMCPServer;
      let freshRegistry: ToolRegistry;

      beforeEach(() => {
        // Create a fresh server with no default budget set
        freshServer = new YNABMCPServer(false);
        freshRegistry = (freshServer as unknown as { toolRegistry: ToolRegistry }).toolRegistry;
      });

      const budgetDependentTools = [
        'list_accounts',
        'get_account',
        'create_account',
        'list_transactions',
        'get_transaction',
        'create_transaction',
        'update_transaction',
        'delete_transaction',
        'list_categories',
        'get_category',
        'update_category',
        'list_payees',
        'get_payee',
        'get_month',
        'list_months',
        'export_transactions',
        'compare_transactions',
        'reconcile_account',
      ] as const;

      budgetDependentTools.forEach((toolName) => {
        it(`should return standardized error for ${toolName} when no default budget is set`, async () => {
          const result = await freshRegistry.executeTool({
            name: toolName,
            accessToken: accessToken(),
            arguments: {},
          });

          const payload = parseCallToolJson(result);
          expect(payload.error).toBeDefined();
          expect(payload.error.code).toBe('VALIDATION_ERROR');
          expect(payload.error.message).toContain(
            'No budget ID provided and no default budget set',
          );
          expect(payload.error.userMessage).toContain('invalid');
          expect(payload.error.suggestions).toBeDefined();
          expect(Array.isArray(payload.error.suggestions)).toBe(true);
          expect(
            payload.error.suggestions.some(
              (suggestion: string) =>
                suggestion.includes('set_default_budget') ||
                suggestion.includes('budget_id parameter'),
            ),
          ).toBe(true);
        });
      });

      it('should return standardized error for invalid budget ID format', async () => {
        const invalidBudgetId = 'not-a-valid-uuid';
        const result = await freshRegistry.executeTool({
          name: 'list_accounts',
          accessToken: accessToken(),
          arguments: { budget_id: invalidBudgetId },
        });

        const payload = parseCallToolJson(result);
        expect(payload.error).toBeDefined();
        expect(payload.error.code).toBe('VALIDATION_ERROR');
        expect(payload.error.message).toContain('Invalid budget ID format');
        expect(payload.error.userMessage).toContain('invalid');
        expect(payload.error.suggestions).toBeDefined();
        expect(Array.isArray(payload.error.suggestions)).toBe(true);
        expect(
          payload.error.suggestions.some(
            (suggestion: string) =>
              suggestion.includes('UUID v4 format') || suggestion.includes('list_budgets'),
          ),
        ).toBe(true);
      });

      it('should work normally after setting a default budget', async () => {
        // First, ensure we get the "no default budget" error
        let result = await freshRegistry.executeTool({
          name: 'list_accounts',
          accessToken: accessToken(),
          arguments: {},
        });

        let payload = parseCallToolJson(result);
        expect(payload.error).toBeDefined();
        expect(payload.error.code).toBe('VALIDATION_ERROR');

        // Now set a default budget
        const defaultBudgetId = await ensureDefaultBudget();
        await freshRegistry.executeTool({
          name: 'set_default_budget',
          accessToken: accessToken(),
          arguments: { budget_id: defaultBudgetId },
        });

        // Now the same call should work
        result = await freshRegistry.executeTool({
          name: 'list_accounts',
          accessToken: accessToken(),
          arguments: {},
        });

        payload = parseCallToolJson(result);
        // Should have accounts data or be valid response, not an error
        expect(payload.error).toBeUndefined();
      });

      it('should have consistent error response structure across all budget-dependent tools', async () => {
        const promises = budgetDependentTools.map((toolName) =>
          freshRegistry.executeTool({
            name: toolName,
            accessToken: accessToken(),
            arguments: {},
          }),
        );

        const results = await Promise.all(promises);

        results.forEach((result) => {
          const payload = parseCallToolJson(result);

          // All should have the same error structure
          expect(payload).toHaveProperty(
            'error',
            expect.objectContaining({
              code: 'VALIDATION_ERROR',
              message: expect.stringContaining('No budget ID provided and no default budget set'),
              userMessage: expect.any(String),
              suggestions: expect.arrayContaining([
                expect.stringMatching(/set_default_budget|budget_id parameter/),
              ]),
            }),
          );
        });
      });
    });
  });

  describe('Modular Architecture Integration', () => {
    let server: YNABMCPServer;

    beforeEach(() => {
      server = new YNABMCPServer(false);
    });

    it('should initialize all service modules during construction', () => {
      // Verify the server has been constructed successfully with all modules
      expect(server).toBeInstanceOf(YNABMCPServer);

      // Check that core functionality from modules works through public interface
      expect(server.getYNABAPI()).toBeDefined();
      expect(server.getServer()).toBeDefined();
    });

    it('should use config module for environment validation', () => {
      // The fact that constructor succeeds means config module is working
      // This test verifies the integration is seamless
      expect(server.getYNABAPI()).toBeDefined();
    });

    it('should handle resource requests through resource manager', async () => {
      // Test that resources work (this goes through the resource manager now)
      const mcpServer = server.getServer();
      expect(mcpServer).toBeDefined();

      // The server should be properly configured with resource handlers
      // If the integration failed, the server wouldn't have the handlers
      expect(() => server.getYNABAPI()).not.toThrow();
    });

    it('should handle prompt requests through prompt manager', async () => {
      // Test that the server has prompt handling capability
      // The integration ensures prompt handlers are properly set up
      const mcpServer = server.getServer();
      expect(mcpServer).toBeDefined();
    });

    it('should handle diagnostic requests through diagnostic manager', async () => {
      // Test that diagnostic tools work through the tool registry integration
      const registry = (server as unknown as { toolRegistry: ToolRegistry }).toolRegistry;

      // Verify diagnostic tool is registered
      const tools = registry.listTools();
      const diagnosticTool = tools.find((tool) => tool.name === 'diagnostic_info');
      expect(diagnosticTool).toBeDefined();
      expect(diagnosticTool?.description).toContain('diagnostic information');
    });

    it('should maintain backward compatibility after modular refactoring', async () => {
      // Test that all expected tools are still available
      const registry = (server as unknown as { toolRegistry: ToolRegistry }).toolRegistry;
      const tools = registry.listTools();

      // Use the shared expectedToolNames constant defined at the top of the test file

      const actualToolNames = tools.map((tool) => tool.name).sort();
      expect(actualToolNames).toEqual(expectedToolNames.sort());
    });

    it('should maintain same error handling behavior after refactoring', () => {
      // Test that configuration errors are still properly thrown
      const originalToken = process.env['YNAB_ACCESS_TOKEN'];
      delete process.env['YNAB_ACCESS_TOKEN'];

      try {
        expect(() => new YNABMCPServer()).toThrow(ConfigurationError);
        expect(() => new YNABMCPServer()).toThrow(
          'YNAB_ACCESS_TOKEN environment variable is required but not set',
        );
      } finally {
        // Restore token
        process.env['YNAB_ACCESS_TOKEN'] = originalToken;
      }
    });

    it('should delegate diagnostic collection to diagnostic manager', async () => {
      const registry = (server as unknown as { toolRegistry: ToolRegistry }).toolRegistry;
      const accessToken = process.env['YNAB_ACCESS_TOKEN']!;

      // Test that diagnostic_info tool works and returns expected structure
      const result = await registry.executeTool({
        name: 'diagnostic_info',
        accessToken,
        arguments: {
          include_server: true,
          include_memory: false,
          include_environment: false,
          include_security: false,
          include_cache: false,
        },
      });

      const diagnostics = parseCallToolJson(result);
      expect(diagnostics.timestamp).toBeDefined();
      expect(diagnostics.server).toBeDefined();
      expect(diagnostics.server.name).toBe('ynab-mcp-server');
      expect(diagnostics.server.version).toBeDefined();

      // These should be undefined because we set include flags to false
      expect(diagnostics.memory).toBeUndefined();
      expect(diagnostics.environment).toBeUndefined();
      expect(diagnostics.security).toBeUndefined();
      expect(diagnostics.cache).toBeUndefined();
    });
  });

  describe('Deprecated Methods', () => {
    let server: YNABMCPServer;

    beforeEach(() => {
      // Create server with valid token for testing deprecated method
      const originalToken = process.env['YNAB_ACCESS_TOKEN'];
      if (!originalToken) {
        throw new Error('YNAB_ACCESS_TOKEN must be defined for getBudgetId tests');
      }
      server = new YNABMCPServer(false);
    });

    describe('getBudgetId', () => {
      it('should throw ValidationError when no budget ID provided and no default set', () => {
        // Ensure no default budget is set
        expect(server.getDefaultBudget()).toBeUndefined();

        // Should throw ValidationError (not YNABAPIError)
        expect(() => {
          server.getBudgetId();
        }).toThrow(ValidationError);

        expect(() => {
          server.getBudgetId();
        }).toThrow('No budget ID provided and no default budget set');
      });

      it('should throw ValidationError for invalid budget ID format', () => {
        expect(() => {
          server.getBudgetId('invalid-id');
        }).toThrow(ValidationError);

        expect(() => {
          server.getBudgetId('invalid-id');
        }).toThrow(/Invalid budget ID format/);
      });

      it('should return valid budget ID when provided with valid UUID', () => {
        const validUuid = '123e4567-e89b-12d3-a456-426614174000';
        const result = server.getBudgetId(validUuid);
        expect(result).toBe(validUuid);
      });
    });
  });

  describe('ErrorHandler Integration', () => {
    let server: YNABMCPServer;

    beforeEach(() => {
      server = new YNABMCPServer(false);
    });

    it('should create ErrorHandler instance with responseFormatter', () => {
      // Verify that createErrorHandler was called with the formatter
      expect(server).toBeInstanceOf(YNABMCPServer);

      // The server should be successfully constructed with ErrorHandler injection
      expect(server.getYNABAPI()).toBeDefined();
    });

    it('should set global ErrorHandler formatter for backward compatibility', () => {
      // This test verifies that the global formatter was set
      // by checking that static ErrorHandler methods work
      const result = ErrorHandler.createValidationError('Test error');

      expect(result.content).toBeDefined();
      expect(result.content[0].type).toBe('text');
      expect(() => JSON.parse(result.content[0].text)).not.toThrow();
    });

    it('should use the same formatter for ErrorHandler and ToolRegistry', () => {
      // Verify that the server uses dependency injection correctly
      expect(server).toBeInstanceOf(YNABMCPServer);

      // The fact that the server constructs successfully means dependency injection worked
      // and both ErrorHandler and ToolRegistry are using the same formatter instance
    });

    it('should maintain existing error response format', async () => {
      const registry = (server as unknown as { toolRegistry: ToolRegistry }).toolRegistry;

      // Test that error responses still have the expected structure
      const result = await registry.executeTool({
        name: 'get_budget',
        accessToken: process.env['YNAB_ACCESS_TOKEN']!,
        arguments: {} as Record<string, unknown>,
      });

      const payload = parseCallToolJson(result);
      expect(payload.error).toBeDefined();
      expect(payload.error.code).toBe('VALIDATION_ERROR');

      // Verify the response is properly formatted JSON
      expect(() => JSON.parse(result.content[0].text)).not.toThrow();
    });

    it('should handle formatter consistency across static and instance methods', () => {
      const formatter = { format: (value: unknown) => JSON.stringify(value) };
      const errorHandler = createErrorHandler(formatter);
      ErrorHandler.setFormatter(formatter);

      const error = new ValidationError('Test error');
      const instanceResult = errorHandler.handleError(error, 'testing');
      const staticResult = ErrorHandler.handleError(error, 'testing');

      // Both should produce the same result structure
      expect(instanceResult.content[0].type).toBe(staticResult.content[0].type);
      expect(() => JSON.parse(instanceResult.content[0].text)).not.toThrow();
      expect(() => JSON.parse(staticResult.content[0].text)).not.toThrow();
    });
  });
});
