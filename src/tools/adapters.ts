import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { ToolExecutionPayload, DefaultArgumentResolver } from '../server/toolRegistry.js';
import { BudgetResolver } from '../server/budgetResolver.js';
import { DefaultArgumentResolutionError } from '../server/toolRegistry.js';
import type {
  ToolContext,
  Handler,
  DeltaHandler,
  WriteHandler,
  NoInputHandler,
} from '../types/toolRegistration.js';

/**
 * Creates adapter functions bound to the provided context. These helpers reduce
 * boilerplate inside tool factory modules by partially applying shared
 * dependencies to handlers.
 */
export function createAdapters(context: ToolContext) {
  const { ynabAPI, deltaFetcher, deltaCache, serverKnowledgeStore } = context;

  return {
    adapt:
      <TInput extends Record<string, unknown>>(handler: Handler<TInput>) =>
      async ({ input }: ToolExecutionPayload<TInput>): Promise<CallToolResult> =>
        handler(ynabAPI, input),

    adaptNoInput:
      (handler: NoInputHandler) =>
      async (_payload: ToolExecutionPayload<Record<string, unknown>>): Promise<CallToolResult> =>
        handler(ynabAPI),

    adaptWithDelta:
      <TInput extends Record<string, unknown>>(handler: DeltaHandler<TInput>) =>
      async ({ input }: ToolExecutionPayload<TInput>): Promise<CallToolResult> =>
        handler(ynabAPI, deltaFetcher, input),

    adaptWrite:
      <TInput extends Record<string, unknown>>(handler: WriteHandler<TInput>) =>
      async ({ input }: ToolExecutionPayload<TInput>): Promise<CallToolResult> =>
        handler(ynabAPI, deltaCache, serverKnowledgeStore, input),
  };
}

/**
 * Creates a budget ID resolver bound to the provided context. The returned
 * resolver matches the ToolRegistry defaultArgumentResolver signature.
 */
export function createBudgetResolver(
  context: ToolContext,
): <TInput extends { budget_id?: string | undefined }>() => DefaultArgumentResolver<TInput> {
  return <TInput extends { budget_id?: string | undefined }>(): DefaultArgumentResolver<TInput> => {
    return ({ rawArguments }) => {
      const provided =
        typeof rawArguments['budget_id'] === 'string' && rawArguments['budget_id'].length > 0
          ? (rawArguments['budget_id'] as string)
          : undefined;

      const result = BudgetResolver.resolveBudgetId(provided, context.getDefaultBudgetId());

      if (typeof result === 'string') {
        return { budget_id: result } as Partial<TInput>;
      }

      throw new DefaultArgumentResolutionError(result);
    };
  };
}
