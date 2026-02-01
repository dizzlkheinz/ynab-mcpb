import { AsyncLocalStorage } from "node:async_hooks";

function parseBool(value: string | undefined, fallback: boolean): boolean {
	if (value === undefined) return fallback;
	const v = value.trim().toLowerCase();
	return v === "1" || v === "true" || v === "yes" || v === "on";
}

function parseIntSafe(value: string | undefined, fallback: number): number {
	if (value === undefined) return fallback;
	const n = Number.parseInt(value, 10);
	return Number.isFinite(n) && n >= 0 ? n : fallback;
}

interface Context {
	minify?: boolean;
}

class ResponseFormatter {
	private defaultMinify: boolean;
	private prettySpaces: number;
	private als = new AsyncLocalStorage<Context>();

	constructor() {
		// Defaults: minify outputs unless explicitly pretty-printed
		this.defaultMinify = parseBool(process.env["YNAB_MCP_MINIFY_OUTPUT"], true);
		this.prettySpaces = parseIntSafe(process.env["YNAB_MCP_PRETTY_SPACES"], 2);
	}

	configure(options?: {
		defaultMinify?: boolean;
		prettySpaces?: number;
	}): void {
		if (!options) return;
		if (typeof options.defaultMinify === "boolean")
			this.defaultMinify = options.defaultMinify;
		if (typeof options.prettySpaces === "number" && options.prettySpaces >= 0) {
			this.prettySpaces = options.prettySpaces;
		}
	}

	runWithMinifyOverride<T>(minify: boolean | undefined, fn: () => T): T {
		if (minify === undefined) return fn();
		return this.als.run({ minify }, fn);
	}

	format(value: unknown): string {
		const ctx = this.als.getStore();
		const minify = ctx?.minify ?? this.defaultMinify;
		if (minify) return JSON.stringify(value);
		return JSON.stringify(value, null, this.prettySpaces);
	}
}

export const responseFormatter = new ResponseFormatter();
