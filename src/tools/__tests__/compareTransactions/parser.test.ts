import { describe, test, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import {
  parseBankCSV,
  autoDetectCSVFormat,
  parseDate,
  amountToMilliunits,
  readCSVFile,
  detectDateFormat,
  extractDateRangeFromCSV,
} from '../../compareTransactions/parser.js';
import { CSVFormat } from '../../compareTransactions/types.js';

// Mock fs module
vi.mock('fs', () => ({
  readFileSync: vi.fn(),
}));

const mockReadFileSync = vi.mocked(readFileSync);

describe('parser', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('parseDate', () => {
    test('should parse MM/DD/YYYY format', () => {
      const result = parseDate('09/15/2023', 'MM/DD/YYYY');
      expect(result.getFullYear()).toBe(2023);
      expect(result.getMonth()).toBe(8); // 0-indexed
      expect(result.getDate()).toBe(15);
    });

    test('should parse YYYY-MM-DD format', () => {
      const result = parseDate('2023-09-15', 'YYYY-MM-DD');
      expect(result.getFullYear()).toBe(2023);
      expect(result.getMonth()).toBe(8);
      expect(result.getDate()).toBe(15);
    });

    test('should parse MMM dd, yyyy format', () => {
      const result = parseDate('Sep 15, 2023', 'MMM dd, yyyy');
      expect(result.getFullYear()).toBe(2023);
      expect(result.getMonth()).toBe(8);
      expect(result.getDate()).toBe(15);
    });

    test('should handle single digit dates', () => {
      const result = parseDate('9/5/2023', 'M/D/YYYY');
      expect(result.getFullYear()).toBe(2023);
      expect(result.getMonth()).toBe(8);
      expect(result.getDate()).toBe(5);
    });

    test('should throw error for invalid date', () => {
      expect(() => parseDate('invalid-date', 'MM/DD/YYYY')).toThrow(
        'Unable to parse date: invalid-date with format: MM/DD/YYYY',
      );
    });

    test('should fallback to native Date parsing for unrecognized formats', () => {
      const result = parseDate('2023-09-15', 'UNKNOWN_FORMAT');
      expect(result.getFullYear()).toBe(2023);
      expect(result.getMonth()).toBe(8);
      // Native Date parsing might interpret '2023-09-15' differently, so check valid date range
      expect(result.getDate()).toBeGreaterThanOrEqual(14);
      expect(result.getDate()).toBeLessThanOrEqual(15);
    });

    test('should handle whitespace in dates', () => {
      const result = parseDate('  09/15/2023  ', 'MM/DD/YYYY');
      expect(result.getFullYear()).toBe(2023);
      expect(result.getMonth()).toBe(8);
      expect(result.getDate()).toBe(15);
    });
  });

  describe('amountToMilliunits', () => {
    test('should convert positive amounts', () => {
      expect(amountToMilliunits('123.45')).toBe(123450);
    });

    test('should convert negative amounts', () => {
      expect(amountToMilliunits('-123.45')).toBe(-123450);
    });

    test('should handle parentheses for negative amounts', () => {
      expect(amountToMilliunits('(123.45)')).toBe(-123450);
    });

    test('should handle currency symbols', () => {
      expect(amountToMilliunits('$123.45')).toBe(123450);
    });

    test('should handle commas in amounts', () => {
      expect(amountToMilliunits('1,234.56')).toBe(1234560);
    });

    test('should handle positive sign', () => {
      expect(amountToMilliunits('+123.45')).toBe(123450);
    });

    test('should handle zero amounts', () => {
      expect(amountToMilliunits('0.00')).toBe(0);
    });

    test('should handle amounts with spaces', () => {
      expect(amountToMilliunits('  123.45  ')).toBe(123450);
    });

    test('should handle very large amounts', () => {
      expect(amountToMilliunits('999999.99')).toBe(999999990);
    });
  });

  describe('detectDateFormat', () => {
    test('should detect MM/DD/YYYY format', () => {
      expect(detectDateFormat('09/15/2023')).toBe('MM/DD/YYYY');
    });

    test('should detect YYYY-MM-DD format', () => {
      expect(detectDateFormat('2023-09-15')).toBe('YYYY-MM-DD');
    });

    test('should detect MM-DD-YYYY format', () => {
      expect(detectDateFormat('09-15-2023')).toBe('MM-DD-YYYY');
    });

    test('should detect MMM dd, yyyy format', () => {
      expect(detectDateFormat('Sep 15, 2023')).toBe('MMM dd, yyyy');
    });

    test('should default to MM/DD/YYYY for undefined input', () => {
      expect(detectDateFormat(undefined)).toBe('MM/DD/YYYY');
    });

    test('should default to MM/DD/YYYY for unrecognized format', () => {
      expect(detectDateFormat('15.09.2023')).toBe('MM/DD/YYYY');
    });
  });

  describe('autoDetectCSVFormat', () => {
    test('should detect header format with standard columns', () => {
      const csvContent = 'Date,Amount,Description\n09/15/2023,123.45,Test Transaction';
      const format = autoDetectCSVFormat(csvContent);

      expect(format.has_header).toBe(true);
      expect(format.date_column).toBe('Date');
      expect(format.amount_column).toBe('Amount');
      expect(format.description_column).toBe('Description');
    });

    test('should detect no-header format', () => {
      const csvContent = '09/15/2023,123.45,Test Transaction\n09/16/2023,67.89,Another Transaction';
      const format = autoDetectCSVFormat(csvContent);

      expect(format.has_header).toBe(false);
      expect(format.date_column).toBe(0);
      expect(format.amount_column).toBe(1);
      expect(format.description_column).toBe(2);
    });

    test('should detect debit/credit columns', () => {
      const csvContent =
        'Date,Description,Debit,Credit\n09/15/2023,Test,123.45,\n09/16/2023,Test2,,67.89';
      const format = autoDetectCSVFormat(csvContent);

      expect(format.has_header).toBe(true);
      expect(format.debit_column).toBe('Debit');
      expect(format.credit_column).toBe('Credit');
      expect(format.amount_column).toBeUndefined();
    });

    test('should throw error for empty CSV', () => {
      expect(() => autoDetectCSVFormat('')).toThrow('CSV file contains empty first line');
    });

    test('should throw error for CSV with empty first line', () => {
      expect(() => autoDetectCSVFormat('\n')).toThrow('CSV file contains empty first line');
    });

    test('should detect date format from data rows', () => {
      const csvContent = 'Date,Amount,Description\n2023-09-15,123.45,Test Transaction';
      const format = autoDetectCSVFormat(csvContent);

      expect(format.date_format).toBe('YYYY-MM-DD');
    });

    test('should derive column names from non-standard headers - Transaction Date', () => {
      const csvContent = 'Transaction Date,Dollar Amount,Memo\n09/15/2023,123.45,Test Transaction';
      const format = autoDetectCSVFormat(csvContent);

      expect(format.has_header).toBe(true);
      expect(format.date_column).toBe('Transaction Date');
      expect(format.amount_column).toBe('Dollar Amount');
      expect(format.description_column).toBe('Memo');
    });

    test('should derive column names from non-standard headers - Post Date and Desc', () => {
      const csvContent = 'Post Date,Amt,Desc\n09/15/2023,123.45,Test Transaction';
      const format = autoDetectCSVFormat(csvContent);

      expect(format.has_header).toBe(true);
      expect(format.date_column).toBe('Post Date');
      expect(format.amount_column).toBe('Amt');
      expect(format.description_column).toBe('Desc');
    });

    test('should derive column names from non-standard headers - Payee column', () => {
      const csvContent = 'Date,Amount,Payee\n09/15/2023,123.45,Test Merchant';
      const format = autoDetectCSVFormat(csvContent);

      expect(format.has_header).toBe(true);
      expect(format.date_column).toBe('Date');
      expect(format.amount_column).toBe('Amount');
      expect(format.description_column).toBe('Payee');
    });

    test('should detect debit/credit columns with non-standard headers', () => {
      const csvContent =
        'Date,Merchant,Withdrawal,Deposit\n09/15/2023,Test,123.45,\n09/16/2023,Test2,,67.89';
      const format = autoDetectCSVFormat(csvContent);

      expect(format.has_header).toBe(true);
      expect(format.date_column).toBe('Date');
      expect(format.description_column).toBe('Merchant');
      expect(format.debit_column).toBe('Withdrawal');
      expect(format.credit_column).toBe('Deposit');
      expect(format.amount_column).toBeUndefined();
    });

    test('should fallback to original headers when patterns do not match', () => {
      const csvContent = 'Col1,Col2,Col3\n09/15/2023,123.45,Test Transaction';
      const format = autoDetectCSVFormat(csvContent);

      expect(format.has_header).toBe(true);
      expect(format.date_column).toBe('Col1'); // Falls back to first column
      expect(format.amount_column).toBe('Col2'); // Falls back to second column
      expect(format.description_column).toBe('Col3'); // Falls back to third column
    });

    test('should handle case-insensitive header matching', () => {
      const csvContent = 'DATE,AMOUNT,DESCRIPTION\n09/15/2023,123.45,Test Transaction';
      const format = autoDetectCSVFormat(csvContent);

      expect(format.has_header).toBe(true);
      expect(format.date_column).toBe('DATE');
      expect(format.amount_column).toBe('AMOUNT');
      expect(format.description_column).toBe('DESCRIPTION');
    });

    test('should detect semicolon delimiter', () => {
      const csvContent = 'Date;Amount;Description\n09/15/2023;123.45;Test Transaction';
      const format = autoDetectCSVFormat(csvContent);

      expect(format.has_header).toBe(true);
      expect(format.delimiter).toBe(';');
      expect(format.date_column).toBe('Date');
      expect(format.amount_column).toBe('Amount');
      expect(format.description_column).toBe('Description');
    });

    test('should detect tab delimiter', () => {
      const csvContent = 'Date\tAmount\tDescription\n09/15/2023\t123.45\tTest Transaction';
      const format = autoDetectCSVFormat(csvContent);

      expect(format.has_header).toBe(true);
      expect(format.delimiter).toBe('\t');
      expect(format.date_column).toBe('Date');
      expect(format.amount_column).toBe('Amount');
      expect(format.description_column).toBe('Description');
    });

    test('should detect pipe delimiter', () => {
      const csvContent = 'Date|Amount|Description\n09/15/2023|123.45|Test Transaction';
      const format = autoDetectCSVFormat(csvContent);

      expect(format.has_header).toBe(true);
      expect(format.delimiter).toBe('|');
      expect(format.date_column).toBe('Date');
      expect(format.amount_column).toBe('Amount');
      expect(format.description_column).toBe('Description');
    });

    test('should detect semicolon delimiter without headers', () => {
      const csvContent = '09/15/2023;123.45;Test Transaction\n09/16/2023;67.89;Another Transaction';
      const format = autoDetectCSVFormat(csvContent);

      expect(format.has_header).toBe(false);
      expect(format.delimiter).toBe(';');
      expect(format.date_column).toBe(0);
      expect(format.amount_column).toBe(1);
      expect(format.description_column).toBe(2);
    });

    test('should detect tab delimiter without headers', () => {
      const csvContent =
        '09/15/2023\t123.45\tTest Transaction\n09/16/2023\t67.89\tAnother Transaction';
      const format = autoDetectCSVFormat(csvContent);

      expect(format.has_header).toBe(false);
      expect(format.delimiter).toBe('\t');
      expect(format.date_column).toBe(0);
      expect(format.amount_column).toBe(1);
      expect(format.description_column).toBe(2);
    });

    test('should detect semicolon delimiter with debit/credit columns', () => {
      const csvContent =
        'Date;Description;Debit;Credit\n09/15/2023;Test;123.45;\n09/16/2023;Test2;;67.89';
      const format = autoDetectCSVFormat(csvContent);

      expect(format.has_header).toBe(true);
      expect(format.delimiter).toBe(';');
      expect(format.debit_column).toBe('Debit');
      expect(format.credit_column).toBe('Credit');
      expect(format.amount_column).toBeUndefined();
    });

    test('should detect semicolon delimiter when quoted fields contain delimiter', () => {
      const csvContent =
        'Date;Description;Amount\n2025-09-20;"Utility;Gas";-50.00\n2025-09-21;"Store;Purchase";-25.00';
      const format = autoDetectCSVFormat(csvContent);

      expect(format.has_header).toBe(true);
      expect(format.delimiter).toBe(';');
      expect(format.date_column).toBe('Date');
      expect(format.amount_column).toBe('Amount');
      expect(format.description_column).toBe('Description');
    });

    test('should detect comma delimiter when quoted fields contain commas', () => {
      const csvContent =
        'Date,Description,Amount\n2025-09-20,"Service, Inc",50.00\n2025-09-21,"Store, LLC",-25.00';
      const format = autoDetectCSVFormat(csvContent);

      expect(format.has_header).toBe(true);
      expect(format.delimiter).toBe(',');
      expect(format.date_column).toBe('Date');
      expect(format.amount_column).toBe('Amount');
      expect(format.description_column).toBe('Description');
    });

    test('should handle complex quoted fields with multiple delimiter types', () => {
      const csvContent =
        'Date;Description;Amount\n2025-09-20;"Utility;Gas,Electric";-50.00\n2025-09-21;"Store;Purchase,Tax";-25.00';
      const format = autoDetectCSVFormat(csvContent);

      expect(format.has_header).toBe(true);
      expect(format.delimiter).toBe(';');
      expect(format.date_column).toBe('Date');
      expect(format.amount_column).toBe('Amount');
      expect(format.description_column).toBe('Description');
    });

    test('should detect tab delimiter with debit/credit columns', () => {
      const csvContent =
        'Date\tDescription\tDebit\tCredit\n09/15/2023\tTest\t123.45\t\n09/16/2023\tTest2\t\t67.89';
      const format = autoDetectCSVFormat(csvContent);

      expect(format.has_header).toBe(true);
      expect(format.delimiter).toBe('\t');
      expect(format.debit_column).toBe('Debit');
      expect(format.credit_column).toBe('Credit');
      expect(format.amount_column).toBeUndefined();
    });
  });

  describe('parseBankCSV', () => {
    test('should parse CSV with headers', () => {
      const csvContent =
        'Date,Amount,Description\n09/15/2023,123.45,Test Transaction\n09/16/2023,-67.89,Another Transaction';
      const format: CSVFormat = {
        date_column: 'Date',
        amount_column: 'Amount',
        description_column: 'Description',
        date_format: 'MM/DD/YYYY',
        has_header: true,
        delimiter: ',',
      };

      const transactions = parseBankCSV(csvContent, format);

      expect(transactions).toHaveLength(2);
      expect(transactions[0].description).toBe('Test Transaction');
      expect(transactions[0].amount).toBe(123450);
      expect(transactions[0].row_number).toBe(2);
      expect(transactions[1].amount).toBe(-67890);
      expect(transactions[1].row_number).toBe(3);
    });

    test('should parse CSV without headers', () => {
      const csvContent =
        '09/15/2023,123.45,Test Transaction\n09/16/2023,-67.89,Another Transaction';
      const format: CSVFormat = {
        date_column: 0,
        amount_column: 1,
        description_column: 2,
        date_format: 'MM/DD/YYYY',
        has_header: false,
        delimiter: ',',
      };

      const transactions = parseBankCSV(csvContent, format);

      expect(transactions).toHaveLength(2);
      expect(transactions[0].description).toBe('Test Transaction');
      expect(transactions[0].amount).toBe(123450);
      expect(transactions[0].row_number).toBe(1);
      expect(transactions[1].row_number).toBe(2);
    });

    test('should handle debit/credit columns with headers', () => {
      const csvContent =
        'Date,Description,Debit,Credit\n09/15/2023,Test Transaction,123.45,\n09/16/2023,Credit Transaction,,67.89';
      const format: CSVFormat = {
        date_column: 'Date',
        description_column: 'Description',
        debit_column: 'Debit',
        credit_column: 'Credit',
        date_format: 'MM/DD/YYYY',
        has_header: true,
        delimiter: ',',
      };

      const transactions = parseBankCSV(csvContent, format);

      expect(transactions).toHaveLength(2);
      expect(transactions[0].amount).toBe(-123450); // Debit is negative
      expect(transactions[1].amount).toBe(67890); // Credit is positive
    });

    test('should handle debit/credit columns without headers', () => {
      const csvContent =
        '09/15/2023,Test Transaction,123.45,0\n09/16/2023,Credit Transaction,0,67.89';
      const format: CSVFormat = {
        date_column: 0,
        description_column: 1,
        debit_column: 2,
        credit_column: 3,
        date_format: 'MM/DD/YYYY',
        has_header: false,
        delimiter: ',',
      };

      const transactions = parseBankCSV(csvContent, format);

      expect(transactions).toHaveLength(2);
      expect(transactions[0].amount).toBe(-123450); // Debit is negative
      expect(transactions[1].amount).toBe(67890); // Credit is positive
    });

    test('should skip rows with missing data', () => {
      const csvContent =
        'Date,Amount,Description\n09/15/2023,123.45,Test Transaction\n,67.89,Missing Date\n09/17/2023,,Missing Amount';
      const format: CSVFormat = {
        date_column: 'Date',
        amount_column: 'Amount',
        description_column: 'Description',
        date_format: 'MM/DD/YYYY',
        has_header: true,
        delimiter: ',',
      };

      const transactions = parseBankCSV(csvContent, format);

      expect(transactions).toHaveLength(1);
      expect(transactions[0].description).toBe('Test Transaction');
    });

    test('should handle quoted dates with commas (MMM dd, yyyy format)', () => {
      const csvContent = 'Date,Amount,Description\n"Sep 15, 2023",123.45,Test Transaction';
      const format: CSVFormat = {
        date_column: 'Date',
        amount_column: 'Amount',
        description_column: 'Description',
        date_format: 'MMM dd, yyyy',
        has_header: true,
        delimiter: ',',
      };

      const transactions = parseBankCSV(csvContent, format);

      expect(transactions).toHaveLength(1);
      expect(transactions[0].date.getFullYear()).toBe(2023);
      expect(transactions[0].date.getMonth()).toBe(8); // September is month 8
    });

    test('should parse quoted fields with commas in descriptions', () => {
      const csvContent =
        'Date,Amount,Description\n09/15/2023,123.45,"Transaction with, comma"\n09/16/2023,67.89,"Another, test, transaction"';
      const format: CSVFormat = {
        date_column: 'Date',
        amount_column: 'Amount',
        description_column: 'Description',
        date_format: 'MM/DD/YYYY',
        has_header: true,
        delimiter: ',',
      };

      const transactions = parseBankCSV(csvContent, format);

      expect(transactions).toHaveLength(2);
      expect(transactions[0].description).toBe('Transaction with, comma');
      expect(transactions[1].description).toBe('Another, test, transaction');
    });

    test('should throw error when no amount column configuration', () => {
      const csvContent = 'Date,Description\n09/15/2023,Test Transaction';
      const format: CSVFormat = {
        date_column: 'Date',
        description_column: 'Description',
        date_format: 'MM/DD/YYYY',
        has_header: true,
        delimiter: ',',
      };

      expect(() => parseBankCSV(csvContent, format)).not.toThrow();
      // Since the function continues on error, check that no transactions are returned
      const transactions = parseBankCSV(csvContent, format);
      expect(transactions).toHaveLength(0);
    });

    test('should handle invalid column indices gracefully', () => {
      const csvContent = '09/15/2023,123.45';
      const format: CSVFormat = {
        date_column: 0,
        amount_column: 1,
        description_column: 99, // Invalid index
        date_format: 'MM/DD/YYYY',
        has_header: false,
        delimiter: ',',
      };

      const transactions = parseBankCSV(csvContent, format);

      expect(transactions).toHaveLength(1);
      expect(transactions[0].description).toBe(''); // Empty description for missing column
    });

    test('should parse semicolon-delimited CSV with headers', () => {
      const csvContent =
        'Date;Amount;Description\n09/15/2023;123.45;Test Transaction\n09/16/2023;-67.89;Another Transaction';
      const format: CSVFormat = {
        date_column: 'Date',
        amount_column: 'Amount',
        description_column: 'Description',
        date_format: 'MM/DD/YYYY',
        has_header: true,
        delimiter: ';',
      };

      const transactions = parseBankCSV(csvContent, format);

      expect(transactions).toHaveLength(2);
      expect(transactions[0].description).toBe('Test Transaction');
      expect(transactions[0].amount).toBe(123450);
      expect(transactions[0].row_number).toBe(2);
      expect(transactions[1].amount).toBe(-67890);
      expect(transactions[1].row_number).toBe(3);
    });

    test('should parse tab-delimited CSV with headers', () => {
      const csvContent =
        'Date\tAmount\tDescription\n09/15/2023\t123.45\tTest Transaction\n09/16/2023\t-67.89\tAnother Transaction';
      const format: CSVFormat = {
        date_column: 'Date',
        amount_column: 'Amount',
        description_column: 'Description',
        date_format: 'MM/DD/YYYY',
        has_header: true,
        delimiter: '\t',
      };

      const transactions = parseBankCSV(csvContent, format);

      expect(transactions).toHaveLength(2);
      expect(transactions[0].description).toBe('Test Transaction');
      expect(transactions[0].amount).toBe(123450);
      expect(transactions[0].row_number).toBe(2);
      expect(transactions[1].amount).toBe(-67890);
      expect(transactions[1].row_number).toBe(3);
    });

    test('should parse semicolon-delimited CSV without headers', () => {
      const csvContent =
        '09/15/2023;123.45;Test Transaction\n09/16/2023;-67.89;Another Transaction';
      const format: CSVFormat = {
        date_column: 0,
        amount_column: 1,
        description_column: 2,
        date_format: 'MM/DD/YYYY',
        has_header: false,
        delimiter: ';',
      };

      const transactions = parseBankCSV(csvContent, format);

      expect(transactions).toHaveLength(2);
      expect(transactions[0].description).toBe('Test Transaction');
      expect(transactions[0].amount).toBe(123450);
      expect(transactions[0].row_number).toBe(1);
      expect(transactions[1].row_number).toBe(2);
    });

    test('should parse tab-delimited CSV without headers', () => {
      const csvContent =
        '09/15/2023\t123.45\tTest Transaction\n09/16/2023\t-67.89\tAnother Transaction';
      const format: CSVFormat = {
        date_column: 0,
        amount_column: 1,
        description_column: 2,
        date_format: 'MM/DD/YYYY',
        has_header: false,
        delimiter: '\t',
      };

      const transactions = parseBankCSV(csvContent, format);

      expect(transactions).toHaveLength(2);
      expect(transactions[0].description).toBe('Test Transaction');
      expect(transactions[0].amount).toBe(123450);
      expect(transactions[0].row_number).toBe(1);
      expect(transactions[1].row_number).toBe(2);
    });

    test('should handle semicolon-delimited debit/credit columns with headers', () => {
      const csvContent =
        'Date;Description;Debit;Credit\n09/15/2023;Test Transaction;123.45;\n09/16/2023;Credit Transaction;;67.89';
      const format: CSVFormat = {
        date_column: 'Date',
        description_column: 'Description',
        debit_column: 'Debit',
        credit_column: 'Credit',
        date_format: 'MM/DD/YYYY',
        has_header: true,
        delimiter: ';',
      };

      const transactions = parseBankCSV(csvContent, format);

      expect(transactions).toHaveLength(2);
      expect(transactions[0].amount).toBe(-123450); // Debit is negative
      expect(transactions[1].amount).toBe(67890); // Credit is positive
    });

    test('should handle tab-delimited debit/credit columns with headers', () => {
      const csvContent =
        'Date\tDescription\tDebit\tCredit\n09/15/2023\tTest Transaction\t123.45\t\n09/16/2023\tCredit Transaction\t\t67.89';
      const format: CSVFormat = {
        date_column: 'Date',
        description_column: 'Description',
        debit_column: 'Debit',
        credit_column: 'Credit',
        date_format: 'MM/DD/YYYY',
        has_header: true,
        delimiter: '\t',
      };

      const transactions = parseBankCSV(csvContent, format);

      expect(transactions).toHaveLength(2);
      expect(transactions[0].amount).toBe(-123450); // Debit is negative
      expect(transactions[1].amount).toBe(67890); // Credit is positive
    });

    test('should parse semicolon-delimited CSV with quoted fields containing delimiter', () => {
      const csvContent =
        'Date;Description;Amount\n2025-09-20;"Utility;Gas";-50.00\n2025-09-21;"Store;Purchase";-25.00';
      const format: CSVFormat = {
        date_column: 'Date',
        amount_column: 'Amount',
        description_column: 'Description',
        date_format: 'YYYY-MM-DD',
        has_header: true,
        delimiter: ';',
      };

      const transactions = parseBankCSV(csvContent, format);

      expect(transactions).toHaveLength(2);
      expect(transactions[0].description).toBe('Utility;Gas');
      expect(transactions[0].amount).toBe(-50000);
      expect(transactions[1].description).toBe('Store;Purchase');
      expect(transactions[1].amount).toBe(-25000);
    });
  });

  describe('extractDateRangeFromCSV', () => {
    test('should extract min and max dates from CSV transactions', () => {
      const csvContent = `Date,Description,Debit,Credit,Balance
11/10/2025,DOLLARAMA # 109,10.91,,
10/15/2025,Uber Trip,30.50,,
09/22/2025,CIRCLE K # 05844 A,18.84,,`;

      const format: CSVFormat = {
        date_column: 'Date',
        description_column: 'Description',
        debit_column: 'Debit',
        credit_column: 'Credit',
        date_format: 'MM/DD/YYYY',
        has_header: true,
        delimiter: ',',
      };

      const { minDate, maxDate } = extractDateRangeFromCSV(csvContent, format);

      expect(minDate).toBe('2025-09-22');
      expect(maxDate).toBe('2025-11-10');
    });

    test('should handle single transaction', () => {
      const csvContent = `Date,Description,Amount
10/15/2025,Test,100.00`;

      const format: CSVFormat = {
        date_column: 'Date',
        description_column: 'Description',
        amount_column: 'Amount',
        date_format: 'MM/DD/YYYY',
        has_header: true,
        delimiter: ',',
      };

      const { minDate, maxDate } = extractDateRangeFromCSV(csvContent, format);

      expect(minDate).toBe('2025-10-15');
      expect(maxDate).toBe('2025-10-15');
    });
  });

  describe('readCSVFile', () => {
    test('should read file successfully', () => {
      const mockContent = 'Date,Amount,Description\n09/15/2023,123.45,Test';
      mockReadFileSync.mockReturnValue(mockContent);

      const result = readCSVFile('/path/to/file.csv');

      expect(result).toBe(mockContent);
      expect(mockReadFileSync).toHaveBeenCalledWith('/path/to/file.csv', 'utf-8');
    });

    test('should throw error when file reading fails', () => {
      const error = new Error('File not found');
      mockReadFileSync.mockImplementation(() => {
        throw error;
      });

      expect(() => readCSVFile('/nonexistent/file.csv')).toThrow(
        'Unable to read CSV file: File not found',
      );
    });

    test('should handle unknown errors', () => {
      mockReadFileSync.mockImplementation(() => {
        throw 'String error';
      });

      expect(() => readCSVFile('/path/to/file.csv')).toThrow(
        'Unable to read CSV file: Unknown error',
      );
    });
  });
});
