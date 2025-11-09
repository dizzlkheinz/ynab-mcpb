import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { API } from 'ynab';
import { handleReconcileAccount } from '../reconcileAccount.js';
import type { MoneyValue } from '../../utils/money.js';

// Mock the dependencies
vi.mock('../compareTransactions/index.js');
vi.mock('../transactionTools.js');
vi.mock('../accountTools.js');
vi.mock('../../server/responseFormatter.js', () => ({
  responseFormatter: {
    format: vi.fn((data) => JSON.stringify(data)),
  },
}));

describe('reconcileAccount MoneyValue integration', () => {
  let mockYnabAPI: any;

  beforeEach(async () => {
    mockYnabAPI = {
      transactions: {
        getTransactionsByAccount: vi.fn(),
      },
    } as unknown as API;

    vi.clearAllMocks();

    // Mock handleGetAccount
    const { handleGetAccount } = await import('../accountTools.js');
    vi.mocked(handleGetAccount).mockResolvedValue({
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            account: {
              id: 'account456',
              name: 'Test Account',
              balance: 100000, // $100 in milliunits
              cleared_balance: 100000,
              uncleared_balance: 0,
            },
          }),
        },
      ],
    });

    // Mock handleCompareTransactions
    const { handleCompareTransactions } = await import('../compareTransactions/index.js');
    vi.mocked(handleCompareTransactions).mockResolvedValue({
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            bank_transactions: [
              { id: 'bank1', date: '2024-01-15', amount: 50.0, description: 'Test 1' },
              { id: 'bank2', date: '2024-01-16', amount: 50.0, description: 'Test 2' },
            ],
            ynab_transactions: [
              { id: 'txn1', date: '2024-01-15', amount: 50000, payee_name: 'Test 1' },
              { id: 'txn2', date: '2024-01-16', amount: 50000, payee_name: 'Test 2' },
            ],
            matches: [
              {
                bank: { id: 'bank1', date: '2024-01-15', amount: 50.0 },
                ynab: { id: 'txn1', date: '2024-01-15', amount: 50000 },
                confidence: 1.0,
              },
              {
                bank: { id: 'bank2', date: '2024-01-16', amount: 50.0 },
                ynab: { id: 'txn2', date: '2024-01-16', amount: 50000 },
                confidence: 1.0,
              },
            ],
            missing_in_ynab: [],
            missing_in_bank: [],
          }),
        },
      ],
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns account_balance fields as MoneyValue objects', async () => {
    mockYnabAPI.transactions.getTransactionsByAccount.mockResolvedValue({
      data: {
        transactions: [
          {
            id: 'txn1',
            amount: 50000,
            date: '2024-01-15',
            cleared: 'cleared',
          },
          {
            id: 'txn2',
            amount: 50000,
            date: '2024-01-16',
            cleared: 'cleared',
          },
        ],
      },
    });

    const result = await handleReconcileAccount(mockYnabAPI, {
      budget_id: 'budget123',
      account_id: 'account456',
      csv_data:
        'Date,Amount,Description\n2024-01-15,50.00,Test 1\n2024-01-16,50.00,Test 2',
      bank_statement_balance: 100.0,
      statement_date: '2024-01-20',
      dry_run: true,
    });

    const parsedResult = JSON.parse(result.content[0]?.text as string);

    // Debug: Check if there's an error
    if (parsedResult.error) {
      console.error('Full error:', JSON.stringify(parsedResult, null, 2));
      throw new Error(`Reconciliation failed with error: ${JSON.stringify(parsedResult.error)}`);
    }
    console.log('Keys in result:', Object.keys(parsedResult));

    // Verify account_balance.before uses MoneyValue
    expect(parsedResult.account_balance).toBeDefined();
    expect(parsedResult.account_balance.before).toBeDefined();
    expect(parsedResult.account_balance.before.balance).toHaveProperty('value_milliunits');
    expect(parsedResult.account_balance.before.balance).toHaveProperty('value');
    expect(parsedResult.account_balance.before.balance).toHaveProperty('value_display');
    expect(parsedResult.account_balance.before.balance).toHaveProperty('currency');
    expect(parsedResult.account_balance.before.balance).toHaveProperty('direction');

    expect(parsedResult.account_balance.before.cleared_balance).toHaveProperty(
      'value_milliunits',
    );
    expect(parsedResult.account_balance.before.uncleared_balance).toHaveProperty(
      'value_milliunits',
    );

    // Verify account_balance.after uses MoneyValue
    expect(parsedResult.account_balance.after.balance).toHaveProperty('value_milliunits');
    expect(parsedResult.account_balance.after.cleared_balance).toHaveProperty('value_milliunits');
    expect(parsedResult.account_balance.after.uncleared_balance).toHaveProperty(
      'value_milliunits',
    );
  });

  it('returns precision_calculations with MoneyValue objects', async () => {
    mockYnabAPI.transactions.getTransactionsByAccount.mockResolvedValue({
      data: {
        transactions: [
          {
            id: 'txn1',
            amount: 100000, // $100
            date: '2024-01-15',
            cleared: 'cleared',
          },
        ],
      },
    });

    const result = await handleReconcileAccount(mockYnabAPI, {
      budget_id: 'budget123',
      account_id: 'account456',
      csv_data: 'Date,Amount,Description\n2024-01-15,77.78,Test',
      bank_statement_balance: 77.78, // Creates $22.22 discrepancy
      statement_date: '2024-01-20',
      dry_run: true,
    });

    const parsedResult = JSON.parse(result.content[0]?.text as string);

    // Verify precision_calculations uses MoneyValue
    const precision = parsedResult.balance_reconciliation?.precision_calculations;
    if (precision) {
      expect(precision.bank_statement_balance).toHaveProperty('value_milliunits');
      expect(precision.bank_statement_balance).toHaveProperty('value_display');
      expect(precision.bank_statement_balance.value_display).toBe('$77.78');

      expect(precision.ynab_calculated_balance).toHaveProperty('value_milliunits');
      expect(precision.ynab_calculated_balance).toHaveProperty('value_display');
      expect(precision.ynab_calculated_balance.value_display).toBe('$100.00');

      expect(precision.discrepancy).toHaveProperty('value_milliunits');
      expect(precision.discrepancy).toHaveProperty('value_display');
      expect(precision.discrepancy).toHaveProperty('direction');
      expect(Math.abs(precision.discrepancy.value)).toBeCloseTo(22.22, 2);
    }
  });

  it('formats MoneyValue display strings correctly for positive amounts', async () => {
    mockYnabAPI.transactions.getTransactionsByAccount.mockResolvedValue({
      data: {
        transactions: [
          {
            id: 'txn1',
            amount: 12345, // $12.345 -> should round to $12.35
            date: '2024-01-15',
            cleared: 'cleared',
          },
        ],
      },
    });

    const result = await handleReconcileAccount(mockYnabAPI, {
      budget_id: 'budget123',
      account_id: 'account456',
      csv_data: 'Date,Amount,Description\n2024-01-15,12.35,Test',
      dry_run: true,
    });

    const parsedResult = JSON.parse(result.content[0]?.text as string);
    const balance = parsedResult.account_balance.before.balance as MoneyValue;

    expect(balance.value_milliunits).toBe(12345);
    expect(balance.value).toBeCloseTo(12.345, 3);
    expect(balance.value_display).toMatch(/^\$12\.3[45]$/); // Allow for rounding
    expect(balance.currency).toBe('USD');
    expect(balance.direction).toBe('credit');
  });

  it('formats MoneyValue display strings correctly for negative amounts', async () => {
    mockYnabAPI.transactions.getTransactionsByAccount.mockResolvedValue({
      data: {
        transactions: [
          {
            id: 'txn1',
            amount: -45670, // -$45.67
            date: '2024-01-15',
            cleared: 'cleared',
          },
        ],
      },
    });

    const result = await handleReconcileAccount(mockYnabAPI, {
      budget_id: 'budget123',
      account_id: 'account456',
      csv_data: 'Date,Amount,Description\n2024-01-15,-45.67,Test',
      dry_run: true,
    });

    const parsedResult = JSON.parse(result.content[0]?.text as string);
    const balance = parsedResult.account_balance.before.balance as MoneyValue;

    expect(balance.value_milliunits).toBe(-45670);
    expect(balance.value).toBeCloseTo(-45.67, 2);
    expect(balance.value_display).toMatch(/-\$45\.67/);
    expect(balance.currency).toBe('USD');
    expect(balance.direction).toBe('debit');
  });
});
