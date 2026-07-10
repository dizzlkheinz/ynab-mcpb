import { describe, expect, it } from "vitest";
import {
	createErrorHandler,
	ValidationError,
	YNABAPIError,
	YNABErrorCode,
} from "../errorHandler.js";

const handler = createErrorHandler({
	format: (value: unknown) => JSON.stringify(value),
});

function parse(error: unknown, context: string) {
	const result = handler.handleError(error, context);
	const text = result.content[0]?.text;
	if (typeof text !== "string") {
		throw new Error("Expected a text error response");
	}
	return JSON.parse(text) as {
		error: {
			code: number | string;
			message: string;
			userMessage: string;
			details?: string;
			suggestions?: string[];
		};
	};
}

describe("ErrorHandler high-risk branches", () => {
	it.each([
		[YNABErrorCode.BAD_REQUEST, "creating transaction"],
		[YNABErrorCode.UNAUTHORIZED, "getting budget"],
		[YNABErrorCode.FORBIDDEN, "listing accounts"],
		[YNABErrorCode.NOT_FOUND, "getting category"],
		[YNABErrorCode.TOO_MANY_REQUESTS, "listing transactions"],
		[YNABErrorCode.INTERNAL_SERVER_ERROR, "getting user"],
	] as const)("formats YNAB code %s", (code, context) => {
		const parsed = parse(new YNABAPIError(code, "failure"), context);
		expect(parsed.error.code).toBe(code);
		expect(parsed.error.userMessage).not.toHaveLength(0);
		expect(parsed.error.suggestions?.length).toBeGreaterThan(0);
	});

	it.each([
		["account lookup", "budget or account"],
		["budget lookup", "budget"],
		["category lookup", "category"],
		["transaction lookup", "transaction"],
		["payee lookup", "payee"],
		["resource lookup", "find"],
	] as const)("uses a contextual not-found response for %s", (context, expected) => {
		const parsed = parse(
			new YNABAPIError(YNABErrorCode.NOT_FOUND, "missing"),
			context,
		);
		expect(parsed.error.userMessage.toLowerCase()).toContain(expected);
	});

	it.each([
		"listing accounts",
		"getting account",
		"creating account",
		"listing budgets",
		"getting budget",
		"listing categories",
		"getting category",
		"updating category",
		"listing months",
		"getting month",
		"listing payees",
		"getting payee",
		"listing transactions",
		"getting transaction",
		"creating transaction",
		"updating transaction",
		"getting user",
	] as const)("uses a specific generic message for %s", (context) => {
		const parsed = parse(new Error("unclassified failure"), context);
		expect(parsed.error.code).toBe("UNKNOWN_ERROR");
		expect(parsed.error.message).not.toContain("An error occurred while");
	});

	it("uses caller-supplied validation suggestions and omits absent details", () => {
		const parsed = parse(
			new ValidationError("invalid", undefined, ["Use an explicit amount"]),
			"validating transaction",
		);
		expect(parsed.error.suggestions).toEqual(["Use an explicit amount"]);
		expect(parsed.error).not.toHaveProperty("details");
	});

	it.each([
		[{ status: 400 }, 400],
		[{ response: { status: 403, statusText: "Forbidden token=secret" } }, 403],
		[{ status: 418 }, "UNKNOWN_ERROR"],
		[{ status: 0 }, "UNKNOWN_ERROR"],
		[{ status: "401" }, "UNKNOWN_ERROR"],
	] as const)("extracts supported HTTP status shapes", (error, expectedCode) => {
		const parsed = parse(error, "requesting data");
		expect(parsed.error.code).toBe(expectedCode);
		if (parsed.error.details) {
			expect(parsed.error.details).not.toContain("secret");
		}
	});

	it.each([
		[{ error: { id: "401", detail: "token=secret" } }, 401],
		[{ response: { data: { error: { id: "403" } } } }, 403],
		[{ error: { name: "unauthorized" } }, 401],
		[{ error: { name: "forbidden" } }, 403],
		[{ error: { name: "not_found" } }, 404],
		[{ error: { name: "too_many_requests" } }, 429],
		[{ error: { name: "rate_limit_exceeded" } }, 429],
		[{ error: { name: "internal_server_error" } }, 500],
		[{ error: { id: "not-a-number", name: "unknown" } }, "UNKNOWN_ERROR"],
	] as const)("extracts structured SDK error shapes", (error, expectedCode) => {
		const parsed = parse(error, "requesting data");
		expect(parsed.error.code).toBe(expectedCode);
		if (parsed.error.details) {
			expect(parsed.error.details).not.toContain("secret");
		}
	});

	it("handles circular objects and primitive fallback values", () => {
		const circular: { self?: unknown } = {};
		circular.self = circular;
		const circularResult = parse(circular, "requesting data");
		expect(circularResult.error.details).toContain("[object Object]");
		expect(parse(null, "requesting data").error.details).toBe("null");
		expect(parse(42, "requesting data").error.details).toBe("42");
	});

	it("sanitizes Error details carried by a custom YNAB error", () => {
		const parsed = parse(
			new YNABAPIError(
				YNABErrorCode.UNAUTHORIZED,
				"failure",
				new Error("Bearer secret-token"),
			),
			"authenticating",
		);
		expect(parsed.error.details).toBe("Bearer ***");
	});
});
