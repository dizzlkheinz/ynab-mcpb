/**
 * Unit tests for utility output schemas
 *
 * Tests schema validation for utility tool outputs including:
 * - SetOutputFormatOutputSchema
 * - DiagnosticInfoOutputSchema with null cases
 */

import { describe, it, expect } from 'vitest';
import {
  SetOutputFormatOutputSchema,
  DiagnosticInfoOutputSchema,
  EnvironmentInfoSchema,
  CacheInfoSchema,
  DeltaInfoSchema,
} from '../utilityOutputs.js';

describe('SetOutputFormatOutputSchema', () => {
  it('should validate output with success, message, and options', () => {
    const validOutput = {
      success: true,
      message: 'Output format configured: minify=true, spaces=2',
      options: {
        defaultMinify: true,
        prettySpaces: 2,
      },
    };

    const result = SetOutputFormatOutputSchema.safeParse(validOutput);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual(validOutput);
    }
  });

  it('should validate output with only defaultMinify option', () => {
    const validOutput = {
      success: true,
      message: 'Output format configured: minify=false',
      options: {
        defaultMinify: false,
      },
    };

    const result = SetOutputFormatOutputSchema.safeParse(validOutput);
    expect(result.success).toBe(true);
  });

  it('should validate output with only prettySpaces option', () => {
    const validOutput = {
      success: true,
      message: 'Output format configured: spaces=4',
      options: {
        prettySpaces: 4,
      },
    };

    const result = SetOutputFormatOutputSchema.safeParse(validOutput);
    expect(result.success).toBe(true);
  });

  it('should validate output with empty options', () => {
    const validOutput = {
      success: true,
      message: 'Output format configured',
      options: {},
    };

    const result = SetOutputFormatOutputSchema.safeParse(validOutput);
    expect(result.success).toBe(true);
  });

  it('should fail validation when missing required success field', () => {
    const invalidOutput = {
      message: 'Output format configured',
      options: {},
    };

    const result = SetOutputFormatOutputSchema.safeParse(invalidOutput);
    expect(result.success).toBe(false);
  });

  it('should fail validation when missing required message field', () => {
    const invalidOutput = {
      success: true,
      options: {},
    };

    const result = SetOutputFormatOutputSchema.safeParse(invalidOutput);
    expect(result.success).toBe(false);
  });

  it('should fail validation when missing required options field', () => {
    const invalidOutput = {
      success: true,
      message: 'Output format configured',
    };

    const result = SetOutputFormatOutputSchema.safeParse(invalidOutput);
    expect(result.success).toBe(false);
  });
});

describe('EnvironmentInfoSchema', () => {
  it('should validate environment info with null token_preview', () => {
    const validEnvironment = {
      token_present: false,
      token_length: 0,
      token_preview: null,
      ynab_env_keys_present: [],
      working_directory: '/path/to/project',
    };

    const result = EnvironmentInfoSchema.safeParse(validEnvironment);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.token_preview).toBeNull();
    }
  });

  it('should validate environment info with string token_preview', () => {
    const validEnvironment = {
      token_present: true,
      token_length: 64,
      token_preview: 'abcd...xyz',
      ynab_env_keys_present: ['YNAB_ACCESS_TOKEN'],
      working_directory: '/path/to/project',
    };

    const result = EnvironmentInfoSchema.safeParse(validEnvironment);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.token_preview).toBe('abcd...xyz');
    }
  });
});

describe('CacheInfoSchema', () => {
  it('should validate cache info with null lastCleanup', () => {
    const validCache = {
      entries: 5,
      estimated_size_kb: 120,
      keys: ['budgets', 'accounts', 'transactions'],
      hits: 100,
      misses: 20,
      evictions: 2,
      lastCleanup: null,
      maxEntries: 1000,
      hitRate: '83.33%',
      performance_summary: 'Hit rate: 83.3% (100 hits, 20 misses)',
    };

    const result = CacheInfoSchema.safeParse(validCache);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.lastCleanup).toBeNull();
    }
  });

  it('should validate cache info with string lastCleanup', () => {
    const validCache = {
      entries: 5,
      estimated_size_kb: 120,
      keys: ['budgets', 'accounts'],
      hits: 100,
      misses: 20,
      evictions: 2,
      lastCleanup: '2025-01-17T12:00:00.000Z',
      maxEntries: 1000,
      hitRate: '83.33%',
    };

    const result = CacheInfoSchema.safeParse(validCache);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.lastCleanup).toBe('2025-01-17T12:00:00.000Z');
    }
  });

  it('should validate cache info without optional performance metrics', () => {
    const validCache = {
      entries: 5,
      estimated_size_kb: 120,
      keys: ['budgets'],
    };

    const result = CacheInfoSchema.safeParse(validCache);
    expect(result.success).toBe(true);
  });
});

describe('DeltaInfoSchema', () => {
  it('should validate delta info with numeric delta_hit_rate', () => {
    const validDelta = {
      enabled: true,
      knowledge_entries: 10,
      knowledge_stats: { budgets: 3, accounts: 5, transactions: 2 },
      feature_flag: 'true',
      delta_hits: 50,
      delta_misses: 10,
      delta_hit_rate: 0.8333,
      merge_operations: 45,
      knowledge_gap_events: 3,
    };

    const result = DeltaInfoSchema.safeParse(validDelta);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(typeof result.data.delta_hit_rate).toBe('number');
      expect(result.data.delta_hit_rate).toBe(0.8333);
    }
  });

  it('should fail validation when delta_hit_rate is a string', () => {
    const invalidDelta = {
      enabled: true,
      knowledge_entries: 10,
      knowledge_stats: {},
      feature_flag: 'true',
      delta_hits: 50,
      delta_misses: 10,
      delta_hit_rate: '0.8333', // String instead of number
      merge_operations: 45,
      knowledge_gap_events: 3,
    };

    const result = DeltaInfoSchema.safeParse(invalidDelta);
    expect(result.success).toBe(false);
  });
});

describe('DiagnosticInfoOutputSchema', () => {
  it('should validate complete diagnostic output with all null cases', () => {
    const validDiagnostics = {
      timestamp: '2025-01-17T12:34:56.789Z',
      server: {
        name: 'ynab-mcp-server',
        version: '0.11.3',
        node_version: 'v20.10.0',
        platform: 'linux',
        arch: 'x64',
        pid: 12345,
        uptime_ms: 3600000,
        uptime_readable: '1h 0m 0s',
        env: {
          node_env: 'production',
          minify_output: 'true',
        },
      },
      memory: {
        rss_mb: 45.2,
        heap_used_mb: 32.1,
        heap_total_mb: 40.0,
        external_mb: 1.5,
        array_buffers_mb: 0.8,
        description: {
          rss: 'Resident Set Size - total memory allocated for the process',
          heap_used: 'Used heap memory (objects, closures, etc.)',
          heap_total: 'Total heap memory allocated',
          external: 'Memory used by C++ objects bound to JavaScript objects',
          array_buffers: 'Memory allocated for ArrayBuffer and SharedArrayBuffer',
        },
      },
      environment: {
        token_present: false,
        token_length: 0,
        token_preview: null, // Null case
        ynab_env_keys_present: [],
        working_directory: '/path/to/project',
      },
      cache: {
        entries: 5,
        estimated_size_kb: 120,
        keys: ['budgets'],
        hits: 100,
        misses: 20,
        evictions: 2,
        lastCleanup: null, // Null case
        maxEntries: 1000,
        hitRate: '83.33%',
      },
      delta: {
        enabled: true,
        knowledge_entries: 10,
        knowledge_stats: {},
        feature_flag: 'true',
        delta_hits: 50,
        delta_misses: 10,
        delta_hit_rate: 0.8333, // Number, not string
        merge_operations: 45,
        knowledge_gap_events: 3,
      },
    };

    const result = DiagnosticInfoOutputSchema.safeParse(validDiagnostics);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.environment?.token_preview).toBeNull();
      expect(result.data.cache?.lastCleanup).toBeNull();
      expect(typeof result.data.delta?.delta_hit_rate).toBe('number');
    }
  });

  it('should validate minimal diagnostic output with only timestamp', () => {
    const validDiagnostics = {
      timestamp: '2025-01-17T12:34:56.789Z',
    };

    const result = DiagnosticInfoOutputSchema.safeParse(validDiagnostics);
    expect(result.success).toBe(true);
  });

  it('should validate diagnostic output with some optional sections', () => {
    const validDiagnostics = {
      timestamp: '2025-01-17T12:34:56.789Z',
      environment: {
        token_present: true,
        token_length: 64,
        token_preview: 'abcd...xyz',
        ynab_env_keys_present: ['YNAB_ACCESS_TOKEN'],
        working_directory: '/path/to/project',
      },
      cache: {
        entries: 0,
        estimated_size_kb: 0,
        keys: [],
      },
    };

    const result = DiagnosticInfoOutputSchema.safeParse(validDiagnostics);
    expect(result.success).toBe(true);
  });
});
