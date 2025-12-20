/**
 * Resources module for YNAB MCP Server
 *
 * Handles MCP resource definitions, templates, and handlers.
 * Extracted from YNABMCPServer to provide focused, testable resource management.
 */

import type * as ynab from 'ynab';
import {
  ResourceTemplate as MCPResourceTemplate,
  Resource as MCPResource,
  ResourceContents,
  ErrorCode,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import { CacheManager, CACHE_TTLS } from './cacheManager.js';

/**
 * Response formatter interface to avoid direct dependency on concrete implementation
 */
interface ResponseFormatter {
  format(data: unknown): string;
}

/**
 * Resource handler function signature
 */
export type ResourceHandler = (
  uri: string,
  dependencies: ResourceDependencies,
) => Promise<ResourceContents[]>;

/**
 * Template handler function signature
 */
export type TemplateHandler = (
  uri: string,
  params: Record<string, string>,
  dependencies: ResourceDependencies,
) => Promise<ResourceContents[]>;

/**
 * Resource definition structure
 */
export interface ResourceDefinition {
  uri: string;
  name: string;
  description: string;
  mimeType: string;
}

/**
 * Resource Template definition structure
 */
export interface ResourceTemplateDefinition extends MCPResourceTemplate {
  handler: TemplateHandler;
}

/**
 * Injectable dependencies for resource handlers
 */
export interface ResourceDependencies {
  ynabAPI: ynab.API;
  responseFormatter: ResponseFormatter;
  cacheManager: CacheManager;
}

/**
 * Default resource handlers
 */
const defaultResourceHandlers: Record<string, ResourceHandler> = {
  'ynab://budgets': async (uri, { ynabAPI, responseFormatter, cacheManager }) => {
    const cacheKey = CacheManager.generateKey('resources', 'budgets', 'list');
    return cacheManager.wrap<ResourceContents[]>(cacheKey, {
      ttl: CACHE_TTLS.BUDGETS,
      loader: async () => {
        try {
          const response = await ynabAPI.budgets.getBudgets();
          const budgets = response.data.budgets.map((budget) => ({
            id: budget.id,
            name: budget.name,
            last_modified_on: budget.last_modified_on,
            first_month: budget.first_month,
            last_month: budget.last_month,
            currency_format: budget.currency_format,
          }));

          return [
            {
              uri: uri,
              mimeType: 'application/json',
              text: responseFormatter.format({ budgets }),
            },
          ];
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          throw new Error(`Failed to fetch budgets: ${message}`);
        }
      },
    });
  },

  'ynab://user': async (uri, { ynabAPI, responseFormatter, cacheManager }) => {
    const cacheKey = CacheManager.generateKey('resources', 'user');
    return cacheManager.wrap<ResourceContents[]>(cacheKey, {
      ttl: CACHE_TTLS.USER_INFO,
      loader: async () => {
        try {
          const response = await ynabAPI.user.getUser();
          const userInfo = response.data.user;
          const user = {
            id: userInfo.id,
          };

          return [
            {
              uri: uri,
              mimeType: 'application/json',
              text: responseFormatter.format({ user }),
            },
          ];
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          throw new Error(`Failed to fetch user info: ${message}`);
        }
      },
    });
  },
};

/**
 * Default resource definitions
 */
const defaultResourceDefinitions: ResourceDefinition[] = [
  {
    uri: 'ynab://budgets',
    name: 'YNAB Budgets',
    description: 'List of all available budgets',
    mimeType: 'application/json',
  },
  {
    uri: 'ynab://user',
    name: 'YNAB User Info',
    description: 'Current user information including ID and email address',
    mimeType: 'application/json',
  },
];

/**
 * Default resource templates
 */
const defaultResourceTemplates: ResourceTemplateDefinition[] = [
  {
    uriTemplate: 'ynab://budgets/{budget_id}',
    name: 'Budget Details',
    description: 'Detailed information for a specific budget',
    mimeType: 'application/json',
    handler: async (uri, params, { ynabAPI, responseFormatter, cacheManager }) => {
      const budget_id = params['budget_id'];
      if (!budget_id) {
        throw new McpError(ErrorCode.InvalidParams, 'Missing budget_id parameter');
      }
      const cacheKey = CacheManager.generateKey('resources', 'budgets', 'get', budget_id);
      return cacheManager.wrap<ResourceContents[]>(cacheKey, {
        ttl: CACHE_TTLS.BUDGETS,
        loader: async () => {
          try {
            const response = await ynabAPI.budgets.getBudgetById(budget_id);
            return [
              {
                uri,
                mimeType: 'application/json',
                text: responseFormatter.format(response.data.budget),
              },
            ];
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            throw new Error(`Failed to fetch budget ${budget_id}: ${message}`);
          }
        },
      });
    },
  },
  {
    uriTemplate: 'ynab://budgets/{budget_id}/accounts',
    name: 'Budget Accounts',
    description: 'List of accounts for a specific budget',
    mimeType: 'application/json',
    handler: async (uri, params, { ynabAPI, responseFormatter, cacheManager }) => {
      const budget_id = params['budget_id'];
      if (!budget_id) {
        throw new McpError(ErrorCode.InvalidParams, 'Missing budget_id parameter');
      }
      const cacheKey = CacheManager.generateKey('resources', 'accounts', 'list', budget_id);
      return cacheManager.wrap<ResourceContents[]>(cacheKey, {
        ttl: CACHE_TTLS.ACCOUNTS,
        loader: async () => {
          try {
            const response = await ynabAPI.accounts.getAccounts(budget_id);
            return [
              {
                uri,
                mimeType: 'application/json',
                text: responseFormatter.format(response.data.accounts),
              },
            ];
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            throw new Error(`Failed to fetch accounts for budget ${budget_id}: ${message}`);
          }
        },
      });
    },
  },
  {
    uriTemplate: 'ynab://budgets/{budget_id}/accounts/{account_id}',
    name: 'Account Details',
    description: 'Detailed information for a specific account within a budget',
    mimeType: 'application/json',
    handler: async (uri, params, { ynabAPI, responseFormatter, cacheManager }) => {
      const budget_id = params['budget_id'];
      const account_id = params['account_id'];
      if (!budget_id) {
        throw new McpError(ErrorCode.InvalidParams, 'Missing budget_id parameter');
      }
      if (!account_id) {
        throw new McpError(ErrorCode.InvalidParams, 'Missing account_id parameter');
      }
      const cacheKey = CacheManager.generateKey(
        'resources',
        'accounts',
        'get',
        budget_id,
        account_id,
      );
      return cacheManager.wrap<ResourceContents[]>(cacheKey, {
        ttl: CACHE_TTLS.ACCOUNTS,
        loader: async () => {
          try {
            const response = await ynabAPI.accounts.getAccountById(budget_id, account_id);
            return [
              {
                uri,
                mimeType: 'application/json',
                text: responseFormatter.format(response.data.account),
              },
            ];
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            throw new Error(
              `Failed to fetch account ${account_id} in budget ${budget_id}: ${message}`,
            );
          }
        },
      });
    },
  },
];

/**
 * ResourceManager class that handles resource registration and request handling
 */
export class ResourceManager {
  private dependencies: ResourceDependencies;
  private resourceHandlers: Record<string, ResourceHandler>;
  private resourceDefinitions: ResourceDefinition[];
  private resourceTemplates: ResourceTemplateDefinition[];

  constructor(dependencies: ResourceDependencies) {
    this.dependencies = dependencies;
    this.resourceHandlers = { ...defaultResourceHandlers };
    this.resourceDefinitions = [...defaultResourceDefinitions];
    this.resourceTemplates = [];
    defaultResourceTemplates.forEach((template) => this.registerTemplate(template));
  }

  /**
   * Register a new resource with its handler at runtime
   */
  registerResource(definition: ResourceDefinition, handler: ResourceHandler): void {
    this.resourceDefinitions.push(definition);
    this.resourceHandlers[definition.uri] = handler;
  }

  /**
   * Register a new resource template
   */
  registerTemplate(definition: ResourceTemplateDefinition): void {
    this.validateTemplateDefinition(definition);
    this.resourceTemplates.push(definition);
  }

  /**
   * Returns list of available resources for MCP resource listing
   */
  listResources(): { resources: MCPResource[] } {
    return {
      resources: this.resourceDefinitions.map((r) => ({
        uri: r.uri,
        name: r.name,
        description: r.description,
        mimeType: r.mimeType,
      })),
    };
  }

  /**
   * Returns list of available resource templates
   */
  listResourceTemplates(): { resourceTemplates: MCPResourceTemplate[] } {
    return {
      resourceTemplates: this.resourceTemplates.map((t) => ({
        uriTemplate: t.uriTemplate,
        name: t.name,
        description: t.description,
        mimeType: t.mimeType,
      })),
    };
  }

  /**
   * Handles resource read requests
   */
  async readResource(uri: string): Promise<{
    contents: ResourceContents[];
  }> {
    // 1. Try exact match first
    const handler = this.resourceHandlers[uri];
    if (handler) {
      return {
        contents: await this.executeResourceHandler(
          () => handler(uri, this.dependencies),
          `resource ${uri}`,
        ),
      };
    }

    // 2. Try template matching
    for (const template of this.resourceTemplates) {
      const params = this.matchTemplate(template.uriTemplate, uri);
      if (params) {
        return {
          contents: await this.executeResourceHandler(
            () => template.handler(uri, params, this.dependencies),
            `resource ${uri}`,
          ),
        };
      }
    }

    throw new McpError(-32002, `Resource not found: ${uri}`);
  }

  private async executeResourceHandler(
    handler: () => Promise<ResourceContents[]>,
    label: string,
  ): Promise<ResourceContents[]> {
    try {
      return await handler();
    } catch (error) {
      if (error instanceof McpError) {
        throw error;
      }
      const message = error instanceof Error ? error.message : String(error);
      throw new McpError(ErrorCode.InternalError, `Failed to read ${label}: ${message}`);
    }
  }

  /**
   * Simple URI template matcher
   * Supports {param} syntax with validation to prevent regex injection
   *
   * @param template - URI template with {param} placeholders
   * @param uri - Actual URI to match against template
   * @returns Object with extracted parameters or null if no match
   */
  private matchTemplate(template: string, uri: string): Record<string, string> | null {
    // Validate template format (only allow safe characters and template syntax)
    if (!/^[a-z0-9:/\-_{}]+$/i.test(template)) {
      throw new Error('Invalid template format: contains unsafe characters');
    }

    // Extract and validate parameter names
    const paramNames: string[] = [];
    const regexPattern = template
      .replace(/[.*+?^$()|[\]\\]/g, '\\$&') // Escape special regex chars
      .replace(/{([a-z_][a-z0-9_]*)}/gi, (_, name) => {
        paramNames.push(name);
        return '([^/]+)'; // Capture group for parameter value
      });

    // Templates are validated at registration and come from trusted internal sources.
    // If external template registration is introduced, consider a ReDoS-safe matcher.
    const regex = new RegExp(`^${regexPattern}$`);
    const match = uri.match(regex);

    if (match) {
      const result: Record<string, string> = {};
      paramNames.forEach((name, i) => {
        const value = match[i + 1];
        if (value) {
          // Validate parameter values don't contain path traversal or invalid chars
          if (value.includes('..') || value.includes('\\')) {
            throw new Error(`Invalid parameter value: ${name}=${value}`);
          }
          result[name] = value;
        }
      });
      return result;
    }

    return null;
  }

  /**
   * Validate template format and parameter names at registration time
   */
  private validateTemplateDefinition(definition: ResourceTemplateDefinition): void {
    const { uriTemplate } = definition;
    if (!/^[a-z0-9:/\-_{}]+$/i.test(uriTemplate)) {
      throw new Error(`Invalid template format: contains unsafe characters (${uriTemplate})`);
    }

    const placeholderPattern = /{([^}]+)}/g;
    const paramNames: string[] = [];
    let match: RegExpExecArray | null;
    while ((match = placeholderPattern.exec(uriTemplate)) !== null) {
      const paramName = match[1] ?? '';
      if (!/^[a-z_][a-z0-9_]*$/i.test(paramName)) {
        throw new Error(
          `Invalid template parameter name '${paramName}' in template ${uriTemplate}`,
        );
      }
      paramNames.push(paramName);
    }

    const uniqueNames = new Set(paramNames);
    if (uniqueNames.size !== paramNames.length) {
      throw new Error(`Duplicate parameter names detected in template ${uriTemplate}`);
    }
  }
}
