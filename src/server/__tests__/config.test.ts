import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';

const originalEnv = { ...process.env };

describe('Config Module', () => {
  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
    if (!process.env.YNAB_ACCESS_TOKEN) {
      process.env.YNAB_ACCESS_TOKEN = 'test-token-placeholder';
    }
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('reloads environment variables on each loadConfig call', async () => {
    const { loadConfig } = await import('../config');
    process.env.YNAB_ACCESS_TOKEN = 'test-token-123';
    expect(loadConfig().YNAB_ACCESS_TOKEN).toBe('test-token-123');

    process.env.YNAB_ACCESS_TOKEN = 'updated-token-456';
    expect(loadConfig().YNAB_ACCESS_TOKEN).toBe('updated-token-456');
  });

  it('keeps the config singleton as a one-time parse', async () => {
    process.env.YNAB_ACCESS_TOKEN = 'initial-token';
    const { config, loadConfig } = await import('../config');
    expect(config.YNAB_ACCESS_TOKEN).toBe('initial-token');

    process.env.YNAB_ACCESS_TOKEN = 'later-token';
    expect(config.YNAB_ACCESS_TOKEN).toBe('initial-token');
    expect(loadConfig().YNAB_ACCESS_TOKEN).toBe('later-token');
  });

  it('throws a detailed error if YNAB_ACCESS_TOKEN is missing', async () => {
    const { loadConfig } = await import('../config');
    const env = { ...process.env };
    delete env.YNAB_ACCESS_TOKEN;

    expect.assertions(2);
    try {
      loadConfig(env);
    } catch (error) {
      expect((error as { name?: string }).name).toBe('ValidationError');
      expect((error as Error).message).toMatch(/YNAB_ACCESS_TOKEN/i);
    }
  });

  it('parses optional MCP_PORT correctly', async () => {
    const { loadConfig } = await import('../config');
    const env = { ...process.env, YNAB_ACCESS_TOKEN: 'token', MCP_PORT: '8080' };

    const parsed = loadConfig(env);
    expect(parsed.MCP_PORT).toBe(8080);
  });

  it('handles missing optional MCP_PORT', async () => {
    const { loadConfig } = await import('../config');
    const env = { ...process.env, YNAB_ACCESS_TOKEN: 'token' };
    delete env.MCP_PORT;

    const parsed = loadConfig(env);
    expect(parsed.MCP_PORT).toBeUndefined();
  });

  it('throws an error for an invalid MCP_PORT', async () => {
    const { loadConfig } = await import('../config');
    const env = { ...process.env, YNAB_ACCESS_TOKEN: 'token', MCP_PORT: 'invalid-port' };

    expect.assertions(2);
    try {
      loadConfig(env);
    } catch (error) {
      expect((error as { name?: string }).name).toBe('ValidationError');
      expect((error as Error).message).toMatch(/MCP_PORT/i);
    }
  });

  it('parses LOG_LEVEL and defaults to info', async () => {
    const { loadConfig } = await import('../config');
    const envWithLog = { ...process.env, YNAB_ACCESS_TOKEN: 'token', LOG_LEVEL: 'debug' };
    expect(loadConfig(envWithLog).LOG_LEVEL).toBe('debug');

    const envWithoutLog = { ...envWithLog };
    delete envWithoutLog.LOG_LEVEL; // Ensure LOG_LEVEL is not set
    expect(loadConfig(envWithoutLog).LOG_LEVEL).toBe('info');
  });
});
