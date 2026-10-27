import { describe, expect, it } from "vitest";
import { normalizeYnabError } from "../executorErrors.js";

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
});
