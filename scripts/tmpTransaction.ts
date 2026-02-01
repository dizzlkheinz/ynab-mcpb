import { handleCreateTransaction } from "../src/tools/transactionTools.js";

type MockTransaction = {
	id: string;
	date: string;
	amount: number;
	memo: string;
	cleared: string;
	approved: boolean;
	flag_color: string | null;
	account_id: string;
	payee_id: string | null;
	category_id: string | null;
	transfer_account_id: string | null;
};

type MockAPI = {
	transactions: {
		createTransaction: (
			budgetId: string,
			payload: unknown,
		) => Promise<{ data: { transaction: MockTransaction } }>;
	};
	accounts: {
		getAccountById: (
			budgetId: string,
			accountId: string,
		) => Promise<{
			data: {
				account: {
					id: string;
					balance: number;
					cleared_balance: number;
					uncleared_balance: number;
				};
			};
		}>;
	};
};

const mockAPI: MockAPI = {
	transactions: {
		createTransaction: async (_budgetId: string, _payload: unknown) => ({
			data: {
				transaction: {
					id: "transaction-3",
					date: "2024-01-17",
					amount: -2500,
					memo: "Test transaction",
					cleared: "uncleared",
					approved: true,
					flag_color: null,
					account_id: "test-account",
					payee_id: null,
					category_id: "category-1",
					transfer_account_id: null,
				},
			},
		}),
	},
	accounts: {
		getAccountById: async (_budgetId: string, _accountId: string) => ({
			data: {
				account: {
					id: "test-account",
					balance: 1000,
					cleared_balance: 1000,
					uncleared_balance: 0,
				},
			},
		}),
	},
};

(async () => {
	const result = await handleCreateTransaction(mockAPI, {
		budget_id: "test-budget",
		account_id: "test-account",
		amount: -2500,
		date: "2024-01-17",
		memo: "Test transaction",
		cleared: "uncleared",
	});
	console.log("result", result);
})();
