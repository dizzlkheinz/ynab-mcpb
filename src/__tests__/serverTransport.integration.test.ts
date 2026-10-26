import { afterEach, describe, expect, it, vi } from "vitest";
import { YNABMCPServer } from "../server/YNABMCPServer.js";
import { executeConfirmedToolCall, executeToolCall } from "./testUtils.js";

afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllEnvs();
});

describe("server tools through the SDK transport", () => {
	it("invalidates cached account reads after a confirmed account creation", async () => {
		vi.stubEnv("YNAB_ACCESS_TOKEN", "transport-test-token");
		const budgetId = "00000000-0000-4000-8000-000000000001";
		const account = {
			id: "account-1",
			name: "Checking",
			type: "checking",
			on_budget: true,
			closed: false,
			balance: 0,
			cleared_balance: 0,
			uncleared_balance: 0,
			transfer_payee_id: "payee-1",
			deleted: false,
		};
		const added = {
			...account,
			id: "account-2",
			name: "Savings",
			type: "savings",
		};
		let created = false;
		const fetch = vi
			.spyOn(globalThis, "fetch")
			.mockImplementation(async (input, init) => {
				const url = new URL(
					typeof input === "string"
						? input
						: input instanceof URL
							? input.href
							: input.url,
				);
				expect(url.pathname).toContain(`/plans/${budgetId}/accounts`);
				let data: Record<string, unknown>;
				if (init?.method === "POST") {
					created = true;
					data = { account: added };
				} else {
					data = {
						accounts: created ? [account, added] : [account],
						server_knowledge: created ? 2 : 1,
					};
				}
				return new Response(JSON.stringify({ data }), {
					status: 200,
					headers: { "Content-Type": "application/json" },
				});
			});
		const server = new YNABMCPServer(false);
		const read = () =>
			executeToolCall(server, "ynab_list_accounts", { budget_id: budgetId });
		for (let i = 0; i < 2; i++) {
			const result = await read();
			expect(result.isError).not.toBe(true);
			expect(result.structuredContent?.["accounts"]).toHaveLength(1);
		}
		expect(fetch).toHaveBeenCalledTimes(1);
		const mutation = await executeConfirmedToolCall(
			server,
			"ynab_create_account",
			{
				budget_id: budgetId,
				name: "Savings",
				type: "savings",
				balance: 0,
			},
		);
		expect(mutation.isError).not.toBe(true);
		expect(created).toBe(true);
		const updated = await read();
		expect(updated.isError).not.toBe(true);
		expect(updated.structuredContent?.["accounts"]).toHaveLength(2);
		expect(fetch).toHaveBeenCalledTimes(3);
	});

	it("keeps payee, category, and split details through list and get responses", async () => {
		vi.stubEnv("YNAB_ACCESS_TOKEN", "transport-test-token");
		const budgetId = "00000000-0000-4000-8000-000000000001";
		const transaction = {
			id: "transaction-1",
			date: "2026-10-01",
			amount: -12_345,
			memo: null,
			cleared: "uncleared",
			approved: true,
			flag_color: null,
			account_id: "account-1",
			account_name: "Checking",
			payee_id: "payee-1",
			payee_name: "Grocer",
			category_id: null,
			category_name: "Split",
			transfer_account_id: null,
			deleted: false,
			subtransactions: [
				{
					id: "line-1",
					transaction_id: "transaction-1",
					amount: -10_000,
					memo: "Food",
					payee_id: null,
					payee_name: null,
					category_id: "category-1",
					category_name: "Groceries",
					transfer_account_id: null,
					deleted: false,
				},
				{
					id: "line-2",
					transaction_id: "transaction-1",
					amount: -2_345,
					memo: "Soap",
					payee_id: null,
					payee_name: null,
					category_id: "category-2",
					category_name: "Household",
					transfer_account_id: null,
					deleted: false,
				},
			],
		};
		vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
			const url = new URL(
				typeof input === "string"
					? input
					: input instanceof URL
						? input.href
						: input.url,
			);
			const data = url.pathname.endsWith(`/transactions/${transaction.id}`)
				? { transaction }
				: { transactions: [transaction], server_knowledge: 1 };
			return new Response(JSON.stringify({ data }), {
				status: 200,
				headers: { "Content-Type": "application/json" },
			});
		});
		const server = new YNABMCPServer(false);
		const expected = {
			payee_name: "Grocer",
			category_name: "Split",
			amount: -12.345,
			amount_milliunits: -12_345,
			subtransactions: [
				expect.objectContaining({
					category_name: "Groceries",
					amount: -10,
					amount_milliunits: -10_000,
				}),
				expect.objectContaining({
					category_name: "Household",
					amount: -2.345,
					amount_milliunits: -2_345,
				}),
			],
		};

		const list = await executeToolCall(server, "ynab_list_transactions", {
			budget_id: budgetId,
			response_format: "json",
		});
		expect(list.isError).not.toBe(true);
		expect(list.structuredContent?.["transactions"]).toEqual([
			expect.objectContaining(expected),
		]);
		const listText = list.content?.[0];
		expect(listText?.type).toBe("text");
		expect(
			JSON.parse(listText?.type === "text" ? listText.text : "").transactions,
		).toEqual([expect.objectContaining(expected)]);

		const detail = await executeToolCall(server, "ynab_get_transaction", {
			budget_id: budgetId,
			transaction_id: transaction.id,
			response_format: "json",
		});
		expect(detail.isError).not.toBe(true);
		expect(detail.structuredContent?.["transaction"]).toEqual(
			expect.objectContaining(expected),
		);
		const detailText = detail.content?.[0];
		expect(
			JSON.parse(detailText?.type === "text" ? detailText.text : "")
				.transaction,
		).toEqual(expect.objectContaining(expected));

		// The default markdown shows names in the list and split lines in the detail.
		for (const [tool, args, names] of [
			["ynab_list_transactions", { budget_id: budgetId }, ["Grocer", "Split"]],
			[
				"ynab_get_transaction",
				{ budget_id: budgetId, transaction_id: transaction.id },
				["Grocer", "Groceries", "Household"],
			],
		] as const) {
			const markdown = await executeToolCall(server, tool, args);
			expect(markdown.isError).not.toBe(true);
			const text = markdown.content?.[0];
			const rendered = text?.type === "text" ? text.text : "";
			for (const name of names) {
				expect(rendered, `${tool} markdown`).toContain(name);
			}
		}
	});
});
