/**
 * Tests for smart sign detection algorithm
 */

import { describe, it, expect } from 'vitest';
import { detectSignInversion } from '../signDetector.js';
import type { BankTransaction, NormalizedYNABTransaction } from '../../../types/reconciliation.js';

describe('detectSignInversion', () => {
  it('detects when bank amounts need inversion (opposite signs)', () => {
    // Bank CSV shows charges as POSITIVE (banking convention)
    const bankTransactions: BankTransaction[] = [
      { id: '1', date: '2025-11-20', amount: 10000, payee: 'Grocery Store' }, // +$10
      { id: '2', date: '2025-11-21', amount: 5000, payee: 'Gas Station' }, // +$5
      { id: '3', date: '2025-11-22', amount: 20000, payee: 'Restaurant' }, // +$20
    ];

    // YNAB shows charges as NEGATIVE
    const ynabTransactions: NormalizedYNABTransaction[] = [
      {
        id: 'y1',
        date: '2025-11-20',
        amount: -10000, // -$10
        payee: 'Grocery Store',
        cleared: 'uncleared',
        approved: true,
        deleted: false,
      },
      {
        id: 'y2',
        date: '2025-11-21',
        amount: -5000, // -$5
        payee: 'Gas Station',
        cleared: 'uncleared',
        approved: true,
        deleted: false,
      },
      {
        id: 'y3',
        date: '2025-11-22',
        amount: -20000, // -$20
        payee: 'Restaurant',
        cleared: 'uncleared',
        approved: true,
        deleted: false,
      },
    ];

    const result = detectSignInversion(bankTransactions, ynabTransactions);

    expect(result).toBe(true); // Need inversion
  });

  it('detects when bank amounts do NOT need inversion (same signs)', () => {
    // Bank CSV already uses YNAB convention (Wealthsimple case)
    const bankTransactions: BankTransaction[] = [
      { id: '1', date: '2025-11-20', amount: -10000, payee: 'Grocery Store' }, // -$10
      { id: '2', date: '2025-11-21', amount: -5000, payee: 'Gas Station' }, // -$5
      { id: '3', date: '2025-11-22', amount: -20000, payee: 'Restaurant' }, // -$20
    ];

    // YNAB also shows charges as NEGATIVE
    const ynabTransactions: NormalizedYNABTransaction[] = [
      {
        id: 'y1',
        date: '2025-11-20',
        amount: -10000,
        payee: 'Grocery Store',
        cleared: 'uncleared',
        approved: true,
        deleted: false,
      },
      {
        id: 'y2',
        date: '2025-11-21',
        amount: -5000,
        payee: 'Gas Station',
        cleared: 'uncleared',
        approved: true,
        deleted: false,
      },
      {
        id: 'y3',
        date: '2025-11-22',
        amount: -20000,
        payee: 'Restaurant',
        cleared: 'uncleared',
        approved: true,
        deleted: false,
      },
    ];

    const result = detectSignInversion(bankTransactions, ynabTransactions);

    expect(result).toBe(false); // No inversion needed
  });

  it('handles mixed positive and negative amounts correctly', () => {
    // Bank CSV with charges (positive) and payment (negative)
    const bankTransactions: BankTransaction[] = [
      { id: '1', date: '2025-11-20', amount: 10000, payee: 'Purchase' },
      { id: '2', date: '2025-11-21', amount: -20000, payee: 'Payment' }, // Credit
      { id: '3', date: '2025-11-22', amount: 5000, payee: 'Purchase' },
    ];

    // YNAB with charges (negative) and payment (positive)
    const ynabTransactions: NormalizedYNABTransaction[] = [
      {
        id: 'y1',
        date: '2025-11-20',
        amount: -10000,
        payee: 'Purchase',
        cleared: 'uncleared',
        approved: true,
        deleted: false,
      },
      {
        id: 'y2',
        date: '2025-11-21',
        amount: 20000, // Payment (positive in YNAB)
        payee: 'Payment',
        cleared: 'uncleared',
        approved: true,
        deleted: false,
      },
      {
        id: 'y3',
        date: '2025-11-22',
        amount: -5000,
        payee: 'Purchase',
        cleared: 'uncleared',
        approved: true,
        deleted: false,
      },
    ];

    const result = detectSignInversion(bankTransactions, ynabTransactions);

    expect(result).toBe(true); // Need inversion (opposite signs)
  });

  it('works with small sample sizes', () => {
    const bankTransactions: BankTransaction[] = [
      { id: '1', date: '2025-11-20', amount: 10000, payee: 'Store' },
    ];

    const ynabTransactions: NormalizedYNABTransaction[] = [
      {
        id: 'y1',
        date: '2025-11-20',
        amount: -10000,
        payee: 'Store',
        cleared: 'uncleared',
        approved: true,
        deleted: false,
      },
    ];

    const result = detectSignInversion(bankTransactions, ynabTransactions);

    expect(result).toBe(true);
  });

  it('returns false when no matching transactions found', () => {
    const bankTransactions: BankTransaction[] = [
      { id: '1', date: '2025-11-20', amount: 10000, payee: 'Store A' },
    ];

    const ynabTransactions: NormalizedYNABTransaction[] = [
      {
        id: 'y1',
        date: '2025-10-20', // Different month
        amount: -50000, // Different amount
        payee: 'Store B',
        cleared: 'uncleared',
        approved: true,
        deleted: false,
      },
    ];

    const result = detectSignInversion(bankTransactions, ynabTransactions);

    // Conservative default: don't invert if we can't determine
    expect(result).toBe(false);
  });

  it('handles empty transaction lists', () => {
    const result1 = detectSignInversion([], []);
    expect(result1).toBe(false);

    const bankTransactions: BankTransaction[] = [
      { id: '1', date: '2025-11-20', amount: 10000, payee: 'Store' },
    ];
    const result2 = detectSignInversion(bankTransactions, []);
    expect(result2).toBe(false);

    const ynabTransactions: NormalizedYNABTransaction[] = [
      {
        id: 'y1',
        date: '2025-11-20',
        amount: -10000,
        payee: 'Store',
        cleared: 'uncleared',
        approved: true,
        deleted: false,
      },
    ];
    const result3 = detectSignInversion([], ynabTransactions);
    expect(result3).toBe(false);
  });
});
