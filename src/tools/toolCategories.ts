import type { MCPToolAnnotations } from '../types/toolAnnotations.js';

/**
 * Preset annotation patterns for common tool categories.
 *
 * These presets provide standardized annotation values for different types of tools
 * based on their interaction patterns with the YNAB API and their operational characteristics.
 *
 * Note: The `title` field is intentionally not included in presets. Each tool should specify
 * its own descriptive title at registration time. When using a preset, spread it first and
 * then add tool-specific fields like `title` to ensure proper property precedence.
 *
 * @example
 * // In tool registration (recommended property order):
 * registry.register({
 *   name: 'list_budgets',
 *   ...ToolAnnotationPresets.READ_ONLY_EXTERNAL,  // Spread preset first
 *   title: 'YNAB: List All Budgets',              // Then add tool-specific fields
 *   // ... other tool properties
 * });
 */
export const ToolAnnotationPresets = {
  /**
   * Preset for read-only tools that query the YNAB API without modifications.
   *
   * Use this for tools that only retrieve data from YNAB without making any changes.
   *
   * Examples:
   * - list_budgets: Retrieves all budgets
   * - get_account: Retrieves account details
   * - list_transactions: Retrieves transaction data
   * - list_categories: Retrieves category information
   * - get_month: Retrieves monthly budget data
   *
   * Annotation rationale:
   * - readOnlyHint: true - Tool only reads data, never modifies
   * - destructiveHint: false - No destructive operations performed
   * - idempotentHint: true - Same query returns same data (barring external changes)
   * - openWorldHint: true - Calls external YNAB API over network
   */
  READ_ONLY_EXTERNAL: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  },

  /**
   * Preset for tools that create new resources in YNAB.
   *
   * Use this for tools that add new entities to YNAB without modifying existing ones.
   *
   * Examples:
   * - create_transaction: Creates a new transaction
   * - create_account: Creates a new account
   * - create_category: Creates a new budget category
   *
   * Annotation rationale:
   * - readOnlyHint: false - Tool modifies data by creating resources
   * - destructiveHint: false - Creation is not destructive (doesn't delete/overwrite)
   * - idempotentHint: false - Repeated calls create multiple distinct resources
   * - openWorldHint: true - Calls external YNAB API over network
   */
  WRITE_EXTERNAL_CREATE: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: true,
  },

  /**
   * Preset for tools that update existing resources in YNAB.
   *
   * Use this for tools that modify existing entities without deleting them.
   *
   * Examples:
   * - update_transaction: Updates an existing transaction
   * - set_default_budget: Sets the default budget preference
   * - reconcile_account: Updates account balances and transaction states
   *
   * Annotation rationale:
   * - readOnlyHint: false - Tool modifies existing data
   * - destructiveHint: false - Updates are not destructive (reversible/editable)
   * - idempotentHint: true - Repeated identical updates have same final state
   * - openWorldHint: true - Calls external YNAB API over network
   */
  WRITE_EXTERNAL_UPDATE: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  },

  /**
   * Preset for tools that delete resources from YNAB.
   *
   * Use this for tools that permanently remove entities from YNAB.
   *
   * Examples:
   * - delete_transaction: Permanently deletes a transaction
   * - delete_account: Removes an account
   *
   * Annotation rationale:
   * - readOnlyHint: false - Tool modifies data by deleting
   * - destructiveHint: true - Deletion is irreversible and destructive
   * - idempotentHint: true - Deleting same resource multiple times has same effect
   * - openWorldHint: true - Calls external YNAB API over network
   */
  WRITE_EXTERNAL_DELETE: {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: true,
    openWorldHint: true,
  },

  /**
   * Preset for local utility tools that don't call external APIs.
   *
   * Use this for tools that perform local operations or calculations without
   * interacting with the YNAB API.
   *
   * Examples:
   * - convert_amount: Converts between dollars and milliunits
   * - set_output_format: Configures local output formatting
   * - diagnostic_info: Returns local server diagnostic information
   * - clear_cache: Clears local in-memory cache
   *
   * Annotation rationale:
   * - readOnlyHint: true - No external/YNAB data modifications (may modify local server state/config)
   * - destructiveHint: false - No destructive operations on external data
   * - idempotentHint: true - Deterministic operations with same inputs (or safe to repeat)
   * - openWorldHint: false - No external API calls, purely local operations
   */
  UTILITY_LOCAL: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
} as const satisfies Record<string, Omit<MCPToolAnnotations, 'title'>>;
