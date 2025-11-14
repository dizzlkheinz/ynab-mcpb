/**
 * ServerKnowledgeStore
 *
 * Tracks the last known `server_knowledge` value per cache key to enable delta requests.
 * Knowledge is ephemeral and resets on server restart (intentional design to ensure consistency).
 *
 * Design rationale:
 * - Knowledge is keyed by cache key (not just budget ID) because different resources for the same
 *   budget can have different server_knowledge values. For example, if you fetch transactions
 *   (knowledge=1000) and then accounts (knowledge=1005), the next transaction delta should use 1000,
 *   not 1005.
 * - No persistence - knowledge resets on server restart to avoid stale knowledge issues
 * - Single-threaded Node.js environment, no locking needed
 * - Memory: O(n) where n = number of cache keys accessed (typically 5-20 per budget)
 */
export class ServerKnowledgeStore {
  /** Map of cache key to last known server_knowledge value */
  private knowledge: Map<string, number> = new Map();

  /**
   * Get the last known server_knowledge for a cache key.
   *
   * @param cacheKey - The cache key to look up
   * @returns The last known server_knowledge value, or undefined if never fetched
   */
  get(cacheKey: string): number | undefined {
    return this.knowledge.get(cacheKey);
  }

  /**
   * Update server_knowledge after an API response.
   *
   * @param cacheKey - The cache key to update
   * @param value - The new server_knowledge value (must be non-negative)
   * @throws Error if value is negative
   */
  update(cacheKey: string, value: number): void {
    if (value < 0) {
      throw new Error(`server_knowledge must be non-negative, got: ${value}`);
    }
    this.knowledge.set(cacheKey, value);
  }

  /**
   * Reset knowledge for keys matching a pattern, or clear all if pattern is undefined.
   *
   * @param keyPattern - Optional pattern to match (uses key.includes(keyPattern))
   */
  reset(keyPattern?: string): void {
    if (keyPattern === undefined) {
      this.knowledge.clear();
      return;
    }

    const keysToDelete: string[] = [];
    for (const key of this.knowledge.keys()) {
      if (key.includes(keyPattern)) {
        keysToDelete.push(key);
      }
    }

    for (const key of keysToDelete) {
      this.knowledge.delete(key);
    }
  }

  /**
   * Convenience helper to reset all knowledge entries for a specific budget.
   *
   * @param budgetId - The budget ID to reset knowledge for
   */
  resetByBudgetId(budgetId: string): void {
    this.reset(`:${budgetId}`);
  }

  /**
   * Get diagnostic information about tracked cache keys.
   *
   * @returns Object containing entry count and all tracked entries
   */
  getStats(): { entryCount: number; entries: Record<string, number> } {
    const entries: Record<string, number> = {};
    for (const [key, value] of this.knowledge.entries()) {
      entries[key] = value;
    }

    return {
      entryCount: this.knowledge.size,
      entries,
    };
  }
}
