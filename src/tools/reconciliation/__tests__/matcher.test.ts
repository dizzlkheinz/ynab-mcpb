import { beforeEach, describe, expect, it } from "vitest";
import { findBestMatch, findMatches } from "../matcher.js";
import type {
	BankTransaction,
	MatchingConfig,
	YNABTransaction,
} from "../types.js";

describe("matcher", () => {
	let config: MatchingConfig;

	beforeEach(() => {
		config = {
			weights: {
				date: 0.15,
				payee: 0.35,
			},
			dateToleranceDays: 2,
			autoMatchThreshold: 90,
			suggestedMatchThreshold: 60,
			minimumCandidateScore: 40,
			exactDateBonus: 5,
			exactPayeeBonus: 10,
			exactDateAutoMatchThreshold: 65,
		};
	});

	describe("findBestMatch", () => {
		describe("high confidence matches (≥90%)", () => {
			it("should return high confidence for exact match", () => {
				const bankTxn: BankTransaction = {
					id: "b1",
					date: "2025-10-15",
					amount: -45230, // milliunits (-45.23)
					payee: "Shell Gas Station",
					sourceRow: 2,
					raw: {
						date: "2025-10-15",
						amount: "-45.23",
						description: "Shell Gas Station",
					},
				};

				const ynabTxns: YNABTransaction[] = [
					{
						id: "y1",
						date: "2025-10-15",
						amount: -45230, // milliunits
						payee: "Shell Gas Station",
						categoryName: "Auto: Gas",
						cleared: "uncleared",
						approved: true,
					},
				];

				const match = findBestMatch(bankTxn, ynabTxns, new Set(), config);

				expect(match.confidence).toBe("high");
				expect(match.confidenceScore).toBeGreaterThanOrEqual(90);
				expect(match.bestMatch?.ynabTransaction).toEqual(ynabTxns[0]);
			});

			it("should return high confidence for normalized payee match", () => {
				const bankTxn: BankTransaction = {
					id: "b1",
					date: "2025-10-15",
					amount: -100000, // milliunits (-100.00)
					payee: "NETFLIX.COM",
					sourceRow: 2,
					raw: {
						date: "2025-10-15",
						amount: "-100.00",
						description: "NETFLIX.COM",
					},
				};

				const ynabTxns: YNABTransaction[] = [
					{
						id: "y1",
						date: "2025-10-15",
						amount: -100000,
						payee: "Netflix Com",
						categoryName: "Entertainment",
						cleared: "uncleared",
						approved: true,
					},
				];

				const match = findBestMatch(bankTxn, ynabTxns, new Set(), config);

				expect(match.confidence).toBe("high");
				expect(match.confidenceScore).toBeGreaterThanOrEqual(90);
			});

			it("should handle date within tolerance", () => {
				const bankTxn: BankTransaction = {
					id: "b1",
					date: "2025-10-15",
					amount: -50000, // milliunits (-50.00)
					payee: "Restaurant",
					sourceRow: 2,
					raw: {
						date: "2025-10-15",
						amount: "-50.00",
						description: "Restaurant",
					},
				};

				const ynabTxns: YNABTransaction[] = [
					{
						id: "y1",
						date: "2025-10-14", // 1 day difference
						amount: -50000,
						payee: "Restaurant",
						categoryName: "Dining",
						cleared: "uncleared",
						approved: true,
					},
				];

				const match = findBestMatch(bankTxn, ynabTxns, new Set(), config);

				expect(match.confidence).toBe("high");
				expect(match.confidenceScore).toBeGreaterThanOrEqual(90);
			});

			it("should return high confidence for fuzzy payee match", () => {
				const bankTxn: BankTransaction = {
					id: "b1",
					date: "2025-10-20",
					amount: -127430, // milliunits (-127.43)
					payee: "AMAZON.COM",
					sourceRow: 2,
					raw: {
						date: "2025-10-20",
						amount: "-127.43",
						description: "AMAZON.COM",
					},
				};

				const ynabTxns: YNABTransaction[] = [
					{
						id: "y1",
						date: "2025-10-20",
						amount: -127430,
						payee: "Amazon Prime",
						categoryName: "Shopping",
						cleared: "uncleared",
						approved: true,
					},
				];

				const match = findBestMatch(bankTxn, ynabTxns, new Set(), config);

				expect(match.confidence).toBe("high");
				expect(match.confidenceScore).toBeGreaterThanOrEqual(90);
				expect(match.candidates).toBeDefined();
				expect(match.candidates?.length).toBeGreaterThan(0);
			});
		});

		describe("medium confidence matches (60-89%)", () => {
			it("should auto-match an exact-date unique candidate even with a weak payee match", () => {
				const bankTxn: BankTransaction = {
					id: "b1",
					date: "2025-10-15",
					amount: -61500,
					payee: "CARD 8472 AUTH 5521",
					sourceRow: 2,
					raw: {
						date: "2025-10-15",
						amount: "-61.50",
						description: "CARD 8472 AUTH 5521",
					},
				};

				const ynabTxns: YNABTransaction[] = [
					{
						id: "y1",
						date: "2025-10-15",
						amount: -61500,
						payee: "Amazon",
						categoryName: "Shopping",
						cleared: "uncleared",
						approved: true,
					},
				];

				const match = findBestMatch(bankTxn, ynabTxns, new Set(), config);

				expect(match.confidenceScore).toBeGreaterThanOrEqual(65);
				expect(match.confidenceScore).toBeLessThan(config.autoMatchThreshold);
				expect(match.candidates).toHaveLength(1);
				expect(match.bestMatch?.scores.date).toBe(100);
				expect(match.confidence).toBe("high");
			});

			it("should keep exact-date matches at medium confidence when multiple candidates exist", () => {
				const bankTxn: BankTransaction = {
					id: "b1",
					date: "2025-10-15",
					amount: -61500,
					payee: "CARD 8472 AUTH 5521",
					sourceRow: 2,
					raw: {
						date: "2025-10-15",
						amount: "-61.50",
						description: "CARD 8472 AUTH 5521",
					},
				};

				const ynabTxns: YNABTransaction[] = [
					{
						id: "y1",
						date: "2025-10-15",
						amount: -61500,
						payee: "Amazon",
						categoryName: "Shopping",
						cleared: "uncleared",
						approved: true,
					},
					{
						id: "y2",
						date: "2025-10-15",
						amount: -61500,
						payee: "Coffee Shop",
						categoryName: "Shopping",
						cleared: "cleared",
						approved: true,
					},
				];

				const match = findBestMatch(bankTxn, ynabTxns, new Set(), config);

				expect(match.confidenceScore).toBeGreaterThanOrEqual(65);
				expect(match.confidenceScore).toBeLessThan(config.autoMatchThreshold);
				expect(match.candidates?.length).toBeGreaterThan(1);
				expect(match.bestMatch?.scores.date).toBe(100);
				expect(match.confidence).toBe("medium");
			});

			it("should provide multiple candidates for medium confidence", () => {
				const bankTxn: BankTransaction = {
					id: "b1",
					date: "2025-10-15",
					amount: -50000,
					payee: "Restaurant",
					sourceRow: 2,
					raw: {
						date: "2025-10-15",
						amount: "-50.00",
						description: "Restaurant",
					},
				};

				const ynabTxns: YNABTransaction[] = [
					{
						id: "y1",
						date: "2025-10-15",
						amount: -50000,
						payee: "Italian Restaurant",
						categoryName: "Dining",
						cleared: "uncleared",
						approved: true,
					},
					{
						id: "y2",
						date: "2025-10-16",
						amount: -50000,
						payee: "Chinese Restaurant",
						categoryName: "Dining",
						cleared: "uncleared",
						approved: true,
					},
				];

				const match = findBestMatch(bankTxn, ynabTxns, new Set(), config);

				expect(match.candidates).toBeDefined();
				expect(match.candidates?.length).toBeGreaterThan(0);
				expect(match.candidates?.length).toBeLessThanOrEqual(3); // Top 3
			});
		});

		describe("low/no confidence matches", () => {
			it("should return no match when amount differs", () => {
				const bankTxn: BankTransaction = {
					id: "b1",
					date: "2025-10-15",
					amount: -45230,
					payee: "Shell",
					sourceRow: 2,
					raw: { date: "2025-10-15", amount: "-45.23", description: "Shell" },
				};

				const ynabTxns: YNABTransaction[] = [
					{
						id: "y1",
						date: "2025-10-15",
						amount: -100000, // Different amount
						payee: "Shell",
						categoryName: "Auto: Gas",
						cleared: "uncleared",
						approved: true,
					},
				];

				const match = findBestMatch(bankTxn, ynabTxns, new Set(), config);

				expect(match.confidence).toBe("none");
				expect(match.confidenceScore).toBe(0);
				expect(match.bestMatch).toBeNull();
			});

			it("should not match opposite-signed transactions", () => {
				const bankTxn: BankTransaction = {
					id: "b1",
					date: "2025-10-15",
					amount: 50000, // Positive (refund) in milliunits
					payee: "Amazon",
					sourceRow: 2,
					raw: { date: "2025-10-15", amount: "50.00", description: "Amazon" },
				};

				const ynabTxns: YNABTransaction[] = [
					{
						id: "y1",
						date: "2025-10-15",
						amount: -50000, // Negative (purchase)
						payee: "Amazon",
						categoryName: "Shopping",
						cleared: "uncleared",
						approved: true,
					},
				];

				const match = findBestMatch(bankTxn, ynabTxns, new Set(), config);

				expect(match.confidence).toBe("none");
				expect(match.bestMatch).toBeNull();
			});
		});

		describe("prioritization", () => {
			it("should prioritize uncleared transactions over cleared", () => {
				const bankTxn: BankTransaction = {
					id: "b1",
					date: "2025-10-15",
					amount: -50000,
					payee: "Coffee Shop",
					sourceRow: 2,
					raw: {
						date: "2025-10-15",
						amount: "-50.00",
						description: "Coffee Shop",
					},
				};

				const ynabTxns: YNABTransaction[] = [
					{
						id: "y1",
						date: "2025-10-15",
						amount: -50000,
						payee: "Coffee Shop",
						categoryName: "Dining",
						cleared: "cleared",
						approved: true,
					},
					{
						id: "y2",
						date: "2025-10-15",
						amount: -50000,
						payee: "Coffee Shop",
						categoryName: "Dining",
						cleared: "uncleared",
						approved: true,
					},
				];

				const match = findBestMatch(bankTxn, ynabTxns, new Set(), config);

				// Should prefer uncleared transaction
				expect(match.bestMatch?.ynabTransaction.id).toBe("y2");
			});

			it("should use date proximity as tiebreaker", () => {
				const bankTxn: BankTransaction = {
					id: "b1",
					date: "2025-10-15",
					amount: -50000,
					payee: "Store",
					sourceRow: 2,
					raw: { date: "2025-10-15", amount: "-50.00", description: "Store" },
				};

				const ynabTxns: YNABTransaction[] = [
					{
						id: "y1",
						date: "2025-10-13", // 2 days away
						amount: -50000,
						payee: "Store",
						categoryName: "Shopping",
						cleared: "uncleared",
						approved: true,
					},
					{
						id: "y2",
						date: "2025-10-14", // 1 day away
						amount: -50000,
						payee: "Store",
						categoryName: "Shopping",
						cleared: "uncleared",
						approved: true,
					},
				];

				const match = findBestMatch(bankTxn, ynabTxns, new Set(), config);

				// Should prefer closer date
				expect(match.bestMatch?.ynabTransaction.id).toBe("y2");
			});
		});

		describe("amount tolerance", () => {
			it("should match when amounts are equal", () => {
				const bankTxn: BankTransaction = {
					id: "b1",
					date: "2025-10-15",
					amount: -45230,
					payee: "Shell",
					sourceRow: 2,
					raw: { date: "2025-10-15", amount: "-45.23", description: "Shell" },
				};

				const ynabTxns: YNABTransaction[] = [
					{
						id: "y1",
						date: "2025-10-15",
						amount: -45230, // exact match
						payee: "Shell",
						categoryName: "Auto: Gas",
						cleared: "uncleared",
						approved: true,
					},
				];

				const match = findBestMatch(bankTxn, ynabTxns, new Set(), config);

				expect(match.confidence).not.toBe("none");
				expect(match.bestMatch?.ynabTransaction).toBeDefined();
			});

			it("should not match when amounts differ", () => {
				const bankTxn: BankTransaction = {
					id: "b1",
					date: "2025-10-15",
					amount: -45000,
					payee: "Shell",
					sourceRow: 2,
					raw: { date: "2025-10-15", amount: "-45.00", description: "Shell" },
				};

				const ynabTxns: YNABTransaction[] = [
					{
						id: "y1",
						date: "2025-10-15",
						amount: -45050, // different amount - no match
						payee: "Shell",
						categoryName: "Auto: Gas",
						cleared: "uncleared",
						approved: true,
					},
				];

				const match = findBestMatch(bankTxn, ynabTxns, new Set(), config);

				expect(match.confidence).toBe("none");
			});
		});

		describe("used IDs", () => {
			it("should skip already-used YNAB transaction IDs", () => {
				const bankTxn: BankTransaction = {
					id: "b1",
					date: "2025-10-15",
					amount: -50000,
					payee: "Store",
					sourceRow: 2,
					raw: { date: "2025-10-15", amount: "-50.00", description: "Store" },
				};

				const ynabTxns: YNABTransaction[] = [
					{
						id: "y1",
						date: "2025-10-15",
						amount: -50000,
						payee: "Store",
						categoryName: "Shopping",
						cleared: "uncleared",
						approved: true,
					},
				];

				const usedIds = new Set(["y1"]);
				const match = findBestMatch(bankTxn, ynabTxns, usedIds, config);

				expect(match.confidence).toBe("none");
				expect(match.bestMatch).toBeNull();
			});
		});
	});

	describe("findMatches", () => {
		it("should match multiple bank transactions", () => {
			const bankTxns: BankTransaction[] = [
				{
					id: "b1",
					date: "2025-10-15",
					amount: -45230,
					payee: "Shell",
					sourceRow: 2,
					raw: { date: "2025-10-15", amount: "-45.23", description: "Shell" },
				},
				{
					id: "b2",
					date: "2025-10-16",
					amount: -100000,
					payee: "Netflix",
					sourceRow: 3,
					raw: {
						date: "2025-10-16",
						amount: "-100.00",
						description: "Netflix",
					},
				},
			];

			const ynabTxns: YNABTransaction[] = [
				{
					id: "y1",
					date: "2025-10-15",
					amount: -45230,
					payee: "Shell Gas",
					categoryName: "Auto: Gas",
					cleared: "uncleared",
					approved: true,
				},
				{
					id: "y2",
					date: "2025-10-16",
					amount: -100000,
					payee: "Netflix",
					categoryName: "Entertainment",
					cleared: "uncleared",
					approved: true,
				},
			];

			const matches = findMatches(bankTxns, ynabTxns, config);

			expect(matches).toHaveLength(2);
			expect(matches[0].bankTransaction.id).toBe("b1");
			expect(matches[1].bankTransaction.id).toBe("b2");
		});

		it("should prevent duplicate matching of YNAB transactions", () => {
			const bankTxns: BankTransaction[] = [
				{
					id: "b1",
					date: "2025-10-15",
					amount: -50000,
					payee: "Store",
					sourceRow: 2,
					raw: { date: "2025-10-15", amount: "-50.00", description: "Store" },
				},
				{
					id: "b2",
					date: "2025-10-15",
					amount: -50000,
					payee: "Store",
					sourceRow: 3,
					raw: { date: "2025-10-15", amount: "-50.00", description: "Store" },
				},
			];

			const ynabTxns: YNABTransaction[] = [
				{
					id: "y1",
					date: "2025-10-15",
					amount: -50000,
					payee: "Store",
					categoryName: "Shopping",
					cleared: "uncleared",
					approved: true,
				},
			];

			const matches = findMatches(bankTxns, ynabTxns, config);

			expect(matches).toHaveLength(2);

			// First should match
			expect(matches[0].confidence).toBe("high");
			expect(matches[0].bestMatch?.ynabTransaction.id).toBe("y1");

			// Second should not match (y1 already used)
			expect(matches[1].confidence).toBe("none");
		});

		it("should handle mix of matched and unmatched transactions", () => {
			const bankTxns: BankTransaction[] = [
				{
					id: "b1",
					date: "2025-10-15",
					amount: -45230,
					payee: "Shell",
					sourceRow: 2,
					raw: { date: "2025-10-15", amount: "-45.23", description: "Shell" },
				},
				{
					id: "b2",
					date: "2025-10-16",
					amount: -15990,
					payee: "NewStore",
					sourceRow: 3,
					raw: {
						date: "2025-10-16",
						amount: "-15.99",
						description: "NewStore",
					},
				},
			];

			const ynabTxns: YNABTransaction[] = [
				{
					id: "y1",
					date: "2025-10-15",
					amount: -45230,
					payee: "Shell",
					categoryName: "Auto: Gas",
					cleared: "uncleared",
					approved: true,
				},
			];

			const matches = findMatches(bankTxns, ynabTxns, config);

			expect(matches).toHaveLength(2);
			expect(matches[0].confidence).toBe("high");
			expect(matches[1].confidence).toBe("none");
			expect(matches[1].bestMatch).toBeNull();
		});

		it("should use custom configuration", () => {
			const customConfig: MatchingConfig = {
				weights: {
					date: 0.15,
					payee: 0.35,
				},
				dateToleranceDays: 5,
				autoMatchThreshold: 85,
				suggestedMatchThreshold: 50,
				minimumCandidateScore: 40,
				exactDateBonus: 5,
				exactPayeeBonus: 10,
				exactDateAutoMatchThreshold: 65,
			};

			const bankTxns: BankTransaction[] = [
				{
					id: "b1",
					date: "2025-10-15",
					amount: -50000,
					payee: "Store",
					sourceRow: 2,
					raw: { date: "2025-10-15", amount: "-50.00", description: "Store" },
				},
			];

			const ynabTxns: YNABTransaction[] = [
				{
					id: "y1",
					date: "2025-10-11", // 4 days difference (within custom tolerance)
					amount: -50000, // exact amount match
					payee: "Store",
					categoryName: "Shopping",
					cleared: "uncleared",
					approved: true,
				},
			];

			const matches = findMatches(bankTxns, ynabTxns, customConfig);

			expect(matches[0].confidence).not.toBe("none");
		});
	});

	describe("edge cases", () => {
		it("should handle empty YNAB transactions list", () => {
			const bankTxn: BankTransaction = {
				id: "b1",
				date: "2025-10-15",
				amount: -50000,
				payee: "Store",
				sourceRow: 2,
				raw: { date: "2025-10-15", amount: "-50.00", description: "Store" },
			};

			const match = findBestMatch(bankTxn, [], new Set(), config);

			expect(match.confidence).toBe("none");
			expect(match.bestMatch).toBeNull();
		});

		it("should handle null payee names", () => {
			const bankTxn: BankTransaction = {
				id: "b1",
				date: "2025-10-15",
				amount: -50000,
				payee: "Store",
				sourceRow: 2,
				raw: { date: "2025-10-15", amount: "-50.00", description: "Store" },
			};

			const ynabTxns: YNABTransaction[] = [
				{
					id: "y1",
					date: "2025-10-15",
					amount: -50000,
					payee: null,
					categoryName: "Shopping",
					cleared: "uncleared",
					approved: true,
				},
			];

			const match = findBestMatch(bankTxn, ynabTxns, new Set(), config);

			// Should still match based on amount and date
			expect(match.confidence).not.toBe("none");
		});

		it("should handle very small amounts", () => {
			const bankTxn: BankTransaction = {
				id: "b1",
				date: "2025-10-15",
				amount: -10, // 1 cent in milliunits
				payee: "Micro Transaction",
				sourceRow: 2,
				raw: {
					date: "2025-10-15",
					amount: "-0.01",
					description: "Micro Transaction",
				},
			};

			const ynabTxns: YNABTransaction[] = [
				{
					id: "y1",
					date: "2025-10-15",
					amount: -10, // 1 cent in milliunits
					payee: "Micro Transaction",
					categoryName: "Misc",
					cleared: "uncleared",
					approved: true,
				},
			];

			const match = findBestMatch(bankTxn, ynabTxns, new Set(), config);
			expect(match.confidence).toBe("high");
		});

		it("should handle large amounts", () => {
			const bankTxn: BankTransaction = {
				id: "b1",
				date: "2025-10-15",
				amount: -10000000, // $10,000 in milliunits
				payee: "Large Purchase",
				sourceRow: 2,
				raw: {
					date: "2025-10-15",
					amount: "-10000.00",
					description: "Large Purchase",
				},
			};

			const ynabTxns: YNABTransaction[] = [
				{
					id: "y1",
					date: "2025-10-15",
					amount: -10000000, // $10,000 in milliunits
					payee: "Large Purchase",
					categoryName: "Shopping",
					cleared: "uncleared",
					approved: true,
				},
			];

			const match = findBestMatch(bankTxn, ynabTxns, new Set(), config);

			expect(match.confidence).toBe("high");
		});
	});
});
