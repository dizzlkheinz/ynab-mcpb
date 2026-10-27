/**
 * Transaction Tools - Facade Module
 *
 * This module delegates to:
 * - transactionReadTools.ts  — read-only handlers (list, get, export)
 * - transactionWriteTools.ts — write handlers (create, update, delete)
 *
 * Schemas and types live in transactionSchemas.ts.
 * Utility functions live in transactionUtils.ts.
 */

import type { ToolFactory } from "../types/toolRegistration.js";
import { registerTransactionReadTools } from "./transactionReadTools.js";
import { registerTransactionWriteTools } from "./transactionWriteTools.js";

// ============================================================================
// Registration facade — called by YNABMCPServer.setupToolRegistry()
// ============================================================================

/**
 * Registers all transaction-domain tools with the provided registry.
 */
export const registerTransactionTools: ToolFactory = (registry, context) => {
	registerTransactionReadTools(registry, context);
	registerTransactionWriteTools(registry, context);
};
