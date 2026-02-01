import { beforeAll, describe, expect, it } from "vitest";
import * as ynab from "ynab";
import { skipOnRateLimit } from "../../__tests__/testUtils.js";
import { handleGetUser } from "../utilityTools.js";

/**
 * Utility Tools Integration Tests
 * Skips if YNAB_ACCESS_TOKEN is not set or if SKIP_E2E_TESTS is true
 */
const hasToken = !!process.env.YNAB_ACCESS_TOKEN;
const shouldSkip = process.env.SKIP_E2E_TESTS === "true" || !hasToken;
const describeIntegration = shouldSkip ? describe.skip : describe;

describeIntegration("Utility Tools Integration Tests", () => {
	let ynabAPI: ynab.API;

	beforeAll(() => {
		const accessToken = process.env.YNAB_ACCESS_TOKEN!;
		ynabAPI = new ynab.API(accessToken);
	});

	describe("handleGetUser", () => {
		it(
			"should retrieve user information from YNAB API",
			{ meta: { tier: "core", domain: "utility" } },
			async (ctx) => {
				await skipOnRateLimit(async () => {
					const result = await handleGetUser(ynabAPI);
					const response = JSON.parse(result.content[0].text);

					// If response contains an error, throw it so skipOnRateLimit can catch it
					if (response.error) {
						throw new Error(JSON.stringify(response.error));
					}

					expect(response).toHaveProperty("user");
					expect(response.user).toHaveProperty("id");
					expect(typeof response.user.id).toBe("string");
					expect(response.user.id.length).toBeGreaterThan(0);
				}, ctx);
			},
		);
	});
});
