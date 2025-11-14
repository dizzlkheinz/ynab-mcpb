import { describe, it, expect, beforeEach } from 'vitest';
import { ServerKnowledgeStore } from '../serverKnowledgeStore.js';

describe('ServerKnowledgeStore', () => {
  let store: ServerKnowledgeStore;

  beforeEach(() => {
    store = new ServerKnowledgeStore();
  });

  describe('Basic Operations', () => {
    it('should return undefined for non-existent keys', () => {
      expect(store.get('non-existent-key')).toBeUndefined();
    });

    it('should store and retrieve knowledge values', () => {
      store.update('transactions:list:budget-123', 1000);
      expect(store.get('transactions:list:budget-123')).toBe(1000);
    });

    it('should update existing knowledge values', () => {
      store.update('transactions:list:budget-123', 1000);
      store.update('transactions:list:budget-123', 1005);
      expect(store.get('transactions:list:budget-123')).toBe(1005);
    });

    it('should handle multiple cache keys independently', () => {
      store.update('transactions:list:budget-123', 1000);
      store.update('accounts:list:budget-123', 2000);
      store.update('transactions:list:budget-456', 3000);

      expect(store.get('transactions:list:budget-123')).toBe(1000);
      expect(store.get('accounts:list:budget-123')).toBe(2000);
      expect(store.get('transactions:list:budget-456')).toBe(3000);
    });

    it('should return correct stats with entryCount and entries object', () => {
      store.update('key1', 100);
      store.update('key2', 200);
      store.update('key3', 300);

      const stats = store.getStats();
      expect(stats.entryCount).toBe(3);
      expect(stats.entries).toEqual({
        key1: 100,
        key2: 200,
        key3: 300,
      });
    });
  });

  describe('Validation', () => {
    it('should throw error for negative server_knowledge values', () => {
      expect(() => store.update('key', -1)).toThrow(
        'server_knowledge must be non-negative, got: -1'
      );
    });

    it('should accept zero as valid server_knowledge', () => {
      expect(() => store.update('key', 0)).not.toThrow();
      expect(store.get('key')).toBe(0);
    });

    it('should accept large positive integers', () => {
      const largeValue = 999999;
      expect(() => store.update('key', largeValue)).not.toThrow();
      expect(store.get('key')).toBe(largeValue);
    });
  });

  describe('Reset Operations', () => {
    beforeEach(() => {
      store.update('transactions:list:budget-123:all:all', 1000);
      store.update('accounts:list:budget-123', 2000);
      store.update('transactions:list:budget-456', 3000);
      store.update('categories:list:budget-123', 4000);
    });

    it('should reset all knowledge when called without pattern', () => {
      store.reset();
      expect(store.get('transactions:list:budget-123:all:all')).toBeUndefined();
      expect(store.get('accounts:list:budget-123')).toBeUndefined();
      expect(store.get('transactions:list:budget-456')).toBeUndefined();
      expect(store.get('categories:list:budget-123')).toBeUndefined();
      expect(store.getStats().entryCount).toBe(0);
    });

    it('should reset only matching keys when pattern provided', () => {
      store.reset('transactions:list:budget-123');

      // Should match and delete
      expect(store.get('transactions:list:budget-123:all:all')).toBeUndefined();

      // Should not match and preserve
      expect(store.get('accounts:list:budget-123')).toBe(2000);
      expect(store.get('transactions:list:budget-456')).toBe(3000);
      expect(store.get('categories:list:budget-123')).toBe(4000);
    });

    it('should not reset non-matching keys', () => {
      store.reset('non-existent-pattern');

      // All keys should remain
      expect(store.get('transactions:list:budget-123:all:all')).toBe(1000);
      expect(store.get('accounts:list:budget-123')).toBe(2000);
      expect(store.get('transactions:list:budget-456')).toBe(3000);
      expect(store.get('categories:list:budget-123')).toBe(4000);
    });

    it('should handle resetByBudgetId correctly', () => {
      store.resetByBudgetId('budget-123');

      // Should match all keys containing ':budget-123'
      expect(store.get('transactions:list:budget-123:all:all')).toBeUndefined();
      expect(store.get('accounts:list:budget-123')).toBeUndefined();
      expect(store.get('categories:list:budget-123')).toBeUndefined();

      // Should not match budget-456
      expect(store.get('transactions:list:budget-456')).toBe(3000);
    });

    it('should not affect other budgets when resetting by budget ID', () => {
      store.update('transactions:list:budget-789', 5000);

      store.resetByBudgetId('budget-123');

      // budget-456 and budget-789 should remain
      expect(store.get('transactions:list:budget-456')).toBe(3000);
      expect(store.get('transactions:list:budget-789')).toBe(5000);
    });

    it('should handle empty store gracefully', () => {
      const emptyStore = new ServerKnowledgeStore();
      expect(() => emptyStore.reset()).not.toThrow();
      expect(() => emptyStore.reset('pattern')).not.toThrow();
      expect(() => emptyStore.resetByBudgetId('budget-123')).not.toThrow();
    });
  });

  describe('Edge Cases', () => {
    it('should handle very long cache keys', () => {
      const longKey = 'a'.repeat(250);
      store.update(longKey, 1000);
      expect(store.get(longKey)).toBe(1000);
    });

    it('should handle special characters in cache keys', () => {
      const specialKey = 'transactions:list:budget-123:date:2024-01-01_2024-12-31';
      store.update(specialKey, 1000);
      expect(store.get(specialKey)).toBe(1000);
    });

    it('should handle rapid updates to same key', () => {
      store.update('key', 100);
      store.update('key', 200);
      store.update('key', 300);
      store.update('key', 400);

      // Last write wins
      expect(store.get('key')).toBe(400);
    });

    it('should maintain isolation between different store instances', () => {
      const store1 = new ServerKnowledgeStore();
      const store2 = new ServerKnowledgeStore();

      store1.update('key', 100);
      store2.update('key', 200);

      expect(store1.get('key')).toBe(100);
      expect(store2.get('key')).toBe(200);
    });
  });
});
