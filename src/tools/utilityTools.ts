import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import * as ynab from 'ynab';
import { z } from 'zod/v4';
import { responseFormatter } from '../server/responseFormatter.js';
import { withToolErrorHandling } from '../types/index.js';
import { createAdapters } from './adapters.js';
import { emptyObjectSchema } from './schemas/common.js';
import { ToolAnnotationPresets } from './toolCategories.js';
import type { ToolFactory } from '../types/toolRegistration.js';

/**
 * Schema for ynab:convert_amount tool parameters
 */
export const ConvertAmountSchema = z
  .object({
    amount: z.number().finite(),
    to_milliunits: z.boolean(),
  })
  .strict();

export type ConvertAmountParams = z.infer<typeof ConvertAmountSchema>;

/**
 * Handles the ynab:get_user tool call
 * Gets information about the authenticated user
 */
export async function handleGetUser(ynabAPI: ynab.API): Promise<CallToolResult> {
  return await withToolErrorHandling(
    async () => {
      const response = await ynabAPI.user.getUser();
      const userInfo = response.data.user;

      const user = {
        id: userInfo.id,
      };

      return {
        content: [
          {
            type: 'text',
            text: responseFormatter.format({ user }),
          },
        ],
      };
    },
    'ynab:get_user',
    'getting user information',
  );
}

/**
 * Handles the ynab:convert_amount tool call
 * Converts between dollars and milliunits with integer arithmetic for precision
 */
export async function handleConvertAmount(
  _ynabAPI: ynab.API,
  params: ConvertAmountParams,
): Promise<CallToolResult> {
  return await withToolErrorHandling(
    async () => {
      const { amount, to_milliunits } = params;

      let result: number;
      let description: string;

      if (to_milliunits) {
        // Convert from dollars to milliunits
        // Use integer arithmetic to avoid floating-point precision issues
        result = Math.round(amount * 1000);
        description = `$${amount.toFixed(2)} = ${result} milliunits`;
      } else {
        // Convert from milliunits to dollars
        // Assume input amount is in milliunits
        result = amount / 1000;
        description = `${amount} milliunits = $${result.toFixed(2)}`;
      }

      return {
        content: [
          {
            type: 'text',
            text: responseFormatter.format({
              conversion: {
                original_amount: amount,
                converted_amount: result,
                to_milliunits,
                description,
              },
            }),
          },
        ],
      };
    },
    'ynab:convert_amount',
    'converting amount',
  );
}

/**
 * Registers utility tools (get_user, convert_amount) using the shared factory pattern.
 */
export const registerUtilityTools: ToolFactory = (registry, context) => {
  const { adapt, adaptNoInput } = createAdapters(context);

  registry.register({
    name: 'get_user',
    description: 'Get information about the authenticated user',
    inputSchema: emptyObjectSchema,
    handler: adaptNoInput(handleGetUser),
    metadata: {
      annotations: {
        ...ToolAnnotationPresets.READ_ONLY_EXTERNAL,
        title: 'YNAB: Get User Information',
      },
    },
  });

  registry.register({
    name: 'convert_amount',
    description: 'Convert between dollars and milliunits with integer arithmetic for precision',
    inputSchema: ConvertAmountSchema,
    handler: adapt(handleConvertAmount),
    metadata: {
      annotations: {
        ...ToolAnnotationPresets.UTILITY_LOCAL,
        title: 'YNAB: Convert Amount',
      },
    },
  });
};
