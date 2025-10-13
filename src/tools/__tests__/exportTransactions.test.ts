import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as ynab from 'ynab';
import { handleExportTransactions, ExportTransactionsSchema } from '../exportTransactions.js';
import { writeFileSync } from 'fs';

// Mock filesystem functions
vi.mock('fs', () => ({
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
}));

vi.mock('path', async () => {
  const actual = await vi.importActual('path');
  return actual;
});

vi.mock('os', () => ({
  homedir: vi.fn(() => '/home/user'),
}));

// Mock the YNAB API
const mockYnabAPI = {
  transactions: {
    getTransactions: vi.fn(),
    getTransactionsByAccount: vi.fn(),
    getTransactionsByCategory: vi.fn(),
  },
} as unknown as ynab.API;

describe('exportTransactions', () => {
  const mockTransactions = [
    {
      id: 'txn-1',
      date: '2024-01-01',
      amount: 1000,
      payee_name: 'Test Payee 1',
      cleared: 'cleared',
      memo: 'Test memo 1',
      approved: true,
      flag_color: null,
      account_id: 'acc-1',
      payee_id: 'pay-1',
      category_id: 'cat-1',
      transfer_account_id: null,
      transfer_transaction_id: null,
      matched_transaction_id: null,
      import_id: null,
      deleted: false,
      account_name: 'Test Account',
      category_name: 'Test Category',
    },
    {
      id: 'txn-2',
      date: '2024-01-02',
      amount: -2000,
      payee_name: 'Test Payee 2',
      cleared: 'uncleared',
      memo: 'Test memo 2',
      approved: false,
      flag_color: 'red',
      account_id: 'acc-2',
      payee_id: 'pay-2',
      category_id: 'cat-2',
      transfer_account_id: null,
      transfer_transaction_id: null,
      matched_transaction_id: null,
      import_id: null,
      deleted: false,
      account_name: 'Test Account 2',
      category_name: 'Test Category 2',
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    // Set up successful API response
    (mockYnabAPI.transactions.getTransactions as any).mockResolvedValue({
      data: { transactions: mockTransactions },
    });
  });

  afterEach(() => {
    // Clean up test files
    vi.restoreAllMocks();
  });

  describe('ExportTransactionsSchema', () => {
    it('should default minimal to true when not provided', () => {
      const params = { budget_id: 'test-budget' };
      const parsed = ExportTransactionsSchema.parse(params);
      expect(parsed.minimal).toBe(true);
    });

    it('should preserve minimal: false when explicitly set', () => {
      const params = { budget_id: 'test-budget', minimal: false };
      const parsed = ExportTransactionsSchema.parse(params);
      expect(parsed.minimal).toBe(false);
    });

    it('should preserve minimal: true when explicitly set', () => {
      const params = { budget_id: 'test-budget', minimal: true };
      const parsed = ExportTransactionsSchema.parse(params);
      expect(parsed.minimal).toBe(true);
    });
  });

  describe('handleExportTransactions', () => {
    it('should export minimal fields by default', async () => {
      const params = { budget_id: 'test-budget' };

      const result = await handleExportTransactions(mockYnabAPI, params);

      expect(writeFileSync).toHaveBeenCalledTimes(1);
      const [, fileContent] = (writeFileSync as any).mock.calls[0];
      const exportData = JSON.parse(fileContent);

      // Check that export_info shows minimal mode
      expect(exportData.export_info.minimal).toBe(true);
      expect(exportData.export_info.filters.minimal).toBe(true);

      // Check that transactions only have minimal fields
      expect(exportData.transactions).toHaveLength(2);

      const firstTransaction = exportData.transactions[0];
      expect(Object.keys(firstTransaction)).toEqual([
        'id',
        'date',
        'amount',
        'payee_name',
        'cleared',
      ]);

      expect(firstTransaction).toEqual({
        id: 'txn-1',
        date: '2024-01-01',
        amount: 1000,
        payee_name: 'Test Payee 1',
        cleared: 'cleared',
      });

      // Verify response message indicates minimal export
      const responseText = result.content[0].text;
      expect(responseText).toContain('(minimal fields)');
      const responseJson = JSON.parse(responseText);
      expect(responseJson.export_mode).toBe('minimal');
      expect(responseJson.minimal_fields).toBe('id, date, amount, payee_name, cleared');
    });

    it('should export all fields when minimal is false', async () => {
      const params = { budget_id: 'test-budget', minimal: false };

      const result = await handleExportTransactions(mockYnabAPI, params);

      expect(writeFileSync).toHaveBeenCalledTimes(1);
      const [, fileContent] = (writeFileSync as any).mock.calls[0];
      const exportData = JSON.parse(fileContent);

      // Check that export_info shows full mode
      expect(exportData.export_info.minimal).toBe(false);
      expect(exportData.export_info.filters.minimal).toBe(false);

      // Check that transactions have all fields
      expect(exportData.transactions).toHaveLength(2);

      const firstTransaction = exportData.transactions[0];
      expect(Object.keys(firstTransaction)).toEqual([
        'id',
        'date',
        'amount',
        'memo',
        'cleared',
        'approved',
        'flag_color',
        'account_id',
        'payee_id',
        'category_id',
        'transfer_account_id',
        'transfer_transaction_id',
        'matched_transaction_id',
        'import_id',
        'deleted',
        'account_name',
        'payee_name',
        'category_name',
      ]);

      // Verify response message indicates full export
      const responseText = result.content[0].text;
      expect(responseText).toContain('(full fields)');
      const responseJson = JSON.parse(responseText);
      expect(responseJson.export_mode).toBe('full');
      expect(responseJson.minimal_fields).toBeNull();
    });

    it('should include "minimal" in filename by default', async () => {
      const params = { budget_id: 'test-budget' };

      await handleExportTransactions(mockYnabAPI, params);

      expect(writeFileSync).toHaveBeenCalledTimes(1);
      const [filePath] = (writeFileSync as any).mock.calls[0];
      expect(filePath).toContain('minimal');
    });

    it('should not include "minimal" in filename when minimal is false', async () => {
      const params = { budget_id: 'test-budget', minimal: false };

      await handleExportTransactions(mockYnabAPI, params);

      expect(writeFileSync).toHaveBeenCalledTimes(1);
      const [filePath] = (writeFileSync as any).mock.calls[0];
      expect(filePath).not.toContain('minimal');
    });
  });
});
