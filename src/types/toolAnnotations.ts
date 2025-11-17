/**
 * Type-safe MCP tool annotations interface
 *
 * These annotations are advisory hints per the MCP specification to help AI clients
 * understand tool behavior. They do not enforce behavior at runtime.
 *
 * @see https://blog.marcnuri.com/mcp-tool-annotations-introduction
 */
export interface MCPToolAnnotations {
  /**
   * Human-readable title for UI display
   *
   * @example "YNAB: Delete Transaction"
   */
  title?: string;

  /**
   * Indicates tool only reads data without modifications
   *
   * @example true for list_budgets, get_account
   */
  readOnlyHint?: boolean;

  /**
   * For non-read-only tools, indicates irreversible operations
   *
   * @example true for delete_transaction
   */
  destructiveHint?: boolean;

  /**
   * Indicates repeated identical calls have same effect
   *
   * @example true for set_default_budget
   */
  idempotentHint?: boolean;

  /**
   * Indicates tool interacts with external systems like YNAB API
   *
   * @example true for all YNAB tools that call the YNAB API
   */
  openWorldHint?: boolean;
}
