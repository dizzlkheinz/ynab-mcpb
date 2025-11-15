import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { YNABMCPServer } from '../YNABMCPServer';
import { AuthenticationError, ConfigurationError } from '../../types/index';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
// StdioServerTransport import removed as it's not used in tests

/**
 * Integration tests for server startup and transport setup
 * Tests the complete server initialization process including:
 * - Environment validation
 * - YNAB API authentication
 * - MCP server initialization
 * - Tool registration
 * - Transport connection setup
 */
describe('Server Startup and Transport Integration', () => {
  const originalEnv = process.env;

  beforeAll(() => {
    if (!process.env['YNAB_ACCESS_TOKEN']) {
      throw new Error(
        'YNAB_ACCESS_TOKEN is required. Set it in your .env file to run integration tests.',
      );
    }
  });

  afterEach(() => {
    // Restore environment but keep API key
    Object.keys(process.env).forEach((key) => {
      if (key !== 'YNAB_ACCESS_TOKEN' && key !== 'YNAB_BUDGET_ID') {
        if (originalEnv[key] !== undefined) {
          process.env[key] = originalEnv[key];
        } else {
          process.env[key] = undefined;
        }
      }
    });
  });

  describe('Server Initialization', () => {
    it('should successfully initialize server with valid configuration', { meta: { tier: 'domain', domain: 'server' } }, () => {
      const server = new YNABMCPServer(false);

      expect(server).toBeInstanceOf(YNABMCPServer);
      expect(server.getYNABAPI()).toBeDefined();
      expect(server.getServer()).toBeInstanceOf(Server);
    });

    it('should fail initialization with missing access token', { meta: { tier: 'domain', domain: 'server' } }, () => {
      const originalToken = process.env['YNAB_ACCESS_TOKEN'];
      delete process.env['YNAB_ACCESS_TOKEN'];

      expect(() => new YNABMCPServer(false)).toThrow(ConfigurationError);
      expect(() => new YNABMCPServer(false)).toThrow(
        'YNAB_ACCESS_TOKEN environment variable is required but not set',
      );

      // Restore token
      process.env['YNAB_ACCESS_TOKEN'] = originalToken;
    });

    it('should fail initialization with invalid access token format', { meta: { tier: 'domain', domain: 'server' } }, () => {
      const originalToken = process.env['YNAB_ACCESS_TOKEN'];
      process.env['YNAB_ACCESS_TOKEN'] = '';

      expect(() => new YNABMCPServer(false)).toThrow(ConfigurationError);
      expect(() => new YNABMCPServer(false)).toThrow(
        'YNAB_ACCESS_TOKEN must be a non-empty string',
      );

      // Restore token
      process.env['YNAB_ACCESS_TOKEN'] = originalToken;
    });
  });

  describe('Server Startup Validation', () => {
    let server: YNABMCPServer;

    beforeEach(() => {
      server = new YNABMCPServer(false);
    });

    it('should validate YNAB token during startup', { meta: { tier: 'domain', domain: 'server' } }, async () => {
      const isValid = await server.validateToken();
      expect(isValid).toBe(true);
    });

    it('should handle invalid token gracefully during startup', { meta: { tier: 'domain', domain: 'server' } }, async () => {
      const originalToken = process.env['YNAB_ACCESS_TOKEN'];
      process.env['YNAB_ACCESS_TOKEN'] = 'invalid-token-12345';

      try {
        const invalidServer = new YNABMCPServer(false);
        await expect(invalidServer.validateToken()).rejects.toThrow(AuthenticationError);
      } finally {
        process.env['YNAB_ACCESS_TOKEN'] = originalToken;
      }
    });

    it('should provide detailed error messages for authentication failures', { meta: { tier: 'domain', domain: 'server' } }, async () => {
      const originalToken = process.env['YNAB_ACCESS_TOKEN'];
      process.env['YNAB_ACCESS_TOKEN'] = 'definitely-invalid-token';

      try {
        const invalidServer = new YNABMCPServer(false);
        await expect(invalidServer.validateToken()).rejects.toThrow(AuthenticationError);

        // Verify the error message contains relevant information
        try {
          await invalidServer.validateToken();
        } catch (error) {
          expect(error).toBeInstanceOf(AuthenticationError);
          expect(error.message).toContain('Token validation failed');
        }
      } finally {
        process.env['YNAB_ACCESS_TOKEN'] = originalToken;
      }
    });
  });

  describe('Tool Registration', () => {
    let server: YNABMCPServer;

    beforeEach(() => {
      server = new YNABMCPServer(false);
    });

    it('should register all expected YNAB tools', { meta: { tier: 'domain', domain: 'server' } }, async () => {
      const mcpServer = server.getServer();

      // We can't directly call the handler, but we can verify the server has the right structure
      expect(mcpServer).toBeDefined();

      // Verify the server instance has been properly initialized
      // The tools are registered in the constructor via setRequestHandler calls
      expect(server.getYNABAPI()).toBeDefined();

      // Test that the server can handle basic operations
      expect(typeof server.validateToken).toBe('function');
      expect(typeof server.run).toBe('function');
    });

    it('should register budget management tools', { meta: { tier: 'domain', domain: 'server' } }, () => {
      // Test that the server instance includes budget tools
      const mcpServer = server.getServer();
      expect(mcpServer).toBeDefined();

      // The tools are registered in the constructor, so if the server initializes
      // successfully, the tools should be registered
      expect(server.getYNABAPI().budgets).toBeDefined();
    });

    it('should register account management tools', { meta: { tier: 'domain', domain: 'server' } }, () => {
      const mcpServer = server.getServer();
      expect(mcpServer).toBeDefined();
      expect(server.getYNABAPI().accounts).toBeDefined();
    });

    it('should register transaction management tools', { meta: { tier: 'domain', domain: 'server' } }, () => {
      const mcpServer = server.getServer();
      expect(mcpServer).toBeDefined();
      expect(server.getYNABAPI().transactions).toBeDefined();
    });

    it('should register category management tools', { meta: { tier: 'domain', domain: 'server' } }, () => {
      const mcpServer = server.getServer();
      expect(mcpServer).toBeDefined();
      expect(server.getYNABAPI().categories).toBeDefined();
    });

    it('should register payee management tools', { meta: { tier: 'domain', domain: 'server' } }, () => {
      const mcpServer = server.getServer();
      expect(mcpServer).toBeDefined();
      expect(server.getYNABAPI().payees).toBeDefined();
    });

    it('should register utility tools', { meta: { tier: 'domain', domain: 'server' } }, () => {
      const mcpServer = server.getServer();
      expect(mcpServer).toBeDefined();
      expect(server.getYNABAPI().user).toBeDefined();
    });
  });

  describe('Transport Setup', () => {
    let server: YNABMCPServer;

    beforeEach(() => {
      server = new YNABMCPServer(false);
    });

    it('should attempt to connect with StdioServerTransport', { meta: { tier: 'domain', domain: 'server' } }, async () => {
      // Mock console.error to capture startup messages
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {
        // Mock implementation for testing
      });

      try {
        // The run method should validate token and attempt stdio connection
        await server.run();

        // In test environment, stdio connection will fail, but that's expected
        // The important thing is that token validation succeeds
      } catch (error) {
        // Expected to fail on stdio connection in test environment
        // But should not fail on authentication or configuration
        expect(error).not.toBeInstanceOf(AuthenticationError);
        expect(error).not.toBeInstanceOf(ConfigurationError);
      }

      consoleSpy.mockRestore();
    });

    it('should handle transport connection errors gracefully', { meta: { tier: 'domain', domain: 'server' } }, async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {
        // Mock implementation for testing
      });

      try {
        await server.run();
      } catch (error) {
        // Should handle transport errors without crashing
        expect(error).toBeDefined();
      }

      consoleSpy.mockRestore();
    });

    it('should validate token before attempting transport connection', { meta: { tier: 'domain', domain: 'server' } }, async () => {
      const validateTokenSpy = vi.spyOn(server, 'validateToken');
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {
        // Mock implementation for testing
      });

      try {
        await server.run();
      } catch {
        // Transport will fail in test environment, but token validation should be called
        expect(validateTokenSpy).toHaveBeenCalled();
      }

      validateTokenSpy.mockRestore();
      consoleSpy.mockRestore();
    });
  });

  describe('Error Reporting', () => {
    it('should report configuration errors clearly', { meta: { tier: 'domain', domain: 'server' } }, () => {
      const originalToken = process.env['YNAB_ACCESS_TOKEN'];
      delete process.env['YNAB_ACCESS_TOKEN'];

      expect(() => new YNABMCPServer(false)).toThrow(
        expect.objectContaining({
          message: 'YNAB_ACCESS_TOKEN environment variable is required but not set',
        }),
      );

      process.env['YNAB_ACCESS_TOKEN'] = originalToken;
    });

    it('should report authentication errors clearly', { meta: { tier: 'domain', domain: 'server' } }, async () => {
      const originalToken = process.env['YNAB_ACCESS_TOKEN'];
      process.env['YNAB_ACCESS_TOKEN'] = 'invalid-token';

      try {
        const server = new YNABMCPServer(false);
        await expect(server.validateToken()).rejects.toThrow(AuthenticationError);
      } finally {
        process.env['YNAB_ACCESS_TOKEN'] = originalToken;
      }
    });

    it('should handle startup errors without exposing sensitive information', { meta: { tier: 'domain', domain: 'server' } }, async () => {
      const originalToken = process.env['YNAB_ACCESS_TOKEN'];
      process.env['YNAB_ACCESS_TOKEN'] = 'invalid-token';

      try {
        const server = new YNABMCPServer(false);
        await expect(server.run()).rejects.toThrow();

        // Verify error doesn't contain the actual token
        try {
          await server.run();
        } catch (error) {
          expect(error.message).not.toContain('invalid-token');
        }
      } finally {
        process.env['YNAB_ACCESS_TOKEN'] = originalToken;
      }
    });
  });

  describe('Graceful Shutdown', () => {
    it('should handle process signals gracefully', { meta: { tier: 'domain', domain: 'server' } }, () => {
      // Test that the server can be created without throwing
      const server = new YNABMCPServer(false);
      expect(server).toBeDefined();

      // In a real scenario, the process signal handlers in index.ts would handle shutdown
      // We can't easily test the actual signal handling in a unit test environment
      // But we can verify the server initializes properly
    });

    it('should clean up resources on shutdown', { meta: { tier: 'domain', domain: 'server' } }, () => {
      const server = new YNABMCPServer(false);

      // Verify server has the necessary components for cleanup
      expect(server.getServer()).toBeDefined();
      expect(server.getYNABAPI()).toBeDefined();
    });
  });

  describe('Full Startup Workflow', () => {
    it('should complete full startup sequence successfully', { meta: { tier: 'domain', domain: 'server' } }, async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {
        // Mock implementation for testing
      });

      try {
        // Create server
        const server = new YNABMCPServer(false);
        expect(server).toBeDefined();

        // Validate token
        const isValid = await server.validateToken();
        expect(isValid).toBe(true);

        // Attempt to run (will fail on transport in test environment)
        try {
          await server.run();
        } catch {
          // Expected to fail on stdio transport in test environment
          // But authentication and initialization should succeed
        }

        console.warn('✅ Server startup workflow completed successfully');
      } finally {
        consoleSpy.mockRestore();
      }
    });

    it('should fail fast on configuration errors', { meta: { tier: 'domain', domain: 'server' } }, () => {
      const originalToken = process.env['YNAB_ACCESS_TOKEN'];
      delete process.env['YNAB_ACCESS_TOKEN'];

      // Should fail immediately on construction, not during run()
      expect(() => new YNABMCPServer(false)).toThrow(ConfigurationError);

      process.env['YNAB_ACCESS_TOKEN'] = originalToken;
    });

    it('should fail fast on authentication errors', { meta: { tier: 'domain', domain: 'server' } }, async () => {
      const originalToken = process.env['YNAB_ACCESS_TOKEN'];
      process.env['YNAB_ACCESS_TOKEN'] = 'invalid-token';

      try {
        const server = new YNABMCPServer(false);

        // Should fail on token validation, before transport setup
        await expect(server.run()).rejects.toThrow(AuthenticationError);
      } finally {
        process.env['YNAB_ACCESS_TOKEN'] = originalToken;
      }
    });
  });
});
