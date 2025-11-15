# Design: Tiered Integration Testing for YNAB MCP Server

**Date**: 2025-01-14
**Status**: Proposed
**Author**: Claude Code (with user collaboration)

---

## Problem Statement

The YNAB MCP Server has 21 integration test files that hit the real YNAB API. With YNAB's rate limit of 200 requests/hour, running all integration tests exhausts the rate limit and blocks further development testing. Current issues:

- Integration tests fail due to rate limit exhaustion
- No way to run quick smoke tests during active development
- CI/CD pipelines can't reliably run integration tests
- Full test suite takes too long for rapid iteration
- All tests are treated equally - no prioritization

**Core Constraint**: We want to test against the **real YNAB API**, not mocks, to ensure accurate integration testing.

---

## Design Goals

1. **Fast Feedback**: Developers get quick validation (<3 minutes) during active development
2. **Selective Testing**: Run only relevant tests when working on specific domains
3. **Comprehensive Coverage**: Full test suite available for pre-release validation
4. **Rate Limit Safety**: Never exhaust YNAB API rate limits
5. **CI/CD Friendly**: Lightweight tests for every PR without burning rate limits
6. **Real API Testing**: No mocks - validate actual YNAB API behavior

---

## Solution: Three-Tier Testing Strategy

### Tier 1: Core/Smoke Tests
- **API Calls**: ~10-15 calls
- **Duration**: <3 minutes
- **Frequency**: Run before every commit, in CI on every PR
- **Rate Impact**: ~7-8% of hourly limit

**Tests**:
- List budgets (1 call)
- Get budget by ID (1 call)
- List accounts (1 call)
- Create transaction (1 call)
- Read transaction (1 call)
- Update transaction (1 call)
- Delete transaction (1 call)
- Get user info (1 call)
- ~5-7 additional critical path tests

### Tier 2: Domain Tests
- **API Calls**: ~30-50 calls per domain
- **Duration**: 5-10 minutes per domain
- **Frequency**: Run when working on specific domain
- **Rate Impact**: ~15-25% of hourly limit per domain

**Domains**:
- Budgets
- Accounts
- Transactions
- Categories
- Payees
- Month tools
- Delta operations
- Reconciliation

### Tier 3: Full Integration Suite
- **API Calls**: ~200 calls (all tests)
- **Duration**: 2-3 hours (with intelligent throttling)
- **Frequency**: Scheduled (nightly/weekly) or manual trigger before releases
- **Rate Impact**: ~100% of hourly limit (safely paced)

**Throttling Strategy**:
- Monitor `X-Rate-Limit-Remaining` header
- Estimate API calls per test
- Automatically delay execution to stay under 180 calls/hour (20 call buffer)
- Resume after rate limit window resets if needed

---

## Architecture

### Test Tagging

Add metadata to integration tests to enable tier-based filtering:

```typescript
describe('Budget Tools Integration', () => {
  it('should list budgets', {
    meta: { tier: 'core', domain: 'budgets' }
  }, async () => {
    // Test implementation
  });

  it('should handle budget settings', {
    meta: { tier: 'domain', domain: 'budgets' }
  }, async () => {
    // Test implementation
  });
});
```

### Vitest Project Configuration

```typescript
// vitest.config.ts
export default defineConfig({
  test: {
    projects: [
      {
        name: 'unit',
        testMatch: ['**/*.test.ts'],
        exclude: ['**/*.integration.test.ts'],
      },
      {
        name: 'integration:core',
        testMatch: ['**/*.integration.test.ts'],
        include: (file) => hasTag(file, 'tier', 'core'),
        testTimeout: 30000,
      },
      {
        name: 'integration:domain',
        testMatch: ['**/*.integration.test.ts'],
        include: (file) => hasTag(file, 'tier', 'domain'),
        testTimeout: 60000,
      },
      {
        name: 'integration:full',
        testMatch: ['**/*.integration.test.ts'],
        testTimeout: 120000,
        maxConcurrency: 1, // Sequential for throttling
      },
    ],
  },
});
```

### NPM Scripts

```json
{
  "scripts": {
    "test:integration:core": "vitest run --project integration:core",
    "test:integration:budgets": "vitest run --project integration:domain --grep 'budgetTools'",
    "test:integration:accounts": "vitest run --project integration:domain --grep 'accountTools'",
    "test:integration:full": "node scripts/run-throttled-integration-tests.js"
  }
}
```

### Throttled Test Runner

Custom runner for full suite that respects rate limits:

```typescript
class ThrottledTestRunner {
  private rateLimit = 200; // requests per hour
  private buffer = 20; // safety buffer
  private requestHistory: Array<{timestamp: number, calls: number}> = [];

  async runWithThrottling(testFile: string) {
    const recentRequests = this.getRecentRequests();

    if (recentRequests >= this.rateLimit - this.buffer) {
      const waitTime = this.calculateWaitTime();
      console.log(`⏳ Rate limit approaching, waiting ${Math.round(waitTime / 60000)} min...`);
      await this.sleep(waitTime);
    }

    await this.runTest(testFile);
    this.trackRequest(this.estimateAPICalls(testFile));
  }

  private getRecentRequests(): number {
    const cutoff = Date.now() - 3600000; // 1 hour
    this.requestHistory = this.requestHistory.filter(r => r.timestamp > cutoff);
    return this.requestHistory.reduce((sum, r) => sum + r.calls, 0);
  }

  private calculateWaitTime(): number {
    const oldestRequest = this.requestHistory[0];
    return (oldestRequest.timestamp + 3600000) - Date.now();
  }
}
```

---

## Test Tier Assignment Guidelines

### Core Tier Criteria
Tests should be in core tier if they:
- ✅ Test fundamental, critical-path functionality
- ✅ Are needed for basic confidence before committing
- ✅ Make 1-2 API calls per test
- ✅ Run in <5 seconds (including network)
- ✅ Don't depend on complex state

**Example**: `GET /budgets`, `POST /transactions`, `GET /user`

### Domain Tier Criteria
Tests should be in domain tier if they:
- ✅ Test comprehensive functionality in a specific domain
- ✅ Are needed when working on that feature area
- ✅ Make 3-10 API calls per test
- ✅ Test edge cases or complex workflows
- ✅ May depend on multiple resources

**Example**: Full CRUD workflows, reconciliation, delta operations

### Full Suite
All integration tests, run with throttling on schedule or before releases.

---

## CI/CD Integration

### GitHub Actions Strategy

```yaml
# Every PR: Unit + Core only
on: [pull_request]
jobs:
  test:
    steps:
      - run: npm run test:unit
      - run: npm run test:integration:core  # ~10-15 API calls

# Scheduled: Full suite
on:
  schedule:
    - cron: '0 2 * * *'  # 2 AM daily
jobs:
  full-integration:
    steps:
      - run: npm run test:integration:full  # 2-3 hours, throttled
```

**Benefits**:
- Every PR gets validated without exhausting rate limits
- Comprehensive testing happens regularly but not on critical path
- Manual trigger available for pre-release validation

---

## Delta Test Handling

Delta tests (`*.delta.integration.test.ts`) track `server_knowledge` - a stateful value. Special considerations:

1. **Initialize Fresh**: Start each delta test with clean API client
2. **Test Sequence**: Test both initial fetch AND delta request in same test
3. **Validate Incremental**: Verify delta responses are smaller than full responses
4. **Clean Up**: Remove test data to avoid polluting future delta tests

```typescript
it('should fetch delta updates', {
  meta: { tier: 'domain', domain: 'delta' }
}, async () => {
  // Initial fetch
  const initial = await api.budgets.getBudgetById(budgetId);
  const serverKnowledge = initial.data.server_knowledge;

  // Create change
  await api.transactions.createTransaction(budgetId, {...});

  // Delta fetch
  const delta = await api.budgets.getBudgetById(budgetId, serverKnowledge);

  // Validate
  expect(delta.data.server_knowledge).toBeGreaterThan(serverKnowledge);
});
```

---

## Migration Steps

### 1. Tag Existing Tests (1-2 hours)
- Review 21 integration test files
- Add `meta: { tier, domain }` to each test
- Identify 8-10 tests for core tier
- Assign remaining tests to domain tier

### 2. Update Vitest Config (30 minutes)
- Create three integration projects: core, domain, full
- Configure test filtering by tier
- Set appropriate timeouts

### 3. Create NPM Scripts (15 minutes)
- Add `test:integration:core`
- Add `test:integration:{domain}` for each domain
- Add `test:integration:full`
- Update default `test:integration` to run core tier

### 4. Implement Throttled Runner (2-3 hours)
- Create `scripts/run-throttled-integration-tests.js`
- Implement rate limit tracking
- Add API call estimation
- Test with subset of tests

### 5. Update CI Configuration (30 minutes)
- Configure PR workflow: unit + core only
- Set up scheduled workflow: full suite
- Add manual trigger option

### 6. Document Workflow (1 hour)
- Update developer docs
- Create tier assignment examples
- Document when to run which tier

### 7. Validate (2-3 hours)
- Run core tier locally (verify <3 min)
- Run domain tiers selectively
- Run full suite with throttling (verify no rate limit hits)
- Validate CI runs

**Total Effort**: ~8-12 hours

---

## Trade-offs

### Pros
✅ Fast feedback during development (core tests <3 min)
✅ Selective testing reduces wasted API calls
✅ Full coverage still available when needed
✅ CI/CD friendly (only 10-15 calls per PR)
✅ Real API testing (no mocks or recordings)
✅ Never hit rate limits

### Cons
⚠️ Requires test tagging maintenance
⚠️ Full suite takes 2-3 hours (but runs scheduled)
⚠️ Need to estimate API calls per test
⚠️ Developers must learn which tier to run

### Alternatives Considered

**1. Record & Replay (Polly.js)**
- ❌ Recordings become stale
- ❌ Don't validate real API behavior
- ❌ High maintenance burden
- ✅ Fast test execution
- ✅ No rate limits

**Decision**: Rejected - we want real API testing

**2. Mock All Integration Tests**
- ❌ Not real integration tests
- ❌ Can drift from actual API
- ✅ Fast and reliable
- ✅ No rate limits

**Decision**: Rejected - defeats purpose of integration tests

**3. Single Tier with Aggressive Throttling**
- ❌ All tests always take hours
- ❌ No fast feedback loop
- ✅ Simple to implement
- ✅ Never hit rate limits

**Decision**: Rejected - too slow for development workflow

---

## Success Criteria

1. **Core tests run in <3 minutes** - Validated by timing actual test runs
2. **CI never hits rate limits** - Monitor CI runs for 429 responses over 2 weeks
3. **Full suite completes without rate limit errors** - Run full suite 3x successfully
4. **Developer satisfaction** - Survey: "Do you know which tier to run?" (>80% yes)
5. **Test coverage maintained** - All existing integration tests still run in full suite

---

## Risk Mitigation

### Risk: Developers forget to tag new tests
**Mitigation**: Add lint rule or pre-commit hook to require tier tags on integration tests

### Risk: API call estimates are wrong
**Mitigation**: Start conservative (overestimate), log actual calls, refine over time

### Risk: YNAB changes rate limits
**Mitigation**: Make rate limit configurable via environment variable

### Risk: Full suite still hits rate limits
**Mitigation**: Increase buffer, add more aggressive throttling, reduce test count

---

## Future Enhancements

1. **Dynamic Tier Assignment**: Analyze test files to auto-assign tiers based on API call count
2. **Rate Limit Observability**: Dashboard showing rate limit usage over time
3. **Parallel Domain Testing**: Run multiple domains in parallel with coordinated throttling
4. **Smart Test Selection**: Only run integration tests for changed code paths
5. **Rate Limit Pooling**: Share rate limit budget across multiple developers

---

## References

- [INTEGRATION_TESTING.md](../guides/INTEGRATION_TESTING.md) - Full implementation guide
- [TESTING.md](../guides/TESTING.md) - Overall testing strategy
- [Vitest Projects](https://vitest.dev/guide/workspace) - Multi-project configuration
- [YNAB API Rate Limits](https://api.youneedabudget.com/#rate-limiting) - Official documentation

---

## Appendix: Example Test Files After Migration

### Before (No Tiers)
```typescript
// budgetTools.integration.test.ts
describe('Budget Tools Integration', () => {
  it('should list budgets', async () => {
    // Test
  });

  it('should get budget settings', async () => {
    // Test
  });
});
```

### After (With Tiers)
```typescript
// budgetTools.integration.test.ts
describe('Budget Tools Integration', () => {
  it('should list budgets', {
    meta: { tier: 'core', domain: 'budgets' }
  }, async () => {
    // Test - runs in core tier
  });

  it('should get budget settings', {
    meta: { tier: 'domain', domain: 'budgets' }
  }, async () => {
    // Test - runs in domain tier only
  });
});
```

---

## Next Steps

1. Review this design with team/stakeholders
2. Create GitHub issue to track implementation
3. Begin migration starting with Step 1 (tag tests)
4. Validate core tier works as expected before proceeding
5. Incrementally roll out domain tiers
6. Document learnings and update design if needed
