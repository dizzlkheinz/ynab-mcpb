import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type * as ynab from "ynab";
import { z } from "zod/v4";
import type { ErrorHandler } from "../server/errorHandler.js";
import { formatUserInfo } from "../server/markdownFormatter.js";
import { responseFormatter } from "../server/responseFormatter.js";
import { withToolErrorHandling } from "../types/index.js";
import type { ToolFactory } from "../types/toolRegistration.js";
import { createAdapters } from "./adapters.js";
import { GetUserOutputSchema } from "./schemas/outputs/index.js";

/**
 * Schema for ynab:get_user tool parameters
 */
export const GetUserSchema = z
	.object({
		response_format: z
			.enum(["json", "markdown"])
			.default("markdown")
			.optional(),
	})
	.strict();

export type GetUserParams = z.infer<typeof GetUserSchema>;

import { ToolAnnotationPresets } from "./toolCategories.js";

/**
 * Handles the ynab:get_user tool call
 * Gets information about the authenticated user
 */
export async function handleGetUser(
	ynabAPI: ynab.API,
	params: GetUserParams,
	errorHandler?: ErrorHandler,
): Promise<CallToolResult> {
	return await withToolErrorHandling(
		async () => {
			const response = await ynabAPI.user.getUser();
			const userInfo = response.data.user;

			const fmt = params.response_format ?? "markdown";
			const dataObject = {
				user: {
					id: userInfo.id,
				},
			};

			return {
				content: [
					{
						type: "text",
						text:
							fmt === "markdown"
								? formatUserInfo(dataObject)
								: responseFormatter.format(dataObject),
					},
				],
				structuredContent: dataObject,
			};
		},
		"ynab:get_user",
		"getting user information",
		errorHandler,
	);
}

/**
 * Registers utility tools (get_user) using the shared factory pattern.
 *
 * Note: convert_amount was removed because all tool responses already return
 * amounts in dollars (converted from YNAB milliunits internally).
 */
export const registerUtilityTools: ToolFactory = (registry, context) => {
	const { adapt } = createAdapters(context);

	registry.register({
		name: "ynab_get_user",
		description: `Get information about the authenticated YNAB user.

Args:
  - response_format (string, optional): "json" or "markdown" (default: "markdown").

Returns: user (id)

Errors:
  - "UNAUTHORIZED" → YNAB token expired or invalid`,
		inputSchema: GetUserSchema,
		outputSchema: GetUserOutputSchema,
		handler: adapt(handleGetUser),
		metadata: {
			annotations: {
				...ToolAnnotationPresets.READ_ONLY_EXTERNAL,
				title: "YNAB: Get User Information",
			},
		},
	});
};
