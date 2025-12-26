import { describe, it, expect } from 'vitest';
import {
  ListTransactionsSchema,
  GetTransactionSchema,
  CreateTransactionSchema,
  CreateTransactionsSchema,
  CreateReceiptSplitTransactionSchema,
  UpdateTransactionSchema,
  UpdateTransactionsSchema,
  DeleteTransactionSchema,
} from '../transactionSchemas.js';

describe('Transaction Schemas', () => {
  describe('ListTransactionsSchema', () => {
    it('should validate with only budget_id', () => {
      const result = ListTransactionsSchema.parse({ budget_id: 'budget-1' });
      expect(result.budget_id).toBe('budget-1');
      expect(result.account_id).toBeUndefined();
      expect(result.category_id).toBeUndefined();
      expect(result.since_date).toBeUndefined();
      expect(result.type).toBeUndefined();
    });

    it('should validate with all optional fields', () => {
      const result = ListTransactionsSchema.parse({
        budget_id: 'budget-1',
        account_id: 'account-1',
        category_id: 'category-1',
        since_date: '2024-01-01',
        type: 'uncategorized',
      });
      expect(result.budget_id).toBe('budget-1');
      expect(result.account_id).toBe('account-1');
      expect(result.category_id).toBe('category-1');
      expect(result.since_date).toBe('2024-01-01');
      expect(result.type).toBe('uncategorized');
    });

    it('should validate type as unapproved', () => {
      const result = ListTransactionsSchema.parse({
        budget_id: 'budget-1',
        type: 'unapproved',
      });
      expect(result.type).toBe('unapproved');
    });

    it('should reject empty budget_id', () => {
      expect(() => ListTransactionsSchema.parse({ budget_id: '' })).toThrow(
        'Budget ID is required',
      );
    });

    it('should reject missing budget_id', () => {
      expect(() => ListTransactionsSchema.parse({})).toThrow();
    });

    it('should reject invalid date format (missing dashes)', () => {
      expect(() =>
        ListTransactionsSchema.parse({
          budget_id: 'budget-1',
          since_date: '20240101',
        }),
      ).toThrow('Date must be in ISO format (YYYY-MM-DD)');
    });

    it('should reject invalid date format (wrong separator)', () => {
      expect(() =>
        ListTransactionsSchema.parse({
          budget_id: 'budget-1',
          since_date: '2024/01/01',
        }),
      ).toThrow('Date must be in ISO format (YYYY-MM-DD)');
    });

    it('should reject invalid type value', () => {
      expect(() =>
        ListTransactionsSchema.parse({
          budget_id: 'budget-1',
          type: 'invalid',
        }),
      ).toThrow();
    });

    it('should reject extra fields (strict mode)', () => {
      expect(() =>
        ListTransactionsSchema.parse({
          budget_id: 'budget-1',
          extra_field: 'value',
        }),
      ).toThrow();
    });
  });

  describe('GetTransactionSchema', () => {
    it('should validate with required fields', () => {
      const result = GetTransactionSchema.parse({
        budget_id: 'budget-1',
        transaction_id: 'transaction-1',
      });
      expect(result.budget_id).toBe('budget-1');
      expect(result.transaction_id).toBe('transaction-1');
    });

    it('should reject empty budget_id', () => {
      expect(() =>
        GetTransactionSchema.parse({
          budget_id: '',
          transaction_id: 'transaction-1',
        }),
      ).toThrow('Budget ID is required');
    });

    it('should reject empty transaction_id', () => {
      expect(() =>
        GetTransactionSchema.parse({
          budget_id: 'budget-1',
          transaction_id: '',
        }),
      ).toThrow('Transaction ID is required');
    });

    it('should reject missing transaction_id', () => {
      expect(() => GetTransactionSchema.parse({ budget_id: 'budget-1' })).toThrow();
    });

    it('should reject extra fields (strict mode)', () => {
      expect(() =>
        GetTransactionSchema.parse({
          budget_id: 'budget-1',
          transaction_id: 'transaction-1',
          extra_field: 'value',
        }),
      ).toThrow();
    });
  });

  describe('CreateTransactionSchema', () => {
    const validBase = {
      budget_id: 'budget-1',
      account_id: 'account-1',
      amount: 25500,
      date: '2024-01-15',
    };

    it('should validate with required fields only', () => {
      const result = CreateTransactionSchema.parse(validBase);
      expect(result.budget_id).toBe('budget-1');
      expect(result.account_id).toBe('account-1');
      expect(result.amount).toBe(25500);
      expect(result.date).toBe('2024-01-15');
    });

    it('should validate with all optional fields', () => {
      const result = CreateTransactionSchema.parse({
        ...validBase,
        payee_name: 'Grocery Store',
        payee_id: 'payee-1',
        category_id: 'category-1',
        memo: 'Weekly groceries',
        cleared: 'cleared',
        approved: true,
        flag_color: 'red',
        import_id: 'YNAB:12345:2024-01-15:1',
        dry_run: true,
      });
      expect(result.payee_name).toBe('Grocery Store');
      expect(result.payee_id).toBe('payee-1');
      expect(result.category_id).toBe('category-1');
      expect(result.memo).toBe('Weekly groceries');
      expect(result.cleared).toBe('cleared');
      expect(result.approved).toBe(true);
      expect(result.flag_color).toBe('red');
      expect(result.import_id).toBe('YNAB:12345:2024-01-15:1');
      expect(result.dry_run).toBe(true);
    });

    it('should validate all cleared status values', () => {
      ['cleared', 'uncleared', 'reconciled'].forEach((status) => {
        const result = CreateTransactionSchema.parse({
          ...validBase,
          cleared: status,
        });
        expect(result.cleared).toBe(status);
      });
    });

    it('should validate all flag colors', () => {
      ['red', 'orange', 'yellow', 'green', 'blue', 'purple'].forEach((color) => {
        const result = CreateTransactionSchema.parse({
          ...validBase,
          flag_color: color,
        });
        expect(result.flag_color).toBe(color);
      });
    });

    it('should validate negative amounts', () => {
      const result = CreateTransactionSchema.parse({
        ...validBase,
        amount: -25500,
      });
      expect(result.amount).toBe(-25500);
    });

    it('should validate zero amount', () => {
      const result = CreateTransactionSchema.parse({
        ...validBase,
        amount: 0,
      });
      expect(result.amount).toBe(0);
    });

    it('should reject non-integer amount', () => {
      expect(() =>
        CreateTransactionSchema.parse({
          ...validBase,
          amount: 25.5,
        }),
      ).toThrow('Amount must be an integer in milliunits');
    });

    it('should reject invalid date format', () => {
      expect(() =>
        CreateTransactionSchema.parse({
          ...validBase,
          date: '2024/01/15',
        }),
      ).toThrow('Date must be in ISO format (YYYY-MM-DD)');
    });

    it('should reject invalid cleared status', () => {
      expect(() =>
        CreateTransactionSchema.parse({
          ...validBase,
          cleared: 'invalid',
        }),
      ).toThrow();
    });

    it('should reject invalid flag color', () => {
      expect(() =>
        CreateTransactionSchema.parse({
          ...validBase,
          flag_color: 'pink',
        }),
      ).toThrow();
    });

    it('should reject empty import_id', () => {
      expect(() =>
        CreateTransactionSchema.parse({
          ...validBase,
          import_id: '',
        }),
      ).toThrow('Import ID cannot be empty');
    });

    it('should validate subtransactions with matching total', () => {
      const result = CreateTransactionSchema.parse({
        ...validBase,
        amount: 30000,
        subtransactions: [
          { amount: 15000, category_id: 'cat-1' },
          { amount: 10000, category_id: 'cat-2' },
          { amount: 5000, category_id: 'cat-3' },
        ],
      });
      expect(result.subtransactions).toHaveLength(3);
      expect(result.subtransactions![0].amount).toBe(15000);
    });

    it('should validate subtransactions with all optional fields', () => {
      const result = CreateTransactionSchema.parse({
        ...validBase,
        amount: 10000,
        subtransactions: [
          {
            amount: 10000,
            payee_name: 'Sub Payee',
            payee_id: 'payee-sub',
            category_id: 'cat-1',
            memo: 'Subtransaction memo',
          },
        ],
      });
      expect(result.subtransactions![0].payee_name).toBe('Sub Payee');
      expect(result.subtransactions![0].payee_id).toBe('payee-sub');
      expect(result.subtransactions![0].memo).toBe('Subtransaction memo');
    });

    it('should reject subtransactions with non-matching total', () => {
      expect(() =>
        CreateTransactionSchema.parse({
          ...validBase,
          amount: 30000,
          subtransactions: [
            { amount: 15000, category_id: 'cat-1' },
            { amount: 10000, category_id: 'cat-2' },
          ],
        }),
      ).toThrow('Amount must equal the sum of subtransaction amounts');
    });

    it('should reject subtransactions with total exceeding parent', () => {
      expect(() =>
        CreateTransactionSchema.parse({
          ...validBase,
          amount: 20000,
          subtransactions: [
            { amount: 15000, category_id: 'cat-1' },
            { amount: 10000, category_id: 'cat-2' },
          ],
        }),
      ).toThrow('Amount must equal the sum of subtransaction amounts');
    });

    it('should reject empty subtransactions array', () => {
      expect(() =>
        CreateTransactionSchema.parse({
          ...validBase,
          subtransactions: [],
        }),
      ).toThrow('At least one subtransaction is required when provided');
    });

    it('should reject subtransaction with non-integer amount', () => {
      expect(() =>
        CreateTransactionSchema.parse({
          ...validBase,
          amount: 10000,
          subtransactions: [{ amount: 10000.5, category_id: 'cat-1' }],
        }),
      ).toThrow('Subtransaction amount must be an integer in milliunits');
    });

    it('should reject extra fields in subtransaction', () => {
      expect(() =>
        CreateTransactionSchema.parse({
          ...validBase,
          amount: 10000,
          subtransactions: [
            {
              amount: 10000,
              category_id: 'cat-1',
              extra_field: 'value',
            },
          ],
        }),
      ).toThrow();
    });
  });

  describe('CreateTransactionsSchema', () => {
    const validTransaction = {
      account_id: 'account-1',
      amount: 10000,
      date: '2024-01-15',
    };

    it('should validate with single transaction', () => {
      const result = CreateTransactionsSchema.parse({
        budget_id: 'budget-1',
        transactions: [validTransaction],
      });
      expect(result.budget_id).toBe('budget-1');
      expect(result.transactions).toHaveLength(1);
      expect(result.transactions[0].account_id).toBe('account-1');
    });

    it('should validate with multiple transactions', () => {
      const result = CreateTransactionsSchema.parse({
        budget_id: 'budget-1',
        transactions: [
          validTransaction,
          { ...validTransaction, account_id: 'account-2' },
          { ...validTransaction, account_id: 'account-3' },
        ],
      });
      expect(result.transactions).toHaveLength(3);
    });

    it('should validate with dry_run flag', () => {
      const result = CreateTransactionsSchema.parse({
        budget_id: 'budget-1',
        transactions: [validTransaction],
        dry_run: true,
      });
      expect(result.dry_run).toBe(true);
    });

    it('should validate transaction with all optional fields', () => {
      const result = CreateTransactionsSchema.parse({
        budget_id: 'budget-1',
        transactions: [
          {
            ...validTransaction,
            payee_name: 'Store',
            payee_id: 'payee-1',
            category_id: 'cat-1',
            memo: 'Test memo',
            cleared: 'cleared',
            approved: true,
            flag_color: 'blue',
            import_id: 'YNAB:123:2024-01-15:1',
          },
        ],
      });
      expect(result.transactions[0].payee_name).toBe('Store');
      expect(result.transactions[0].memo).toBe('Test memo');
    });

    it('should reject empty transactions array', () => {
      expect(() =>
        CreateTransactionsSchema.parse({
          budget_id: 'budget-1',
          transactions: [],
        }),
      ).toThrow('At least one transaction is required');
    });

    it('should reject more than 100 transactions', () => {
      const transactions = Array(101)
        .fill(null)
        .map((_, i) => ({
          ...validTransaction,
          account_id: `account-${i}`,
        }));

      expect(() =>
        CreateTransactionsSchema.parse({
          budget_id: 'budget-1',
          transactions,
        }),
      ).toThrow('A maximum of 100 transactions may be created at once');
    });

    it('should accept exactly 100 transactions', () => {
      const transactions = Array(100)
        .fill(null)
        .map((_, i) => ({
          ...validTransaction,
          account_id: `account-${i}`,
        }));

      const result = CreateTransactionsSchema.parse({
        budget_id: 'budget-1',
        transactions,
      });
      expect(result.transactions).toHaveLength(100);
    });

    it('should reject transaction with subtransactions field (not supported in bulk)', () => {
      expect(() =>
        CreateTransactionsSchema.parse({
          budget_id: 'budget-1',
          transactions: [
            {
              ...validTransaction,
              subtransactions: [{ amount: 10000, category_id: 'cat-1' }],
            },
          ],
        }),
      ).toThrow();
    });

    it('should reject empty budget_id', () => {
      expect(() =>
        CreateTransactionsSchema.parse({
          budget_id: '',
          transactions: [validTransaction],
        }),
      ).toThrow('Budget ID is required');
    });
  });

  describe('CreateReceiptSplitTransactionSchema', () => {
    const validReceipt = {
      budget_id: 'budget-1',
      account_id: 'account-1',
      payee_name: 'Grocery Store',
      receipt_tax: 2.5,
      receipt_total: 27.5,
      categories: [
        {
          category_id: 'cat-1',
          items: [
            { name: 'Milk', amount: 5.0 },
            { name: 'Bread', amount: 3.0 },
          ],
        },
        {
          category_id: 'cat-2',
          items: [{ name: 'Apples', amount: 7.0 }],
        },
        {
          category_id: 'cat-3',
          items: [{ name: 'Chicken', amount: 10.0 }],
        },
      ],
    };

    it('should validate with required fields only', () => {
      const result = CreateReceiptSplitTransactionSchema.parse(validReceipt);
      expect(result.budget_id).toBe('budget-1');
      expect(result.account_id).toBe('account-1');
      expect(result.payee_name).toBe('Grocery Store');
      expect(result.receipt_tax).toBe(2.5);
      expect(result.receipt_total).toBe(27.5);
      expect(result.categories).toHaveLength(3);
    });

    it('should validate with all optional fields', () => {
      const result = CreateReceiptSplitTransactionSchema.parse({
        ...validReceipt,
        date: '2024-01-15',
        memo: 'Weekly shopping',
        receipt_subtotal: 25.0,
        cleared: 'cleared',
        approved: true,
        flag_color: 'green',
        dry_run: true,
      });
      expect(result.date).toBe('2024-01-15');
      expect(result.memo).toBe('Weekly shopping');
      expect(result.receipt_subtotal).toBe(25.0);
      expect(result.cleared).toBe('cleared');
      expect(result.approved).toBe(true);
      expect(result.flag_color).toBe('green');
      expect(result.dry_run).toBe(true);
    });

    it('should validate items with quantity', () => {
      const result = CreateReceiptSplitTransactionSchema.parse({
        ...validReceipt,
        categories: [
          {
            category_id: 'cat-1',
            items: [
              {
                name: 'Apples',
                amount: 10.0,
                quantity: 2.5,
                memo: '2.5 lbs @ $4/lb',
              },
            ],
          },
        ],
        receipt_total: 12.5,
      });
      expect(result.categories[0].items[0].quantity).toBe(2.5);
      expect(result.categories[0].items[0].memo).toBe('2.5 lbs @ $4/lb');
    });

    it('should validate items with category_name', () => {
      const result = CreateReceiptSplitTransactionSchema.parse({
        ...validReceipt,
        categories: [
          {
            category_id: 'cat-1',
            category_name: 'Groceries',
            items: [{ name: 'Item', amount: 25.0 }],
          },
        ],
      });
      expect(result.categories[0].category_name).toBe('Groceries');
    });

    it('should validate when subtotal + tax = total (exact match)', () => {
      const result = CreateReceiptSplitTransactionSchema.parse({
        ...validReceipt,
        receipt_subtotal: 25.0,
        receipt_tax: 2.5,
        receipt_total: 27.5,
      });
      expect(result.receipt_subtotal).toBe(25.0);
    });

    it('should validate when items total matches receipt_subtotal', () => {
      const result = CreateReceiptSplitTransactionSchema.parse({
        budget_id: 'budget-1',
        account_id: 'account-1',
        payee_name: 'Store',
        receipt_subtotal: 50.0,
        receipt_tax: 5.0,
        receipt_total: 55.0,
        categories: [
          {
            category_id: 'cat-1',
            items: [
              { name: 'Item 1', amount: 30.0 },
              { name: 'Item 2', amount: 20.0 },
            ],
          },
        ],
      });
      expect(result.categories[0].items).toHaveLength(2);
    });

    it('should reject when items total does not match receipt_subtotal', () => {
      expect(() =>
        CreateReceiptSplitTransactionSchema.parse({
          ...validReceipt,
          receipt_subtotal: 30.0, // Items sum to 25.0
        }),
      ).toThrow('Receipt subtotal (30.00) does not match categorized items total (25.00)');
    });

    it('should reject when subtotal + tax does not match total', () => {
      expect(() =>
        CreateReceiptSplitTransactionSchema.parse({
          ...validReceipt,
          receipt_total: 30.0, // Should be 27.5
        }),
      ).toThrow('Receipt total (30.00) does not match subtotal plus tax (27.50)');
    });

    it('should allow small rounding differences (within tolerance)', () => {
      // This should NOT throw because difference is less than 0.01 (0.001)
      const result = CreateReceiptSplitTransactionSchema.parse({
        budget_id: 'budget-1',
        account_id: 'account-1',
        payee_name: 'Store',
        receipt_subtotal: 25.001,
        receipt_tax: 2.5,
        receipt_total: 27.5,
        categories: [
          {
            category_id: 'cat-1',
            items: [{ name: 'Item', amount: 25.0 }],
          },
        ],
      });
      expect(result.receipt_subtotal).toBe(25.001);
    });

    it('should reject rounding differences exceeding 0.01', () => {
      expect(() =>
        CreateReceiptSplitTransactionSchema.parse({
          budget_id: 'budget-1',
          account_id: 'account-1',
          payee_name: 'Store',
          receipt_subtotal: 25.02,
          receipt_tax: 2.5,
          receipt_total: 27.5,
          categories: [
            {
              category_id: 'cat-1',
              items: [{ name: 'Item', amount: 25.0 }],
            },
          ],
        }),
      ).toThrow('Receipt subtotal (25.02) does not match categorized items total (25.00)');
    });

    it('should reject negative receipt_subtotal', () => {
      expect(() =>
        CreateReceiptSplitTransactionSchema.parse({
          ...validReceipt,
          receipt_subtotal: -10.0,
        }),
      ).toThrow('Receipt subtotal must be zero or greater');
    });

    it('should accept zero receipt_subtotal with positive total', () => {
      // receipt_total must be > 0, even if subtotal is 0 (e.g., all tax)
      const result = CreateReceiptSplitTransactionSchema.parse({
        budget_id: 'budget-1',
        account_id: 'account-1',
        payee_name: 'Store',
        receipt_subtotal: 0.0,
        receipt_tax: 1.0,
        receipt_total: 1.0,
        categories: [
          {
            category_id: 'cat-1',
            items: [{ name: 'Free item', amount: 0.0 }],
          },
        ],
      });
      expect(result.receipt_subtotal).toBe(0.0);
      expect(result.receipt_total).toBe(1.0);
    });

    it('should reject zero or negative receipt_total', () => {
      expect(() =>
        CreateReceiptSplitTransactionSchema.parse({
          ...validReceipt,
          receipt_total: 0,
        }),
      ).toThrow('Receipt total must be greater than zero');

      expect(() =>
        CreateReceiptSplitTransactionSchema.parse({
          ...validReceipt,
          receipt_total: -10.0,
        }),
      ).toThrow('Receipt total must be greater than zero');
    });

    it('should reject Infinity values', () => {
      expect(() =>
        CreateReceiptSplitTransactionSchema.parse({
          ...validReceipt,
          receipt_tax: Infinity,
        }),
      ).toThrow();

      expect(() =>
        CreateReceiptSplitTransactionSchema.parse({
          ...validReceipt,
          receipt_total: Infinity,
        }),
      ).toThrow();
    });

    it('should reject NaN values', () => {
      expect(() =>
        CreateReceiptSplitTransactionSchema.parse({
          ...validReceipt,
          receipt_tax: NaN,
        }),
      ).toThrow();
    });

    it('should reject empty categories array', () => {
      expect(() =>
        CreateReceiptSplitTransactionSchema.parse({
          ...validReceipt,
          categories: [],
        }),
      ).toThrow('At least one categorized group is required to create a split transaction');
    });

    it('should reject category with empty items array', () => {
      expect(() =>
        CreateReceiptSplitTransactionSchema.parse({
          ...validReceipt,
          categories: [
            {
              category_id: 'cat-1',
              items: [],
            },
          ],
        }),
      ).toThrow('Each category must include at least one item');
    });

    it('should reject item with empty name', () => {
      expect(() =>
        CreateReceiptSplitTransactionSchema.parse({
          ...validReceipt,
          categories: [
            {
              category_id: 'cat-1',
              items: [{ name: '', amount: 10.0 }],
            },
          ],
        }),
      ).toThrow('Item name is required');
    });

    it('should reject item with zero or negative quantity', () => {
      expect(() =>
        CreateReceiptSplitTransactionSchema.parse({
          ...validReceipt,
          categories: [
            {
              category_id: 'cat-1',
              items: [{ name: 'Item', amount: 10.0, quantity: 0 }],
            },
          ],
        }),
      ).toThrow('Quantity must be greater than zero');

      expect(() =>
        CreateReceiptSplitTransactionSchema.parse({
          ...validReceipt,
          categories: [
            {
              category_id: 'cat-1',
              items: [{ name: 'Item', amount: 10.0, quantity: -1 }],
            },
          ],
        }),
      ).toThrow('Quantity must be greater than zero');
    });

    it('should reject empty payee_name', () => {
      expect(() =>
        CreateReceiptSplitTransactionSchema.parse({
          ...validReceipt,
          payee_name: '',
        }),
      ).toThrow('Payee name is required');
    });

    it('should reject empty category_id', () => {
      expect(() =>
        CreateReceiptSplitTransactionSchema.parse({
          ...validReceipt,
          categories: [
            {
              category_id: '',
              items: [{ name: 'Item', amount: 25.0 }],
            },
          ],
        }),
      ).toThrow('Category ID is required');
    });
  });

  describe('UpdateTransactionSchema', () => {
    const validBase = {
      budget_id: 'budget-1',
      transaction_id: 'trans-1',
    };

    it('should validate with only required fields', () => {
      const result = UpdateTransactionSchema.parse(validBase);
      expect(result.budget_id).toBe('budget-1');
      expect(result.transaction_id).toBe('trans-1');
    });

    it('should validate with all optional fields', () => {
      const result = UpdateTransactionSchema.parse({
        ...validBase,
        account_id: 'account-1',
        amount: 15000,
        date: '2024-01-20',
        payee_name: 'New Payee',
        payee_id: 'payee-2',
        category_id: 'cat-2',
        memo: 'Updated memo',
        cleared: 'reconciled',
        approved: false,
        flag_color: 'purple',
        dry_run: true,
      });
      expect(result.account_id).toBe('account-1');
      expect(result.amount).toBe(15000);
      expect(result.date).toBe('2024-01-20');
      expect(result.memo).toBe('Updated memo');
      expect(result.cleared).toBe('reconciled');
      expect(result.approved).toBe(false);
      expect(result.flag_color).toBe('purple');
      expect(result.dry_run).toBe(true);
    });

    it('should reject non-integer amount', () => {
      expect(() =>
        UpdateTransactionSchema.parse({
          ...validBase,
          amount: 15.5,
        }),
      ).toThrow('Amount must be an integer in milliunits');
    });

    it('should reject invalid date format', () => {
      expect(() =>
        UpdateTransactionSchema.parse({
          ...validBase,
          date: '01/20/2024',
        }),
      ).toThrow('Date must be in ISO format (YYYY-MM-DD)');
    });

    it('should reject empty transaction_id', () => {
      expect(() =>
        UpdateTransactionSchema.parse({
          budget_id: 'budget-1',
          transaction_id: '',
        }),
      ).toThrow('Transaction ID is required');
    });

    it('should reject extra fields', () => {
      expect(() =>
        UpdateTransactionSchema.parse({
          ...validBase,
          extra_field: 'value',
        }),
      ).toThrow();
    });
  });

  describe('UpdateTransactionsSchema', () => {
    const validUpdate = {
      id: 'trans-1',
      amount: 10000,
    };

    it('should validate with single update', () => {
      const result = UpdateTransactionsSchema.parse({
        budget_id: 'budget-1',
        transactions: [validUpdate],
      });
      expect(result.transactions).toHaveLength(1);
      expect(result.transactions[0].id).toBe('trans-1');
    });

    it('should validate with multiple updates', () => {
      const result = UpdateTransactionsSchema.parse({
        budget_id: 'budget-1',
        transactions: [
          validUpdate,
          { id: 'trans-2', memo: 'Updated' },
          { id: 'trans-3', cleared: 'cleared' },
        ],
      });
      expect(result.transactions).toHaveLength(3);
    });

    it('should validate with all updatable fields', () => {
      const result = UpdateTransactionsSchema.parse({
        budget_id: 'budget-1',
        transactions: [
          {
            id: 'trans-1',
            amount: 20000,
            date: '2024-02-01',
            payee_name: 'Updated Payee',
            payee_id: 'payee-3',
            category_id: 'cat-3',
            memo: 'Updated',
            cleared: 'uncleared',
            approved: true,
            flag_color: 'yellow',
            original_account_id: 'account-1',
            original_date: '2024-01-01',
          },
        ],
      });
      expect(result.transactions[0].amount).toBe(20000);
      expect(result.transactions[0].original_account_id).toBe('account-1');
      expect(result.transactions[0].original_date).toBe('2024-01-01');
    });

    it('should reject empty transactions array', () => {
      expect(() =>
        UpdateTransactionsSchema.parse({
          budget_id: 'budget-1',
          transactions: [],
        }),
      ).toThrow('At least one transaction is required');
    });

    it('should reject more than 100 transactions', () => {
      const updates = Array(101)
        .fill(null)
        .map((_, i) => ({
          id: `trans-${i}`,
          amount: 10000,
        }));

      expect(() =>
        UpdateTransactionsSchema.parse({
          budget_id: 'budget-1',
          transactions: updates,
        }),
      ).toThrow('A maximum of 100 transactions may be updated at once');
    });

    it('should accept exactly 100 transactions', () => {
      const updates = Array(100)
        .fill(null)
        .map((_, i) => ({
          id: `trans-${i}`,
          amount: 10000,
        }));

      const result = UpdateTransactionsSchema.parse({
        budget_id: 'budget-1',
        transactions: updates,
      });
      expect(result.transactions).toHaveLength(100);
    });

    it('should reject update with missing id', () => {
      expect(() =>
        UpdateTransactionsSchema.parse({
          budget_id: 'budget-1',
          transactions: [{ amount: 10000 }],
        }),
      ).toThrow();
    });

    it('should reject update with empty id', () => {
      expect(() =>
        UpdateTransactionsSchema.parse({
          budget_id: 'budget-1',
          transactions: [{ id: '', amount: 10000 }],
        }),
      ).toThrow('Transaction ID is required');
    });

    it('should reject invalid original_date format', () => {
      expect(() =>
        UpdateTransactionsSchema.parse({
          budget_id: 'budget-1',
          transactions: [
            {
              id: 'trans-1',
              amount: 10000,
              original_date: '2024/01/01',
            },
          ],
        }),
      ).toThrow('Date must be in ISO format (YYYY-MM-DD)');
    });

    it('should reject extra fields in update', () => {
      expect(() =>
        UpdateTransactionsSchema.parse({
          budget_id: 'budget-1',
          transactions: [
            {
              id: 'trans-1',
              extra_field: 'value',
            },
          ],
        }),
      ).toThrow();
    });
  });

  describe('DeleteTransactionSchema', () => {
    it('should validate with required fields', () => {
      const result = DeleteTransactionSchema.parse({
        budget_id: 'budget-1',
        transaction_id: 'trans-1',
      });
      expect(result.budget_id).toBe('budget-1');
      expect(result.transaction_id).toBe('trans-1');
    });

    it('should validate with dry_run flag', () => {
      const result = DeleteTransactionSchema.parse({
        budget_id: 'budget-1',
        transaction_id: 'trans-1',
        dry_run: true,
      });
      expect(result.dry_run).toBe(true);
    });

    it('should reject empty budget_id', () => {
      expect(() =>
        DeleteTransactionSchema.parse({
          budget_id: '',
          transaction_id: 'trans-1',
        }),
      ).toThrow('Budget ID is required');
    });

    it('should reject empty transaction_id', () => {
      expect(() =>
        DeleteTransactionSchema.parse({
          budget_id: 'budget-1',
          transaction_id: '',
        }),
      ).toThrow('Transaction ID is required');
    });

    it('should reject missing fields', () => {
      expect(() => DeleteTransactionSchema.parse({ budget_id: 'budget-1' })).toThrow();
      expect(() => DeleteTransactionSchema.parse({ transaction_id: 'trans-1' })).toThrow();
    });

    it('should reject extra fields', () => {
      expect(() =>
        DeleteTransactionSchema.parse({
          budget_id: 'budget-1',
          transaction_id: 'trans-1',
          extra_field: 'value',
        }),
      ).toThrow();
    });
  });

  describe('Edge Cases', () => {
    it('should handle very large integer amounts', () => {
      const result = CreateTransactionSchema.parse({
        budget_id: 'budget-1',
        account_id: 'account-1',
        amount: 999999999999,
        date: '2024-01-15',
      });
      expect(result.amount).toBe(999999999999);
    });

    it('should handle very large negative amounts', () => {
      const result = CreateTransactionSchema.parse({
        budget_id: 'budget-1',
        account_id: 'account-1',
        amount: -999999999999,
        date: '2024-01-15',
      });
      expect(result.amount).toBe(-999999999999);
    });

    it('should handle boundary date values', () => {
      const dates = ['2024-01-01', '2024-12-31', '2000-01-01', '2099-12-31'];

      dates.forEach((date) => {
        const result = CreateTransactionSchema.parse({
          budget_id: 'budget-1',
          account_id: 'account-1',
          amount: 1000,
          date,
        });
        expect(result.date).toBe(date);
      });
    });

    it('should reject null values for required fields', () => {
      expect(() =>
        CreateTransactionSchema.parse({
          budget_id: 'budget-1',
          account_id: 'account-1',
          amount: null,
          date: '2024-01-15',
        }),
      ).toThrow();
    });

    it('should reject undefined for required fields', () => {
      expect(() =>
        CreateTransactionSchema.parse({
          budget_id: 'budget-1',
          account_id: 'account-1',
          amount: undefined,
          date: '2024-01-15',
        }),
      ).toThrow();
    });

    it('should handle very long string values', () => {
      const longString = 'a'.repeat(1000);
      const result = CreateTransactionSchema.parse({
        budget_id: 'budget-1',
        account_id: 'account-1',
        amount: 1000,
        date: '2024-01-15',
        memo: longString,
      });
      expect(result.memo).toBe(longString);
    });

    it('should handle special characters in string fields', () => {
      const specialChars = '!@#$%^&*()_+-={}[]|\\:";\'<>?,./';
      const result = CreateTransactionSchema.parse({
        budget_id: 'budget-1',
        account_id: 'account-1',
        amount: 1000,
        date: '2024-01-15',
        payee_name: specialChars,
        memo: specialChars,
      });
      expect(result.payee_name).toBe(specialChars);
      expect(result.memo).toBe(specialChars);
    });

    it('should handle unicode characters', () => {
      const unicode = '🏪 Café München 日本語';
      const result = CreateTransactionSchema.parse({
        budget_id: 'budget-1',
        account_id: 'account-1',
        amount: 1000,
        date: '2024-01-15',
        payee_name: unicode,
      });
      expect(result.payee_name).toBe(unicode);
    });

    it('should handle empty strings for optional fields', () => {
      // Empty strings are allowed for optional string fields (they're just strings)
      const result = CreateTransactionSchema.parse({
        budget_id: 'budget-1',
        account_id: 'account-1',
        amount: 1000,
        date: '2024-01-15',
        memo: '',
        payee_name: '',
      });
      expect(result.memo).toBe('');
      expect(result.payee_name).toBe('');
    });
  });
});
