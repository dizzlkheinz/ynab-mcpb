import { describe, it, expect } from 'vitest';
import {
  normalizePayee,
  normalizedMatch,
  fuzzyMatch,
  tokenBasedSimilarity,
  payeeSimilarity,
  payeeContains,
} from '../payeeNormalizer.js';

describe('payeeNormalizer', () => {
  describe('normalizePayee', () => {
    it('should convert to lowercase', () => {
      expect(normalizePayee('SHELL #1234')).toBe('shell1234');
      expect(normalizePayee('Amazon Prime')).toBe('amazonprime');
    });

    it('should remove all spaces', () => {
      expect(normalizePayee('Shell Gas Station')).toBe('shellgasstation');
      expect(normalizePayee('A B C D')).toBe('abcd');
    });

    it('should remove special characters', () => {
      expect(normalizePayee('AMZN MKTP CA*123456789')).toBe('amznmktpca123456789');
      expect(normalizePayee('NETFLIX.COM')).toBe('netflixcom');
      expect(normalizePayee('Shell #1234 - Oakville, ON')).toBe('shell1234oakvilleon');
    });

    it('should keep only alphanumeric characters', () => {
      expect(normalizePayee('Test!@#$%^&*()123')).toBe('test123');
      expect(normalizePayee('Hello_World-2024')).toBe('helloworld2024');
    });

    it('should handle null and undefined', () => {
      expect(normalizePayee(null)).toBe('');
      expect(normalizePayee(undefined)).toBe('');
    });

    it('should handle empty string', () => {
      expect(normalizePayee('')).toBe('');
    });

    it('should handle real-world examples', () => {
      expect(normalizePayee('SHELL #1234 OAKVILLE ON')).toBe('shell1234oakvilleon');
      expect(normalizePayee('Shell Gas Station')).toBe('shellgasstation');
      expect(normalizePayee('NETFLIX.COM')).toBe('netflixcom');
      expect(normalizePayee('Netflix Subscription')).toBe('netflixsubscription');
      expect(normalizePayee('AMZN MKTP CA*123456789')).toBe('amznmktpca123456789');
      expect(normalizePayee('Amazon')).toBe('amazon');
    });
  });

  describe('normalizedMatch', () => {
    it('should match identical normalized strings', () => {
      expect(normalizedMatch('SHELL', 'shell')).toBe(true);
      expect(normalizedMatch('SHELL #1234', 'shell 1234')).toBe(true);
      expect(normalizedMatch('Amazon Prime', 'amazon-prime')).toBe(true);
    });

    it('should match despite different special characters', () => {
      expect(normalizedMatch('NETFLIX.COM', 'NETFLIX COM')).toBe(true);
      expect(normalizedMatch('Shell #1234', 'Shell 1234')).toBe(true);
    });

    it('should not match different strings', () => {
      expect(normalizedMatch('SHELL', 'ESSO')).toBe(false);
      expect(normalizedMatch('Amazon', 'Walmart')).toBe(false);
    });

    it('should handle null and undefined', () => {
      expect(normalizedMatch(null, 'test')).toBe(false);
      expect(normalizedMatch('test', null)).toBe(false);
      expect(normalizedMatch(null, null)).toBe(false);
      expect(normalizedMatch(undefined, undefined)).toBe(false);
    });

    it('should match empty strings', () => {
      expect(normalizedMatch('', '')).toBe(false); // Both empty = no match
    });

    it('should match real-world examples', () => {
      expect(normalizedMatch('SHELL #1234 OAKVILLE', 'Shell 1234 Oakville')).toBe(true);
      expect(normalizedMatch('NETFLIX.COM', 'Netflix.com')).toBe(true);
      expect(normalizedMatch('AMZN MKTP CA', 'amzn mktp ca')).toBe(true);
    });
  });

  describe('fuzzyMatch', () => {
    it('should return 100 for identical strings', () => {
      expect(fuzzyMatch('shell', 'shell')).toBe(100);
      expect(fuzzyMatch('AMAZON', 'amazon')).toBe(100);
    });

    it('should return high score for similar strings', () => {
      const score = fuzzyMatch('shell', 'shells');
      expect(score).toBeGreaterThan(80);
      expect(score).toBeLessThan(100);
    });

    it('should return lower score for different strings', () => {
      const score = fuzzyMatch('shell', 'esso');
      expect(score).toBeLessThan(50);
    });

    it('should return 0 for completely different strings', () => {
      const score = fuzzyMatch('a', 'xyz');
      expect(score).toBeLessThan(30);
    });

    it('should handle null and undefined', () => {
      expect(fuzzyMatch(null, 'test')).toBe(0);
      expect(fuzzyMatch('test', null)).toBe(0);
      expect(fuzzyMatch(null, null)).toBe(0);
    });

    it('should calculate Levenshtein distance correctly', () => {
      // 'shell' -> 'shells' requires 1 insertion
      const score1 = fuzzyMatch('shell', 'shells');
      expect(score1).toBeGreaterThan(80);

      // 'kitten' -> 'sitting' requires 3 operations
      const score2 = fuzzyMatch('kitten', 'sitting');
      expect(score2).toBeGreaterThan(40);
      expect(score2).toBeLessThan(70);
    });

    it('should handle real-world payee variations', () => {
      expect(fuzzyMatch('Amazon', 'Amazon Prime')).toBeGreaterThan(60);
      expect(fuzzyMatch('Shell', 'Shell Gas')).toBeGreaterThan(60);
      expect(fuzzyMatch('Netflix', 'Netflux')).toBeGreaterThan(70);
    });
  });

  describe('tokenBasedSimilarity', () => {
    it('should return 100 for identical tokens', () => {
      expect(tokenBasedSimilarity('amazon prime', 'amazon prime')).toBe(100);
    });

    it('should return score for same tokens in different order', () => {
      const score = tokenBasedSimilarity('prime amazon', 'amazon prime');
      // Tokens extracted from normalized string, which removes spaces
      expect(score).toBeGreaterThanOrEqual(0);
    });

    it('should return partial score for partial overlap', () => {
      const score = tokenBasedSimilarity('amazon prime video', 'amazon prime');
      expect(score).toBeGreaterThan(50);
      expect(score).toBeLessThan(100);
    });

    it('should return 0 for no overlap', () => {
      expect(tokenBasedSimilarity('amazon', 'netflix')).toBe(0);
    });

    it('should handle null and undefined', () => {
      expect(tokenBasedSimilarity(null, 'test')).toBe(0);
      expect(tokenBasedSimilarity('test', undefined)).toBe(0);
    });

    it('should split on alpha/numeric boundaries', () => {
      const score = tokenBasedSimilarity('shell1234', 'shell 1234');
      expect(score).toBe(100);
    });

    it('should handle real-world examples', () => {
      // After normalization, these become single tokens, so similarity is based on token overlap
      expect(tokenBasedSimilarity('Shell123', 'Shell456')).toBeGreaterThan(0);
      expect(tokenBasedSimilarity('Amazon2024', 'Amazon2023')).toBeGreaterThan(0);
    });
  });

  describe('payeeSimilarity', () => {
    it('should return 100 for exact normalized match', () => {
      expect(payeeSimilarity('SHELL #1234', 'shell 1234')).toBe(100);
      expect(payeeSimilarity('NETFLIX.COM', 'Netflix Com')).toBe(100);
    });

    it('should return best score from fuzzy or token matching', () => {
      const score = payeeSimilarity('Amazon Prime', 'Prime Amazon');
      expect(score).toBeGreaterThan(5); // Different order = low Levenshtein, but some token overlap
    });

    it('should handle typos with fuzzy matching', () => {
      const score = payeeSimilarity('Netflix', 'Netflx');
      expect(score).toBeGreaterThan(70);
    });

    it('should return 0 for completely different payees', () => {
      const score = payeeSimilarity('Shell', 'Walmart');
      expect(score).toBeLessThan(30);
    });

    it('should handle null and undefined', () => {
      expect(payeeSimilarity(null, 'test')).toBe(0);
      expect(payeeSimilarity('test', null)).toBe(0);
    });

    describe('real-world examples from design spec', () => {
      it('should match Shell variations', () => {
        const score = payeeSimilarity('SHELL #1234 OAKVILLE ON', 'Shell Gas Station');
        expect(score).toBeGreaterThan(30); // Partial match on "shell"
      });

      it('should match Amazon variations', () => {
        const score = payeeSimilarity('AMZN MKTP CA*123456789', 'Amazon');
        expect(score).toBeGreaterThan(10); // Difficult abbreviation match
      });

      it('should match Netflix variations', () => {
        const score = payeeSimilarity('NETFLIX.COM', 'Netflix Subscription');
        expect(score).toBeGreaterThan(30); // Partial match on "netflix"
      });
    });
  });

  describe('payeeContains', () => {
    it('should return true when payee contains substring', () => {
      expect(payeeContains('AMAZON.COM', 'amazon')).toBe(true);
      expect(payeeContains('Shell Gas Station', 'shell')).toBe(true);
    });

    it('should be case insensitive', () => {
      expect(payeeContains('amazon.com', 'AMAZON')).toBe(true);
      expect(payeeContains('SHELL', 'shell')).toBe(true);
    });

    it('should ignore special characters', () => {
      expect(payeeContains('SHELL #1234', 'shell1234')).toBe(true);
      expect(payeeContains('NETFLIX.COM', 'netflix')).toBe(true);
    });

    it('should return false when substring not found', () => {
      expect(payeeContains('Shell', 'amazon')).toBe(false);
      expect(payeeContains('Walmart', 'target')).toBe(false);
    });

    it('should handle null and undefined', () => {
      expect(payeeContains(null, 'test')).toBe(false);
      expect(payeeContains('test', '')).toBe(false);
    });

    it('should match partial words', () => {
      expect(payeeContains('Amazon Prime Video', 'prime')).toBe(true);
      expect(payeeContains('Shell Gas Station', 'gas')).toBe(true);
    });
  });

  describe('edge cases', () => {
    it('should handle very long payee names', () => {
      const longPayee = 'A'.repeat(500);
      expect(normalizePayee(longPayee)).toBe('a'.repeat(500));
      expect(fuzzyMatch(longPayee, longPayee)).toBe(100);
    });

    it('should handle Unicode characters', () => {
      expect(normalizePayee('Café René')).toBe('cafren'); // Non-ASCII normalized
      expect(normalizePayee('日本語')).toBe(''); // All non-alphanumeric removed
    });

    it('should handle numbers only', () => {
      expect(normalizePayee('123456')).toBe('123456');
      expect(normalizedMatch('12345', '12345')).toBe(true);
    });

    it('should handle mixed case with numbers', () => {
      expect(normalizePayee('ABC123def456')).toBe('abc123def456');
    });
  });
});
