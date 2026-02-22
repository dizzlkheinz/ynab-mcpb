import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { describe, expect, it } from "vitest";
import {
	BudgetResolver,
	createInvalidBudgetError,
	createMissingBudgetError,
	resolveBudgetId,
	validateBudgetId,
} from "../budgetResolver.js";

describe("BudgetResolver", () => {
	const validUuid = "123e4567-e89b-12d3-a456-426614174000";
	const validUuid2 = "f47ac10b-58cc-4372-a567-0e02b2c3d479";
	const invalidUuid = "123e4567-e89b-12d3-a456-42661417400"; // Missing last character
	const malformedUuid = "not-a-valid-uuid-format-at-all";

	describe("resolveBudgetId", () => {
		describe("with valid provided budget ID", () => {
			it("should return provided UUID v4 budget ID", () => {
				const result = BudgetResolver.resolveBudgetId(validUuid);
				expect(result).toBe(validUuid);
			});

			it('should return error for "default" keyword when no default budget set', () => {
				const result = BudgetResolver.resolveBudgetId("default");
				expect(typeof result).toBe("object");
				expect((result as CallToolResult).content).toBeDefined();
				const errorText = ((result as CallToolResult).content?.[0] as any)
					?.text;
				expect(errorText).toContain(
					"No budget ID provided and no default budget set",
				);
			});

			it('should return default budget ID when "default" keyword provided', () => {
				const result = BudgetResolver.resolveBudgetId("default", validUuid);
				expect(result).toBe(validUuid);
			});

			it('should return error for "last-used" keyword (not supported)', () => {
				const result = BudgetResolver.resolveBudgetId("last-used");
				expect(typeof result).toBe("object");
				expect((result as CallToolResult).content).toBeDefined();
				const errorText = ((result as CallToolResult).content?.[0] as any)
					?.text;
				const parsedError = JSON.parse(errorText);
				expect(parsedError.error.details).toContain(
					'The "last-used" keyword is not supported yet',
				);
			});

			it("should prioritize provided ID over default ID", () => {
				const result = BudgetResolver.resolveBudgetId(validUuid, validUuid2);
				expect(result).toBe(validUuid);
			});

			it("should trim whitespace from provided ID", () => {
				const result = BudgetResolver.resolveBudgetId(`  ${validUuid}  `);
				expect(result).toBe(validUuid);
			});
		});

		describe("with invalid provided budget ID", () => {
			it("should return error for invalid UUID format", () => {
				const result = BudgetResolver.resolveBudgetId(invalidUuid);
				expect(typeof result).toBe("object");
				expect((result as CallToolResult).content).toBeDefined();
				expect((result as CallToolResult).content?.[0]?.type).toBe("text");
				const errorText = ((result as CallToolResult).content?.[0] as any)
					?.text;
				expect(errorText).toContain("Invalid budget ID format");
				expect(errorText).toContain(invalidUuid);
			});

			it("should return error for malformed UUID", () => {
				const result = BudgetResolver.resolveBudgetId(malformedUuid);
				expect(typeof result).toBe("object");
				expect((result as CallToolResult).content).toBeDefined();
				const errorText = ((result as CallToolResult).content?.[0] as any)
					?.text;
				expect(errorText).toContain("Invalid budget ID format");
				expect(errorText).toContain(malformedUuid);
			});

			it("should return error for empty string", () => {
				const result = BudgetResolver.resolveBudgetId("");
				expect(typeof result).toBe("object");
				expect((result as CallToolResult).content).toBeDefined();
				const errorText = ((result as CallToolResult).content?.[0] as any)
					?.text;
				const parsedError = JSON.parse(errorText);
				expect(parsedError.error.details).toContain(
					"Budget ID must be provided as a non-empty string",
				);
			});

			it("should return error for whitespace-only string", () => {
				const result = BudgetResolver.resolveBudgetId("   ");
				expect(typeof result).toBe("object");
				expect((result as CallToolResult).content).toBeDefined();
				const errorText = ((result as CallToolResult).content?.[0] as any)
					?.text;
				const parsedError = JSON.parse(errorText);
				expect(parsedError.error.details).toContain(
					"Budget ID cannot be empty or whitespace only",
				);
			});
		});

		describe("with default budget ID fallback", () => {
			it("should return valid default UUID when no provided ID", () => {
				const result = BudgetResolver.resolveBudgetId(undefined, validUuid);
				expect(result).toBe(validUuid);
			});

			it('should return error for "default" keyword as default budget ID', () => {
				const result = BudgetResolver.resolveBudgetId(undefined, "default");
				expect(typeof result).toBe("object");
				expect((result as CallToolResult).content).toBeDefined();
				const errorText = ((result as CallToolResult).content?.[0] as any)
					?.text;
				expect(errorText).toContain("Invalid budget ID format");
			});

			it("should return error when default ID is invalid", () => {
				const result = BudgetResolver.resolveBudgetId(undefined, invalidUuid);
				expect(typeof result).toBe("object");
				expect((result as CallToolResult).content).toBeDefined();
				const errorText = ((result as CallToolResult).content?.[0] as any)
					?.text;
				expect(errorText).toContain("Invalid budget ID format");
				expect(errorText).toContain(invalidUuid);
			});
		});

		describe("with missing budget ID", () => {
			it("should return error when no provided ID and no default", () => {
				const result = BudgetResolver.resolveBudgetId();
				expect(typeof result).toBe("object");
				expect((result as CallToolResult).content).toBeDefined();
				const errorText = ((result as CallToolResult).content?.[0] as any)
					?.text;
				expect(errorText).toContain(
					"No budget ID provided and no default budget set",
				);
				expect(errorText).toContain("ynab_set_default_budget");
			});

			it("should return error when provided ID is undefined and no default", () => {
				const result = BudgetResolver.resolveBudgetId(undefined, undefined);
				expect(typeof result).toBe("object");
				expect((result as CallToolResult).content).toBeDefined();
				const errorText = ((result as CallToolResult).content?.[0] as any)
					?.text;
				expect(errorText).toContain(
					"No budget ID provided and no default budget set",
				);
			});
		});
	});

	describe("validateBudgetId", () => {
		describe("with valid budget IDs", () => {
			it("should return valid UUID v4 format", () => {
				const result = BudgetResolver.validateBudgetId(validUuid);
				expect(result).toBe(validUuid);
			});

			it('should return error for "default" keyword (keywords not allowed in validation)', () => {
				const result = BudgetResolver.validateBudgetId("default");
				expect(typeof result).toBe("object");
				expect((result as CallToolResult).content).toBeDefined();
				const errorText = ((result as CallToolResult).content?.[0] as any)
					?.text;
				expect(errorText).toContain("Invalid budget ID format");
				expect(errorText).toContain("Must be a valid UUID format");
			});

			it('should return error for "last-used" keyword (keywords not allowed in validation)', () => {
				const result = BudgetResolver.validateBudgetId("last-used");
				expect(typeof result).toBe("object");
				expect((result as CallToolResult).content).toBeDefined();
				const errorText = ((result as CallToolResult).content?.[0] as any)
					?.text;
				expect(errorText).toContain("Invalid budget ID format");
				expect(errorText).toContain("Must be a valid UUID format");
			});

			it("should trim whitespace and return valid ID", () => {
				const result = BudgetResolver.validateBudgetId(`  ${validUuid}  `);
				expect(result).toBe(validUuid);
			});

			it("should handle mixed case UUID correctly", () => {
				const mixedCaseUuid = "123E4567-e89b-12d3-A456-426614174000";
				const result = BudgetResolver.validateBudgetId(mixedCaseUuid);
				expect(result).toBe(mixedCaseUuid);
			});
		});

		describe("with invalid budget IDs", () => {
			it("should return error for invalid UUID format", () => {
				const result = BudgetResolver.validateBudgetId(invalidUuid);
				expect(typeof result).toBe("object");
				expect((result as CallToolResult).content).toBeDefined();
				const errorText = ((result as CallToolResult).content?.[0] as any)
					?.text;
				expect(errorText).toContain("Invalid budget ID format");
				expect(errorText).toContain("UUID v4 format");
				expect(errorText).toContain("ynab_list_budgets");
			});

			it("should return error for malformed UUID", () => {
				const result = BudgetResolver.validateBudgetId(malformedUuid);
				expect(typeof result).toBe("object");
				expect((result as CallToolResult).content).toBeDefined();
				const errorText = ((result as CallToolResult).content?.[0] as any)
					?.text;
				expect(errorText).toContain("Invalid budget ID format");
			});

			it("should return error for empty string", () => {
				const result = BudgetResolver.validateBudgetId("");
				expect(typeof result).toBe("object");
				expect((result as CallToolResult).content).toBeDefined();
				const errorText = ((result as CallToolResult).content?.[0] as any)
					?.text;
				const parsedError = JSON.parse(errorText);
				expect(parsedError.error.details).toContain(
					"Budget ID must be provided as a non-empty string",
				);
			});

			it("should return error for whitespace-only string", () => {
				const result = BudgetResolver.validateBudgetId("   ");
				expect(typeof result).toBe("object");
				expect((result as CallToolResult).content).toBeDefined();
				const errorText = ((result as CallToolResult).content?.[0] as any)
					?.text;
				const parsedError = JSON.parse(errorText);
				expect(parsedError.error.details).toContain(
					"Budget ID cannot be empty or whitespace only",
				);
			});

			it("should return error for non-string input", () => {
				// @ts-expect-error Testing invalid input
				const result = BudgetResolver.validateBudgetId(null);
				expect(typeof result).toBe("object");
				expect((result as CallToolResult).content).toBeDefined();
				const errorText = ((result as CallToolResult).content?.[0] as any)
					?.text;
				expect(errorText).toContain(
					"Budget ID must be provided as a non-empty string",
				);
			});

			it("should return error for invalid keyword format", () => {
				const result = BudgetResolver.validateBudgetId("invalid-keyword");
				expect(typeof result).toBe("object");
				expect((result as CallToolResult).content).toBeDefined();
				const errorText = ((result as CallToolResult).content?.[0] as any)
					?.text;
				expect(errorText).toContain("Invalid budget ID format");
				expect(errorText).toContain("Must be a valid UUID format");
			});
		});

		describe("edge cases", () => {
			it("should handle very long strings", () => {
				const longString = "a".repeat(1000);
				const result = BudgetResolver.validateBudgetId(longString);
				expect(typeof result).toBe("object");
				expect((result as CallToolResult).content).toBeDefined();
				const errorText = ((result as CallToolResult).content?.[0] as any)
					?.text;
				expect(errorText).toContain("Invalid budget ID format");
			});

			it("should handle special characters", () => {
				const specialChars = "!@#$%^&*()_+-=[]{}|;:,.<>?";
				const result = BudgetResolver.validateBudgetId(specialChars);
				expect(typeof result).toBe("object");
				expect((result as CallToolResult).content).toBeDefined();
				const errorText = ((result as CallToolResult).content?.[0] as any)
					?.text;
				expect(errorText).toContain("Invalid budget ID format");
			});

			it("should handle unicode characters", () => {
				const unicode = "🎯📊💰";
				const result = BudgetResolver.validateBudgetId(unicode);
				expect(typeof result).toBe("object");
				expect((result as CallToolResult).content).toBeDefined();
				const errorText = ((result as CallToolResult).content?.[0] as any)
					?.text;
				expect(errorText).toContain("Invalid budget ID format");
			});
		});
	});

	describe("convenience throw functions", () => {
		describe("resolveBudgetIdOrThrow", () => {
			it("should return valid budget ID when successful", () => {
				const result = BudgetResolver.resolveBudgetIdOrThrow(validUuid);
				expect(result).toBe(validUuid);
			});

			it("should throw error when resolution fails", () => {
				expect(() => {
					BudgetResolver.resolveBudgetIdOrThrow(invalidUuid);
				}).toThrow();
			});

			it("should throw error when no budget provided and no default", () => {
				expect(() => {
					BudgetResolver.resolveBudgetIdOrThrow();
				}).toThrow("No budget ID provided and no default budget set");
			});
		});

		describe("validateBudgetIdOrThrow", () => {
			it("should return valid budget ID when successful", () => {
				const result = BudgetResolver.validateBudgetIdOrThrow(validUuid);
				expect(result).toBe(validUuid);
			});

			it("should throw error when validation fails", () => {
				expect(() => {
					BudgetResolver.validateBudgetIdOrThrow(invalidUuid);
				}).toThrow();
			});

			it("should throw error for empty string", () => {
				expect(() => {
					BudgetResolver.validateBudgetIdOrThrow("");
				}).toThrow();
			});
		});
	});

	describe("error creation functions", () => {
		describe("createMissingBudgetError", () => {
			it("should create standardized missing budget error", () => {
				const result = BudgetResolver.createMissingBudgetError();
				expect(typeof result).toBe("object");
				expect(result.content).toBeDefined();
				expect(result.content?.[0]?.type).toBe("text");
				const errorText = (result.content?.[0] as any)?.text;
				expect(errorText).toContain(
					"No budget ID provided and no default budget set",
				);
				expect(errorText).toContain("ynab_set_default_budget");
			});
		});

		describe("createInvalidBudgetError", () => {
			it("should create standardized invalid budget error with details", () => {
				const details = "Test error details";
				const result = BudgetResolver.createInvalidBudgetError(details);
				expect(typeof result).toBe("object");
				expect(result.content).toBeDefined();
				expect(result.content?.[0]?.type).toBe("text");
				const errorText = (result.content?.[0] as any)?.text;
				expect(errorText).toContain("Invalid budget ID format");
				expect(errorText).toContain(details);
				expect(errorText).toContain("UUID v4 format");
				expect(errorText).toContain("ynab_list_budgets");
			});
		});
	});

	describe("convenience functions", () => {
		describe("resolveBudgetId function", () => {
			it("should work the same as BudgetResolver.resolveBudgetId", () => {
				const classResult = BudgetResolver.resolveBudgetId(validUuid);
				const functionResult = resolveBudgetId(validUuid);
				expect(functionResult).toEqual(classResult);
			});
		});

		describe("validateBudgetId function", () => {
			it("should work the same as BudgetResolver.validateBudgetId", () => {
				const classResult = BudgetResolver.validateBudgetId(validUuid);
				const functionResult = validateBudgetId(validUuid);
				expect(functionResult).toEqual(classResult);
			});
		});

		describe("createMissingBudgetError function", () => {
			it("should work the same as BudgetResolver.createMissingBudgetError", () => {
				const classResult = BudgetResolver.createMissingBudgetError();
				const functionResult = createMissingBudgetError();
				expect(functionResult).toEqual(classResult);
			});
		});

		describe("createInvalidBudgetError function", () => {
			it("should work the same as BudgetResolver.createInvalidBudgetError", () => {
				const details = "Test details";
				const classResult = BudgetResolver.createInvalidBudgetError(details);
				const functionResult = createInvalidBudgetError(details);
				expect(functionResult).toEqual(classResult);
			});
		});
	});

	describe("error response structure", () => {
		it("should create consistent error response shape for missing budget", () => {
			const result =
				BudgetResolver.createMissingBudgetError() as CallToolResult;
			expect(result).toHaveProperty("content");
			expect(Array.isArray(result.content)).toBe(true);
			expect(result.content).toHaveLength(1);
			expect(result.content?.[0]).toHaveProperty("type", "text");
			expect(result.content?.[0]).toHaveProperty("text");
			expect(typeof (result.content?.[0] as any)?.text).toBe("string");
		});

		it("should create consistent error response shape for invalid budget", () => {
			const result = BudgetResolver.createInvalidBudgetError(
				"test details",
			) as CallToolResult;
			expect(result).toHaveProperty("content");
			expect(Array.isArray(result.content)).toBe(true);
			expect(result.content).toHaveLength(1);
			expect(result.content?.[0]).toHaveProperty("type", "text");
			expect(result.content?.[0]).toHaveProperty("text");
			expect(typeof (result.content?.[0] as any)?.text).toBe("string");
		});

		it("should include actionable suggestions in error messages", () => {
			const missingResult =
				BudgetResolver.createMissingBudgetError() as CallToolResult;
			const missingText = (missingResult.content?.[0] as any)?.text;
			expect(missingText).toContain("ynab_set_default_budget");
			expect(missingText).toContain("budget_id parameter");

			const invalidResult = BudgetResolver.createInvalidBudgetError(
				"test",
			) as CallToolResult;
			const invalidText = (invalidResult.content?.[0] as any)?.text;
			expect(invalidText).toContain("ynab_list_budgets");
			expect(invalidText).toContain("UUID format");
		});
	});

	describe("integration with ErrorHandler", () => {
		it("should use ErrorHandler.createValidationError for consistent formatting", () => {
			// Test that the error format matches what ErrorHandler produces
			const result = BudgetResolver.createMissingBudgetError();
			expect(typeof result).toBe("object");
			expect(result.content).toBeDefined();
			expect(result.content?.[0]?.type).toBe("text");

			// The text should be JSON formatted since ErrorHandler uses responseFormatter
			const errorText = (result.content?.[0] as any)?.text;
			expect(() => JSON.parse(errorText)).not.toThrow();

			const parsedError = JSON.parse(errorText);
			expect(parsedError).toHaveProperty("error");
			expect(parsedError.error).toHaveProperty("code");
			expect(parsedError.error).toHaveProperty("message");
			expect(parsedError.error).toHaveProperty("userMessage");
			expect(parsedError.error).toHaveProperty("suggestions");
		});
	});
});
