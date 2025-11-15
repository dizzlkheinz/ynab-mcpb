# Integration Testing Strategy for YNAB MCP Server

## Philosophy

**Integration tests should test real API interactions, not mocks.** This project uses a tiered testing strategy that works within YNAB's rate limits while maintaining test quality and fast feedback loops.

## YNAB API Constraints

- **Rate Limit**: 200 requests per access token per hour (rolling window)
- **No Official Sandbox**: YNAB does not provide a test/sandbox environment for API development
- **Real Data**: Tests run against real YNAB budgets (recommend using a dedicated test budget)

---

## Testing Tiers

### Tier 1: Core/Smoke Tests (~10-15 API calls, <3 minutes)

**Purpose**: Essential functionality verification during active development

**What's Tested**:
- List budgets
- Get single budget by ID
- List accounts for a budget
- Basic transaction CRUD (create, read, update, delete - one of each)
- Get user info

**When to Run**:
- Before every commit
- During active development (frequent)
- In CI/CD pipelines

**Rate Limit Impact**: Negligible (~10-15 calls = ~7-8% of hourly limit)

**NPM Script**: `npm run test:integration:core`

---

### Tier 2: Domain Tests (~30-50 API calls per domain, 5-10 minutes)

**Purpose**: Comprehensive testing of specific feature areas you're actively working on

**Domains**:
- **Budget Tools**: Budget listing, retrieval, settings
- **Account Tools**: Account management, balances, reconciliation
- **Transaction Tools**: Full CRUD, bulk operations, filtering
- **Category Tools**: Category management, activity tracking
- **Payee Tools**: Payee management and transactions
- **Month Tools**: Monthly budget data, rollover calculations
- **Delta Operations**: Server knowledge tracking, incremental updates
- **Reconciliation**: Account reconciliation workflows, recommendation engine

**When to Run**:
- When working on a specific domain (selective testing)
- Before committing changes to a domain
- In PR validation for changed domains only

**Rate Limit Impact**: Moderate (one domain = ~15-25% of hourly limit)

**NPM Scripts**:
- `npm run test:integration:budgets`
- `npm run test:integration:accounts`
- `npm run test:integration:transactions`
- `npm run test:integration:categories`
- `npm run test:integration:payees`
- `npm run test:integration:reconciliation`
- `npm run test:integration:delta`

**Throttling**: Light delays between test files (5-10 seconds) to avoid bursts

---

### Tier 3: Full Integration Suite (~200 API calls, 2-3 hours)

**Purpose**: Comprehensive validation of entire system before releases or major changes

**What's Tested**: All integration tests across all domains

**When to Run**:
- Before releases (manual trigger)
- Nightly or weekly (scheduled)
- After major refactoring
- On-demand for comprehensive validation

**Rate Limit Impact**: Uses full hourly quota (~100% of rate limit)

**NPM Script**: `npm run test:integration:full`

**Throttling**: Intelligent rate-limit-aware pacing:
- Monitors API rate limit headers (`X-Rate-Limit-Remaining`)
- Automatically delays test execution to stay under 200 requests/hour
- Spreads tests over 2-3 hours with smart scheduling
- Safe to run unattended - will never hit rate limits

---

## Test Organization

### File Structure

```
src/
├── __tests__/
│   ├── unit/                          # Unit tests (mocked, no API)
│   └── testUtils.ts                   # Shared test utilities
├── server/__tests__/
│   ├── *.test.ts                      # Unit tests
│   └── *.integration.test.ts          # Integration tests (tagged by tier)
└── tools/__tests__/
    ├── *.test.ts                      # Unit tests
    ├── *.integration.test.ts          # Integration tests (tagged by tier)
    └── *.delta.integration.test.ts    # Delta-specific integration tests
```

### Test Tagging

Integration tests are tagged with metadata to enable tier-based filtering:

```typescript
import { describe, it, expect } from 'vitest';

describe('Budget Tools Integration', () => {
  it('should list budgets', {
    meta: { tier: 'core', domain: 'budgets' }
  }, async () => {
    // Test implementation
  });

  it('should get budget settings', {
    meta: { tier: 'domain', domain: 'budgets' }
  }, async () => {
    // Test implementation
  });
});
```

---

## Rate Limit Management

### Throttling Implementation

**Core Tests**: No throttling needed (fast execution)

**Domain Tests**: Light throttling between test files
```typescript
// Delay between test files in same domain
const DOMAIN_TEST_DELAY_MS = 5000; // 5 seconds
```

**Full Suite**: Intelligent throttling based on rate limit headers
```typescript
// Rate limit aware test scheduler
class RateLimitScheduler {
  async scheduleTest(testFn: () => Promise<void>) {
    const remainingCalls = this.getRemainingFromHeaders();
    const estimatedCallsInTest = this.estimateAPICalls(testFn);

    if (remainingCalls < estimatedCallsInTest + 20) { // 20 call buffer
      const waitTime = this.calculateWaitTime();
      console.log(`Rate limit approaching, waiting ${waitTime}ms...`);
      await this.sleep(waitTime);
    }

    await testFn();
  }

  private calculateWaitTime(): number {
    // Calculate time until rate limit window resets
    // Based on X-Rate-Limit-Reset header
    return this.getResetTime() - Date.now();
  }
}
```

### Best Practices

1. **Monitor Rate Limit Headers**: Always check `X-Rate-Limit-Remaining` and `X-Rate-Limit-Reset` in responses
2. **Fail Gracefully**: If rate limit hit, pause tests and resume after reset window
3. **Estimate API Calls**: Track approximate API calls per test for scheduling
4. **Use Delta Requests**: Prefer delta/incremental API calls when possible to reduce response size
5. **Cache Aggressively**: Use cached data in tests when fresh data isn't required

---

## Vitest Configuration

### Project Setup

```typescript
// vitest.config.ts
import { defineConfig } from 'vitest/config';

const integrationFiles = ['src/**/*.integration.test.ts'];

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    setupFiles: ['src/__tests__/setup.ts'],
    projects: [
      {
        test: {
          name: 'unit',
          include: ['src/**/*.{test,spec}.ts'],
          exclude: [
            'src/**/*.integration.test.ts',
            'src/**/*.e2e.test.ts',
            'src/server/__tests__/YNABMCPServer.test.ts',
          ],
        },
      },
      {
        test: {
          name: 'integration:core',
          include: integrationFiles,
          env: { INTEGRATION_TEST_TIER: 'core' },
          testTimeout: 30000,
          hookTimeout: 10000,
        },
      },
      {
        test: {
          name: 'integration:domain',
          include: integrationFiles,
          env: { INTEGRATION_TEST_TIER: 'domain' },
          testTimeout: 60000,
          hookTimeout: 15000,
        },
      },
      {
        test: {
          name: 'integration:full',
          include: integrationFiles,
          env: { INTEGRATION_TEST_TIER: 'full' },
          testTimeout: 120000,
          hookTimeout: 30000,
          fileParallelism: false,
          maxWorkers: 1,
        },
      },
      {
        test: {
          name: 'e2e',
          include: ['src/**/*.e2e.test.ts'],
        },
      },
    ],
  },
});
```

---

## NPM Scripts

```json
{
  "scripts": {
    "test": "vitest run --project unit",
    "test:unit": "vitest run --project unit",
    "test:watch": "vitest --project unit",

    "test:integration": "npm run test:integration:core",
    "test:integration:core": "vitest run --project integration:core",
    "test:integration:full": "node scripts/run-throttled-integration-tests.js",

    "test:integration:budgets": "node scripts/run-domain-integration-tests.js budgets",
    "test:integration:accounts": "node scripts/run-domain-integration-tests.js accounts",
    "test:integration:transactions": "node scripts/run-domain-integration-tests.js transactions",
    "test:integration:categories": "node scripts/run-domain-integration-tests.js categories",
    "test:integration:payees": "node scripts/run-domain-integration-tests.js payees",
    "test:integration:months": "node scripts/run-domain-integration-tests.js months",
    "test:integration:reconciliation": "node scripts/run-domain-integration-tests.js reconciliation",
    "test:integration:delta": "node scripts/run-domain-integration-tests.js delta",

    "test:all": "npm run test:unit && npm run test:integration:core",
    "test:coverage": "vitest run --coverage --project unit"
  }
}
```

Each domain script routes through `scripts/run-domain-integration-tests.js`, which sets the `INTEGRATION_TEST_DOMAINS` environment variable so only tests tagged with those domains execute. You can target multiple domains at once (for example `node scripts/run-domain-integration-tests.js budgets accounts`) or pass additional Vitest flags after `--`.

---

## CI/CD Integration

### GitHub Actions Example

```yaml
name: CI Tests

on: [push, pull_request]

jobs:
  unit-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - run: npm ci
      - run: npm run test:unit

  integration-core:
    runs-on: ubuntu-latest
    needs: unit-tests
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - run: npm ci
      - run: npm run test:integration:core
        env:
          YNAB_ACCESS_TOKEN: ${{ secrets.YNAB_ACCESS_TOKEN }}

  integration-full:
    runs-on: ubuntu-latest
    # Only run on schedule (nightly) or manual trigger
    if: github.event_name == 'schedule' || github.event_name == 'workflow_dispatch'
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - run: npm ci
      - run: npm run test:integration:full
        env:
          YNAB_ACCESS_TOKEN: ${{ secrets.YNAB_ACCESS_TOKEN }}
```

**CI Strategy**:
- **Every Push**: Unit tests only
- **Every PR**: Unit tests + core integration tests (~10-15 API calls)
- **Nightly/Weekly**: Full integration suite (scheduled)
- **Manual**: Full integration suite (on-demand via workflow_dispatch)

---

## Environment Variables

```bash
# .env.test
# YNAB API Configuration
YNAB_ACCESS_TOKEN=your_token_here

# Test Configuration
TEST_BUDGET_ID=optional_specific_budget_id
TEST_ACCOUNT_ID=optional_specific_account_id

# Integration Test Behavior
INTEGRATION_TEST_TIER=core          # core | domain | full
INTEGRATION_TEST_DOMAINS=           # comma-separated domains for domain tier
SKIP_INTEGRATION_TESTS=false        # Set to true to skip all integration tests
INTEGRATION_THROTTLE_MS=5000        # Delay between domain tests (milliseconds)

# Rate Limit Configuration
RATE_LIMIT_PER_HOUR=200             # Base rate limit before applying buffer
RATE_LIMIT_BUFFER=20                # Reserve N calls before throttling
RATE_LIMIT_WINDOW_MS=3600000        # Window length (1 hour)
RATE_LIMIT_MAX_WAIT_MS=3600000      # Max wait time for rate limit reset (1 hour)
```

---

## Tier Assignment Guidelines

### Core Tier (Fast, Frequent)

Assign tests to **core** tier if they:
- ✅ Test fundamental, critical-path functionality
- ✅ Are needed for basic confidence before committing
- ✅ Make 1-2 API calls per test
- ✅ Run in under 5 seconds (including network latency)
- ✅ Don't depend on complex state or multiple resources

**Example Core Tests**:
- `GET /budgets` - List all budgets
- `GET /budgets/{budget_id}` - Get single budget
- `GET /budgets/{budget_id}/accounts` - List accounts
- `POST /budgets/{budget_id}/transactions` - Create transaction
- `GET /user` - Get user info

### Domain Tier (Selective, Thorough)

Assign tests to **domain** tier if they:
- ✅ Test comprehensive functionality within a specific domain
- ✅ Are needed when working on that specific feature area
- ✅ Make 3-10 API calls per test
- ✅ Test edge cases, error handling, or complex workflows
- ✅ May depend on multiple resources or state

**Example Domain Tests**:
- Full transaction CRUD workflow
- Account reconciliation with recommendations
- Category group management and reordering
- Delta request handling with server_knowledge
- Bulk transaction operations
- Month-to-month rollover calculations

### Full Suite (Comprehensive, Scheduled)

All integration tests run in **full** tier, including:
- ✅ All core tests
- ✅ All domain tests
- ✅ Performance tests
- ✅ Stress tests
- ✅ Long-running scenarios

---

## Delta Integration Tests

Delta tests (`*.delta.integration.test.ts`) require special handling due to their stateful nature:

### Challenge
Delta requests track `server_knowledge` - a monotonically increasing value that represents server state. Sequential delta requests depend on previous responses.

### Strategy
1. **Initialize Fresh**: Each delta test starts with a fresh API client (no cached server_knowledge)
2. **Test Sequence**: Test both initial fetch AND subsequent delta request in same test
3. **Validate Incremental**: Verify that delta responses are smaller than full responses
4. **Reset State**: Clean up any created test data to avoid polluting future delta tests

### Example Delta Test

```typescript
describe('Delta Integration', () => {
  it('should fetch initial data and then delta updates', {
    meta: { tier: 'domain', domain: 'delta' }
  }, async () => {
    // Initial fetch (no server_knowledge)
    const initial = await api.budgets.getBudgetById(budgetId);
    const serverKnowledge = initial.data.server_knowledge;

    // Create a change
    await api.transactions.createTransaction(budgetId, { /* ... */ });

    // Delta fetch (with server_knowledge)
    const delta = await api.budgets.getBudgetById(budgetId, serverKnowledge);

    // Verify delta is smaller than full response
    expect(delta.data.transactions.length).toBeLessThan(initial.data.transactions.length);
    expect(delta.data.server_knowledge).toBeGreaterThan(serverKnowledge);
  });
});
```

---

## Throttled Test Runner

The full integration suite uses a custom test runner that intelligently throttles API calls:

```typescript
// scripts/run-throttled-integration-tests.js
import { spawn } from 'child_process';
import { readFileSync } from 'fs';

class ThrottledTestRunner {
  constructor() {
    this.rateLimit = 200; // requests per hour
    this.rateLimitWindow = 3600000; // 1 hour in ms
    this.buffer = 20; // safety buffer
    this.requestHistory = [];
  }

  async run() {
    // Get all integration test files
    const testFiles = this.getIntegrationTests();

    for (const testFile of testFiles) {
      await this.runWithThrottling(testFile);
    }
  }

  async runWithThrottling(testFile) {
    // Check if we need to throttle
    const recentRequests = this.getRecentRequests();

    if (recentRequests >= this.rateLimit - this.buffer) {
      const waitTime = this.calculateWaitTime();
      console.log(`⏳ Rate limit approaching (${recentRequests}/${this.rateLimit} calls)`);
      console.log(`   Waiting ${Math.round(waitTime / 60000)} minutes...`);
      await this.sleep(waitTime);
    }

    // Run test
    console.log(`▶️  Running ${testFile}...`);
    await this.runTest(testFile);

    // Track request count (estimate based on test file)
    const estimatedCalls = this.estimateAPICalls(testFile);
    this.requestHistory.push({
      timestamp: Date.now(),
      calls: estimatedCalls,
    });
  }

  getRecentRequests() {
    const cutoff = Date.now() - this.rateLimitWindow;
    this.requestHistory = this.requestHistory.filter(r => r.timestamp > cutoff);
    return this.requestHistory.reduce((sum, r) => sum + r.calls, 0);
  }

  calculateWaitTime() {
    if (this.requestHistory.length === 0) return 0;

    const oldestRequest = this.requestHistory[0];
    const timeUntilExpiry = (oldestRequest.timestamp + this.rateLimitWindow) - Date.now();

    return Math.max(timeUntilExpiry, 60000); // At least 1 minute
  }

  estimateAPICalls(testFile) {
    // Parse test file for API call estimates
    // Could use static analysis or embedded metadata
    // For now, use conservative estimates based on test type

    if (testFile.includes('delta')) return 15;
    if (testFile.includes('reconciliation')) return 25;
    if (testFile.includes('transaction')) return 12;
    if (testFile.includes('budget')) return 8;

    return 10; // default estimate
  }

  async runTest(testFile) {
    return new Promise((resolve, reject) => {
      const proc = spawn('npx', ['vitest', 'run', testFile], {
        stdio: 'inherit',
        env: { ...process.env },
      });

      proc.on('close', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`Test failed with code ${code}`));
      });
    });
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  getIntegrationTests() {
    // Use glob or similar to find all *.integration.test.ts files
    // Return sorted array of test file paths
  }
}

// Run it
const runner = new ThrottledTestRunner();
runner.run().catch(console.error);
```

---

## Migration Path

### Current State (v0.10.0)
- ✅ 21 integration test files exist
- ⚠️ All tests hit real API without throttling
- ⚠️ No tier organization
- ⚠️ Rate limits cause test failures

### Target State
- ✅ Integration tests organized into 3 tiers
- ✅ Core tests run frequently (CI, pre-commit)
- ✅ Domain tests run selectively (feature work)
- ✅ Full suite runs scheduled/on-demand with throttling
- ✅ CI runs only unit + core tests
- ✅ Never hit rate limits

### Migration Steps

1. **Tag Existing Tests** (1-2 hours)
   - Add `meta: { tier, domain }` to all integration tests
   - Identify 8-10 tests for core tier
   - Organize remaining tests by domain

2. **Update Vitest Config** (30 minutes)
   - Create `integration:core`, `integration:domain`, `integration:full` projects
   - Configure test filtering by tier
   - Set appropriate timeouts per tier

3. **Create NPM Scripts** (15 minutes)
   - Add tier-specific test scripts
   - Add domain-specific test scripts
   - Update default `test:integration` to run core tier

4. **Implement Throttled Runner** (2-3 hours)
   - Create `scripts/run-throttled-integration-tests.js`
   - Implement rate limit tracking and scheduling
   - Add API call estimation logic
   - Test with subset of integration tests

5. **Update CI Configuration** (30 minutes)
   - Configure CI to run unit + core only on PRs
   - Set up scheduled full suite runs (nightly/weekly)
   - Add manual trigger for full suite

6. **Document Workflow** (1 hour)
   - Update developer documentation
   - Create examples for each tier
   - Document when to run which tier

7. **Validate** (2-3 hours)
   - Run core tier locally (should be fast)
   - Run domain tiers selectively
   - Run full suite with throttling (validate no rate limit hits)
   - Verify CI runs successfully

**Total Effort**: ~8-12 hours

---

## Best Practices

### 1. Test Data Management
- **Use Dedicated Test Budget**: Create a YNAB budget specifically for testing
- **Consistent Test Data**: Use predictable account/category names for easier test writing
- **Clean Up After Tests**: Delete created transactions/payees to keep budget clean
- **Idempotent Tests**: Tests should be repeatable without manual cleanup

### 2. Rate Limit Awareness
- **Monitor Headers**: Always log rate limit headers during full suite runs
- **Buffer Safety**: Never use more than 180 calls in full suite (leave 20 call buffer)
- **Graceful Degradation**: If rate limit hit, pause and resume (don't fail)
- **Estimate Conservatively**: Overestimate API calls per test for safer throttling

### 3. Test Organization
- **Core = Critical Path**: Only include must-have functionality in core tier
- **Domain = Feature Work**: Group tests by domain for selective running
- **Full = Scheduled**: Accept that full suite is slow, run overnight/weekly
- **Tag Consistently**: Use consistent tier/domain tags for filtering

### 4. CI/CD Strategy
- **Fast Feedback**: Unit + core tests should complete in <5 minutes
- **PR Validation**: Core tests catch regressions without burning rate limits
- **Scheduled Deep Tests**: Full suite runs when you're not waiting for results
- **Manual Override**: Allow manual full suite runs for pre-release validation

---

## Troubleshooting

### Rate Limit Exceeded During Tests

**Symptoms**: Tests fail with 429 responses or HTML error pages

**Solutions**:
1. Check recent API usage: `grep "X-Rate-Limit-Remaining" test-output.log`
2. Wait for rate limit window to reset (check `X-Rate-Limit-Reset` header)
3. Reduce test scope: Run domain tests instead of full suite
4. Increase throttling: Adjust `INTEGRATION_THROTTLE_MS` environment variable

### Tests Failing Inconsistently

**Symptoms**: Same test passes/fails on different runs

**Possible Causes**:
- Network issues (timeouts, latency)
- YNAB API throttling (not rate limit, but request pacing)
- State pollution (previous test didn't clean up)
- Delta state issues (server_knowledge out of sync)

**Solutions**:
- Increase test timeouts: `testTimeout: 60000`
- Add retry logic for network errors
- Ensure tests clean up created resources
- Reset delta state between tests

### Full Suite Takes Too Long

**Symptoms**: Full suite exceeds expected 2-3 hour window

**Solutions**:
- Reduce throttling buffer: Lower `RATE_LIMIT_BUFFER` (but risk hitting limits)
- Optimize tests: Combine multiple assertions into single API call
- Remove redundant tests: Eliminate duplicate coverage
- Use delta requests: Prefer incremental fetches over full data

### CI Running Out of Rate Limits

**Symptoms**: CI fails due to rate limits on every PR

**Solutions**:
- Verify CI only runs core tier: Check workflow uses `test:integration:core`
- Reduce core tier tests: Move less critical tests to domain tier
- Use separate YNAB token for CI: Isolate CI rate limits from dev
- Implement CI-level throttling: Add delays between workflow runs

---

## Resources

### YNAB API
- **API Documentation**: https://api.youneedabudget.com/
- **Rate Limits**: 200 requests/hour per token (rolling window)
- **SDK**: https://github.com/ynab/ynab-sdk-js
- **Support**: https://support.youneedabudget.com/

### Testing Tools
- **Vitest**: https://vitest.dev/
- **Vitest Projects**: https://vitest.dev/guide/workspace
- **GitHub Actions**: https://docs.github.com/en/actions

### Related Documentation
- [Testing Guide](./TESTING.md) - Comprehensive testing documentation
- [Build Guide](../development/BUILD.md) - Build and development workflow
- [Deployment Guide](./DEPLOYMENT.md) - Deployment and packaging

---

## Conclusion

This tiered integration testing strategy provides:

✅ **Fast Feedback**: Core tests run in <3 minutes for quick validation
✅ **Selective Testing**: Domain tests focus on areas you're actively developing
✅ **Comprehensive Coverage**: Full suite validates entire system before releases
✅ **Rate Limit Safety**: Intelligent throttling prevents API limit exhaustion
✅ **CI/CD Friendly**: Lightweight core tests don't burn rate limits on every PR
✅ **Real API Testing**: No mocks - tests validate actual YNAB API behavior

**The key insight**: Not all integration tests need to run all the time. Organize tests by purpose and run them at the right frequency to balance speed, coverage, and rate limits.
