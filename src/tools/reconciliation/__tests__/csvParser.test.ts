import { describe, it, expect } from 'vitest';
import { parseCSV, ParseCSVOptions } from '../csvParser.js';

describe('csvParser', () => {
  describe('Security and Limits', () => {
    it('should throw error if file size exceeds maxBytes', () => {
      const largeContent = 'a'.repeat(1024 * 1024 + 1); // 1MB + 1 byte
      const options: ParseCSVOptions = { maxBytes: 1024 * 1024 }; // 1MB limit

      expect(() => parseCSV(largeContent, options)).toThrow(/File size exceeds limit/);
    });

    it('should respect maxRows limit', () => {
      const rows = Array.from({ length: 20 }, (_, i) => `2024-01-${String(i + 1).padStart(2, '0')},Desc ${i},10.00`).join('\n');
      const content = `Date,Description,Amount\n${rows}`;
      const options: ParseCSVOptions = { maxRows: 10 };

      const result = parseCSV(content, options);
      expect(result.transactions).toHaveLength(10);
      expect(result.meta.validRows).toBe(10);
    });

    it('should sanitize control characters from description', () => {
      // ASCII 0x07 (Bell) and 0x1B (Escape) are control characters
      const badDesc = 'Bad\x07Description\x1B';
      const content = `Date,Description,Amount\n2024-01-01,${badDesc},10.00`;
      
      const result = parseCSV(content);
      expect(result.transactions[0].payee).toBe('BadDescription');
    });

    it('should limit description length to 500 characters', () => {
      const longDesc = 'a'.repeat(600);
      const content = `Date,Description,Amount\n2024-01-01,${longDesc},10.00`;
      
      const result = parseCSV(content);
      expect(result.transactions[0].payee).toHaveLength(500);
      expect(result.transactions[0].payee).toBe('a'.repeat(500));
    });
  });

  describe('Timezone Handling', () => {
    it('should parse ISO dates correctly without timezone shift', () => {
      // If parsed as local time in UTC-5 (EST), 2024-01-01 00:00:00 becomes 2023-12-31 19:00:00 UTC
      // But we want 2024-01-01 regardless of local timezone
      const content = `Date,Description,Amount\n2024-01-01,Test,10.00`;
      const result = parseCSV(content);
      expect(result.transactions[0].date).toBe('2024-01-01');
    });

    it('should parse MDY dates correctly without timezone shift', () => {
      const content = `Date,Description,Amount\n01/01/2024,Test,10.00`;
      const result = parseCSV(content, { dateFormat: 'MDY' });
      expect(result.transactions[0].date).toBe('2024-01-01');
    });

    it('should parse DMY dates correctly without timezone shift', () => {
      const content = `Date,Description,Amount\n01/01/2024,Test,10.00`;
      const result = parseCSV(content, { dateFormat: 'DMY' });
      expect(result.transactions[0].date).toBe('2024-01-01');
    });
  });

  describe('Bank Presets', () => {
    it('should detect TD headerless format correctly', () => {
      // TD Pattern: Date, Description, Debit, Credit, Balance
      const content = `
01/15/2024,PAYMENT RECEIVED,,100.00,500.00
01/16/2024,PURCHASE,50.00,,450.00
`.trim();
      
      // Note: TD pattern detection requires 4+ columns
      // Our parser might need a hint if the csv is very short or malformed
      // But the auto-detect logic checks for date in col 0 and numerics in 2/3
      
      const result = parseCSV(content);
      // Should detect TD preset which implies header: false
      expect(result.meta.detectedColumns).toBeDefined();
      expect(result.transactions).toHaveLength(2);
      expect(result.transactions[0].amount).toBe(100000); // Credit is inflow (positive)
      expect(result.transactions[1].amount).toBe(-50000); // Debit is outflow (negative)
    });
  });
});
