import { describe, expect, it, vi } from "vitest";
import type * as ynab from "ynab";
import {
	getBudgetByIdCompat,
	getMonthCompat,
	listBudgetsCompat,
	listMonthsCompat,
} from "../ynabApiCompat.js";

const asApi = (value: unknown) => value as ynab.API;

describe("ynabApiCompat", () => {
	it("prefers legacy budgets APIs and applies response fallbacks", async () => {
		const getBudgets = vi.fn().mockResolvedValue({ data: {} });
		const getBudgetById = vi.fn().mockResolvedValue({
			data: { budget: { id: "budget-1", name: "Main" } },
		});
		const api = asApi({ budgets: { getBudgets, getBudgetById } });
		expect(await listBudgetsCompat(api)).toEqual({
			budgets: [],
			serverKnowledge: 0,
		});
		expect(await getBudgetByIdCompat(api, "budget-1")).toEqual({
			id: "budget-1",
			name: "Main",
		});
		expect(getBudgetById).toHaveBeenCalledWith("budget-1");
	});

	it("supports renamed plans APIs", async () => {
		const plan = { id: "budget-1", name: "Main" };
		const getPlans = vi.fn().mockResolvedValue({
			data: { plans: [plan], server_knowledge: 12 },
		});
		const getPlanById = vi.fn().mockResolvedValue({ data: { plan } });
		const api = asApi({ plans: { getPlans, getPlanById } });
		expect(await listBudgetsCompat(api)).toEqual({
			budgets: [plan],
			serverKnowledge: 12,
		});
		expect(await getBudgetByIdCompat(api, "budget-1")).toEqual(plan);
	});

	it("uses both month API names with and without delta knowledge", async () => {
		const month = { month: "2026-07-01" };
		const legacy = vi.fn().mockResolvedValue({
			data: { months: [month], server_knowledge: 5 },
		});
		const legacyApi = asApi({ months: { getBudgetMonths: legacy } });
		expect(await listMonthsCompat(legacyApi, "budget-1")).toEqual({
			months: [month],
			serverKnowledge: 5,
		});
		expect(await listMonthsCompat(legacyApi, "budget-1", 4)).toEqual({
			months: [month],
			serverKnowledge: 5,
		});
		expect(legacy).toHaveBeenNthCalledWith(1, "budget-1");
		expect(legacy).toHaveBeenNthCalledWith(2, "budget-1", 4);

		const renamed = vi.fn().mockResolvedValue({ data: {} });
		const renamedApi = asApi({ months: { getPlanMonths: renamed } });
		expect(await listMonthsCompat(renamedApi, "budget-1")).toEqual({
			months: [],
			serverKnowledge: 0,
		});
		await listMonthsCompat(renamedApi, "budget-1", 7);
		expect(renamed).toHaveBeenLastCalledWith("budget-1", 7);
	});

	it("gets a month through either compatibility API", async () => {
		const month = { month: "2026-07-01" };
		const getBudgetMonth = vi.fn().mockResolvedValue({ data: { month } });
		expect(
			await getMonthCompat(
				asApi({ months: { getBudgetMonth } }),
				"budget-1",
				"2026-07-01",
			),
		).toEqual(month);
		const getPlanMonth = vi.fn().mockResolvedValue({ data: { month } });
		expect(
			await getMonthCompat(
				asApi({ months: { getPlanMonth } }),
				"budget-1",
				"2026-07-01",
			),
		).toEqual(month);
	});

	it("throws actionable errors when neither API shape exists", async () => {
		const api = asApi({});
		await expect(listBudgetsCompat(api)).rejects.toThrow(
			"budgets.getBudgets() or plans.getPlans()",
		);
		await expect(getBudgetByIdCompat(api, "budget-1")).rejects.toThrow(
			"budgets.getBudgetById() or plans.getPlanById()",
		);
		await expect(listMonthsCompat(api, "budget-1")).rejects.toThrow(
			"months.getBudgetMonths() or months.getPlanMonths()",
		);
		await expect(getMonthCompat(api, "budget-1", "2026-07-01")).rejects.toThrow(
			"months.getBudgetMonth() or months.getPlanMonth()",
		);
	});
});
