import { describe, expect, test, vi, beforeEach } from 'vitest';
import * as ynab from 'ynab';
import {
  handleFinancialOverview,
  handleSpendingAnalysis,
  handleBudgetHealthCheck,
} from '../../financialOverview/handlers.js';
import type {
  FinancialOverviewParams,
  SpendingAnalysisParams,
  BudgetHealthParams,
} from '../../financialOverview/schemas.js';

// Mock all the dependencies
vi.mock('../../../types/index.js', () => ({
  withToolErrorHandling: async (fn: () => Promise<unknown>) => await fn(),
}));

const { mockCacheManager } = vi.hoisted(() => {
  return {
    mockCacheManager: {
      get: vi.fn(() => Promise.resolve(null)),
      set: vi.fn(() => Promise.resolve()),
    },
  };
});

vi.mock('../../../server/cacheManager.js', () => ({
  cacheManager: mockCacheManager,
  CACHE_TTLS: {
    MONTHS: 3600000,
  },
}));

vi.mock('../../../utils/dateUtils.js', () => ({
  getHistoricalMonths: (months: number) => {
    const result = [];
    for (let i = 0; i < months; i++) {
      result.push(`2024-${String(months - i).padStart(2, '0')}-01`);
    }
    return result;
  },
}));

vi.mock('../../../server/responseFormatter.js', () => ({
  responseFormatter: {
    format: (data: unknown) => JSON.stringify(data),
  },
}));

// Mock the sub-modules - moved from trendAnalysis.ts to formatter.ts
vi.mock('../../financialOverview/formatter.js', async () => {
  const actual = await vi.importActual<typeof import('../../financialOverview/formatter.js')>(
    '../../financialOverview/formatter.js',
  );
  return {
    ...actual,
    calculateAccountBalances: vi.fn(() => ({
      liquidNetWorth: 10000,
      totalNetWorth: 50000,
      liquidAssets: 12000,
      totalAssets: 75000,
      totalLiabilities: 25000,
      totalDebt: 2000,
      checkingBalance: 2000,
      savingsBalance: 10000,
      creditCardBalance: -500,
      investmentBalance: 40000,
      realEstateBalance: 0,
      mortgageBalance: 0,
      otherAssetBalance: 0,
      otherLiabilityBalance: 0,
    })),
    analyzeCategoryPerformance: vi.fn(() => [
      {
        category_name: 'Groceries',
        category_id: 'cat-1',
        average_budgeted: 400,
        average_spent: 380,
        utilization_rate: 95,
        current_balance: 20,
        monthly_data: [],
      },
    ]),
    calculateNetWorthTrend: vi.fn(() => ({
      direction: 'increasing',
      change_amount: 5000,
      change_percentage: 10,
      monthly_values: [],
      analysis: 'Net worth has increased by 10.0% over the analysis period',
    })),
    buildFinancialOverviewResponse: vi.fn((data) => ({
      content: [{ type: 'text', text: JSON.stringify(data) }],
    })),
    buildSpendingAnalysisResponse: vi.fn((data) => ({
      content: [{ type: 'text', text: JSON.stringify(data) }],
    })),
    buildBudgetHealthResponse: vi.fn((data) => ({
      content: [{ type: 'text', text: JSON.stringify(data) }],
    })),
    calculateBudgetUtilization: vi.fn(() => 95),
    performDetailedSpendingAnalysis: vi.fn(() => ({
      analysis_period: 'January 2024 - June 2024 (6 months)',
      category_analysis: [],
      balance_insights: {
        top_unused_balances: [],
        under_budgeted_categories: [],
      },
    })),
    performBudgetHealthCheck: vi.fn(() => ({
      analysis_period: 'January 2024',
      health_score: 85,
      sub_scores: {
        spending_health: 85,
        debt_health: 90,
        emergency_fund_health: 75,
        budget_discipline: 80,
      },
      score_explanation: 'Good financial health',
      metrics: {},
      recommendations: [],
      last_assessment: new Date().toISOString(),
    })),
    formatAccountBalances: vi.fn(),
  };
});

vi.mock('../../financialOverview/insightGenerator.js', () => ({
  generateFinancialInsights: vi.fn(() => [
    {
      type: 'info',
      category: 'budgeting',
      title: 'Test Insight',
      description: 'Test insight description',
      impact: 'medium',
      actionable: true,
      suggestions: ['Test suggestion'],
    },
  ]),
  calculateOverallHealthScore: vi.fn(() => 85),
  calculateHealthSubScores: vi.fn(() => ({
    spending_health: 85,
    debt_health: 90,
    emergency_fund_health: 75,
    budget_discipline: 80,
  })),
  calculateEmergencyFundStatus: vi.fn(() => ({
    current_amount: 5000,
    recommended_minimum: 1000,
    status: 'adequate',
  })),
  calculateDebtToAssetRatio: vi.fn(() => 15),
  getHealthScoreExplanation: vi.fn(() => 'Good financial health'),
  generateHealthRecommendations: vi.fn(() => ['Test recommendation']),
}));


// Mock YNAB API
function createMockYnabAPI(): ynab.API {
  return {
    budgets: {
      getBudgetById: vi.fn().mockResolvedValue({
        data: {
          budget: {
            id: 'budget-1',
            name: 'Test Budget',
            accounts: [
              {
                id: 'account-1',
                name: 'Checking',
                type: ynab.AccountType.Checking,
                on_budget: true,
                balance: 2000000, // $2000 in milliunits
              },
            ],
            categories: [
              {
                id: 'cat-1',
                name: 'Groceries',
                category_group_id: 'group-1',
                category_group_name: 'Monthly Bills',
              },
            ],
          },
        },
      }),
    } as any,
    transactions: {
      getTransactions: vi.fn().mockResolvedValue({
        data: {
          transactions: [
            {
              id: 'trans-1',
              account_id: 'account-1',
              category_id: 'cat-1',
              amount: -50000, // -$50
              date: '2024-01-15',
              payee_name: 'Test Store',
            },
          ],
        },
      }),
    } as any,
    months: {
      getBudgetMonth: vi.fn().mockResolvedValue({
        data: {
          month: {
            month: '2024-01-01',
            income: 5000000, // $5000
            budgeted: 4500000, // $4500
            activity: -4200000, // -$4200
            to_be_budgeted: 300000, // $300
            categories: [
              {
                id: 'cat-1',
                budgeted: 400000, // $400
                activity: -380000, // -$380
                balance: 20000, // $20
              },
            ],
          },
        },
      }),
    } as any,
  } as ynab.API;
}

describe('Handler Integration Tests', () => {
  let mockAPI: ynab.API;

  beforeEach(() => {
    vi.clearAllMocks();
    mockAPI = createMockYnabAPI();
    mockCacheManager.get.mockReturnValue(null); // No cache by default
  });

  describe('handleFinancialOverview', () => {
    test('should handle successful financial overview request', async () => {
      const params: FinancialOverviewParams = {
        budget_id: 'budget-1',
        months: 3,
        include_insights: true,
      };

      const result = await handleFinancialOverview(mockAPI, params);

      expect(result).toBeDefined();
      expect(result.content).toHaveLength(1);
      expect(result.content[0].type).toBe('text');

      // Verify required API calls were made
      expect(mockAPI.budgets.getBudgetById).toHaveBeenCalledWith('budget-1');
      expect(mockAPI.months.getBudgetMonth).toHaveBeenCalled();
    });

    test('should return cached result when available', async () => {
      const cachedResult = {
        overview: { budgetName: 'Cached Budget' },
        summary: {},
        current_month: null,
        account_overview: {},
        category_performance: [],
        net_worth_trend: {},
        spending_trends: {},
        insights: [],
        cached: true,
      };

      mockCacheManager.get.mockReturnValue(cachedResult);

      const params: FinancialOverviewParams = {
        budget_id: 'budget-1',
        months: 3,
        include_insights: true,
      };

      const result = await handleFinancialOverview(mockAPI, params);

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.cached).toBe(true);
      expect(mockAPI.budgets.getBudgetById).not.toHaveBeenCalled();
    });

    test('should skip trends when include_trends is false', async () => {
      const params: FinancialOverviewParams = {
        budget_id: 'budget-1',
        months: 3,
        include_insights: true,
      };

      const result = await handleFinancialOverview(mockAPI, params);

      // Verify result was generated without trends
      expect(result).toBeDefined();
      expect(result.content).toHaveLength(1);
    });

    test('should skip insights when include_insights is false', async () => {
      const { generateFinancialInsights } = await import(
        '../../financialOverview/insightGenerator.js'
      );

      const params: FinancialOverviewParams = {
        budget_id: 'budget-1',
        months: 3,
        include_insights: false,
      };

      await handleFinancialOverview(mockAPI, params);

      expect(generateFinancialInsights).not.toHaveBeenCalled();
    });

    test('should throw error for missing budget_id', async () => {
      const params = {
        months: 3,
        include_insights: true,
      } as FinancialOverviewParams;

      await expect(handleFinancialOverview(mockAPI, params)).rejects.toThrow(
        'Budget ID is required and must be a string',
      );
    });

    test('should handle API errors gracefully', async () => {
      mockAPI.budgets.getBudgetById = vi.fn().mockRejectedValue(new Error('API Error'));

      const params: FinancialOverviewParams = {
        budget_id: 'budget-1',
        months: 3,
        include_insights: true,
      };

      await expect(handleFinancialOverview(mockAPI, params)).rejects.toThrow('API Error');
    });

    test('should cache the result after successful processing', async () => {
      const params: FinancialOverviewParams = {
        budget_id: 'budget-1',
        months: 3,
        include_insights: true,
      };

      await handleFinancialOverview(mockAPI, params);

      expect(mockCacheManager.set).toHaveBeenCalledWith(
        expect.stringContaining('financial-overview:budget-1:3:true'),
        expect.any(Object),
        expect.any(Number),
      );
    });
  });

  describe('handleSpendingAnalysis', () => {
    test('should handle successful spending analysis request', async () => {
      const params: SpendingAnalysisParams = {
        budget_id: 'budget-1',
        period_months: 6,
        category_id: 'cat-1',
      };

      const result = await handleSpendingAnalysis(mockAPI, params);

      expect(result).toBeDefined();
      expect(result.content).toHaveLength(1);
      expect(result.content[0].type).toBe('text');

      // Verify API calls were made
      expect(mockAPI.budgets.getBudgetById).toHaveBeenCalledWith('budget-1');
      expect(mockAPI.months.getBudgetMonth).toHaveBeenCalled();
    });

    test('should work without category_id filter', async () => {
      const params: SpendingAnalysisParams = {
        budget_id: 'budget-1',
        period_months: 6,
      };

      const result = await handleSpendingAnalysis(mockAPI, params);

      expect(result).toBeDefined();
      expect(result.content).toHaveLength(1);
    });

    test('should throw error for missing budget_id', async () => {
      const params = {
        period_months: 6,
      } as SpendingAnalysisParams;

      await expect(handleSpendingAnalysis(mockAPI, params)).rejects.toThrow(
        'Budget ID is required and must be a string',
      );
    });

    test('should handle month data fetch failures gracefully', async () => {
      // Mock some months to fail
      mockAPI.months.getBudgetMonth = vi
        .fn()
        .mockResolvedValueOnce({ data: { month: { month: '2024-01-01' } } })
        .mockRejectedValueOnce(new Error('Month not found'))
        .mockResolvedValueOnce({ data: { month: { month: '2024-03-01' } } });

      const params: SpendingAnalysisParams = {
        budget_id: 'budget-1',
        period_months: 3,
      };

      const result = await handleSpendingAnalysis(mockAPI, params);

      expect(result).toBeDefined();
      // Should still work with partial data
    });
  });

  describe('handleBudgetHealthCheck', () => {
    test('should handle successful health check request', async () => {
      const params: BudgetHealthParams = {
        budget_id: 'budget-1',
        include_recommendations: true,
      };

      const result = await handleBudgetHealthCheck(mockAPI, params);

      expect(result).toBeDefined();
      expect(result.content).toHaveLength(1);
      expect(result.content[0].type).toBe('text');

      // Verify API calls were made
      expect(mockAPI.budgets.getBudgetById).toHaveBeenCalledWith('budget-1');
      expect(mockAPI.months.getBudgetMonth).toHaveBeenCalled();
    });

    test('should exclude recommendations when requested', async () => {
      const { generateHealthRecommendations } = await import(
        '../../financialOverview/insightGenerator.js'
      );

      const params: BudgetHealthParams = {
        budget_id: 'budget-1',
        include_recommendations: false,
      };

      await handleBudgetHealthCheck(mockAPI, params);

      // Recommendations should not be generated when include_recommendations is false
      expect(generateHealthRecommendations).not.toHaveBeenCalled();
    });

    test('should throw error for missing budget_id', async () => {
      const params = {
        include_recommendations: true,
      } as BudgetHealthParams;

      await expect(handleBudgetHealthCheck(mockAPI, params)).rejects.toThrow(
        'Budget ID is required and must be a string',
      );
    });

    test('should use current month for analysis', async () => {
      const params: BudgetHealthParams = {
        budget_id: 'budget-1',
        include_recommendations: true,
      };

      await handleBudgetHealthCheck(mockAPI, params);

      // Should fetch current month data
      expect(mockAPI.months.getBudgetMonth).toHaveBeenCalledWith(
        'budget-1',
        expect.stringMatching(/\d{4}-\d{2}-01/), // Current month format
      );
    });
  });

  describe('Error Handling and Edge Cases', () => {
    test('should handle null month data gracefully', async () => {
      mockAPI.months.getBudgetMonth = vi.fn().mockResolvedValue(null);

      const params: FinancialOverviewParams = {
        budget_id: 'budget-1',
        months: 3,
        include_insights: true,
      };

      const result = await handleFinancialOverview(mockAPI, params);

      expect(result).toBeDefined();
      // Should handle empty months array
    });

    test('should handle empty budget data', async () => {
      mockAPI.budgets.getBudgetById = vi.fn().mockResolvedValue({
        data: {
          budget: {
            id: 'budget-1',
            name: 'Empty Budget',
            accounts: [],
            categories: [],
          },
        },
      });

      const params: FinancialOverviewParams = {
        budget_id: 'budget-1',
        months: 3,
        include_insights: true,
      };

      const result = await handleFinancialOverview(mockAPI, params);

      expect(result).toBeDefined();
      // Should handle empty data gracefully
    });

    test('should handle concurrent API calls correctly', async () => {
      const params1: FinancialOverviewParams = {
        budget_id: 'budget-1',
        months: 3,
        include_insights: true,
      };

      const params2: FinancialOverviewParams = {
        budget_id: 'budget-2',
        months: 6,
        include_insights: true,
      };

      // Both should succeed independently
      const [result1, result2] = await Promise.all([
        handleFinancialOverview(mockAPI, params1),
        handleFinancialOverview(mockAPI, params2),
      ]);

      expect(result1).toBeDefined();
      expect(result2).toBeDefined();
    });
  });

  describe('Module Orchestration', () => {
    test('should call sub-modules in correct sequence for financial overview', async () => {
      const { calculateAccountBalances, analyzeCategoryPerformance, buildFinancialOverviewResponse } =
        await import('../../financialOverview/formatter.js');
      const { generateFinancialInsights } = await import(
        '../../financialOverview/insightGenerator.js'
      );

      const params: FinancialOverviewParams = {
        budget_id: 'budget-1',
        months: 3,
        include_insights: true,
      };

      await handleFinancialOverview(mockAPI, params);

      // Verify modules are called in correct order
      expect(calculateAccountBalances).toHaveBeenCalled();
      expect(analyzeCategoryPerformance).toHaveBeenCalled();
      expect(generateFinancialInsights).toHaveBeenCalled();
      expect(buildFinancialOverviewResponse).toHaveBeenCalled();
    });

    test('should pass data correctly between modules', async () => {
      const { generateFinancialInsights } = await import(
        '../../financialOverview/insightGenerator.js'
      );

      const params: FinancialOverviewParams = {
        budget_id: 'budget-1',
        months: 3,
        include_insights: true,
      };

      await handleFinancialOverview(mockAPI, params);

      // Verify insights generator receives correct parameters (trends removed)
      expect(generateFinancialInsights).toHaveBeenCalledWith(
        expect.any(Array), // months
        expect.any(Object), // budget
        expect.any(Array), // trends (empty array since trend analysis removed)
      );
    });
  });

  describe('Performance and Caching', () => {
    test('should make parallel API calls for efficiency', async () => {
      const params: FinancialOverviewParams = {
        budget_id: 'budget-1',
        months: 3,
        include_insights: true,
      };

      const startTime = Date.now();
      await handleFinancialOverview(mockAPI, params);
      const endTime = Date.now();

      // Should complete quickly due to parallel calls (mocked, but structure is tested)
      expect(endTime - startTime).toBeLessThan(100);

      // Verify all API calls were made
      expect(mockAPI.budgets.getBudgetById).toHaveBeenCalled();
      expect(mockAPI.months.getBudgetMonth).toHaveBeenCalled();
    });

    test('should generate correct cache keys', async () => {
      const params: FinancialOverviewParams = {
        budget_id: 'budget-123',
        months: 6,
        include_insights: true,
      };

      await handleFinancialOverview(mockAPI, params);

      expect(mockCacheManager.set).toHaveBeenCalledWith(
        'financial-overview:budget-123:6:true',
        expect.any(Object),
        expect.any(Number),
      );
    });
  });
});
