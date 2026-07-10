import { describe, expect, it } from "vitest";
import { parseCSV, SAFE_DELIMITERS } from "../csvParser.js";

describe("csvParser bank-export branches", () => {
	it("accepts every declared delimiter and rejects arbitrary delimiters", () => {
		expect(SAFE_DELIMITERS).toEqual([",", ";", "\t", "|", " "]);
		expect(() =>
			parseCSV("Date^Description^Amount", { delimiter: "^" }),
		).toThrow("Unsafe delimiter");
		const semicolon = parseCSV(
			"Date;Description;Amount\n2026-07-01;Coffee;-4.25",
			{ delimiter: ";" },
		);
		expect(semicolon.transactions[0]?.amount).toBe(-4250);
	});

	it("reports PapaParse failures without discarding valid metadata", () => {
		const result = parseCSV(
			'Date,Description,Amount\n2026-07-01,"unterminated,-4.25',
		);
		expect(result.errors.some((error) => error.field === "csv")).toBe(true);
		expect(result.meta.detectedColumns).toContain("Date");
	});

	it.each([
		["When,Memo\n2026-07-01,Coffee", "date"],
		["Date,Memo\n2026-07-01,Coffee", "amount"],
	] as const)("reports missing required columns", (content, field) => {
		const result = parseCSV(content);
		expect(result.errors.some((error) => error.field === field)).toBe(true);
		expect(result.transactions).toHaveLength(0);
	});

	it("reports a partially resolved debit and credit pair", () => {
		const result = parseCSV("Date,Debit,Memo\n2026-07-01,4.25,Coffee", {
			columns: {
				date: "Date",
				debit: "Debit",
				credit: "Credit",
				description: "Memo",
			},
		});
		expect(result.errors[0]?.message).toContain(
			"Found debit but missing credit",
		);
	});

	it("uses explicit manual columns and amount inversion", () => {
		const result = parseCSV("When|Narrative|Value\n2026-07-01|Coffee|$4.25", {
			delimiter: "|",
			invertAmounts: true,
			columns: {
				date: "When",
				amount: "Value",
				description: "Narrative",
			},
		});
		expect(result.transactions[0]).toMatchObject({
			date: "2026-07-01",
			amount: -4250,
			payee: "Coffee",
		});
	});

	it("detects an RBC header and applies split debit/credit signs", () => {
		const result = parseCSV(
			[
				"Transaction Date,Description 1,Debit,Credit",
				"2026-07-01,Coffee,4.25,",
				"2026-07-02,Refund,,2.50",
			].join("\n"),
		);
		expect(result.transactions.map(({ amount }) => amount)).toEqual([
			-4250, 2500,
		]);
	});

	it("detects RBC through the account-type header variant", () => {
		const result = parseCSV(
			"Date,Account Type,Description,Debit,Credit\n2026-07-01,Chequing,Coffee,4.25,",
		);
		expect(result.transactions[0]?.amount).toBe(-4250);
	});

	it("detects TD through a CAD amount header", () => {
		const result = parseCSV("Date,Description,CAD$\n2026-07-01,Coffee,-4.25", {
			header: true,
		});
		expect(result.transactions[0]?.amount).toBe(-4250);
	});

	it("supports an explicitly selected headerless TD preset", () => {
		const result = parseCSV("07/01/2026,Coffee,4.25,,100.00", {
			preset: "td",
		});
		expect(result.meta.detectedColumns).toEqual(["0", "1", "2", "3", "4"]);
		expect(result.transactions[0]).toMatchObject({
			date: "2026-07-01",
			amount: -4250,
			payee: "Coffee",
		});
	});

	it("does not misclassify nonnumeric headerless rows as TD", () => {
		const result = parseCSV(
			"07/01/2026,Coffee,not-money,also-not-money\nnot-a-date,Other,1.00,",
			{ header: false },
		);
		expect(result.transactions).toHaveLength(0);
		expect(result.errors.length).toBeGreaterThan(0);
	});

	it.each([
		["2026/07/03", "YMD", "2026-07-03"],
		["07/04/26", "MDY", "2026-07-04"],
		["05/07/26", "DMY", "2026-07-05"],
	] as const)("parses %s using %s", (rawDate, dateFormat, expected) => {
		const result = parseCSV(`Date,Description,Amount\n${rawDate},Test,1`, {
			dateFormat,
		});
		expect(result.transactions[0]?.date).toBe(expected);
	});

	it("falls back to natural-language dates and rejects impossible dates", () => {
		const natural = parseCSV('Date,Description,Amount\n"July 8 2026",Coffee,1');
		expect(natural.transactions[0]?.date).toBe("2026-07-08");

		const impossible = parseCSV(
			"Date,Description,Amount\n99/99/2026,Coffee,1",
			{ dateFormat: "MDY" },
		);
		expect(impossible.errors[0]).toMatchObject({ field: "date" });
	});

	it.each([
		["(1,234.56)", -1234560],
		["1.234,56 EUR", 1234560],
		["CAD 1,234", 1234000],
		["£2.50", 2500],
	] as const)("parses currency amount %s", (amount, expected) => {
		const result = parseCSV(
			`Date,Description,Amount\n2026-07-01,Test,"${amount}"`,
		);
		expect(result.transactions[0]?.amount).toBe(expected);
	});

	it.each(["", "not-money"])("rejects invalid amount %j", (amount) => {
		const result = parseCSV(
			`Date,Description,Amount\n2026-07-01,Test,${amount}`,
		);
		expect(result.errors.some((error) => error.field === "amount")).toBe(true);
	});

	it("rejects invalid debit and credit values independently", () => {
		const badDebit = parseCSV(
			"Transaction Date,Description 1,Debit,Credit\n2026-07-01,Coffee,nope,",
		);
		expect(badDebit.errors[0]?.rawValue).toBe("nope");

		const badCredit = parseCSV(
			"Transaction Date,Description 1,Debit,Credit\n2026-07-01,Refund,,nope",
		);
		expect(badCredit.errors[0]?.rawValue).toBe("nope");
	});

	it("warns for ambiguous and negative debit values", () => {
		const result = parseCSV(
			[
				"Transaction Date,Description 1,Debit,Credit",
				"2026-07-01,Ambiguous,4.25,2.00",
				"2026-07-02,Negative debit,-3.00,",
			].join("\n"),
		);
		expect(result.transactions[0]?.warnings?.[0]).toContain("Both Debit");
		expect(result.transactions[1]?.warnings?.[0]).toContain(
			"contains negative value",
		);
		expect(result.warnings).toHaveLength(2);
	});

	it("reports rows with neither debit nor credit", () => {
		const result = parseCSV(
			"Transaction Date,Description 1,Debit,Credit\n2026-07-01,Empty,,",
		);
		expect(result.errors[0]?.message).toBe("Missing debit/credit amount");
	});

	it("uses Unknown and strips dangerous Unicode when description is absent", () => {
		const missing = parseCSV("Date,Description,Amount\n2026-07-01,,1");
		expect(missing.transactions[0]?.payee).toBe("Unknown");

		const unsafe = parseCSV(
			"Date,Description,Amount\n2026-07-01,A\u202EB\u200BC\u2028D,1",
		);
		expect(unsafe.transactions[0]?.payee).toBe("ABCD");
	});

	it("honors a zero row limit", () => {
		const result = parseCSV("Date,Description,Amount\n2026-07-01,Coffee,1", {
			maxRows: 0,
		});
		expect(result.transactions).toHaveLength(0);
	});
});
