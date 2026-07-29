import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod/v4";
import {
	canonicalJson,
	DEFAULT_WRITE_MODE,
	WriteSafetyPolicy,
} from "../writeSafety.js";
import {
	ToolRegistry,
	type ToolRegistryDependencies,
} from "../toolRegistry.js";

const FIXED_TOKEN = "fixed-confirmation-token-123";

function result(value: Record<string, unknown>): CallToolResult {
	return {
		content: [{ type: "text", text: JSON.stringify(value) }],
		structuredContent: value,
	};
}

function createDependencies(
	policy: WriteSafetyPolicy,
): ToolRegistryDependencies {
	const errorHandler = {
		createValidationError: vi.fn((message: string, details?: string) => ({
			isError: true,
			content: [
				{ type: "text" as const, text: `${message}: ${details ?? ""}` },
			],
		})),
		handleError: vi.fn((error: unknown, context: string) => ({
			isError: true,
			content: [
				{
					type: "text" as const,
					text: `${context}: ${error instanceof Error ? error.message : String(error)}`,
				},
			],
		})),
	};

	return {
		errorHandler,
		responseFormatter: { format: (value) => JSON.stringify(value) },
		writeSafetyPolicy: policy,
		withSecurityWrapper:
			<T extends Record<string, unknown>>(
				_namespace: string,
				_operation: string,
				schema: z.ZodSchema<T>,
			) =>
			(_accessToken: string) =>
			(params: Record<string, unknown>) =>
			async (handler: (validated: T) => Promise<CallToolResult>) =>
				handler(schema.parse(params)),
	};
}

function registerMutation(
	registry: ToolRegistry,
	name: string,
	handler = vi.fn(async ({ input }: { input: Record<string, unknown> }) =>
		result({ received: input }),
	),
) {
	registry.register({
		name,
		description: "Protected mutation",
		inputSchema: z
			.object({
				id: z.string(),
				amount: z.number().optional(),
				dry_run: z.boolean().optional(),
			})
			.strict(),
		handler,
		metadata: {
			writeSafety: { mutation: true, preview: "dry-run" },
			annotations: { readOnlyHint: false },
		},
	});
	return handler;
}

function confirmationToken(response: CallToolResult): string {
	const text = response.content
		.filter((item) => item.type === "text")
		.map((item) => item.text)
		.join("\n");
	const match = text.match(/confirmation_token="([^"]+)"/);
	if (!match?.[1]) {
		throw new Error("Preview did not return a confirmation token");
	}
	return match[1];
}

describe("WriteSafetyPolicy", () => {
	it("uses preview as the conservative default", () => {
		expect(DEFAULT_WRITE_MODE).toBe("preview");
		expect(new WriteSafetyPolicy().mode).toBe("preview");
	});

	it("canonicalizes object keys while preserving array order", () => {
		expect(canonicalJson({ b: 2, a: [{ z: 1, y: 2 }] })).toBe(
			'{"a":[{"y":2,"z":1}],"b":2}',
		);
		expect(canonicalJson({ value: -0 })).toBe('{"value":0}');
	});

	it("binds tokens to tool name and validated arguments", () => {
		const policy = new WriteSafetyPolicy({ tokenFactory: () => FIXED_TOKEN });
		const issued = policy.issue("ynab_create_transaction", { amount: 12.5 });
		expect(issued.token).toBe(FIXED_TOKEN);
		expect(
			policy.consume(FIXED_TOKEN, "ynab_delete_transaction", {
				amount: 12.5,
			}),
		).toEqual({ ok: false, reason: "invalid" });
	});

	it("rejects expiry and token reuse", () => {
		let now = 1_000;
		const tokens = ["confirmation-token-one", "confirmation-token-two"];
		const policy = new WriteSafetyPolicy({
			ttlMs: 100,
			now: () => now,
			tokenFactory: () => tokens.shift() ?? "unused-token-value",
		});

		policy.issue("tool", { id: "one" });
		now = 1_101;
		expect(
			policy.consume("confirmation-token-one", "tool", { id: "one" }),
		).toEqual({ ok: false, reason: "expired" });

		now = 2_000;
		policy.issue("tool", { id: "two" });
		expect(
			policy.consume("confirmation-token-two", "tool", { id: "two" }),
		).toEqual({ ok: true });
		expect(
			policy.consume("confirmation-token-two", "tool", { id: "two" }),
		).toEqual({ ok: false, reason: "reused" });
	});
});

describe("ToolRegistry write safety enforcement", () => {
	it("does not register mutations in read-only mode", () => {
		const registry = new ToolRegistry(
			createDependencies(new WriteSafetyPolicy({ mode: "read-only" })),
		);
		registerMutation(registry, "ynab_delete_transaction");
		expect(registry.hasTool("ynab_delete_transaction")).toBe(false);
	});

	it("preserves direct mutation behavior in enabled mode", async () => {
		const registry = new ToolRegistry(
			createDependencies(new WriteSafetyPolicy({ mode: "enabled" })),
		);
		const handler = registerMutation(registry, "ynab_update_transaction");
		await registry.executeTool({
			name: "ynab_update_transaction",
			accessToken: "token",
			arguments: { id: "txn-1", amount: 10 },
		});
		expect(handler).toHaveBeenCalledWith(
			expect.objectContaining({
				input: { id: "txn-1", amount: 10 },
			}),
		);
	});

	it("previews, confirms the identical request once, and rejects reuse", async () => {
		const policy = new WriteSafetyPolicy({ tokenFactory: () => FIXED_TOKEN });
		const registry = new ToolRegistry(createDependencies(policy));
		const handler = registerMutation(registry, "ynab_create_transaction");

		const listed = registry.listTools()[0];
		expect(listed?.inputSchema.properties).toHaveProperty("confirmation_token");
		expect(listed?.description).toContain("call without confirmation_token");

		const preview = await registry.executeTool({
			name: "ynab_create_transaction",
			accessToken: "token",
			arguments: { id: "txn-1", amount: 10, dry_run: true },
		});
		expect(handler).toHaveBeenLastCalledWith(
			expect.objectContaining({
				input: { id: "txn-1", amount: 10, dry_run: true },
			}),
		);

		const confirmed = await registry.executeTool({
			name: "ynab_create_transaction",
			accessToken: "token",
			arguments: {
				id: "txn-1",
				amount: 10,
				dry_run: true,
				confirmation_token: confirmationToken(preview),
			},
		});
		expect(confirmed.isError).not.toBe(true);
		expect(handler).toHaveBeenLastCalledWith(
			expect.objectContaining({
				input: { id: "txn-1", amount: 10, dry_run: false },
			}),
		);

		const reused = await registry.executeTool({
			name: "ynab_create_transaction",
			accessToken: "token",
			arguments: {
				id: "txn-1",
				amount: 10,
				confirmation_token: FIXED_TOKEN,
			},
		});
		expect(reused.isError).toBe(true);
		expect(handler).toHaveBeenCalledTimes(2);
	});

	it("rejects altered arguments and consumes the token", async () => {
		const registry = new ToolRegistry(
			createDependencies(
				new WriteSafetyPolicy({ tokenFactory: () => FIXED_TOKEN }),
			),
		);
		const handler = registerMutation(registry, "ynab_update_transactions");
		const preview = await registry.executeTool({
			name: "ynab_update_transactions",
			accessToken: "token",
			arguments: { id: "batch-1", amount: 10 },
		});

		const altered = await registry.executeTool({
			name: "ynab_update_transactions",
			accessToken: "token",
			arguments: {
				id: "batch-1",
				amount: 11,
				confirmation_token: confirmationToken(preview),
			},
		});
		expect(altered.isError).toBe(true);
		expect(handler).toHaveBeenCalledTimes(1);
	});

	it.each(["ynab_create_transactions", "ynab_delete_transaction"])(
		"forces dry-run preview for protected bulk/deletion tool %s",
		async (name) => {
			const registry = new ToolRegistry(
				createDependencies(new WriteSafetyPolicy({ mode: "preview" })),
			);
			const handler = registerMutation(registry, name);
			await registry.executeTool({
				name,
				accessToken: "token",
				arguments: { id: "target" },
			});
			expect(handler).toHaveBeenCalledWith(
				expect.objectContaining({
					input: expect.objectContaining({ dry_run: true }),
				}),
			);
		},
	);

	it("rejects protected registrations that cannot preview", () => {
		const registry = new ToolRegistry(
			createDependencies(new WriteSafetyPolicy({ mode: "preview" })),
		);
		expect(() =>
			registry.register({
				name: "unsafe_mutation",
				description: "Missing dry run",
				inputSchema: z.object({ id: z.string() }).strict(),
				handler: async () => result({ ok: true }),
				metadata: {
					writeSafety: { mutation: true, preview: "dry-run" },
				},
			}),
		).toThrow("must expose dry_run");
	});
});
