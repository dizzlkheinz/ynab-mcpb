import { describe, expect, it } from "vitest";
import { YNABAPIError, YNABErrorCode } from "../../../server/errorHandler.js";
import {
	attachStatusToError,
	normalizeYnabError,
	shouldPropagateYnabError,
} from "../executorErrors.js";

describe("reconciliation executor error normalization", () => {
	it("normalizes Error status, response status, detail, and empty messages", () => {
		const direct = new Error("Bad request") as Error & {
			status: number;
			detail: string;
		};
		direct.status = 400;
		direct.detail = "invalid transaction";
		expect(normalizeYnabError(direct)).toEqual({
			status: 400,
			name: "Error",
			message: "Bad request",
			detail: "invalid transaction",
		});

		const responseStatus = new Error("Forbidden") as Error & {
			response: { status: string };
		};
		responseStatus.response = { status: "403" };
		expect(normalizeYnabError(responseStatus).status).toBe(403);

		const empty = new Error("") as Error & { detail: string };
		empty.detail = "   ";
		expect(normalizeYnabError(empty)).toEqual({
			name: "Error",
			message: "Unknown error occurred",
		});
	});

	it.each([
		[
			{ error: { id: "404", name: "not_found", detail: "missing" } },
			{ status: 404, name: "not_found", message: "missing", detail: "missing" },
		],
		[
			{ status: 429, message: "slow down" },
			{ status: 429, message: "slow down", detail: "slow down" },
		],
		[{ error: "plain SDK failure" }, { message: "plain SDK failure" }],
		[
			{ error: { id: "nope", name: "" } },
			{ name: "", message: "Unknown error occurred" },
		],
		[{}, { message: "Unknown error occurred" }],
	] as const)("normalizes SDK object shape %#", (input, expected) => {
		expect(normalizeYnabError(input)).toEqual(expected);
	});

	it("normalizes primitive values", () => {
		expect(normalizeYnabError("offline")).toEqual({ message: "offline" });
		expect(normalizeYnabError(null)).toEqual({
			message: "Unknown error occurred",
		});
		expect(normalizeYnabError(42)).toEqual({
			message: "Unknown error occurred",
		});
	});

	it.each([400, 401, 403, 404, 429, 500, 503])(
		"propagates fatal HTTP status %s",
		(status) => {
			expect(shouldPropagateYnabError({ status, message: "fatal" })).toBe(true);
		},
	);

	it("does not propagate nonfatal or absent statuses", () => {
		expect(shouldPropagateYnabError({ status: 409, message: "conflict" })).toBe(
			false,
		);
		expect(shouldPropagateYnabError({ message: "unknown" })).toBe(false);
	});

	it.each([
		YNABErrorCode.BAD_REQUEST,
		YNABErrorCode.UNAUTHORIZED,
		YNABErrorCode.FORBIDDEN,
		YNABErrorCode.NOT_FOUND,
		YNABErrorCode.TOO_MANY_REQUESTS,
		YNABErrorCode.INTERNAL_SERVER_ERROR,
	])("attaches known YNAB code %s as YNABAPIError", (status) => {
		const original = new Error("original");
		const result = attachStatusToError(
			{ status, message: "YNAB failure" },
			original,
		);
		expect(result).toBeInstanceOf(YNABAPIError);
		expect(result).toMatchObject({ status, originalError: original });
	});

	it("attaches unknown status, detail, and name to a generic Error", () => {
		const result = attachStatusToError({
			status: 503,
			name: "ServiceUnavailable",
			message: "Service failed",
			detail: "retry later",
		});
		expect(result).toMatchObject({
			name: "ServiceUnavailable",
			message: "Service failed (HTTP 503) (retry later)",
			status: 503,
		});
	});

	it("avoids duplicate detail and supplies a missing message", () => {
		const duplicate = attachStatusToError({
			message: "Failure: retry later",
			detail: "retry later",
		});
		expect(duplicate.message).toBe("Failure: retry later");

		const fallback = attachStatusToError({ status: 0, message: "" });
		expect(fallback.message).toBe("YNAB API error");
		expect(fallback).toMatchObject({ status: 0 });
	});
});
