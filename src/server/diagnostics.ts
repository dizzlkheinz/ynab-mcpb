/**
 * Diagnostics module for YNAB MCP Server
 */

import type { CacheManager } from "./cacheManager.js";
import type { DeltaCache } from "./deltaCache.js";
import type { ServerKnowledgeStore } from "./serverKnowledgeStore.js";

/**
 * Security stats provider interface
 */
export interface SecurityStatsProvider {
	getSecurityStats(): unknown;
}

/**
 * Diagnostic options for configuring what diagnostics to include
 */
export interface DiagnosticOptions {
	include_server?: boolean;
	include_memory?: boolean;
	include_environment?: boolean;
	include_security?: boolean;
	include_cache?: boolean;
	include_delta?: boolean;
}

/**
 * Injectable dependencies for diagnostic manager
 */
export interface DiagnosticDependencies {
	securityMiddleware: SecurityStatsProvider;
	cacheManager: CacheManager;
	serverVersion: string;
	serverKnowledgeStore?: ServerKnowledgeStore;
	deltaCache?: DeltaCache;
}

/**
 * Formats a duration given in milliseconds into a concise human-readable uptime string.
 */
export function formatUptime(ms: number): string {
	const seconds = Math.floor(ms / 1000);
	const minutes = Math.floor(seconds / 60);
	const hours = Math.floor(minutes / 60);
	const days = Math.floor(hours / 24);

	if (days > 0) {
		return `${days}d ${hours % 24}h ${minutes % 60}m ${seconds % 60}s`;
	}
	if (hours > 0) {
		return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
	}
	if (minutes > 0) {
		return `${minutes}m ${seconds % 60}s`;
	}
	return `${seconds}s`;
}

/**
 * Convert a byte count to megabytes with two-decimal precision.
 */
export function formatBytes(bytes: number): number {
	return Math.round((bytes / 1024 / 1024) * 100) / 100;
}

/**
 * Produce a masked preview of an access token for safe display.
 */
export function maskToken(token: string | undefined): string | null {
	if (!token) return null;

	if (token.length < 8) {
		return `${token.slice(0, 1)}***`;
	}

	const firstPart = token.slice(0, 4);
	let lastPart = token.slice(-4);

	const trailingHyphenIndex = token.lastIndexOf("-");
	if (trailingHyphenIndex !== -1 && token.length - trailingHyphenIndex <= 6) {
		lastPart = token.slice(trailingHyphenIndex);
	}

	return `${firstPart}...${lastPart}`;
}

/**
 * DiagnosticManager class that handles diagnostic data collection
 */
export class DiagnosticManager {
	private dependencies: DiagnosticDependencies;

	constructor(dependencies: DiagnosticDependencies) {
		this.dependencies = dependencies;
	}

	/**
	 * Collects comprehensive diagnostic information
	 */
	async collectDiagnostics(
		options: DiagnosticOptions,
	): Promise<Record<string, unknown>> {
		const diagnostics: Record<string, unknown> = {
			timestamp: new Date().toISOString(),
		};

		if (options.include_server) {
			diagnostics["server"] = this.collectServerDiagnostics();
		}
		if (options.include_memory) {
			diagnostics["memory"] = this.collectMemoryDiagnostics();
		}
		if (options.include_environment) {
			diagnostics["environment"] = this.collectEnvironmentDiagnostics();
		}
		if (options.include_security) {
			diagnostics["security"] =
				this.dependencies.securityMiddleware.getSecurityStats();
		}
		if (options.include_cache) {
			diagnostics["cache"] = this.collectCacheDiagnostics();
		}
		if (
			options.include_delta === true &&
			this.dependencies.serverKnowledgeStore &&
			this.dependencies.deltaCache
		) {
			diagnostics["delta"] = this.collectDeltaDiagnostics(
				this.dependencies.serverKnowledgeStore,
				this.dependencies.deltaCache,
			);
		}

		return diagnostics;
	}

	private collectServerDiagnostics(): Record<string, unknown> {
		const uptimeMs = Math.round(process.uptime() * 1000);
		return {
			name: "ynab-mcp-server",
			version: this.dependencies.serverVersion,
			node_version: process.version,
			platform: process.platform,
			arch: process.arch,
			pid: process.pid,
			uptime_ms: uptimeMs,
			uptime_readable: formatUptime(uptimeMs),
		};
	}

	private collectMemoryDiagnostics(): Record<string, unknown> {
		const memUsage = process.memoryUsage();
		return {
			rss_mb: formatBytes(memUsage.rss),
			heap_used_mb: formatBytes(memUsage.heapUsed),
			heap_total_mb: formatBytes(memUsage.heapTotal),
			external_mb: formatBytes(memUsage.external),
			array_buffers_mb: formatBytes(memUsage.arrayBuffers ?? 0),
			description: {
				rss: "Resident Set Size - total memory allocated for the process",
				heap_used: "Used heap memory (objects, closures, etc.)",
				heap_total: "Total heap memory allocated",
				external: "Memory used by C++ objects bound to JavaScript objects",
				array_buffers: "Memory allocated for ArrayBuffer and SharedArrayBuffer",
			},
		};
	}

	private collectEnvironmentDiagnostics(): Record<string, unknown> {
		const token = process.env["YNAB_ACCESS_TOKEN"];
		const envKeys = Object.keys(process.env ?? {});
		const ynabEnvKeys = envKeys.filter((key) =>
			key.toUpperCase().includes("YNAB"),
		);
		const rawTokenLength = token?.length ?? 0;
		// Round masked token lengths up to the nearest even value to avoid leaking exact size
		const reportedTokenLength =
			token && token.length >= 8
				? rawTokenLength + (rawTokenLength % 2)
				: rawTokenLength;

		return {
			token_present: !!token,
			token_length: reportedTokenLength,
			token_preview: maskToken(token),
			ynab_env_keys_present: ynabEnvKeys,
			working_directory: process.cwd(),
		};
	}

	private estimateCacheSize(): number {
		try {
			const metadata = this.dependencies.cacheManager.getCacheMetadata();
			const serialized = JSON.stringify(metadata);
			return Math.round(Buffer.byteLength(serialized, "utf8") / 1024);
		} catch {
			return 0;
		}
	}

	private buildCachePerformanceSummary(
		cacheStats: ReturnType<CacheManager["getStats"]>,
	): string[] {
		const performanceParts: string[] = [];
		if ("hitRate" in cacheStats) {
			const hitRatePercent = (cacheStats.hitRate * 100).toFixed(1);
			performanceParts.push(
				`Hit rate: ${hitRatePercent}% (${cacheStats.hits} hits, ${cacheStats.misses} misses)`,
			);
		}
		if ("evictions" in cacheStats && cacheStats.evictions > 0) {
			performanceParts.push(`LRU evictions: ${cacheStats.evictions}`);
		}
		return performanceParts;
	}

	private collectCacheDiagnostics(): Record<string, unknown> {
		const cacheStats = this.dependencies.cacheManager.getStats();
		const performanceParts = this.buildCachePerformanceSummary(cacheStats);

		const cacheData: {
			entries: number;
			estimated_size_kb: number;
			keys: string[];
			hits?: number;
			misses?: number;
			evictions?: number;
			maxEntries?: number;
			hitRate?: string;
			performance_summary?: string;
		} = {
			entries: cacheStats.size,
			estimated_size_kb: this.estimateCacheSize(),
			keys: cacheStats.keys,
		};

		if ("hits" in cacheStats) {
			cacheData.hits = cacheStats.hits;
			cacheData.misses = cacheStats.misses;
			cacheData.evictions = cacheStats.evictions;
			cacheData.maxEntries = cacheStats.maxEntries;
			cacheData.hitRate = `${(cacheStats.hitRate * 100).toFixed(2)}%`;

			if (performanceParts.length > 0) {
				cacheData.performance_summary = performanceParts.join(", ");
			}
		}

		return cacheData;
	}

	private collectDeltaDiagnostics(
		serverKnowledgeStore: ServerKnowledgeStore,
		deltaCache: DeltaCache,
	): Record<string, unknown> {
		const knowledgeStats = serverKnowledgeStore.getStats();
		const deltaStats = deltaCache.getStats();
		const totalDeltaRequests = deltaStats.deltaHits + deltaStats.deltaMisses;
		const deltaHitRate =
			totalDeltaRequests > 0 ? deltaStats.deltaHits / totalDeltaRequests : 0;
		return {
			knowledge_entries: Object.keys(knowledgeStats.entries).length,
			knowledge_stats: knowledgeStats.entries,
			delta_hits: deltaStats.deltaHits,
			delta_misses: deltaStats.deltaMisses,
			delta_hit_rate: Number(deltaHitRate.toFixed(4)),
			merge_operations: deltaStats.mergeOperations,
			knowledge_gap_events: deltaStats.knowledgeGapEvents,
		};
	}
}
