import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as ynab from 'ynab';
import { DeltaFetcher } from '../deltaFetcher.js';
import type { DeltaCache } from '../../server/deltaCache.js';
import { CACHE_TTLS } from '../../server/cacheManager.js';
import {
  mergeFlatEntities,
  mergeCategories,
  mergeTransactions,
  mergeMonths,
} from '../../server/deltaCache.merge.js';

const createMockDeltaCache = () => ({ fetchWithDelta: vi.fn() });

describe('DeltaFetcher', () => {
  let mockYnabAPI: ynab.API;
  let mockDeltaCache: ReturnType<typeof createMockDeltaCache>;

  beforeEach(() => {
    mockDeltaCache = createMockDeltaCache();
    mockYnabAPI = {
      accounts: { getAccounts: vi.fn() },
      categories: { getCategories: vi.fn() },
      transactions: {
        getTransactions: vi.fn(),
        getTransactionsByAccount: vi.fn(),
      },
      scheduledTransactions: { getScheduledTransactions: vi.fn() },
      payees: { getPayees: vi.fn() },
      months: { getBudgetMonths: vi.fn() },
      budgets: { getBudgets: vi.fn() },
    } as unknown as ynab.API;

    (mockYnabAPI.accounts.getAccounts as unknown as vi.Mock).mockResolvedValue({
      data: { accounts: [], server_knowledge: 0 },
    });
    (mockYnabAPI.categories.getCategories as unknown as vi.Mock).mockResolvedValue({
      data: { category_groups: [], server_knowledge: 0 },
    });
    (mockYnabAPI.transactions.getTransactions as unknown as vi.Mock).mockResolvedValue({
      data: { transactions: [], server_knowledge: 0 },
    });
    (mockYnabAPI.transactions.getTransactionsByAccount as unknown as vi.Mock).mockResolvedValue({
      data: { transactions: [], server_knowledge: 0 },
    });
    (
      mockYnabAPI.scheduledTransactions.getScheduledTransactions as unknown as vi.Mock
    ).mockResolvedValue({
      data: { scheduled_transactions: [], server_knowledge: 0 },
    });
    (mockYnabAPI.payees.getPayees as unknown as vi.Mock).mockResolvedValue({
      data: { payees: [], server_knowledge: 0 },
    });
    (mockYnabAPI.months.getBudgetMonths as unknown as vi.Mock).mockResolvedValue({
      data: { months: [], server_knowledge: 0 },
    });
    (mockYnabAPI.budgets.getBudgets as unknown as vi.Mock).mockResolvedValue({
      data: { budgets: [], server_knowledge: 0 },
    });
  });

  it('fetchAccounts wires delta cache with proper key and merge strategy', async () => {
    const fetcher = new DeltaFetcher(mockYnabAPI, mockDeltaCache as unknown as DeltaCache);
    const mockResult = { data: [], wasCached: false, usedDelta: false, serverKnowledge: 1 };
    (mockDeltaCache.fetchWithDelta as unknown as vi.Mock).mockResolvedValue(mockResult);

    const result = await fetcher.fetchAccounts('budget-1');

    expect(result).toBe(mockResult);
    expect(mockDeltaCache.fetchWithDelta).toHaveBeenCalledWith(
      'accounts:list:budget-1',
      'budget-1',
      expect.any(Function),
      mergeFlatEntities,
      expect.objectContaining({ ttl: CACHE_TTLS.ACCOUNTS }),
    );

    const fetcherFn = (mockDeltaCache.fetchWithDelta as unknown as vi.Mock).mock.calls[0][2];
    await fetcherFn(42);
    expect(mockYnabAPI.accounts.getAccounts).toHaveBeenCalledWith('budget-1', 42);
  });

  it('fetchCategories uses mergeCategories and TTL', async () => {
    const fetcher = new DeltaFetcher(mockYnabAPI, mockDeltaCache as unknown as DeltaCache);
    (mockDeltaCache.fetchWithDelta as unknown as vi.Mock).mockResolvedValue({});

    await fetcher.fetchCategories('budget-2');

    expect(mockDeltaCache.fetchWithDelta).toHaveBeenCalledWith(
      'categories:list:budget-2',
      'budget-2',
      expect.any(Function),
      mergeCategories,
      expect.objectContaining({ ttl: CACHE_TTLS.CATEGORIES }),
    );
  });

  it('fetchTransactions includes filters in key and uses mergeTransactions', async () => {
    const fetcher = new DeltaFetcher(mockYnabAPI, mockDeltaCache as unknown as DeltaCache);
    (mockDeltaCache.fetchWithDelta as unknown as vi.Mock).mockResolvedValue({});

    await fetcher.fetchTransactions(
      'budget-3',
      '2024-01-01',
      ynab.GetTransactionsTypeEnum.Uncategorized,
    );

    expect(mockDeltaCache.fetchWithDelta).toHaveBeenCalledWith(
      'transactions:list:budget-3:2024-01-01:uncategorized',
      'budget-3',
      expect.any(Function),
      mergeTransactions,
      expect.objectContaining({ ttl: CACHE_TTLS.TRANSACTIONS }),
    );
    const fetcherFn = (mockDeltaCache.fetchWithDelta as unknown as vi.Mock).mock.calls[0][2];
    await fetcherFn(undefined);
    expect(mockYnabAPI.transactions.getTransactions).toHaveBeenCalledWith(
      'budget-3',
      '2024-01-01',
      'uncategorized',
      undefined,
    );
  });

  it('fetchTransactionsByAccount encodes account in key', async () => {
    const fetcher = new DeltaFetcher(mockYnabAPI, mockDeltaCache as unknown as DeltaCache);
    (mockDeltaCache.fetchWithDelta as unknown as vi.Mock).mockResolvedValue({});

    await fetcher.fetchTransactionsByAccount('budget-4', 'acct-1', '2024-02-02');

    expect(mockDeltaCache.fetchWithDelta).toHaveBeenCalledWith(
      'transactions:account:budget-4:acct-1:2024-02-02',
      'budget-4',
      expect.any(Function),
      mergeTransactions,
      expect.objectContaining({ ttl: CACHE_TTLS.TRANSACTIONS }),
    );
    const fetcherFn = (mockDeltaCache.fetchWithDelta as unknown as vi.Mock).mock.calls[0][2];
    await fetcherFn(5);
    expect(mockYnabAPI.transactions.getTransactionsByAccount).toHaveBeenCalledWith(
      'budget-4',
      'acct-1',
      '2024-02-02',
      undefined,
      5,
    );
  });

  it('fetchScheduledTransactions wires cache key and merge strategy', async () => {
    const fetcher = new DeltaFetcher(mockYnabAPI, mockDeltaCache as unknown as DeltaCache);
    (mockDeltaCache.fetchWithDelta as unknown as vi.Mock).mockResolvedValue({});

    await fetcher.fetchScheduledTransactions('budget-sched');

    expect(mockDeltaCache.fetchWithDelta).toHaveBeenCalledWith(
      'scheduled_transactions:list:budget-sched',
      'budget-sched',
      expect.any(Function),
      mergeFlatEntities,
      expect.objectContaining({ ttl: CACHE_TTLS.SCHEDULED_TRANSACTIONS }),
    );

    const fetcherFn = (mockDeltaCache.fetchWithDelta as unknown as vi.Mock).mock.calls[0][2];
    await fetcherFn(321);
    expect(mockYnabAPI.scheduledTransactions.getScheduledTransactions).toHaveBeenCalledWith(
      'budget-sched',
      321,
    );
  });

  it('fetchPayees delegates to mergeFlatEntities', async () => {
    const fetcher = new DeltaFetcher(mockYnabAPI, mockDeltaCache as unknown as DeltaCache);
    (mockDeltaCache.fetchWithDelta as unknown as vi.Mock).mockResolvedValue({});

    await fetcher.fetchPayees('budget-5');

    expect(mockDeltaCache.fetchWithDelta).toHaveBeenCalledWith(
      'payees:list:budget-5',
      'budget-5',
      expect.any(Function),
      mergeFlatEntities,
      expect.objectContaining({ ttl: CACHE_TTLS.PAYEES }),
    );
  });

  it('fetchMonths uses mergeMonths and month TTL', async () => {
    const fetcher = new DeltaFetcher(mockYnabAPI, mockDeltaCache as unknown as DeltaCache);
    (mockDeltaCache.fetchWithDelta as unknown as vi.Mock).mockResolvedValue({});

    await fetcher.fetchMonths('budget-6');

    expect(mockDeltaCache.fetchWithDelta).toHaveBeenCalledWith(
      'months:list:budget-6',
      'budget-6',
      expect.any(Function),
      mergeMonths,
      expect.objectContaining({ ttl: CACHE_TTLS.MONTHS }),
    );
  });

  it('fetchBudgets always forces full refresh', async () => {
    const fetcher = new DeltaFetcher(mockYnabAPI, mockDeltaCache as unknown as DeltaCache);
    (mockDeltaCache.fetchWithDelta as unknown as vi.Mock).mockResolvedValue({});

    await fetcher.fetchBudgets();
    expect(mockYnabAPI.budgets.getBudgets).toHaveBeenCalledWith();

    expect(mockDeltaCache.fetchWithDelta).toHaveBeenCalledWith(
      'budgets:list',
      'global',
      expect.any(Function),
      mergeFlatEntities,
      expect.objectContaining({ ttl: CACHE_TTLS.BUDGETS, forceFullRefresh: true }),
    );
  });

  it('fetchAccountsFull bypasses cache and filters deleted accounts', async () => {
    const fetcher = new DeltaFetcher(mockYnabAPI, mockDeltaCache as unknown as DeltaCache);
    (mockYnabAPI.accounts.getAccounts as unknown as vi.Mock).mockResolvedValue({
      data: {
        accounts: [
          { id: 'acct-1', deleted: false },
          { id: 'acct-2', deleted: true },
        ],
        server_knowledge: 12,
      },
    });

    const result = await fetcher.fetchAccountsFull('budget-x');

    expect(mockYnabAPI.accounts.getAccounts).toHaveBeenCalledWith('budget-x');
    expect(result).toEqual({
      data: [{ id: 'acct-1', deleted: false }],
      wasCached: false,
      usedDelta: false,
      serverKnowledge: 12,
    });
  });

  it('fetchTransactionsByAccountFull bypasses delta cache', async () => {
    const fetcher = new DeltaFetcher(mockYnabAPI, mockDeltaCache as unknown as DeltaCache);
    (mockYnabAPI.transactions.getTransactionsByAccount as unknown as vi.Mock).mockResolvedValue({
      data: {
        transactions: [
          { id: 'tx-1', deleted: false },
          { id: 'tx-2', deleted: true },
        ],
        server_knowledge: 55,
      },
    });

    const result = await fetcher.fetchTransactionsByAccountFull('budget-x', 'acct-1', '2024-03-01');

    expect(mockYnabAPI.transactions.getTransactionsByAccount).toHaveBeenCalledWith(
      'budget-x',
      'acct-1',
      '2024-03-01',
    );
    expect(result).toEqual({
      data: [{ id: 'tx-1', deleted: false }],
      wasCached: false,
      usedDelta: false,
      serverKnowledge: 55,
    });
  });
});
