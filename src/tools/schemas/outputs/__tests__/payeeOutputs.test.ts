/**
 * Unit tests for payee output schemas
 *
 * Tests schema validation for payee tool outputs including:
 * - ListPayeesOutputSchema
 * - GetPayeeOutputSchema
 * - PayeeSchema
 */

import { describe, it, expect } from 'vitest';
import { ListPayeesOutputSchema, GetPayeeOutputSchema, PayeeSchema } from '../payeeOutputs.js';

describe('PayeeSchema', () => {
  it('should validate complete payee with all fields', () => {
    const validPayee = {
      id: 'payee-123',
      name: 'Whole Foods',
      deleted: false,
    };

    const result = PayeeSchema.safeParse(validPayee);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.id).toBe('payee-123');
      expect(result.data.name).toBe('Whole Foods');
      expect(result.data.transfer_account_id).toBeUndefined();
      expect(result.data.deleted).toBe(false);
    }
  });

  it('should validate transfer payee with transfer_account_id', () => {
    const validPayee = {
      id: 'payee-456',
      name: 'Transfer: Savings Account',
      transfer_account_id: 'account-789',
      deleted: false,
    };

    const result = PayeeSchema.safeParse(validPayee);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.transfer_account_id).toBe('account-789');
      expect(result.data.name).toContain('Transfer:');
    }
  });

  it('should validate minimal payee with only required fields', () => {
    const validPayee = {
      id: 'payee-minimal',
      name: 'Minimal Payee',
      deleted: false,
    };

    const result = PayeeSchema.safeParse(validPayee);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.transfer_account_id).toBeUndefined();
    }
  });

  it('should validate deleted payee', () => {
    const validPayee = {
      id: 'payee-deleted',
      name: 'Deleted Payee',
      deleted: true,
    };

    const result = PayeeSchema.safeParse(validPayee);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.deleted).toBe(true);
    }
  });

  it('should fail validation when missing required id field', () => {
    const invalidPayee = {
      name: 'Invalid Payee',
      deleted: false,
    };

    const result = PayeeSchema.safeParse(invalidPayee);
    expect(result.success).toBe(false);
  });

  it('should fail validation when missing required name field', () => {
    const invalidPayee = {
      id: 'payee-123',
      deleted: false,
    };

    const result = PayeeSchema.safeParse(invalidPayee);
    expect(result.success).toBe(false);
  });

  it('should fail validation when missing required deleted field', () => {
    const invalidPayee = {
      id: 'payee-123',
      name: 'Invalid Payee',
    };

    const result = PayeeSchema.safeParse(invalidPayee);
    expect(result.success).toBe(false);
  });

  it('should fail validation when deleted is not a boolean', () => {
    const invalidPayee = {
      id: 'payee-123',
      name: 'Invalid Payee',
      deleted: 'false', // String instead of boolean
    };

    const result = PayeeSchema.safeParse(invalidPayee);
    expect(result.success).toBe(false);
  });
});

describe('ListPayeesOutputSchema', () => {
  it('should validate output with multiple payees including transfers', () => {
    const validOutput = {
      payees: [
        {
          id: 'payee-1',
          name: 'Whole Foods',
          deleted: false,
        },
        {
          id: 'payee-2',
          name: 'Transfer: Savings Account',
          transfer_account_id: 'account-123',
          deleted: false,
        },
        {
          id: 'payee-3',
          name: 'Gas Station',
          deleted: false,
        },
      ],
      total_count: 50,
      returned_count: 3,
      cached: true,
      cache_info: 'Data retrieved from cache for improved performance',
    };

    const result = ListPayeesOutputSchema.safeParse(validOutput);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.payees).toHaveLength(3);
      expect(result.data.total_count).toBe(50);
      expect(result.data.returned_count).toBe(3);
      expect(result.data.cached).toBe(true);
    }
  });

  it('should validate output with single payee', () => {
    const validOutput = {
      payees: [
        {
          id: 'payee-solo',
          name: 'Solo Payee',
          deleted: false,
        },
      ],
      total_count: 1,
      returned_count: 1,
      cached: false,
      cache_info: 'Fresh data retrieved from YNAB API',
    };

    const result = ListPayeesOutputSchema.safeParse(validOutput);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.payees).toHaveLength(1);
      expect(result.data.total_count).toBe(1);
      expect(result.data.returned_count).toBe(1);
      expect(result.data.cached).toBe(false);
    }
  });

  it('should validate output with empty payees array', () => {
    const validOutput = {
      payees: [],
      total_count: 0,
      returned_count: 0,
      cached: false,
      cache_info: 'No payees found',
    };

    const result = ListPayeesOutputSchema.safeParse(validOutput);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.payees).toHaveLength(0);
      expect(result.data.total_count).toBe(0);
    }
  });

  it('should validate output with deleted payees', () => {
    const validOutput = {
      payees: [
        {
          id: 'payee-1',
          name: 'Active Payee',
          deleted: false,
        },
        {
          id: 'payee-2',
          name: 'Deleted Payee',
          deleted: true,
        },
      ],
      total_count: 2,
      returned_count: 2,
      cached: true,
      cache_info: 'Data retrieved from cache for improved performance (delta merge applied)',
    };

    const result = ListPayeesOutputSchema.safeParse(validOutput);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.payees[0].deleted).toBe(false);
      expect(result.data.payees[1].deleted).toBe(true);
    }
  });

  it('should fail validation when payees is not an array', () => {
    const invalidOutput = {
      payees: 'not-an-array', // String instead of array
      total_count: 0,
      returned_count: 0,
      cached: false,
      cache_info: 'Invalid',
    };

    const result = ListPayeesOutputSchema.safeParse(invalidOutput);
    expect(result.success).toBe(false);
  });

  it('should fail validation when missing required payees field', () => {
    const invalidOutput = {
      total_count: 0,
      returned_count: 0,
      cached: false,
      cache_info: 'Missing payees',
    };

    const result = ListPayeesOutputSchema.safeParse(invalidOutput);
    expect(result.success).toBe(false);
  });

  it('should fail validation when missing required total_count field', () => {
    const invalidOutput = {
      payees: [],
      returned_count: 0,
      cached: false,
      cache_info: 'Missing total_count',
    };

    const result = ListPayeesOutputSchema.safeParse(invalidOutput);
    expect(result.success).toBe(false);
  });

  it('should fail validation when total_count is not an integer', () => {
    const invalidOutput = {
      payees: [],
      total_count: 5.5, // Float instead of integer
      returned_count: 0,
      cached: false,
      cache_info: 'Invalid',
    };

    const result = ListPayeesOutputSchema.safeParse(invalidOutput);
    expect(result.success).toBe(false);
  });
});

describe('GetPayeeOutputSchema', () => {
  it('should validate output with complete payee and cache metadata', () => {
    const validOutput = {
      payee: {
        id: 'payee-123',
        name: 'Whole Foods',
        deleted: false,
      },
      cached: false,
      cache_info: 'Fresh data retrieved from YNAB API',
    };

    const result = GetPayeeOutputSchema.safeParse(validOutput);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.payee.id).toBe('payee-123');
      expect(result.data.payee.name).toBe('Whole Foods');
      expect(result.data.payee.deleted).toBe(false);
      expect(result.data.cached).toBe(false);
    }
  });

  it('should validate output with transfer payee', () => {
    const validOutput = {
      payee: {
        id: 'payee-456',
        name: 'Transfer: Savings Account',
        transfer_account_id: 'account-789',
        deleted: false,
      },
      cached: true,
      cache_info: 'Data retrieved from cache for improved performance (delta merge applied)',
    };

    const result = GetPayeeOutputSchema.safeParse(validOutput);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.payee.transfer_account_id).toBe('account-789');
      expect(result.data.cached).toBe(true);
    }
  });

  it('should validate output with deleted payee', () => {
    const validOutput = {
      payee: {
        id: 'payee-deleted',
        name: 'Deleted Payee',
        deleted: true,
      },
      cached: false,
      cache_info: 'Fresh data',
    };

    const result = GetPayeeOutputSchema.safeParse(validOutput);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.payee.deleted).toBe(true);
    }
  });

  it('should fail validation when payee is not an object', () => {
    const invalidOutput = {
      payee: 'not-an-object', // String instead of object
      cached: false,
      cache_info: 'Invalid',
    };

    const result = GetPayeeOutputSchema.safeParse(invalidOutput);
    expect(result.success).toBe(false);
  });

  it('should fail validation when payee missing required fields', () => {
    const invalidOutput = {
      payee: {
        id: 'payee-123',
        name: 'Incomplete Payee',
        // Missing: deleted
      },
      cached: false,
      cache_info: 'Invalid',
    };

    const result = GetPayeeOutputSchema.safeParse(invalidOutput);
    expect(result.success).toBe(false);
  });

  it('should fail validation when missing required payee field', () => {
    const invalidOutput = {
      cached: false,
      cache_info: 'Missing payee field',
    };

    const result = GetPayeeOutputSchema.safeParse(invalidOutput);
    expect(result.success).toBe(false);
  });
});
