import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type * as ynab from "ynab";
import { z } from "zod/v4";
import type { DeltaCache } from "../server/deltaCache.js";
import { handleToolError, type ErrorHandler } from "../server/errorHandler.js";
import { responseFormatter } from "../server/responseFormatter.js";
import type { ServerKnowledgeStore } from "../server/serverKnowledgeStore.js";
import type { ToolFactory } from "../types/toolRegistration.js";
import { milliunitsToAmount } from "../utils/amountUtils.js";
import {
	createAdapters,
	createBudgetResolver,
	requireResolvedBudgetId,
} from "./adapters.js";
import type { DeltaFetcher } from "./deltaFetcher.js";
import {
	amountInputShape,
	normalizeOptionalAmount,
	normalizeRequiredAmount,
	validateOptionalAmount,
	validateRequiredAmount,
} from "./schemas/monetaryInput.js";
import { ToolAnnotationPresets } from "./toolCategories.js";

const FREQUENCIES = [
	"never",
	"daily",
	"weekly",
	"everyOtherWeek",
	"twiceAMonth",
	"every4Weeks",
	"monthly",
	"everyOtherMonth",
	"every3Months",
	"every4Months",
	"twiceAYear",
	"yearly",
	"everyOtherYear",
] as const;

const isoDate = z
	.string()
	.regex(/^\d{4}-\d{2}-\d{2}$/, "Date must use YYYY-MM-DD");

export const ListScheduledTransactionsSchema = z
	.object({
		budget_id: z.string().min(1).optional(),
		limit: z.number().int().positive().max(500).default(100).optional(),
		offset: z.number().int().min(0).default(0).optional(),
	})
	.strict();

export const GetScheduledTransactionSchema = z
	.object({
		budget_id: z.string().min(1).optional(),
		scheduled_transaction_id: z.string().min(1),
	})
	.strict();

const scheduledSaveShape = {
	account_id: z.string().min(1),
	date: isoDate,
	...amountInputShape,
	payee_id: z.string().nullable().optional(),
	payee_name: z.string().nullable().optional(),
	category_id: z.string().nullable().optional(),
	memo: z.string().nullable().optional(),
	flag_color: z
		.enum(["red", "orange", "yellow", "green", "blue", "purple"])
		.nullable()
		.optional(),
	frequency: z.enum(FREQUENCIES),
};

export const CreateScheduledTransactionSchema = z
	.object({
		budget_id: z.string().min(1).optional(),
		...scheduledSaveShape,
		dry_run: z.boolean().optional(),
	})
	.strict()
	.superRefine((data, ctx) =>
		validateRequiredAmount(data, ctx, ["amount_decimal"]),
	)
	.transform(normalizeRequiredAmount);

export const UpdateScheduledTransactionSchema = z
	.object({
		budget_id: z.string().min(1).optional(),
		scheduled_transaction_id: z.string().min(1),
		account_id: scheduledSaveShape.account_id.optional(),
		date: scheduledSaveShape.date.optional(),
		...amountInputShape,
		payee_id: scheduledSaveShape.payee_id,
		payee_name: scheduledSaveShape.payee_name,
		category_id: scheduledSaveShape.category_id,
		memo: scheduledSaveShape.memo,
		flag_color: scheduledSaveShape.flag_color,
		frequency: scheduledSaveShape.frequency.optional(),
		dry_run: z.boolean().optional(),
	})
	.strict()
	.superRefine((data, ctx) =>
		validateOptionalAmount(data, ctx, ["amount_decimal"]),
	)
	.transform(normalizeOptionalAmount);

export const DeleteScheduledTransactionSchema = z
	.object({
		budget_id: z.string().min(1).optional(),
		scheduled_transaction_id: z.string().min(1),
		dry_run: z.boolean().optional(),
	})
	.strict();

const ScheduledTransactionOutputSchema = z.object({
	id: z.string(),
	date_first: z.string(),
	date_next: z.string(),
	frequency: z.enum(FREQUENCIES),
	amount: z.number(),
	amount_milliunits: z.number().int(),
	account_id: z.string(),
	account_name: z.string(),
	payee_id: z.string().nullable(),
	payee_name: z.string().nullable(),
	category_id: z.string().nullable(),
	category_name: z.string().nullable(),
	memo: z.string().nullable(),
	flag_color: z.string().nullable(),
	deleted: z.boolean(),
});

const ListScheduledOutputSchema = z.object({
	scheduled_transactions: z.array(ScheduledTransactionOutputSchema),
	total_count: z.number().int(),
	returned_count: z.number().int(),
	offset: z.number().int(),
	has_more: z.boolean(),
	next_offset: z.number().int().nullable(),
	cached: z.boolean(),
	used_delta: z.boolean(),
});

const GetScheduledOutputSchema = z.object({
	scheduled_transaction: ScheduledTransactionOutputSchema,
});

const ScheduledMutationOutputSchema = z.union([
	z.object({
		dry_run: z.literal(true),
		action: z.string(),
		request: z.record(z.string(), z.unknown()),
	}),
	z.object({ scheduled_transaction: ScheduledTransactionOutputSchema }),
]);

const DeleteScheduledOutputSchema = z.union([
	z.object({
		dry_run: z.literal(true),
		action: z.literal("ynab_delete_scheduled_transaction"),
		request: z.record(z.string(), z.unknown()),
	}),
	z.object({ success: z.literal(true), scheduled_transaction_id: z.string() }),
]);

function normalizeScheduledTransaction(
	transaction: ynab.ScheduledTransactionDetail,
) {
	return {
		id: transaction.id,
		date_first: transaction.date_first,
		date_next: transaction.date_next,
		frequency: transaction.frequency,
		amount: milliunitsToAmount(transaction.amount),
		amount_milliunits: transaction.amount,
		account_id: transaction.account_id,
		account_name: transaction.account_name,
		payee_id: transaction.payee_id ?? null,
		payee_name: transaction.payee_name ?? null,
		category_id: transaction.category_id ?? null,
		category_name: transaction.category_name ?? null,
		memo: transaction.memo ?? null,
		flag_color: transaction.flag_color ?? null,
		deleted: transaction.deleted,
	};
}

function asResult(data: Record<string, unknown>): CallToolResult {
	return {
		content: [{ type: "text", text: responseFormatter.format(data) }],
		structuredContent: data,
	};
}

export async function handleListScheduledTransactions(
	_api: ynab.API,
	deltaFetcher: DeltaFetcher,
	params: z.infer<typeof ListScheduledTransactionsSchema>,
	errorHandler?: ErrorHandler,
): Promise<CallToolResult> {
	try {
		const budgetId = requireResolvedBudgetId(params.budget_id);
		const fetched = await deltaFetcher.fetchScheduledTransactions(budgetId);
		const active = fetched.data.filter((item) => !item.deleted);
		const offset = params.offset ?? 0;
		const limit = params.limit ?? 100;
		const page = active.slice(offset, offset + limit);
		const data = {
			scheduled_transactions: page.map(normalizeScheduledTransaction),
			total_count: active.length,
			returned_count: page.length,
			offset,
			has_more: offset + page.length < active.length,
			next_offset:
				offset + page.length < active.length ? offset + page.length : null,
			cached: fetched.wasCached,
			used_delta: fetched.usedDelta,
		};
		return asResult(data);
	} catch (error) {
		return handleToolError(
			error,
			"ynab_list_scheduled_transactions",
			"listing scheduled transactions",
			errorHandler,
		);
	}
}

export async function handleGetScheduledTransaction(
	api: ynab.API,
	params: z.infer<typeof GetScheduledTransactionSchema>,
	errorHandler?: ErrorHandler,
): Promise<CallToolResult> {
	try {
		const budgetId = requireResolvedBudgetId(params.budget_id);
		const response =
			await api.scheduledTransactions.getScheduledTransactionById(
				budgetId,
				params.scheduled_transaction_id,
			);
		return asResult({
			scheduled_transaction: normalizeScheduledTransaction(
				response.data.scheduled_transaction,
			),
		});
	} catch (error) {
		return handleToolError(
			error,
			"ynab_get_scheduled_transaction",
			"getting scheduled transaction",
			errorHandler,
		);
	}
}

function saveRequest(
	params: z.infer<typeof CreateScheduledTransactionSchema>,
): ynab.SaveScheduledTransaction {
	return {
		account_id: params.account_id,
		date: params.date,
		amount: params.amount,
		frequency: params.frequency,
		...(params.payee_id !== undefined && { payee_id: params.payee_id }),
		...(params.payee_name !== undefined && { payee_name: params.payee_name }),
		...(params.category_id !== undefined && {
			category_id: params.category_id,
		}),
		...(params.memo !== undefined && { memo: params.memo }),
		...(params.flag_color !== undefined && { flag_color: params.flag_color }),
	};
}

export async function handleCreateScheduledTransaction(
	api: ynab.API,
	deltaCache: DeltaCache,
	_knowledgeStore: ServerKnowledgeStore,
	params: z.infer<typeof CreateScheduledTransactionSchema>,
	errorHandler?: ErrorHandler,
): Promise<CallToolResult> {
	try {
		const budgetId = requireResolvedBudgetId(params.budget_id);
		const request = saveRequest(params);
		if (params.dry_run) {
			return asResult({
				dry_run: true,
				action: "ynab_create_scheduled_transaction",
				request: { ...request, amount: milliunitsToAmount(params.amount) },
			});
		}
		const response = await api.scheduledTransactions.createScheduledTransaction(
			budgetId,
			{ scheduled_transaction: request },
		);
		deltaCache.forceFullRefresh(budgetId, "scheduled_transactions");
		return asResult({
			scheduled_transaction: normalizeScheduledTransaction(
				response.data.scheduled_transaction,
			),
		});
	} catch (error) {
		return handleToolError(
			error,
			"ynab_create_scheduled_transaction",
			"creating scheduled transaction",
			errorHandler,
		);
	}
}

export async function handleUpdateScheduledTransaction(
	api: ynab.API,
	deltaCache: DeltaCache,
	_knowledgeStore: ServerKnowledgeStore,
	params: z.infer<typeof UpdateScheduledTransactionSchema>,
	errorHandler?: ErrorHandler,
): Promise<CallToolResult> {
	try {
		const budgetId = requireResolvedBudgetId(params.budget_id);
		const currentResponse =
			await api.scheduledTransactions.getScheduledTransactionById(
				budgetId,
				params.scheduled_transaction_id,
			);
		const current = currentResponse.data.scheduled_transaction;
		const {
			budget_id: _budgetId,
			scheduled_transaction_id: id,
			dry_run: _dryRun,
			...changes
		} = params;
		const request: ynab.SaveScheduledTransaction = {
			account_id: changes.account_id ?? current.account_id,
			date: changes.date ?? current.date_next,
			amount: changes.amount ?? current.amount,
			frequency: changes.frequency ?? current.frequency,
			payee_id:
				changes.payee_id !== undefined
					? changes.payee_id
					: (current.payee_id ?? null),
			category_id:
				changes.category_id !== undefined
					? changes.category_id
					: (current.category_id ?? null),
			memo: changes.memo !== undefined ? changes.memo : (current.memo ?? null),
			flag_color:
				changes.flag_color !== undefined
					? changes.flag_color
					: (current.flag_color ?? null),
			...(changes.payee_name !== undefined && {
				payee_name: changes.payee_name,
			}),
		};
		if (params.dry_run) {
			return asResult({
				dry_run: true,
				action: "ynab_update_scheduled_transaction",
				request: {
					...request,
					...(request.amount !== undefined && {
						amount: milliunitsToAmount(request.amount),
					}),
				},
			});
		}
		const response = await api.scheduledTransactions.updateScheduledTransaction(
			budgetId,
			id,
			{ scheduled_transaction: request },
		);
		deltaCache.forceFullRefresh(budgetId, "scheduled_transactions");
		return asResult({
			scheduled_transaction: normalizeScheduledTransaction(
				response.data.scheduled_transaction,
			),
		});
	} catch (error) {
		return handleToolError(
			error,
			"ynab_update_scheduled_transaction",
			"updating scheduled transaction",
			errorHandler,
		);
	}
}

export async function handleDeleteScheduledTransaction(
	api: ynab.API,
	deltaCache: DeltaCache,
	_knowledgeStore: ServerKnowledgeStore,
	params: z.infer<typeof DeleteScheduledTransactionSchema>,
	errorHandler?: ErrorHandler,
): Promise<CallToolResult> {
	try {
		const budgetId = requireResolvedBudgetId(params.budget_id);
		if (params.dry_run) {
			return asResult({
				dry_run: true,
				action: "ynab_delete_scheduled_transaction",
				request: { scheduled_transaction_id: params.scheduled_transaction_id },
			});
		}
		await api.scheduledTransactions.deleteScheduledTransaction(
			budgetId,
			params.scheduled_transaction_id,
		);
		deltaCache.forceFullRefresh(budgetId, "scheduled_transactions");
		return asResult({
			success: true,
			scheduled_transaction_id: params.scheduled_transaction_id,
		});
	} catch (error) {
		return handleToolError(
			error,
			"ynab_delete_scheduled_transaction",
			"deleting scheduled transaction",
			errorHandler,
		);
	}
}

export const registerScheduledTransactionTools: ToolFactory = (
	registry,
	context,
) => {
	const { adapt, adaptWithDelta, adaptWrite } = createAdapters(context);
	const budgetResolver = createBudgetResolver(context);
	registry.register({
		name: "ynab_list_scheduled_transactions",
		description:
			"List scheduled transactions with delta caching and pagination. Amounts are returned in decimal currency and explicit milliunits.",
		inputSchema: ListScheduledTransactionsSchema,
		outputSchema: ListScheduledOutputSchema,
		handler: adaptWithDelta(handleListScheduledTransactions),
		defaultArgumentResolver: budgetResolver(),
		metadata: {
			annotations: {
				...ToolAnnotationPresets.READ_ONLY_EXTERNAL,
				title: "YNAB: List Scheduled Transactions",
			},
		},
	});
	registry.register({
		name: "ynab_get_scheduled_transaction",
		description: "Get one scheduled transaction by ID.",
		inputSchema: GetScheduledTransactionSchema,
		outputSchema: GetScheduledOutputSchema,
		handler: adapt(handleGetScheduledTransaction),
		defaultArgumentResolver: budgetResolver(),
		metadata: {
			annotations: {
				...ToolAnnotationPresets.READ_ONLY_EXTERNAL,
				title: "YNAB: Get Scheduled Transaction",
			},
		},
	});

	registry.register({
		name: "ynab_create_scheduled_transaction",
		description:
			"Create a recurring scheduled transaction. Prefer amount_decimal; amount_milliunits is available for already-converted values.",
		inputSchema: CreateScheduledTransactionSchema,
		outputSchema: ScheduledMutationOutputSchema,
		handler: adaptWrite(handleCreateScheduledTransaction),
		defaultArgumentResolver: budgetResolver(),
		metadata: {
			writeSafety: { mutation: true, preview: "dry-run" },
			annotations: {
				...ToolAnnotationPresets.WRITE_EXTERNAL_CREATE,
				title: "YNAB: Create Scheduled Transaction",
			},
		},
	});
	registry.register({
		name: "ynab_update_scheduled_transaction",
		description: "Update selected fields on a scheduled transaction.",
		inputSchema: UpdateScheduledTransactionSchema,
		outputSchema: ScheduledMutationOutputSchema,
		handler: adaptWrite(handleUpdateScheduledTransaction),
		defaultArgumentResolver: budgetResolver(),
		metadata: {
			writeSafety: { mutation: true, preview: "dry-run" },
			annotations: {
				...ToolAnnotationPresets.WRITE_EXTERNAL_UPDATE,
				title: "YNAB: Update Scheduled Transaction",
			},
		},
	});
	registry.register({
		name: "ynab_delete_scheduled_transaction",
		description: "Delete a scheduled transaction.",
		inputSchema: DeleteScheduledTransactionSchema,
		outputSchema: DeleteScheduledOutputSchema,
		handler: adaptWrite(handleDeleteScheduledTransaction),
		defaultArgumentResolver: budgetResolver(),
		metadata: {
			writeSafety: { mutation: true, preview: "dry-run" },
			annotations: {
				...ToolAnnotationPresets.WRITE_EXTERNAL_DELETE,
				title: "YNAB: Delete Scheduled Transaction",
			},
		},
	});
};
