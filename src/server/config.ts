import "dotenv/config";
import { z } from "zod/v4";
import { fromZodError } from "zod-validation-error";
import { ValidationError } from "../utils/errors.js";
import { DEFAULT_WRITE_MODE, WRITE_MODES } from "./writeSafety.js";
import { DEFAULT_TOOL_PROFILE, TOOL_PROFILES } from "./toolProfiles.js";

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

export const RESPONSE_SIZE_LIMIT_BYTES = 90_000;
