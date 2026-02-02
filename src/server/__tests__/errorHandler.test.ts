import { describe, expect, it, vi } from "vitest";
import {
	createErrorHandler,
	handleToolError,
	ValidationError,
	withToolErrorHandling,
	YNABAPIError,
	YNABErrorCode,
} from "../errorHandler.js";

/**
 * Helper to create an ErrorHandler with a simple JSON formatter for tests.
 */
function createTestErrorHandler() {
	return createErrorHandler({
		format: (value: unknown) => JSON.stringify(value, null, 2),
	});
}

describe("ErrorHandler", () => {
	describe("handleError", () => {
		it("should handle YNABAPIError correctly", () => {
			const errorHandler = createTestErrorHandler();
			const error = new YNABAPIError(YNABErrorCode.UNAUTHORIZED, "Test error");
			const result = errorHandler.handleError(error, "testing");

			expect(result.content[0].text).toContain(
				"Invalid or expired YNAB access token",
			);
			expect(JSON.parse(result.content[0].text).error.code).toBe(401);
		});

		it("should handle ValidationError correctly", () => {
			const errorHandler = createTestErrorHandler();
			const error = new ValidationError("Invalid input", "Field is required");
			const result = errorHandler.handleError(error, "validating");

			const parsed = JSON.parse(result.content[0].text);
			expect(parsed.error.code).toBe("VALIDATION_ERROR");
			expect(parsed.error.message).toBe("Invalid input");
			expect(parsed.error.details).toBe("Field is required");
		});

		it("should detect 401 errors from generic Error messages", () => {
			const errorHandler = createTestErrorHandler();
			const error = new Error("Request failed with status 401 Unauthorized");
			const result = errorHandler.handleError(error, "testing");

			const parsed = JSON.parse(result.content[0].text);
			expect(parsed.error.code).toBe(401);
			expect(parsed.error.message).toContain(
				"Invalid or expired YNAB access token",
			);
		});

		it("should detect 403 errors from generic Error messages", () => {
			const errorHandler = createTestErrorHandler();
			const error = new Error("403 Forbidden access");
			const result = errorHandler.handleError(error, "testing");

			const parsed = JSON.parse(result.content[0].text);
			expect(parsed.error.code).toBe(403);
			expect(parsed.error.message).toContain("Insufficient permissions");
		});

		it("should detect 404 errors from generic Error messages", () => {
			const errorHandler = createTestErrorHandler();
			const error = new Error("Resource not found - 404");
			const result = errorHandler.handleError(error, "testing");

			const parsed = JSON.parse(result.content[0].text);
			expect(parsed.error.code).toBe(404);
			expect(parsed.error.message).toContain(
				"requested resource was not found",
			);
		});

		it("should detect 429 errors from generic Error messages", () => {
			const errorHandler = createTestErrorHandler();
			const error = new Error("Too many requests - 429");
			const result = errorHandler.handleError(error, "testing");

			const parsed = JSON.parse(result.content[0].text);
			expect(parsed.error.code).toBe(429);
			expect(parsed.error.message).toContain("Rate limit exceeded");
		});

		it("should detect 500 errors from generic Error messages", () => {
			const errorHandler = createTestErrorHandler();
			const error = new Error("Internal server error 500");
			const result = errorHandler.handleError(error, "testing");

			const parsed = JSON.parse(result.content[0].text);
			expect(parsed.error.code).toBe(500);
			expect(parsed.error.message).toContain(
				"YNAB service is currently unavailable",
			);
		});

		it("should handle unknown errors gracefully", () => {
			const errorHandler = createTestErrorHandler();
			const error = new Error("Some unknown error");
			const result = errorHandler.handleError(error, "testing");

			const parsed = JSON.parse(result.content[0].text);
			expect(parsed.error.code).toBe("UNKNOWN_ERROR");
			expect(parsed.error.message).toContain("An error occurred while testing");
		});

		it("should preserve original error message in details field for unknown errors", () => {
			const errorHandler = createTestErrorHandler();
			const error = new Error("Specific diagnostic error message");
			const result = errorHandler.handleError(error, "testing operation");

			const parsed = JSON.parse(result.content[0].text);
			expect(parsed.error.code).toBe("UNKNOWN_ERROR");
			expect(parsed.error.details).toBe("Specific diagnostic error message");
			expect(parsed.error.message).toContain(
				"An error occurred while testing operation",
			);
		});

		it("should handle non-Error objects", () => {
			const errorHandler = createTestErrorHandler();
			const error = "String error";
			const result = errorHandler.handleError(error, "testing");

			const parsed = JSON.parse(result.content[0].text);
			expect(parsed.error.code).toBe("UNKNOWN_ERROR");
		});
	});

	describe("sanitizeErrorDetails", () => {
		it("should sanitize access tokens", () => {
			const errorHandler = createTestErrorHandler();
			const originalError = new Error("Failed with token: abc123xyz");
			const error = new YNABAPIError(
				YNABErrorCode.UNAUTHORIZED,
				"Test error",
				originalError,
			);
			const result = errorHandler.handleError(error, "testing");

			const parsed = JSON.parse(result.content[0].text);
			expect(parsed.error.details).toBeDefined();
			expect(parsed.error.details).not.toContain("abc123xyz");
			expect(parsed.error.details).toContain("token=***");
		});

		it("should sanitize API keys", () => {
			const errorHandler = createTestErrorHandler();
			const error = new ValidationError("Invalid input", "key=secret123");
			const result = errorHandler.handleError(error, "testing");

			const parsed = JSON.parse(result.content[0].text);
			expect(parsed.error.details).toContain("key=***");
			expect(parsed.error.details).not.toContain("secret123");
		});

		it("should sanitize passwords", () => {
			const errorHandler = createTestErrorHandler();
			const error = new ValidationError(
				"Auth failed",
				"password: mypassword123",
			);
			const result = errorHandler.handleError(error, "testing");

			const parsed = JSON.parse(result.content[0].text);
			expect(parsed.error.details).toContain("password=***");
			expect(parsed.error.details).not.toContain("mypassword123");
		});

		it("should sanitize authorization headers", () => {
			const errorHandler = createTestErrorHandler();
			const error = new ValidationError(
				"Auth failed",
				"authorization: Bearer token123",
			);
			const result = errorHandler.handleError(error, "testing");

			const parsed = JSON.parse(result.content[0].text);
			expect(parsed.error.details).toContain("authorization=***");
			expect(parsed.error.details).not.toContain("token123");
		});
	});

	describe("withErrorHandling", () => {
		it("should return result when operation succeeds", async () => {
			const errorHandler = createTestErrorHandler();
			const operation = vi.fn().mockResolvedValue({ success: true });
			const result = await errorHandler.withErrorHandling(operation, "testing");

			expect(result).toEqual({ success: true });
			expect(operation).toHaveBeenCalledOnce();
		});

		it("should handle errors when operation fails", async () => {
			const errorHandler = createTestErrorHandler();
			const operation = vi
				.fn()
				.mockRejectedValue(new Error("Operation failed"));
			const result = await errorHandler.withErrorHandling(operation, "testing");

			expect(result).toHaveProperty("content");
			expect(operation).toHaveBeenCalledOnce();
		});
	});

	describe("createValidationError", () => {
		it("should create a validation error response", () => {
			const errorHandler = createTestErrorHandler();
			const result = errorHandler.createValidationError(
				"Invalid input",
				"Field required",
			);

			const parsed = JSON.parse(result.content[0].text);
			expect(parsed.error.code).toBe("VALIDATION_ERROR");
			expect(parsed.error.message).toBe("Invalid input");
			expect(parsed.error.details).toBe("Field required");
		});
	});

	describe("createYNABError", () => {
		it("should create a YNAB API error", () => {
			const errorHandler = createTestErrorHandler();
			const originalError = new Error("Original error");
			const error = errorHandler.createYNABError(
				YNABErrorCode.NOT_FOUND,
				"finding resource",
				originalError,
			);

			expect(error).toBeInstanceOf(YNABAPIError);
			expect(error.code).toBe(YNABErrorCode.NOT_FOUND);
			expect(error.originalError).toBe(originalError);
		});
	});
});

describe("handleToolError", () => {
	it("should format tool error messages correctly", () => {
		const error = new Error("Test error");
		const result = handleToolError(
			error,
			"ynab:test_tool",
			"testing operation",
		);

		const parsed = JSON.parse(result.content[0].text);
		expect(parsed.error.code).toBe("UNKNOWN_ERROR");
		expect(parsed.error.message).toContain(
			"executing ynab:test_tool - testing operation",
		);
	});

	it("should use injected errorHandler when provided", () => {
		const mockFormatter = {
			format: vi.fn((value) => `CUSTOM: ${JSON.stringify(value)}`),
		};
		const errorHandler = createErrorHandler(mockFormatter);

		const error = new Error("Test error");
		const result = handleToolError(
			error,
			"ynab:test_tool",
			"testing operation",
			errorHandler,
		);

		expect(mockFormatter.format).toHaveBeenCalled();
		expect(result.content[0].text).toContain("CUSTOM:");
	});
});

describe("withToolErrorHandling", () => {
	it("should return result when tool operation succeeds", async () => {
		const operation = vi
			.fn()
			.mockResolvedValue({ content: [{ type: "text", text: "success" }] });
		const result = await withToolErrorHandling(
			operation,
			"ynab:test_tool",
			"testing",
		);

		expect(result).toEqual({ content: [{ type: "text", text: "success" }] });
		expect(operation).toHaveBeenCalledOnce();
	});

	it("should handle errors when tool operation fails", async () => {
		const operation = vi.fn().mockRejectedValue(new Error("Tool failed"));
		const result = await withToolErrorHandling(
			operation,
			"ynab:test_tool",
			"testing",
		);

		expect(result).toHaveProperty("content");
		const parsed = JSON.parse((result as any).content[0].text);
		expect(parsed.error.message).toContain(
			"executing ynab:test_tool - testing",
		);
	});

	it("should use injected errorHandler when provided", async () => {
		const mockFormatter = {
			format: vi.fn((value) => `CUSTOM: ${JSON.stringify(value)}`),
		};
		const errorHandler = createErrorHandler(mockFormatter);

		const operation = vi.fn().mockRejectedValue(new Error("Tool failed"));
		await withToolErrorHandling(
			operation,
			"ynab:test_tool",
			"testing",
			errorHandler,
		);

		expect(mockFormatter.format).toHaveBeenCalled();
	});
});

describe("YNABAPIError", () => {
	it("should create error with correct properties", () => {
		const originalError = new Error("Original");
		const error = new YNABAPIError(
			YNABErrorCode.UNAUTHORIZED,
			"Test message",
			originalError,
		);

		expect(error.name).toBe("YNABAPIError");
		expect(error.code).toBe(YNABErrorCode.UNAUTHORIZED);
		expect(error.message).toBe("Test message");
		expect(error.originalError).toBe(originalError);
	});
});

describe("ValidationError", () => {
	it("should create error with correct properties", () => {
		const error = new ValidationError("Test message", "Test details");

		expect(error.name).toBe("ValidationError");
		expect(error.message).toBe("Test message");
		expect(error.details).toBe("Test details");
	});
});

describe("ErrorHandler with formatter injection", () => {
	it("should use injected formatter for error responses", () => {
		const mockFormatter = {
			format: vi.fn((value) => `CUSTOM: ${JSON.stringify(value)}`),
		};
		const errorHandler = createErrorHandler(mockFormatter);

		const error = new ValidationError("Test error");
		const result = errorHandler.handleError(error, "testing");

		expect(mockFormatter.format).toHaveBeenCalledOnce();
		expect(result.content[0].text).toContain("CUSTOM:");
	});

	it("should call formatter with error response object", () => {
		const mockFormatter = {
			format: vi.fn((value) => JSON.stringify(value)),
		};
		const errorHandler = createErrorHandler(mockFormatter);

		const error = new YNABAPIError(YNABErrorCode.UNAUTHORIZED, "Test");
		errorHandler.handleError(error, "testing");

		expect(mockFormatter.format).toHaveBeenCalledWith(
			expect.objectContaining({
				error: expect.objectContaining({
					code: YNABErrorCode.UNAUTHORIZED,
					message: expect.any(String),
					userMessage: expect.any(String),
				}),
			}),
		);
	});

	it("should create different instances with different formatters", () => {
		const formatter1 = { format: (v: unknown) => `F1: ${JSON.stringify(v)}` };
		const formatter2 = { format: (v: unknown) => `F2: ${JSON.stringify(v)}` };

		const handler1 = createErrorHandler(formatter1);
		const handler2 = createErrorHandler(formatter2);

		const error = new ValidationError("Test");
		const result1 = handler1.handleError(error, "testing");
		const result2 = handler2.handleError(error, "testing");

		expect(result1.content[0].text).toContain("F1:");
		expect(result2.content[0].text).toContain("F2:");
	});
});

describe("Error scenarios", () => {
	it("should handle formatter errors gracefully", () => {
		const faultyFormatter = {
			format: () => {
				throw new Error("Formatter error");
			},
		};
		const errorHandler = createErrorHandler(faultyFormatter);

		const error = new ValidationError("Test error");

		// Should not throw despite formatter error
		expect(() => errorHandler.handleError(error, "testing")).not.toThrow();

		const result = errorHandler.handleError(error, "testing");

		// Should still return a valid CallToolResult
		expect(result.content).toBeDefined();
		expect(result.content[0].type).toBe("text");
	});
});
