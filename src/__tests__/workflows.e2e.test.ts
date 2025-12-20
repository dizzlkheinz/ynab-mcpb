/**
 * End-to-end smoke tests for YNAB MCP Server
 * These tests require a real YNAB API key but only perform read operations
 * to verify connectivity and basic functionality without hitting rate limits.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { YNABMCPServer } from '../server/YNABMCPServer.js';
import {
  getTestConfig,
  createTestServer,
  executeToolCall,
  parseToolResult,
  validateOutputSchema,
} from './testUtils.js';

const runE2ETests = process.env['SKIP_E2E_TESTS'] !== 'true';
const describeE2E = runE2ETests ? describe : describe.skip;

describeE2E('YNAB MCP Server - Smoke Tests', () => {
  let server: YNABMCPServer;
  let testConfig: ReturnType<typeof getTestConfig>;

  beforeAll(async () => {
    testConfig = getTestConfig();

    if (testConfig.skipE2ETests) {
      console.warn('Skipping E2E smoke tests - no real API key or SKIP_E2E_TESTS=true');
      return;
    }

    server = await createTestServer();
  });

  it('should authenticate and retrieve user information', async () => {
    if (testConfig.skipE2ETests) return;

    const result = await executeToolCall(server, 'ynab:get_user');

    // Validate output schema
    const validation = validateOutputSchema(server, 'get_user', result);
    expect(validation.valid).toBe(true);

    const data = parseToolResult(result);
    expect(data.data.user).toBeDefined();
    expect(data.data.user.id).toBeDefined();
  });

  it('should list budgets', async () => {
    if (testConfig.skipE2ETests) return;

    const result = await executeToolCall(server, 'ynab:list_budgets');

    // Validate output schema
    const validation = validateOutputSchema(server, 'list_budgets', result);
    expect(validation.valid).toBe(true);

    const data = parseToolResult(result);
    expect(Array.isArray(data.data.budgets)).toBe(true);
  });
});
