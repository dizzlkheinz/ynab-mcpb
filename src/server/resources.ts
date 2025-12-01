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
} from '@modelcontextprotocol/sdk/types.js';

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
) => Promise<MCPResource[]>;

/**
 * Template handler function signature
 */
export type TemplateHandler = (
  uri: string,
  params: Record<string, string>,
  dependencies: ResourceDependencies,
) => Promise<MCPResource[]>;

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
}

/**
 * Default resource handlers
 */
const defaultResourceHandlers: Record<string, ResourceHandler> = {
  'ynab://budgets': async (uri, { ynabAPI, responseFormatter }) => {
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
      throw new Error(`Failed to fetch budgets: ${error}`);
    }
  },

  'ynab://user': async (uri, { ynabAPI, responseFormatter }) => {
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
      throw new Error(`Failed to fetch user info: ${error}`);
    }
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
    handler: async (uri, params, { ynabAPI, responseFormatter }) => {
      const { budget_id } = params;
      const response = await ynabAPI.budgets.getBudgetById(budget_id);
      return [
        {
          uri,
          mimeType: 'application/json',
          text: responseFormatter.format(response.data.budget),
        },
      ];
    },
  },
  {
    uriTemplate: 'ynab://budgets/{budget_id}/accounts',
    name: 'Budget Accounts',
    description: 'List of accounts for a specific budget',
    mimeType: 'application/json',
    handler: async (uri, params, { ynabAPI, responseFormatter }) => {
      const { budget_id } = params;
      const response = await ynabAPI.accounts.getAccounts(budget_id);
      return [
        {
          uri,
          mimeType: 'application/json',
          text: responseFormatter.format(response.data.accounts),
        },
      ];
    },
  },
  {
    uriTemplate: 'ynab://accounts/{account_id}',
    name: 'Account Details',
    description: 'Detailed information for a specific account (requires budget_id context if possible, otherwise searches)',
    mimeType: 'application/json',
    handler: async (uri, params, { ynabAPI, responseFormatter }) => {
       // Note: YNAB API requires budget_id to get an account.
       // This template might require finding the budget first or we assume the URI structure might need improvement.
       // Ideally: ynab://budgets/{budget_id}/accounts/{account_id}
       // But if we want direct access, we'd need to know the budget.
       // For now, let's implement the hierarchical one as primary and this one as a "search" if feasible,
       // or simply assume the user must use the hierarchical one.
       // Let's stick to the hierarchical one for correctness with YNAB API.
       throw new Error('Please use ynab://budgets/{budget_id}/accounts/{account_id} to access account details.');
    }
  },
  {
    uriTemplate: 'ynab://budgets/{budget_id}/accounts/{account_id}',
    name: 'Account Details (Hierarchical)',
    description: 'Detailed information for a specific account within a budget',
    mimeType: 'application/json',
    handler: async (uri, params, { ynabAPI, responseFormatter }) => {
      const { budget_id, account_id } = params;
      const response = await ynabAPI.accounts.getAccountById(budget_id, account_id);
      return [
        {
          uri,
          mimeType: 'application/json',
          text: responseFormatter.format(response.data.account),
        },
      ];
    },
  }
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
    // Filter out the incomplete implementation from defaults for now
    this.resourceTemplates = defaultResourceTemplates.filter(t => !t.uriTemplate.includes('ynab://accounts/{account_id}'));
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
    this.resourceTemplates.push(definition);
  }

  /**
   * Returns list of available resources for MCP resource listing
   */
  listResources(): { resources: MCPResource[] } {
    return {
      resources: this.resourceDefinitions.map(r => ({
        uri: r.uri,
        name: r.name,
        description: r.description,
        mimeType: r.mimeType
      })),
    };
  }

  /**
   * Returns list of available resource templates
   */
  listResourceTemplates(): { resourceTemplates: MCPResourceTemplate[] } {
    return {
      resourceTemplates: this.resourceTemplates.map(t => ({
        uriTemplate: t.uriTemplate,
        name: t.name,
        description: t.description,
        mimeType: t.mimeType
      })),
    };
  }

  /**
   * Handles resource read requests
   */
  async readResource(uri: string): Promise<{
    contents: MCPResource[];
  }> {
    // 1. Try exact match first
    const handler = this.resourceHandlers[uri];
    if (handler) {
      return { contents: await handler(uri, this.dependencies) };
    }

    // 2. Try template matching
    for (const template of this.resourceTemplates) {
      const params = this.matchTemplate(template.uriTemplate, uri);
      if (params) {
        return { contents: await template.handler(uri, params, this.dependencies) };
      }
    }

    throw new Error(`Unknown resource: ${uri}`);
  }

  /**
   * Simple URI template matcher
   * Supports {param} syntax
   */
  private matchTemplate(template: string, uri: string): Record<string, string> | null {
    // Escape special regex characters
    // We do NOT escape { and } in the first pass because we use them as delimiters
    const escaped = template.replace(/[.*+?^$()|[\]\\]/g, '\\$&');

    // Convert {name} to (?<name>[^/]+)
    // We match {name} literally.
    const regexPattern = escaped.replace(/{([^}]+)}/g, '(?<$1>[^/]+)');

    const regex = new RegExp(`^${regexPattern}$`);
    const match = uri.match(regex);

    if (match && match.groups) {
      return match.groups;
    }

    return null;
  }
}
