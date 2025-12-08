import { describe, expect, it, vi } from 'vitest';
import { DefaultArgumentResolutionError } from '../../server/toolRegistry.js';
import type { ToolContext } from '../../types/toolRegistration.js';
import { createAdapters, createBudgetResolver } from '../adapters.js';

const createMockContext = (overrides: Partial<ToolContext> = {}): ToolContext => {
  return {
    ynabAPI: (overrides.ynabAPI ?? ({ budgets: {} } as unknown as any)) as ToolContext['ynabAPI'],
    deltaFetcher: overrides.deltaFetcher ?? ({} as any),
    deltaCache: overrides.deltaCache ?? ({} as any),
    serverKnowledgeStore: overrides.serverKnowledgeStore ?? ({} as any),
    getDefaultBudgetId:
      overrides.getDefaultBudgetId ?? vi.fn(() => '123e4567-e89b-12d3-a456-426614174000'),
    setDefaultBudget: overrides.setDefaultBudget ?? vi.fn(),
    cacheManager: overrides.cacheManager ?? ({} as any),
    diagnosticManager: overrides.diagnosticManager,
  } satisfies ToolContext;
};

describe('createAdapters', () => {
  it('adapt passes api and params to handler', async () => {
    const context = createMockContext();
    const { adapt } = createAdapters(context);
    const handler = vi.fn().mockResolvedValue({ content: [] });

    const adapted = adapt(handler);
    await adapted({ input: { foo: 'bar' }, context: {} as any });

    expect(handler).toHaveBeenCalledWith(context.ynabAPI, { foo: 'bar' });
  });

  it('adaptNoInput passes api without params', async () => {
    const context = createMockContext();
    const { adaptNoInput } = createAdapters(context);
    const handler = vi.fn().mockResolvedValue({ content: [] });

    const adapted = adaptNoInput(handler);
    await adapted({ input: {}, context: {} as any });

    expect(handler).toHaveBeenCalledWith(context.ynabAPI);
  });

  it('adaptWithDelta passes deltaFetcher to handler', async () => {
    const deltaFetcher = { fetch: vi.fn() } as any;
    const context = createMockContext({ deltaFetcher });
    const { adaptWithDelta } = createAdapters(context);
    const handler = vi.fn().mockResolvedValue({ content: [] });

    const adapted = adaptWithDelta(handler);
    await adapted({ input: { a: 1 }, context: {} as any });

    expect(handler).toHaveBeenCalledWith(context.ynabAPI, deltaFetcher, { a: 1 });
  });

  it('adaptWrite passes cache and knowledge store to handler', async () => {
    const deltaCache = { invalidate: vi.fn() } as any;
    const serverKnowledgeStore = { update: vi.fn() } as any;
    const context = createMockContext({ deltaCache, serverKnowledgeStore });
    const { adaptWrite } = createAdapters(context);
    const handler = vi.fn().mockResolvedValue({ content: [] });

    const adapted = adaptWrite(handler);
    await adapted({ input: { a: 2 }, context: {} as any });

    expect(handler).toHaveBeenCalledWith(context.ynabAPI, deltaCache, serverKnowledgeStore, {
      a: 2,
    });
  });
});

describe('createBudgetResolver', () => {
  it('returns provided budget_id when supplied', () => {
    const context = createMockContext({ getDefaultBudgetId: () => 'default-budget' });
    const resolverFactory = createBudgetResolver(context);
    const resolver = resolverFactory<{ budget_id?: string }>();

    const result = resolver({
      name: 'tool',
      accessToken: 'token',
      rawArguments: { budget_id: '123e4567-e89b-12d3-a456-426614174000' },
    });

    expect(result).toEqual({ budget_id: '123e4567-e89b-12d3-a456-426614174000' });
  });

  it('falls back to default budget id when not provided', () => {
    const context = createMockContext({
      getDefaultBudgetId: () => '89abcdef-0123-4567-89ab-cdef01234567',
    });
    const resolver = createBudgetResolver(context)<{ budget_id?: string }>();

    const result = resolver({
      name: 'tool',
      accessToken: 'token',
      rawArguments: {},
    });

    expect(result).toEqual({ budget_id: '89abcdef-0123-4567-89ab-cdef01234567' });
  });

  it('throws DefaultArgumentResolutionError when no budget id available', () => {
    const context = createMockContext({ getDefaultBudgetId: () => undefined });
    const resolver = createBudgetResolver(context)<{ budget_id?: string }>();

    expect(() =>
      resolver({
        name: 'tool',
        accessToken: 'token',
        rawArguments: {},
      }),
    ).toThrow(DefaultArgumentResolutionError);
  });
});
