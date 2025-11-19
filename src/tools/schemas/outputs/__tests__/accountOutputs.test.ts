/**
 * Unit tests for account output schemas
 *
 * Tests schema validation for account tool outputs including:
 * - ListAccountsOutputSchema
 * - GetAccountOutputSchema
 * - AccountSchema
 */

import { describe, it, expect } from 'vitest';
import {
  ListAccountsOutputSchema,
  GetAccountOutputSchema,
  AccountSchema,
} from '../accountOutputs.js';

describe('AccountSchema', () => {
  it('should validate complete account with all fields', () => {
    const validAccount = {
      id: 'account-123',
      name: 'Checking Account',
      type: 'checking',
      on_budget: true,
      closed: false,
      note: 'Main checking account',
      balance: 2500.5,
      cleared_balance: 2400.0,
      uncleared_balance: 100.5,
      transfer_payee_id: 'payee-456',
      direct_import_linked: true,
      direct_import_in_error: false,
    };

    const result = AccountSchema.safeParse(validAccount);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual(validAccount);
      expect(result.data.balance).toBe(2500.5);
      expect(result.data.type).toBe('checking');
    }
  });

  it('should validate minimal account with only required fields', () => {
    const validAccount = {
      id: 'account-456',
      name: 'Savings Account',
      type: 'savings',
      on_budget: false,
      closed: false,
      balance: 5000.0,
      cleared_balance: 5000.0,
      uncleared_balance: 0.0,
      transfer_payee_id: 'payee-789',
    };

    const result = AccountSchema.safeParse(validAccount);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.note).toBeUndefined();
      expect(result.data.direct_import_linked).toBeUndefined();
      expect(result.data.direct_import_in_error).toBeUndefined();
    }
  });

  it('should validate closed account', () => {
    const validAccount = {
      id: 'account-789',
      name: 'Closed Credit Card',
      type: 'creditCard',
      on_budget: true,
      closed: true,
      balance: 0.0,
      cleared_balance: 0.0,
      uncleared_balance: 0.0,
      transfer_payee_id: 'payee-closed',
    };

    const result = AccountSchema.safeParse(validAccount);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.closed).toBe(true);
      expect(result.data.type).toBe('creditCard');
    }
  });

  it('should validate off-budget tracking account', () => {
    const validAccount = {
      id: 'account-tracking',
      name: 'Tracking Account',
      type: 'otherAsset',
      on_budget: false,
      closed: false,
      balance: 10000.0,
      cleared_balance: 10000.0,
      uncleared_balance: 0.0,
      transfer_payee_id: 'payee-tracking',
    };

    const result = AccountSchema.safeParse(validAccount);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.on_budget).toBe(false);
      expect(result.data.type).toBe('otherAsset');
    }
  });

  it('should validate account with various account types', () => {
    const accountTypes = [
      'checking',
      'savings',
      'creditCard',
      'cash',
      'lineOfCredit',
      'otherAsset',
      'otherLiability',
    ];

    for (const type of accountTypes) {
      const validAccount = {
        id: `account-${type}`,
        name: `${type} Account`,
        type,
        on_budget: true,
        closed: false,
        balance: 1000.0,
        cleared_balance: 1000.0,
        uncleared_balance: 0.0,
        transfer_payee_id: `payee-${type}`,
      };

      const result = AccountSchema.safeParse(validAccount);
      expect(result.success).toBe(true);
    }
  });

  it('should fail validation when missing required id field', () => {
    const invalidAccount = {
      name: 'Invalid Account',
      type: 'checking',
      on_budget: true,
      closed: false,
      balance: 1000.0,
      cleared_balance: 1000.0,
      uncleared_balance: 0.0,
      transfer_payee_id: 'payee-123',
    };

    const result = AccountSchema.safeParse(invalidAccount);
    expect(result.success).toBe(false);
  });

  it('should fail validation when missing required name field', () => {
    const invalidAccount = {
      id: 'account-123',
      type: 'checking',
      on_budget: true,
      closed: false,
      balance: 1000.0,
      cleared_balance: 1000.0,
      uncleared_balance: 0.0,
      transfer_payee_id: 'payee-123',
    };

    const result = AccountSchema.safeParse(invalidAccount);
    expect(result.success).toBe(false);
  });

  it('should fail validation when balance is not a number', () => {
    const invalidAccount = {
      id: 'account-123',
      name: 'Checking Account',
      type: 'checking',
      on_budget: true,
      closed: false,
      balance: '1000.00', // String instead of number
      cleared_balance: 1000.0,
      uncleared_balance: 0.0,
      transfer_payee_id: 'payee-123',
    };

    const result = AccountSchema.safeParse(invalidAccount);
    expect(result.success).toBe(false);
  });

  it('should fail validation when on_budget is not a boolean', () => {
    const invalidAccount = {
      id: 'account-123',
      name: 'Checking Account',
      type: 'checking',
      on_budget: 'true', // String instead of boolean
      closed: false,
      balance: 1000.0,
      cleared_balance: 1000.0,
      uncleared_balance: 0.0,
      transfer_payee_id: 'payee-123',
    };

    const result = AccountSchema.safeParse(invalidAccount);
    expect(result.success).toBe(false);
  });
});

describe('ListAccountsOutputSchema', () => {
  it('should validate output with multiple accounts and cache metadata', () => {
    const validOutput = {
      accounts: [
        {
          id: 'account-1',
          name: 'Checking',
          type: 'checking',
          on_budget: true,
          closed: false,
          balance: 1500.0,
          cleared_balance: 1400.0,
          uncleared_balance: 100.0,
          transfer_payee_id: 'payee-1',
        },
        {
          id: 'account-2',
          name: 'Savings',
          type: 'savings',
          on_budget: true,
          closed: false,
          balance: 5000.0,
          cleared_balance: 5000.0,
          uncleared_balance: 0.0,
          transfer_payee_id: 'payee-2',
        },
      ],
      total_count: 5,
      returned_count: 2,
      cached: true,
      cache_info: 'Data retrieved from cache for improved performance',
    };

    const result = ListAccountsOutputSchema.safeParse(validOutput);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.accounts).toHaveLength(2);
      expect(result.data.total_count).toBe(5);
      expect(result.data.returned_count).toBe(2);
      expect(result.data.cached).toBe(true);
    }
  });

  it('should validate output with single account', () => {
    const validOutput = {
      accounts: [
        {
          id: 'account-solo',
          name: 'Solo Account',
          type: 'checking',
          on_budget: true,
          closed: false,
          balance: 2000.0,
          cleared_balance: 2000.0,
          uncleared_balance: 0.0,
          transfer_payee_id: 'payee-solo',
        },
      ],
      total_count: 1,
      returned_count: 1,
      cached: false,
      cache_info: 'Fresh data retrieved from YNAB API',
    };

    const result = ListAccountsOutputSchema.safeParse(validOutput);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.accounts).toHaveLength(1);
      expect(result.data.total_count).toBe(1);
      expect(result.data.returned_count).toBe(1);
      expect(result.data.cached).toBe(false);
    }
  });

  it('should validate output with empty accounts array', () => {
    const validOutput = {
      accounts: [],
      total_count: 0,
      returned_count: 0,
      cached: false,
      cache_info: 'No accounts found',
    };

    const result = ListAccountsOutputSchema.safeParse(validOutput);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.accounts).toHaveLength(0);
      expect(result.data.total_count).toBe(0);
    }
  });

  it('should fail validation when accounts is not an array', () => {
    const invalidOutput = {
      accounts: 'not-an-array', // String instead of array
      total_count: 0,
      returned_count: 0,
      cached: false,
      cache_info: 'Invalid',
    };

    const result = ListAccountsOutputSchema.safeParse(invalidOutput);
    expect(result.success).toBe(false);
  });

  it('should fail validation when missing required total_count field', () => {
    const invalidOutput = {
      accounts: [],
      returned_count: 0,
      cached: false,
      cache_info: 'Missing total_count',
    };

    const result = ListAccountsOutputSchema.safeParse(invalidOutput);
    expect(result.success).toBe(false);
  });

  it('should fail validation when total_count is not an integer', () => {
    const invalidOutput = {
      accounts: [],
      total_count: 5.5, // Float instead of integer
      returned_count: 0,
      cached: false,
      cache_info: 'Invalid',
    };

    const result = ListAccountsOutputSchema.safeParse(invalidOutput);
    expect(result.success).toBe(false);
  });
});

describe('GetAccountOutputSchema', () => {
  it('should validate output with complete account and cache metadata', () => {
    const validOutput = {
      account: {
        id: 'account-123',
        name: 'Checking Account',
        type: 'checking',
        on_budget: true,
        closed: false,
        note: 'Main account',
        balance: 2500.5,
        cleared_balance: 2400.0,
        uncleared_balance: 100.5,
        transfer_payee_id: 'payee-456',
        direct_import_linked: true,
        direct_import_in_error: false,
      },
      cached: false,
      cache_info: 'Fresh data retrieved from YNAB API',
    };

    const result = GetAccountOutputSchema.safeParse(validOutput);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.account.id).toBe('account-123');
      expect(result.data.account.name).toBe('Checking Account');
      expect(result.data.account.balance).toBe(2500.5);
      expect(result.data.cached).toBe(false);
    }
  });

  it('should validate output with minimal account', () => {
    const validOutput = {
      account: {
        id: 'account-456',
        name: 'Savings',
        type: 'savings',
        on_budget: true,
        closed: false,
        balance: 5000.0,
        cleared_balance: 5000.0,
        uncleared_balance: 0.0,
        transfer_payee_id: 'payee-789',
      },
      cached: true,
      cache_info: 'Data retrieved from cache for improved performance (delta merge applied)',
    };

    const result = GetAccountOutputSchema.safeParse(validOutput);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.account.note).toBeUndefined();
      expect(result.data.cached).toBe(true);
    }
  });

  it('should fail validation when account is not an object', () => {
    const invalidOutput = {
      account: 'not-an-object', // String instead of object
      cached: false,
      cache_info: 'Invalid',
    };

    const result = GetAccountOutputSchema.safeParse(invalidOutput);
    expect(result.success).toBe(false);
  });

  it('should fail validation when account is missing required fields', () => {
    const invalidOutput = {
      account: {
        id: 'account-123',
        name: 'Incomplete Account',
        // Missing required fields: type, on_budget, closed, balance, etc.
      },
      cached: false,
      cache_info: 'Invalid',
    };

    const result = GetAccountOutputSchema.safeParse(invalidOutput);
    expect(result.success).toBe(false);
  });

  it('should fail validation when missing required account field', () => {
    const invalidOutput = {
      cached: false,
      cache_info: 'Missing account field',
    };

    const result = GetAccountOutputSchema.safeParse(invalidOutput);
    expect(result.success).toBe(false);
  });
});
