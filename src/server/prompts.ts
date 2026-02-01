/**
 * Prompts module for YNAB MCP Server
 *
 * Handles MCP prompt definitions and handlers.
 * Extracted from YNABMCPServer to provide focused, testable prompt management.
 */

/**
 * Prompt argument definition
 */
export interface PromptArgument {
	name: string;
	description: string;
	required: boolean;
}

/**
 * Prompt definition structure
 */
export interface PromptDefinition {
	name: string;
	description: string;
	arguments: PromptArgument[];
}

/**
 * Prompt response structure
 */
export interface PromptResponse {
	description: string;
	messages: {
		role: "user" | "assistant";
		content: {
			type: "text";
			text: string;
		};
	}[];
}

/**
 * Prompt handler function signature
 */
export type PromptHandler = (
	name: string,
	args: Record<string, unknown> | undefined,
) => Promise<PromptResponse>;

/**
 * Default prompt definitions
 */
const defaultPromptDefinitions: PromptDefinition[] = [
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
];

/**
 * Default prompt handlers
 */
const defaultPromptHandlers: Record<string, PromptHandler> = {
	"create-transaction": async (_name, args) => {
		const budgetName = args?.["budget_name"] || "first available budget";
		const accountName = args?.["account_name"] || "[ACCOUNT_NAME]";
		const amount = args?.["amount"] || "[AMOUNT]";
		const payee = args?.["payee"] || "[PAYEE]";
		const category = args?.["category"] || "[CATEGORY]";
		const memo = args?.["memo"] || "";

		return {
			description: `Create a transaction for ${payee} in ${accountName}`,
			messages: [
				{
					role: "user",
					content: {
						type: "text",
						text: `Please create a transaction with the following details:
- Budget: ${budgetName}
- Account: ${accountName}
- Amount: $${amount}
- Payee: ${payee}
- Category: ${category}
- Memo: ${memo}

Use the appropriate YNAB MCP tools to:
1. First, list budgets to find the budget ID
2. List accounts for that budget to find the account ID
3. If a category is specified, list categories to find the category ID
4. Create the transaction with the correct amount in milliunits (multiply by 1000)
5. Confirm the transaction was created successfully`,
					},
				},
			],
		};
	},

	"budget-summary": async (_name, args) => {
		const summaryBudget = args?.["budget_name"] || "first available budget";
		const month = args?.["month"] || "current month";

		return {
			description: `Get budget summary for ${summaryBudget}`,
			messages: [
				{
					role: "user",
					content: {
						type: "text",
						text: `Please provide a comprehensive budget summary for ${summaryBudget} (${month}):

IMPORTANT: In YNAB, understand these key fields:
- budgeted: Amount assigned to the category this month
- activity: Spending/income in the category this month (negative = spending)
- balance: Available amount in the category = previous balance + budgeted + activity
- OVERSPENDING occurs when balance < 0 (Available goes negative), NOT when spending > budgeted for the month

SPENDING TRENDS: The analysis uses linear regression over multiple months to detect real spending patterns. Each trend includes:
- explanation: User-friendly description of what the trend means
- reliability_score: Confidence level (0-100%) indicating how reliable the trend is
- data_points: Number of months used in the analysis
Focus on trends with high reliability scores for actionable insights.

BUDGET OPTIMIZATION: The system provides three types of optimization insights:
1. "Consistently Under-Spent Categories" - Based on multi-month historical trends (reliable patterns)
2. "Categories Over Monthly Assignment" - Current month only (spending > budgeted but Available still positive)
3. "Large Unused Category Balances" - Categories with substantial unused funds
Distinguish between current-month patterns vs historical trends when presenting insights.

1. List all budgets and select the appropriate one
2. Get monthly data for ${month}
3. List categories to show budget vs actual spending
4. Provide insights on:
   - Total budgeted vs actual spending
   - Categories where Available balance is negative (true overspending - when the category's balance field is < 0)
   - Categories where spending exceeded this month's assignment (but still have positive Available balance)
   - Available money to budget
   - Any true overspending where categories went into the red (negative Available balance)

Format the response in a clear, easy-to-read summary.`,
					},
				},
			],
		};
	},

	"account-balances": async (_name, args) => {
		const balanceBudget = args?.["budget_name"] || "first available budget";
		const accountType = args?.["account_type"] || "all accounts";

		return {
			description: `Check account balances for ${accountType}`,
			messages: [
				{
					role: "user",
					content: {
						type: "text",
						text: `Please show account balances for ${balanceBudget}:

1. List all budgets and select the appropriate one
2. List accounts for that budget
3. Filter by account type: ${accountType}
4. Show balances in a clear format with:
   - Account name and type
   - Current balance
   - Cleared vs uncleared amounts
   - Total by account type
   - Net worth summary (assets - liabilities)

Convert milliunits to dollars for easy reading.`,
					},
				},
			],
		};
	},
};

/**
 * PromptManager class that handles prompt registration and request handling
 */
export class PromptManager {
	private promptDefinitions: PromptDefinition[];
	private promptHandlers: Record<string, PromptHandler>;

	constructor() {
		this.promptDefinitions = [...defaultPromptDefinitions];
		this.promptHandlers = { ...defaultPromptHandlers };
	}

	/**
	 * Register a new prompt with its handler at runtime
	 */
	registerPrompt(definition: PromptDefinition, handler: PromptHandler): void {
		this.promptDefinitions.push(definition);
		this.promptHandlers[definition.name] = handler;
	}

	/**
	 * Returns list of available prompts for MCP prompt listing
	 */
	listPrompts(): { prompts: PromptDefinition[] } {
		return {
			prompts: this.promptDefinitions,
		};
	}

	/**
	 * Handles prompt get requests
	 */
	async getPrompt(
		name: string,
		args: Record<string, unknown> | undefined,
	): Promise<PromptResponse> {
		const handler = this.promptHandlers[name];
		if (!handler) {
			throw new Error(`Unknown prompt: ${name}`);
		}

		const definition = this.promptDefinitions.find((p) => p.name === name);
		if (!definition) {
			throw new Error(`Prompt definition not found: ${name}`);
		}

		// Let handlers deal with missing arguments - they provide placeholders when args are missing

		return await handler(name, args);
	}
}
