
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ResourceManager, ResourceDependencies } from '../resources';
import type * as ynab from 'ynab';

// Mock YNAB API
const mockYnabAPI = {
  budgets: {
    getBudgets: vi.fn(),
    getBudgetById: vi.fn(),
  },
  accounts: {
    getAccounts: vi.fn(),
    getAccountById: vi.fn(),
  },
  user: {
    getUser: vi.fn(),
  },
} as unknown as ynab.API;

// Mock Response Formatter
const mockResponseFormatter = {
  format: vi.fn((data) => JSON.stringify(data)),
};

describe('ResourceManager Templates', () => {
  let resourceManager: ResourceManager;

  beforeEach(() => {
    vi.clearAllMocks();
    resourceManager = new ResourceManager({
      ynabAPI: mockYnabAPI,
      responseFormatter: mockResponseFormatter,
    });
  });

  it('should list resource templates', () => {
    const templates = resourceManager.listResourceTemplates();
    expect(templates.resourceTemplates.length).toBeGreaterThan(0);
    expect(templates.resourceTemplates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          uriTemplate: 'ynab://budgets/{budget_id}',
          name: 'Budget Details',
        }),
        expect.objectContaining({
          uriTemplate: 'ynab://budgets/{budget_id}/accounts',
          name: 'Budget Accounts',
        }),
      ])
    );
  });

  it('should match and handle budget details template', async () => {
    const budgetId = 'test-budget-id';
    const mockBudget = { id: budgetId, name: 'Test Budget' };
    
    (mockYnabAPI.budgets.getBudgetById as any).mockResolvedValue({
      data: { budget: mockBudget },
    });

    const uri = `ynab://budgets/${budgetId}`;
    const result = await resourceManager.readResource(uri);

    expect(mockYnabAPI.budgets.getBudgetById).toHaveBeenCalledWith(budgetId);
    expect(result.contents).toHaveLength(1);
    expect(result.contents[0].uri).toBe(uri);
    expect(JSON.parse(result.contents[0].text)).toEqual(mockBudget);
  });

  it('should match and handle budget accounts template', async () => {
    const budgetId = 'test-budget-id';
    const mockAccounts = [{ id: 'acc1', name: 'Checking' }];
    
    (mockYnabAPI.accounts.getAccounts as any).mockResolvedValue({
      data: { accounts: mockAccounts },
    });

    const uri = `ynab://budgets/${budgetId}/accounts`;
    const result = await resourceManager.readResource(uri);

    expect(mockYnabAPI.accounts.getAccounts).toHaveBeenCalledWith(budgetId);
    expect(result.contents).toHaveLength(1);
    expect(JSON.parse(result.contents[0].text)).toEqual(mockAccounts);
  });

  it('should match and handle specific account template', async () => {
    const budgetId = 'test-budget-id';
    const accountId = 'test-account-id';
    const mockAccount = { id: accountId, name: 'Savings' };
    
    (mockYnabAPI.accounts.getAccountById as any).mockResolvedValue({
      data: { account: mockAccount },
    });

    const uri = `ynab://budgets/${budgetId}/accounts/${accountId}`;
    const result = await resourceManager.readResource(uri);

    expect(mockYnabAPI.accounts.getAccountById).toHaveBeenCalledWith(budgetId, accountId);
    expect(result.contents).toHaveLength(1);
    expect(JSON.parse(result.contents[0].text)).toEqual(mockAccount);
  });

  it('should fallback to throwing error for unknown URIs', async () => {
    const uri = 'ynab://unknown/resource';
    await expect(resourceManager.readResource(uri)).rejects.toThrow('Unknown resource: ynab://unknown/resource');
  });
  
  it('should prefer static resources over templates when both match (though unlikely with current design)', async () => {
    // Assuming 'ynab://budgets' is a static resource
    const mockBudgetsList = [{ id: 'b1', name: 'B1' }];
    (mockYnabAPI.budgets.getBudgets as any).mockResolvedValue({
      data: { budgets: mockBudgetsList },
    });

    const uri = 'ynab://budgets';
    const result = await resourceManager.readResource(uri);

    // Should call getBudgets (static), not getBudgetById (template)
    expect(mockYnabAPI.budgets.getBudgets).toHaveBeenCalled();
    expect(mockYnabAPI.budgets.getBudgetById).not.toHaveBeenCalled();
    expect(JSON.parse(result.contents[0].text)).toEqual({ budgets: expect.any(Array) });
  });
});
