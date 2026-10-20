import "dotenv/config";
import { z } from "zod/v4";
import { fromZodError } from "zod-validation-error";
import { ValidationError } from "../utils/errors.js";
import { DEFAULT_TOOL_PROFILE, TOOL_PROFILES } from "./toolProfiles.js";
import { DEFAULT_WRITE_MODE, WRITE_MODES } from "./writeSafety.js";

const normalizeEnvValue = (value: unknown) => {
	if (typeof value !== "string") {
		return value;
	}
	const trimmed = value.trim();
	const lowered = trimmed.toLowerCase();
	if (lowered === "undefined" || lowered === "null") {
		return undefined;
	}
	return trimmed;
};

const envSchema = z.object({
	YNAB_ACCESS_TOKEN: z.preprocess(
		normalizeEnvValue,
		z.string().min(1, "YNAB_ACCESS_TOKEN must be a non-empty string"),
	),
	YNAB_DEFAULT_BUDGET_ID: z
		.string()
		.uuid("YNAB_DEFAULT_BUDGET_ID must be a valid UUID")
		.optional(),
	YNAB_MCP_ENABLE_DELTA: z.enum(["true", "false"]).optional(),
	YNAB_MCP_WRITE_MODE: z.enum(WRITE_MODES).default(DEFAULT_WRITE_MODE),
	YNAB_MCP_TOOL_PROFILE: z.enum(TOOL_PROFILES).default(DEFAULT_TOOL_PROFILE),
	LOG_LEVEL: z
		.enum(["trace", "debug", "info", "warn", "error", "fatal"])
		.default("info"),
	YNAB_EXPORT_PATH: z.string().optional(),
	XDG_DOCUMENTS_DIR: z.string().optional(),
	RATE_LIMIT_LOGGING: z
		.enum(["true", "false"])
		.optional()
		.transform((value) => value === "true"),
	VERBOSE_TESTS: z
		.enum(["true", "false"])
		.optional()
		.transform((value) => value === "true"),
});

export type AppConfig = z.infer<typeof envSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
	const result = envSchema.safeParse(env);
	if (!result.success) {
		const validationError = fromZodError(result.error);
		throw new ValidationError(validationError.toString());
	}
	return result.data;
}

let cachedConfig: AppConfig | undefined;

/**
 * Returns the memoized application config, loading it from the environment on
 * first use. Tests that mutate relevant environment variables should call
 * `resetAppConfig()` to force a reload.
 */
export function getAppConfig(): AppConfig {
	if (!cachedConfig) {
		cachedConfig = loadConfig();
	}
	return cachedConfig;
}

export function resetAppConfig(): void {
	cachedConfig = undefined;
}

/**
 * Runtime-infrastructure settings that must be readable without YNAB
 * credentials. Standalone imports (tests, tooling) must not require
 * YNAB_ACCESS_TOKEN, so this schema only covers optional keys and never
 * throws.
 */
const runtimeEnvSchema = z.object({
	LOG_LEVEL: z
		.enum(["trace", "debug", "info", "warn", "error", "fatal"])
		.default("info"),
	YNAB_EXPORT_PATH: z.string().optional(),
	XDG_DOCUMENTS_DIR: z.string().optional(),
	YNAB_MCP_ENABLE_DELTA: z.enum(["true", "false"]).optional(),
	RATE_LIMIT_LOGGING: z
		.enum(["true", "false"])
		.optional()
		.transform((value) => value === "true"),
	VERBOSE_TESTS: z
		.enum(["true", "false"])
		.optional()
		.transform((value) => value === "true"),
});

export type RuntimeConfig = z.infer<typeof runtimeEnvSchema>;

let cachedRuntimeConfig: RuntimeConfig | undefined;

/**
 * Returns the memoized runtime config for infrastructure modules (logging,
 * rate limiting, exports). Never throws, so modules can read these values
 * at import time without YNAB credentials present.
 */
export function getRuntimeConfig(): RuntimeConfig {
	if (!cachedRuntimeConfig) {
		const result = runtimeEnvSchema.safeParse(process.env);
		cachedRuntimeConfig = result.success
			? result.data
			: runtimeEnvSchema.parse({});
	}
	return cachedRuntimeConfig;
}

export function resetRuntimeConfig(): void {
	cachedRuntimeConfig = undefined;
}

export const RESPONSE_SIZE_LIMIT_BYTES = 90_000;
