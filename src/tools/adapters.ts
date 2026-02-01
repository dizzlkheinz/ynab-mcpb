/**
 * @fileoverview Adapter utilities for tool factory functions.
 * Provides createAdapters() to reduce boilerplate when registering tools,
 * and createBudgetResolver() for consistent budget ID resolution.
 * @module tools/adapters
 */

import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { BudgetResolver } from "../server/budgetResolver.js";
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

	return {
		adapt:
			<TInput extends Record<string, unknown>>(handler: Handler<TInput>) =>
			async ({
				input,
			}: ToolExecutionPayload<TInput>): Promise<CallToolResult> =>
				handler(ynabAPI, input),

		adaptNoInput:
			(handler: NoInputHandler) =>
			async (
				_payload: ToolExecutionPayload<Record<string, unknown>>,
			): Promise<CallToolResult> =>
				handler(ynabAPI),

		adaptWithDelta:
			<TInput extends Record<string, unknown>>(handler: DeltaHandler<TInput>) =>
			async ({
				input,
			}: ToolExecutionPayload<TInput>): Promise<CallToolResult> =>
				handler(ynabAPI, deltaFetcher, input),

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
				) => Promise<CallToolResult>,
			) =>
			async ({
				input,
				context,
			}: ToolExecutionPayload<TInput>): Promise<CallToolResult> =>
				handler(ynabAPI, deltaFetcher, input, context.sendProgress),

		adaptWrite:
			<TInput extends Record<string, unknown>>(handler: WriteHandler<TInput>) =>
			async ({
				input,
			}: ToolExecutionPayload<TInput>): Promise<CallToolResult> =>
				handler(ynabAPI, deltaCache, serverKnowledgeStore, input),
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
			);

			if (typeof result === "string") {
				return { budget_id: result } as Partial<TInput>;
			}

			throw new DefaultArgumentResolutionError(result);
		};
	};
}
