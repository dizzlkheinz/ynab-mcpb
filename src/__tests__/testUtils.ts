/**
 * Shared test utilities.
 */

import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { expect } from "vitest";
import type { YNABMCPServer } from "../server/YNABMCPServer.js";

export async function executeToolCall(
	server: YNABMCPServer,
	toolName: string,
	args: Record<string, unknown> = {},
): Promise<CallToolResult> {
	return await server.getToolRegistry().executeTool({
		name: toolName,
		arguments: args,
	});
}

export async function executeConfirmedToolCall(
	server: YNABMCPServer,
	toolName: string,
	args: Record<string, unknown> = {},
): Promise<CallToolResult> {
	const preview = await executeToolCall(server, toolName, args);
	const text = preview.content
		.filter((item) => item.type === "text")
		.map((item) => item.text)
		.join("\n");
	const match = text.match(/confirmation_token="([^"]+)"/);
	const confirmationToken = match?.[1];
	if (!confirmationToken) {
		throw new Error(
			`Preview for ${toolName} did not return a confirmation token`,
		);
	}

	return await executeToolCall(server, toolName, {
		...args,
		confirmation_token: confirmationToken,
	});
}

export function validateToolResult(result: CallToolResult): void {
	expect(result).toBeDefined();
	expect(result.content).toBeDefined();
	expect(Array.isArray(result.content)).toBe(true);
	expect(result.content.length).toBeGreaterThan(0);

	for (const content of result.content) {
		if (content.type === "text") {
			expect(typeof content.text).toBe("string");
		}
	}
}

export function textOf(item: object | undefined): string {
	if (item && "text" in item && typeof item.text === "string") {
		return item.text;
	}
	throw new Error(
		`Expected a text content item, got ${JSON.stringify(item) ?? "undefined"}`,
	);
}

export function maybeTextOf(item: object | undefined): string | undefined {
	return item && "text" in item && typeof item.text === "string"
		? item.text
		: undefined;
}

export function parseToolResult<T = unknown>(result: CallToolResult): T {
	validateToolResult(result);
	const content = result.content[0];
	if (content?.type !== "text") {
		throw new Error("No text content in tool result");
	}
	return JSON.parse(content.text) as T;
}

export async function waitFor(
	condition: () => boolean | Promise<boolean>,
	timeout = 5000,
	interval = 100,
): Promise<void> {
	const start = Date.now();
	while (Date.now() - start < timeout) {
		if (await condition()) {
			return;
		}
		await new Promise((resolve) => setTimeout(resolve, interval));
	}
	throw new Error(`Condition not met within ${timeout}ms`);
}
