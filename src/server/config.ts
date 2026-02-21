import "dotenv/config";
import { z } from "zod/v4";
import { fromZodError } from "zod-validation-error";
import { ValidationError } from "../utils/errors.js";

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
