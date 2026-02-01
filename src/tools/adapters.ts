/**
 * @fileoverview Adapter utilities for tool factory functions.
 * Provides createAdapters() to reduce boilerplate when registering tools,
 * and createBudgetResolver() for consistent budget ID resolution.
 * @module tools/adapters
 */

import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { BudgetResolver } from "../server/budgetResolver.js";
import {
	type ErrorHandler,
	handleToolError as _handleToolError,
	withToolErrorHandling as _withToolErrorHandling,
} from "../server/errorHandler.js";
import type {
	DefaultArgumentResolver,
	ProgressCallback,
	ToolExecutionPayload,
} from "../server/toolRegistry.js";
import { DefaultArgumentResolutionError } from "../server/toolRegistry.js";
import type {
	DeltaHandler,
	Handler,
	NoInputHandler,
	ToolContext,
	WriteHandler,
} from "../types/toolRegistration.js";
import type { DeltaFetcher } from "./deltaFetcher.js";

/**
 * Creates adapter functions bound to the provided context. These helpers reduce
 * boilerplate inside tool factory modules by partially applying shared
 * dependencies to handlers.
 */
export function createAdapters(context: ToolContext) {
	const { ynabAPI, deltaFetcher, deltaCache, serverKnowledgeStore } = context;

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
				handler(ynabAPI, deltaFetcher, input, errorHandler),

		/**
		 * Adapter for delta operations that may emit progress notifications.
		 * Passes the optional sendProgress callback from the execution context.
		 */
		adaptWithDeltaAndProgress:
			<TInput extends Record<string, unknown>>(
				handler: (
					api: typeof ynabAPI,
					deltaFetcher: DeltaFetcher,
					params: TInput,
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
					deltaFetcher,
					input,
					execContext.sendProgress,
					errorHandler,
				),

		adaptWrite:
			<TInput extends Record<string, unknown>>(handler: WriteHandler<TInput>) =>
			async ({
				input,
			}: ToolExecutionPayload<TInput>): Promise<CallToolResult> =>
				handler(ynabAPI, deltaCache, serverKnowledgeStore, input, errorHandler),
	};
}

/**
 * Creates error handling helpers bound to the ErrorHandler instance from context.
 * Tool files use these instead of the bare standalone functions to route errors
 * through the injected ErrorHandler rather than the static singleton.
 */
export function createErrorHelpers(context: ToolContext) {
	const { errorHandler } = context;
	return {
		withToolErrorHandling: <T>(
			operation: () => Promise<T>,
			toolName: string,
			operationName: string,
		): Promise<T | CallToolResult> =>
			_withToolErrorHandling(operation, toolName, operationName, errorHandler),
		handleToolError: (
			error: unknown,
			toolName: string,
			operation: string,
		): CallToolResult =>
			_handleToolError(error, toolName, operation, errorHandler),
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
