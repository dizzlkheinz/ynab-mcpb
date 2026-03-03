import { describe, expect, it } from "vitest";
import { resolveCsvPathCandidates } from "../csvFilePath.js";

describe("resolveCsvPathCandidates", () => {
	it("always includes the original path first", () => {
		const candidates = resolveCsvPathCandidates("/tmp/statement.csv", "linux");
		expect(candidates[0]).toBe("/tmp/statement.csv");
	});

	it("maps /mnt/<drive>/... paths to Windows drive paths on win32", () => {
		const candidates = resolveCsvPathCandidates(
			"/mnt/c/Users/test/statement.csv",
			"win32",
		);

		expect(candidates).toContain("/mnt/c/Users/test/statement.csv");
		expect(candidates).toContain("C:\\Users\\test\\statement.csv");
	});

	it("maps /<drive>/... paths to Windows drive paths on win32", () => {
		const candidates = resolveCsvPathCandidates(
			"/c/Users/test/statement.csv",
			"win32",
		);

		expect(candidates).toContain("/c/Users/test/statement.csv");
		expect(candidates).toContain("C:\\Users\\test\\statement.csv");
	});

	it("does not generate bogus drive mappings for non-drive /mnt paths", () => {
		const candidates = resolveCsvPathCandidates(
			"/mnt/user-data/uploads/statement.csv",
			"win32",
		);

		expect(candidates).toEqual(["/mnt/user-data/uploads/statement.csv"]);
	});

	it("maps Windows drive paths to /mnt/<drive>/... on non-Windows platforms", () => {
		const candidates = resolveCsvPathCandidates(
			"C:\\Users\\test\\statement.csv",
			"linux",
		);

		expect(candidates).toContain("C:\\Users\\test\\statement.csv");
		expect(candidates).toContain("/mnt/c/Users/test/statement.csv");
	});
});
