import * as ynab from "ynab";
import type { CacheManager } from "./cacheManager.js";
import { RateLimitError, type RateLimiter } from "./rateLimiter.js";
import type { ServerKnowledgeStore } from "./serverKnowledgeStore.js";

export interface YNABClientDependencies {
	cacheManager: CacheManager;
	knowledgeStore: ServerKnowledgeStore;
	rateLimiter: RateLimiter;
	fetch?: typeof globalThis.fetch;
}

/**
 * The only network boundary for a server instance. The SDK's transport hook
 * covers tools, resources, completions and reconciliation, including SDK bulk
 * operations that issue more than one HTTP request.
 */
export class YNABClient extends ynab.API {
	constructor(accessToken: string, dependencies: YNABClientDependencies) {
		super(accessToken);
		const fetch = dependencies.fetch ?? globalThis.fetch.bind(globalThis);
		this._configuration = new ynab.Configuration({
			accessToken,
			fetchApi: async (
				input: Parameters<typeof globalThis.fetch>[0],
				init?: Parameters<typeof globalThis.fetch>[1],
			) => {
				const status = dependencies.rateLimiter.tryAcquire(accessToken);
				if (status.isLimited) {
					throw new RateLimitError(
						"YNAB API rate limit exceeded. Wait before making another API request.",
						status.resetTime,
						status.remaining,
					);
				}

				const url = new URL(
					typeof input === "string"
						? input
						: input instanceof URL
							? input.href
							: input.url,
				);
				const method = (init?.method ?? "GET").toUpperCase();
				const mutation = !["GET", "HEAD", "OPTIONS"].includes(method);
				const budgetId = url.pathname.match(
					/\/(?:budgets|plans)\/([^/]+)/,
				)?.[1];
				const invalidate = () => {
					if (!mutation) return;
					if (budgetId && budgetId !== "last-used") {
						dependencies.cacheManager.deleteByBudgetId(
							decodeURIComponent(budgetId),
						);
						dependencies.knowledgeStore.resetByBudgetId(
							decodeURIComponent(budgetId),
						);
						// Budget summaries are shared across budgets and include balances.
						dependencies.cacheManager.deleteMany([
							"budgets:list",
							"resources:budgets:list",
							"completions:budgets",
						]);
						dependencies.knowledgeStore.reset("budgets:list");
					} else {
						dependencies.cacheManager.clear();
						dependencies.knowledgeStore.reset();
					}
				};

				// Invalidate both before and after the request: reads already in flight
				// and reads started while the write is pending must not publish stale
				// snapshots. Timeouts also invalidate because a write may have committed.
				invalidate();
				try {
					const response = await fetch(input, init);
					if (response.status === 429)
						dependencies.rateLimiter.markExhausted(accessToken);
					return response;
				} finally {
					invalidate();
				}
			},
		});
	}
}
