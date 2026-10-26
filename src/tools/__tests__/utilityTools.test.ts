import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as ynab from "ynab";
import { textOf } from "../../__tests__/testUtils.js";
import { handleGetUser } from "../utilityTools.js";

// Mock the YNAB API
const mockYnabAPI = {
	user: {
		getUser: vi.fn(),
	},
} as unknown as ynab.API;

describe("Utility Tools", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe("handleGetUser", () => {
		it("should return user information successfully", async () => {
			const mockUser = {
				id: "user-123",
			};

			const mockResponse = {
				data: {
					user: mockUser,
				},
			};

			(mockYnabAPI.user.getUser as any).mockResolvedValue(mockResponse);

			const result = await handleGetUser(mockYnabAPI, {
				response_format: "json",
			});
			const parsed = JSON.parse(textOf(result.content[0]));
			expect(parsed.user).toBeDefined();
			expect(parsed.user.id).toBe("user-123");
			expect(mockYnabAPI.user.getUser).toHaveBeenCalledTimes(1);
		});

		it("should handle 401 authentication errors", async () => {
			const error = new Error("401 Unauthorized");
			(mockYnabAPI.user.getUser as any).mockRejectedValue(error);

			const result = await handleGetUser(mockYnabAPI, {
				response_format: "json",
			});

			expect(textOf(result.content[0])).toContain(
				"Invalid or expired YNAB access token",
			);
		});

		it("should handle 403 authorization errors", async () => {
			const error = new Error("403 Forbidden");
			(mockYnabAPI.user.getUser as any).mockRejectedValue(error);

			const result = await handleGetUser(mockYnabAPI, {
				response_format: "json",
			});

			expect(textOf(result.content[0])).toContain(
				"Insufficient permissions to access YNAB data",
			);
		});

		it("should handle 429 rate limiting errors", async () => {
			const error = new Error("429 Too Many Requests");
			(mockYnabAPI.user.getUser as any).mockRejectedValue(error);

			const result = await handleGetUser(mockYnabAPI, {
				response_format: "json",
			});

			expect(textOf(result.content[0])).toContain(
				"Rate limit exceeded. Please try again later",
			);
		});

		it("should handle 500 server errors", async () => {
			const error = new Error("500 Internal Server Error");
			(mockYnabAPI.user.getUser as any).mockRejectedValue(error);

			const result = await handleGetUser(mockYnabAPI, {
				response_format: "json",
			});

			expect(textOf(result.content[0])).toContain(
				"YNAB service is currently unavailable",
			);
		});

		it("should handle generic errors", async () => {
			const error = new Error("Network error");
			(mockYnabAPI.user.getUser as any).mockRejectedValue(error);

			const result = await handleGetUser(mockYnabAPI, {
				response_format: "json",
			});

			expect(textOf(result.content[0])).toContain(
				"Failed to get user information",
			);
		});
	});
});
