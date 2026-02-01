/**
 * @fileoverview Type definitions for the tool factory registration pattern.
 * Provides ToolContext for dependency injection and typed handler signatures
 * used by domain-specific tool factory functions.
 * @module types/toolRegistration
 */

import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type * as ynab from 'ynab';
import type { CacheManager } from '../server/cacheManager.js';
import type { DeltaCache } from '../server/deltaCache.js';
import type { DiagnosticManager } from '../server/diagnostics.js';
import type { ServerKnowledgeStore } from '../server/serverKnowledgeStore.js';
import type {
  DefaultArgumentResolver,
  ToolExecutionPayload,
  ToolRegistry,
} from '../server/toolRegistry.js';
import type { DeltaFetcher } from '../tools/deltaFetcher.js';

/**
 * Context object passed to tool factory functions. Contains the dependencies
 * required by tool adapters and handlers.
 *
 * @stable This interface is part of the public tool registration contract.
 * Changes to this interface may affect all domain tool factories.
 */
export interface ToolContext {
  ynabAPI: ynab.API;
  deltaFetcher: DeltaFetcher;
  deltaCache: DeltaCache;
  serverKnowledgeStore: ServerKnowledgeStore;
  getDefaultBudgetId: () => string | undefined;
  setDefaultBudget: (budgetId: string) => void;
  cacheManager: CacheManager;
  diagnosticManager?: DiagnosticManager;
}

/**
 * Factory function signature for registering a domain's tools.
 */
export type ToolFactory = (registry: ToolRegistry, context: ToolContext) => void;

/**
 * Common adapter signature used within tool factories.
 */
export type Adapter<TInput extends Record<string, unknown>> = (
  payload: ToolExecutionPayload<TInput>,
) => Promise<CallToolResult>;

/**
 * Generic handler signature used by adapter helpers.
 */
export type Handler<TInput extends Record<string, unknown>> = (
  api: ynab.API,
  params: TInput,
) => Promise<CallToolResult>;

/**
 * Handler signature for operations that require delta fetching.
 */
export type DeltaHandler<TInput extends Record<string, unknown>> = (
  api: ynab.API,
  deltaFetcher: DeltaFetcher,
  params: TInput,
) => Promise<CallToolResult>;

/**
 * Handler signature for write operations that update caches and knowledge stores.
 */
export type WriteHandler<TInput extends Record<string, unknown>> = (
  api: ynab.API,
  deltaCache: DeltaCache,
  serverKnowledgeStore: ServerKnowledgeStore,
  params: TInput,
) => Promise<CallToolResult>;

/**
 * Handler signature for tools that do not accept input parameters.
 */
export type NoInputHandler = (api: ynab.API) => Promise<CallToolResult>;

/**
 * Helper type for default argument resolver factories.
 */
export type BudgetIdResolverFactory = <
  TInput extends { budget_id?: string | undefined },
>() => DefaultArgumentResolver<TInput>;
