import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import * as ynab from 'ynab';
import { responseFormatter } from '../server/responseFormatter.js';
import { withToolErrorHandling } from '../types/index.js';
import { createAdapters } from './adapters.js';
import { emptyObjectSchema } from './schemas/common.js';
import { ToolAnnotationPresets } from './toolCategories.js';
import type { ToolFactory } from '../types/toolRegistration.js';

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
 * Registers utility tools (get_user) using the shared factory pattern.
 *
 * Note: convert_amount was removed because all tool responses already return
 * amounts in dollars (converted from YNAB milliunits internally).
 */
export const registerUtilityTools: ToolFactory = (registry, context) => {
  const { adaptNoInput } = createAdapters(context);

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
};
