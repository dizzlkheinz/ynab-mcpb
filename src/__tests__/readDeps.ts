import type * as ynab from "ynab";
import { CacheManager } from "../server/cacheManager.js";
import { DeltaCache } from "../server/deltaCache.js";
import { ServerKnowledgeStore } from "../server/serverKnowledgeStore.js";
import { DeltaFetcher } from "../tools/deltaFetcher.js";
import type { ReadDeps } from "../types/toolRegistration.js";

/** Explicit, test-owned read dependencies; production never creates fallback state. */
export function createReadDeps(
	api: ynab.API,
	overrides: { cacheManager?: unknown; deltaFetcher?: DeltaFetcher } = {},
): ReadDeps {
	const cacheManager = (overrides.cacheManager ??
		new CacheManager()) as CacheManager;
	return {
		cacheManager,
		deltaFetcher:
			overrides.deltaFetcher ??
			new DeltaFetcher(
				api,
				new DeltaCache(cacheManager, new ServerKnowledgeStore()),
			),
	};
}
