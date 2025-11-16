import { vi } from 'vitest';
import { DeltaFetcher } from '../deltaFetcher.js';

export interface MockDeltaResult<T> {
  data: T[];
  wasCached?: boolean;
  usedDelta?: boolean;
}

type DeltaFetcherMethod =
  | 'fetchAccounts'
  | 'fetchBudgets'
  | 'fetchCategories'
  | 'fetchMonths';

export function createDeltaFetcherMock<T>(
  method: DeltaFetcherMethod,
  result: MockDeltaResult<T>,
): {
  fetcher: DeltaFetcher;
  spy: ReturnType<typeof vi.fn>;
  resolved: Required<MockDeltaResult<T>>;
} {
  const resolved = {
    wasCached: false,
    usedDelta: false,
    ...result,
  };
  const spy = vi.fn().mockResolvedValue(resolved);
  return {
    fetcher: Object.assign(Object.create(DeltaFetcher.prototype), {
      [method]: spy,
    }) as DeltaFetcher,
    spy,
    resolved,
  };
}

export function createRejectingDeltaFetcherMock(
  method: DeltaFetcherMethod,
  error: Error,
): { fetcher: DeltaFetcher; spy: ReturnType<typeof vi.fn> } {
  const spy = vi.fn().mockRejectedValue(error);
  return {
    fetcher: Object.assign(Object.create(DeltaFetcher.prototype), {
      [method]: spy,
    }) as DeltaFetcher,
    spy,
  };
}
