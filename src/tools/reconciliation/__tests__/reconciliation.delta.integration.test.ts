import {
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from "vitest";
import * as ynab from "ynab";
import {
	isAuthError,
	isRateLimitError,
	skipOnRateLimit,
} from "../../../__tests__/testUtils.js";
import { CacheManager } from "../../../server/cacheManager.js";
import { DeltaCache } from "../../../server/deltaCache.js";
import { ServerKnowledgeStore } from "../../../server/serverKnowledgeStore.js";
import { DeltaFetcher } from "../../deltaFetcher.js";
import { handleReconcileAccount } from "../index.js";

const shouldSkip = ["true", "1", "yes", "y", "on"].includes(
	(process.env.SKIP_E2E_TESTS || "").toLowerCase().trim(),
);
const hasToken = !!process.env.YNAB_ACCESS_TOKEN;
const skipTests = shouldSkip || !hasToken;
const describeIntegration = skipTests ? describe.skip : describe;

describeIntegration("Reconciliation delta isolation", () => {
	let ynabAPI: ynab.API;
	let testBudgetId: string;
	let testAccountId: string;
	let deltaFetcher: DeltaFetcher;
	let previousNodeEnv: string | undefined;
	let setupRateLimited = false;

	beforeAll(async () => {
		try {
			const accessToken = process.env.YNAB_ACCESS_TOKEN!;
			ynabAPI = new ynab.API(accessToken);
			const budgetsResponse = await ynabAPI.budgets.getBudgets();
			const budget = budgetsResponse.data.budgets[0];
			if (!budget) {
				throw new Error(
					"No budgets available for reconciliation integration tests.",
				);
			}
			testBudgetId = budget.id;

			const accountsResponse = await ynabAPI.accounts.getAccounts(testBudgetId);
			const account = accountsResponse.data.accounts.find(
				(acct) => !acct.closed,
			);
			if (!account) {
				throw new Error(
					"No open accounts available for reconciliation integration tests.",
				);
			}
			testAccountId = account.id;
		} catch (error) {
			if (isRateLimitError(error) || isAuthError(error)) {
				setupRateLimited = true;
				const reason = isAuthError(error)
					? "authentication failure"
					: "YNAB API rate limit";
				console.warn(
					`⏭️  Skipping reconciliation delta integration tests due to ${reason} during setup`,
				);
				return;
			}
			throw error;
		}
	});

	beforeEach(() => {
		previousNodeEnv = process.env.NODE_ENV;
		process.env.NODE_ENV = "integration";
		const cacheManager = new CacheManager();
		const knowledgeStore = new ServerKnowledgeStore();
		const deltaCache = new DeltaCache(cacheManager, knowledgeStore);
		deltaFetcher = new DeltaFetcher(ynabAPI, deltaCache);
		process.env.YNAB_MCP_ENABLE_DELTA = "true";
	});

	afterEach(() => {
		process.env.YNAB_MCP_ENABLE_DELTA = undefined;
		if (previousNodeEnv === undefined) {
			process.env.NODE_ENV = undefined;
		} else {
			process.env.NODE_ENV = previousNodeEnv;
		}
		previousNodeEnv = undefined;
		vi.restoreAllMocks();
	});

	const withRateLimitSkip = async (
		ctx: { skip: () => void },
		testFn: () => Promise<void>,
	) => {
		if (setupRateLimited) {
			ctx.skip();
			return;
		}
		await skipOnRateLimit(testFn, ctx);
	};

	it("uses full-fetch helpers and exposes audit metadata", {
		meta: { tier: "domain", domain: "delta" },
	}, async (ctx) => {
		await withRateLimitSkip(ctx, async () => {
			const csvData = ["Date,Amount,Description", "2024-01-01,10,Coffee"].join(
				"\n",
			);
			const params = {
				budget_id: testBudgetId,
				account_id: testAccountId,
				csv_data: csvData,
				statement_balance: 0,
			};

			const accountsFullSpy = vi.spyOn(deltaFetcher, "fetchAccountsFull");
			const txFullSpy = vi.spyOn(
				deltaFetcher,
				"fetchTransactionsByAccountFull",
			);
			const txDeltaSpy = vi.spyOn(deltaFetcher, "fetchTransactionsByAccount");

			await handleReconcileAccount(ynabAPI, deltaFetcher, params);

			expect(accountsFullSpy).toHaveBeenCalledWith(testBudgetId);
			expect(txFullSpy).toHaveBeenCalledWith(
				testBudgetId,
				testAccountId,
				expect.any(String),
			);
			expect(txDeltaSpy).not.toHaveBeenCalled();
		});
	});
});
