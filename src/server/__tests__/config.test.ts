import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';

// Mock process.env
const originalEnv = { ...process.env };

describe('Config Module', () => {
  beforeEach(() => {
    vi.resetModules(); // Reset modules to ensure config is re-evaluated
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('should load YNAB_ACCESS_TOKEN from environment variables', async () => {
    const mockToken = 'test-token-123';
    process.env.YNAB_ACCESS_TOKEN = mockToken;

    const { config } = await import('../config');
    expect(config.YNAB_ACCESS_TOKEN).toBe(mockToken);
  });

  it('should throw a detailed error if YNAB_ACCESS_TOKEN is missing', async () => {
    delete process.env.YNAB_ACCESS_TOKEN;

    await expect(import('../config')).rejects.toThrow(
      /Validation error: Invalid input: expected string, received undefined at "YNAB_ACCESS_TOKEN"/i,
    );
  });

  it('should parse optional MCP_PORT correctly', async () => {
    process.env.YNAB_ACCESS_TOKEN = 'token';
    process.env.MCP_PORT = '8080';

    const { config } = await import('../config');
    expect(config.MCP_PORT).toBe(8080);
  });

  it('should handle missing optional MCP_PORT', async () => {
    process.env.YNAB_ACCESS_TOKEN = 'token';
    delete process.env.MCP_PORT;

    const { config } = await import('../config');
    expect(config.MCP_PORT).toBeUndefined();
  });

  it('should throw an error for an invalid MCP_PORT', async () => {
    process.env.YNAB_ACCESS_TOKEN = 'token';
    process.env.MCP_PORT = 'invalid-port';

    await expect(import('../config')).rejects.toThrow(
      /Validation error: Invalid input: expected number, received nan at "MCP_PORT"/i,
    );
  });

  it('should correctly parse LOG_LEVEL', async () => {
    process.env.YNAB_ACCESS_TOKEN = 'token';
    process.env.LOG_LEVEL = 'debug';
    const { config } = await import('../config');
    expect(config.LOG_LEVEL).toBe('debug');
  });

  it('should use "info" as default LOG_LEVEL', async () => {
    process.env.YNAB_ACCESS_TOKEN = 'token';
    delete process.env.LOG_LEVEL; // Ensure LOG_LEVEL is not set
    const { config } = await import('../config');
    expect(config.LOG_LEVEL).toBe('info');
  });
});
