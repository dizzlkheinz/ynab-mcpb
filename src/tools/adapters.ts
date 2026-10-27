/**
 * @fileoverview Adapter utilities for tool factory functions.
 * Provides createAdapters() to reduce boilerplate when registering tools,
 * and createBudgetResolver() for consistent budget ID resolution.
 * @module tools/adapters
 */

import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { BudgetResolver } from "../server/budgetResolver.js";
import type { ErrorHandler } from "../server/errorHandler.js";
import type {
	DefaultArgumentResolver,
	ProgressCallback,
	ToolExecutionPayload,
} from "../server/toolRegistry.js";
import { DefaultArgumentResolutionError } from "../server/toolRegistry.js";
import type {
	DeltaHandler,
	Handler,
	HandlerDeltaDeps,
	NoInputHandler,
	ToolContext,
} from "../types/toolRegistration.js";

/**
 * Creates adapter functions bound to the provided context. These helpers reduce
 * boilerplate inside tool factory modules by partially applying shared
 * dependencies to handlers.
 */
export function createAdapters(context: ToolContext) {
	const { ynabAPI, deltaFetcher, cacheManager } = context;

	const { errorHandler } = context;

	return {
		adapt:
			<TInput extends Record<string, unknown>>(handler: Handler<TInput>) =>
			async ({
				input,
			}: ToolExecutionPayload<TInput>): Promise<CallToolResult> =>
				handler(ynabAPI, input, errorHandler),

		adaptNoInput:
			(handler: NoInputHandler) =>
			async (
				_payload: ToolExecutionPayload<Record<string, unknown>>,
			): Promise<CallToolResult> =>
				handler(ynabAPI, errorHandler),

		adaptWithDelta:
			<TInput extends Record<string, unknown>>(handler: DeltaHandler<TInput>) =>
			async ({
				input,
			}: ToolExecutionPayload<TInput>): Promise<CallToolResult> =>
				handler(ynabAPI, input, { deltaFetcher, cacheManager }, errorHandler),

		/**
		 * Adapter for delta operations that may emit progress notifications.
		 * Passes the optional sendProgress callback from the execution context.
		 */
		adaptWithDeltaAndProgress:
			<TInput extends Record<string, unknown>>(
				handler: (
					api: typeof ynabAPI,
					params: TInput,
					deps: HandlerDeltaDeps,
					sendProgress?: ProgressCallback,
					errorHandler?: ErrorHandler,
				) => Promise<CallToolResult>,
			) =>
			async ({
				input,
				context: execContext,
			}: ToolExecutionPayload<TInput>): Promise<CallToolResult> =>
				handler(
					ynabAPI,
					input,
					{ deltaFetcher, cacheManager },
					execContext.sendProgress,
					errorHandler,
				),
	};
}

/**
 * Creates a budget ID resolver bound to the provided context. The returned
 * resolver matches the ToolRegistry defaultArgumentResolver signature.
 */
export function createBudgetResolver(
	context: ToolContext,
): <
	TInput extends { budget_id?: string | undefined },
>() => DefaultArgumentResolver<TInput> {
	return <
		TInput extends { budget_id?: string | undefined },
	>(): DefaultArgumentResolver<TInput> => {
		return ({ rawArguments }) => {
			const provided =
				typeof rawArguments["budget_id"] === "string" &&
				rawArguments["budget_id"].length > 0
					? rawArguments["budget_id"]
					: undefined;

			const result = BudgetResolver.resolveBudgetId(
				provided,
				context.getDefaultBudgetId(),
				context.errorHandler,
			);

			if (typeof result === "string") {
				return { budget_id: result } as Partial<TInput>;
			}

			throw new DefaultArgumentResolutionError(result);
		};
	};
}

/**
 * Narrows a resolver-backed budget_id after ToolRegistry default argument
 * resolution. If this throws, the handler was called without the registry
 * applying its default budget resolution.
 */
export function requireResolvedBudgetId(budgetId: string | undefined): string {
	if (!budgetId) {
		throw new Error(
			"Budget ID is required. Pass budget_id explicitly or configure a default budget.",
		);
	}

	return budgetId;
}
