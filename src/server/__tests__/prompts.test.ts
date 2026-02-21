/**
 * Unit tests for prompts module
 *
 * Tests prompt management functionality.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { PromptManager } from "../prompts.js";

describe("prompts module", () => {
	let promptManager: PromptManager;

	beforeEach(() => {
		promptManager = new PromptManager();
	});

	describe("PromptManager", () => {
		describe("constructor", () => {
			it("should initialize without dependencies", () => {
				expect(promptManager).toBeInstanceOf(PromptManager);
			});
		});

		describe("listPrompts", () => {
			it("should return list of available prompts", () => {
				const result = promptManager.listPrompts();

				expect(result).toEqual({
					prompts: [
						{
							name: "create-transaction",
							description: "Create a new transaction in YNAB",
							arguments: [
								{
									name: "budget_name",
									description:
										"Name of the budget (optional, uses first budget if not specified)",
									required: false,
								},
								{
									name: "account_name",
									description: "Name of the account",
									required: true,
								},
								{
									name: "amount",
									description:
										"Transaction amount (negative for expenses, positive for income)",
									required: true,
								},
								{
									name: "payee",
									description: "Who you paid or received money from",
									required: true,
								},
								{
									name: "category",
									description: "Budget category (optional)",
									required: false,
								},
								{
									name: "memo",
									description: "Additional notes (optional)",
									required: false,
								},
							],
						},
						{
							name: "budget-summary",
							description: "Get a summary of your budget status",
							arguments: [
								{
									name: "budget_name",
									description:
										"Name of the budget (optional, uses first budget if not specified)",
									required: false,
								},
								{
									name: "month",
									description:
										"Month to analyze (YYYY-MM format, optional, uses current month if not specified)",
									required: false,
								},
							],
						},
						{
							name: "reconcile-account",
							description:
								"Reconcile a YNAB account against a bank statement or CSV export",
							arguments: [
								{
									name: "budget_name",
									description:
										"Name of the budget (optional, uses first budget if not specified)",
									required: false,
								},
								{
									name: "account_name",
									description: "Name of the account to reconcile",
									required: true,
								},
								{
									name: "statement_balance",
									description:
										"Ending balance from the bank statement (in dollars)",
									required: true,
								},
								{
									name: "csv_data",
									description:
										"Paste CSV data directly (optional, omit if providing a file path instead)",
									required: false,
								},
							],
						},
						{
							name: "account-balances",
							description: "Check balances across all accounts",
							arguments: [
								{
									name: "budget_name",
									description:
										"Name of the budget (optional, uses first budget if not specified)",
									required: false,
								},
								{
									name: "account_type",
									description:
										"Filter by account type (checking, savings, creditCard, etc.)",
									required: false,
								},
							],
						},
					],
				});
			});

			it("should return consistent prompt list", () => {
				const result1 = promptManager.listPrompts();
				const result2 = promptManager.listPrompts();

				expect(result1).toEqual(result2);
			});
		});

		describe("getPrompt", () => {
			describe("create-transaction", () => {
				it("should generate transaction creation prompt with default values", async () => {
					const result = await promptManager.getPrompt(
						"create-transaction",
						{},
					);

					expect(result.description).toBe(
						"Create a transaction for [PAYEE] in [ACCOUNT_NAME]",
					);
					expect(result.messages).toHaveLength(1);
					expect(result.messages[0].role).toBe("user");
					expect(result.messages[0].content.type).toBe("text");
					expect(result.messages[0].content.text).toContain(
						"first available budget",
					);
					expect(result.messages[0].content.text).toContain("[ACCOUNT_NAME]");
					expect(result.messages[0].content.text).toContain("[AMOUNT]");
					expect(result.messages[0].content.text).toContain("[PAYEE]");
					expect(result.messages[0].content.text).toContain("[CATEGORY]");
				});

				it("should generate transaction creation prompt with provided arguments", async () => {
					const args = {
						budget_name: "Personal Budget",
						account_name: "Checking Account",
						amount: "25.50",
						payee: "Grocery Store",
						category: "Groceries",
						memo: "Weekly shopping",
					};

					const result = await promptManager.getPrompt(
						"create-transaction",
						args,
					);

					expect(result.description).toBe(
						"Create a transaction for Grocery Store in Checking Account",
					);
					expect(result.messages[0].content.text).toContain("Personal Budget");
					expect(result.messages[0].content.text).toContain("Checking Account");
					expect(result.messages[0].content.text).toContain("$25.50");
					expect(result.messages[0].content.text).toContain("Grocery Store");
					expect(result.messages[0].content.text).toContain("Groceries");
					expect(result.messages[0].content.text).toContain("Weekly shopping");
				});

				it("should handle partial arguments", async () => {
					const args = {
						account_name: "Savings Account",
						payee: "Transfer",
					};

					const result = await promptManager.getPrompt(
						"create-transaction",
						args,
					);

					expect(result.description).toBe(
						"Create a transaction for Transfer in Savings Account",
					);
					expect(result.messages[0].content.text).toContain(
						"first available budget",
					);
					expect(result.messages[0].content.text).toContain("Savings Account");
					expect(result.messages[0].content.text).toContain("[AMOUNT]");
					expect(result.messages[0].content.text).toContain("Transfer");
					expect(result.messages[0].content.text).toContain("[CATEGORY]");
				});

				it("should include proper workflow instructions", async () => {
					const result = await promptManager.getPrompt(
						"create-transaction",
						{},
					);

					const text = result.messages[0].content.text;
					expect(text).toContain("list budgets to find the budget ID");
					expect(text).toContain(
						"List accounts for that budget to find the account ID",
					);
					expect(text).toContain("list categories to find the category ID");
					expect(text).toContain(
						"Create the transaction with the correct amount in milliunits",
					);
					expect(text).toContain("multiply by 1000");
				});
			});

			describe("budget-summary", () => {
				it("should generate budget summary prompt with default values", async () => {
					const result = await promptManager.getPrompt("budget-summary", {});

					expect(result.description).toBe(
						"Get budget summary for first available budget",
					);
					expect(result.messages).toHaveLength(1);
					expect(result.messages[0].role).toBe("user");
					expect(result.messages[0].content.text).toContain(
						"first available budget",
					);
					expect(result.messages[0].content.text).toContain("current month");
				});

				it("should generate budget summary prompt with provided arguments", async () => {
					const args = {
						budget_name: "Family Budget",
						month: "2024-03",
					};

					const result = await promptManager.getPrompt("budget-summary", args);

					expect(result.description).toBe(
						"Get budget summary for Family Budget",
					);
					expect(result.messages[0].content.text).toContain(
						"Family Budget (2024-03)",
					);
				});

				it("should include YNAB-specific guidance", async () => {
					const result = await promptManager.getPrompt("budget-summary", {});

					const text = result.messages[0].content.text;
					expect(text).toContain("budgeted: Amount assigned to the category");
					expect(text).toContain("activity: Spending/income in the category");
					expect(text).toContain("balance: Available amount in the category");
					expect(text).toContain("OVERSPENDING occurs when balance < 0");
					expect(text).toContain("SPENDING TRENDS");
					expect(text).toContain("BUDGET OPTIMIZATION");
					expect(text).toContain("reliability_score");
					expect(text).toContain("Consistently Under-Spent Categories");
					expect(text).toContain("Categories Over Monthly Assignment");
					expect(text).toContain("Large Unused Category Balances");
				});
			});

			describe("account-balances", () => {
				it("should generate account balances prompt with default values", async () => {
					const result = await promptManager.getPrompt("account-balances", {});

					expect(result.description).toBe(
						"Check account balances for all accounts",
					);
					expect(result.messages).toHaveLength(1);
					expect(result.messages[0].role).toBe("user");
					expect(result.messages[0].content.text).toContain(
						"first available budget",
					);
					expect(result.messages[0].content.text).toContain("all accounts");
				});

				it("should generate account balances prompt with provided arguments", async () => {
					const args = {
						budget_name: "Business Budget",
						account_type: "checking",
					};

					const result = await promptManager.getPrompt(
						"account-balances",
						args,
					);

					expect(result.description).toBe(
						"Check account balances for checking",
					);
					expect(result.messages[0].content.text).toContain("Business Budget");
					expect(result.messages[0].content.text).toContain("checking");
				});

				it("should include proper balance display instructions", async () => {
					const result = await promptManager.getPrompt("account-balances", {});

					const text = result.messages[0].content.text;
					expect(text).toContain("Account name and type");
					expect(text).toContain("Current balance");
					expect(text).toContain("Cleared vs uncleared amounts");
					expect(text).toContain("Total by account type");
					expect(text).toContain("Net worth summary");
					expect(text).toContain("Convert milliunits to dollars");
				});
			});

			describe("unknown prompts", () => {
				it("should throw error for unknown prompt names", async () => {
					await expect(
						promptManager.getPrompt("unknown-prompt", {}),
					).rejects.toThrow("Unknown prompt: unknown-prompt");
				});

				it("should throw error for empty prompt name", async () => {
					await expect(promptManager.getPrompt("", {})).rejects.toThrow(
						"Unknown prompt: ",
					);
				});
			});

			describe("argument handling", () => {
				it("should handle undefined arguments", async () => {
					const result = await promptManager.getPrompt(
						"create-transaction",
						undefined,
					);

					expect(result.description).toBe(
						"Create a transaction for [PAYEE] in [ACCOUNT_NAME]",
					);
					expect(result.messages[0].content.text).toContain(
						"first available budget",
					);
				});

				it("should handle null arguments", async () => {
					const result = await promptManager.getPrompt(
						"budget-summary",
						null as any,
					);

					expect(result.description).toBe(
						"Get budget summary for first available budget",
					);
					expect(result.messages[0].content.text).toContain("current month");
				});

				it("should handle empty arguments object", async () => {
					const result = await promptManager.getPrompt("account-balances", {});

					expect(result.description).toBe(
						"Check account balances for all accounts",
					);
					expect(result.messages[0].content.text).toContain("all accounts");
				});

				it("should handle arguments with null/undefined values", async () => {
					const args = {
						budget_name: null,
						account_name: undefined,
						amount: "",
						payee: "Test Payee",
					};

					const result = await promptManager.getPrompt(
						"create-transaction",
						args,
					);

					expect(result.messages[0].content.text).toContain(
						"first available budget",
					);
					expect(result.messages[0].content.text).toContain("[ACCOUNT_NAME]");
					expect(result.messages[0].content.text).toContain("[AMOUNT]");
					expect(result.messages[0].content.text).toContain("Test Payee");
				});
			});

			describe("edge cases", () => {
				it("should handle very long argument values", async () => {
					const longValue = "a".repeat(1000);
					const args = {
						budget_name: longValue,
						memo: longValue,
					};

					const result = await promptManager.getPrompt(
						"create-transaction",
						args,
					);

					expect(result.messages[0].content.text).toContain(longValue);
				});

				it("should handle special characters in arguments", async () => {
					const args = {
						payee: "McDonald's & Co. (special chars: !@#$%^&*)",
						category: "Dining/Restaurants",
						memo: 'Quote: "Great food!"',
					};

					const result = await promptManager.getPrompt(
						"create-transaction",
						args,
					);

					expect(result.messages[0].content.text).toContain(args.payee);
					expect(result.messages[0].content.text).toContain(args.category);
					expect(result.messages[0].content.text).toContain(args.memo);
				});

				it("should maintain consistent message structure across all prompts", async () => {
					const prompts = [
						"create-transaction",
						"budget-summary",
						"account-balances",
					];

					for (const promptName of prompts) {
						const result = await promptManager.getPrompt(promptName, {});

						expect(result).toHaveProperty("description");
						expect(result).toHaveProperty("messages");
						expect(Array.isArray(result.messages)).toBe(true);
						expect(result.messages).toHaveLength(1);
						expect(result.messages[0]).toHaveProperty("role", "user");
						expect(result.messages[0]).toHaveProperty("content");
						expect(result.messages[0].content).toHaveProperty("type", "text");
						expect(result.messages[0].content).toHaveProperty("text");
						expect(typeof result.messages[0].content.text).toBe("string");
						expect(result.messages[0].content.text.length).toBeGreaterThan(0);
					}
				});
			});
		});
	});
});
