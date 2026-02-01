import type * as ynab from 'ynab';
import type { z } from 'zod/v4';
import type { CompareTransactionsSchema } from './index.js';

/**
 * Represents a bank transaction from CSV
 */
export interface BankTransaction {
  /** Parsed date of the transaction */
  date: Date;
  /** Transaction amount in milliunits (YNAB format) */
  amount: number;
  /** Transaction description from CSV */
  description: string;
  /** Original amount string from CSV */
  raw_amount: string;
  /** Original date string from CSV */
  raw_date: string;
  /** Row number in CSV file for reference */
  row_number: number;
}

/**
 * Represents a YNAB transaction for comparison
 */
export interface YNABTransaction {
  /** YNAB transaction ID */
  id: string;
  /** Transaction date */
  date: Date;
  /** Transaction amount in milliunits */
  amount: number;
  /** Payee name (nullable) */
  payee_name: string | null | undefined;
  /** Transaction memo (nullable) */
  memo: string | null | undefined;
  /** Transaction cleared status */
  cleared: string;
  /** Original YNAB transaction detail object */
  original: ynab.TransactionDetail;
}

/**
 * Represents a matched pair of bank and YNAB transactions
 */
export interface TransactionMatch {
  /** Bank transaction from CSV */
  bank_transaction: BankTransaction;
  /** Matched YNAB transaction */
  ynab_transaction: YNABTransaction;
  /** Match score (0-100, higher is better) */
  match_score: number;
  /** Reasons for the match with explanations */
  match_reasons: string[];
}

/**
 * CSV format configuration type derived from zod schema for consistency
 */
export type CSVFormat = z.infer<typeof CompareTransactionsSchema>['csv_format'];
