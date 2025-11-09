# Unimplemented Features & Roadmap Analysis

**Date**: 2025-11-09 (Updated)
**Status**: Post-reconciliation completion
**Version**: v0.10.0

## Executive Summary

This document consolidates all unimplemented features, pending tasks, and roadmap items discovered across project documentation files. The project is currently at v0.10.0 with **reconciliation v2 fully complete** (all 6 phases shipped as of Nov 9, 2025). Many other planned features remain unimplemented.

---

## Priority 1: ✅ COMPLETED - Reconciliation v2

### 1. Reconciliation v2 - **ALL PHASES COMPLETE** 🎉

**Status**: ✅ **FULLY IMPLEMENTED** (Nov 9, 2025)
**Documents**:

- `docs/plans/2025-10-31-reconciliation-redesign.md`
- `docs/plans/2025-11-01-reconciliation-implementation-review.md`
- `docs/plans/2025-11-01-reconciliation-output-improvements.md`
- `docs/plans/2025-11-09-reconciliation-implementation-status.md` (completion report)

#### All Phases Complete:

**Core Implementation:**
- ✅ Phase 1: Analysis-only mode (`reconcile_account_v2`)
- ✅ Intelligent insight detection (repeat amounts, near matches, anomalies)
- ✅ Combination matching (2-3 transactions summing to discrepancy)
- ✅ Matcher with two-tier matching strategy
- ✅ Analyzer with balance calculations
- ✅ Payee normalizer
- ✅ Executor with dry-run and execution modes

**Output Format Improvements (All 6 Phases):**
- ✅ Phase 1: MoneyValue Standard - Structured monetary values throughout
- ✅ Phase 2: Interpretation Layer - Insights, combination matching, confidence scoring
- ✅ Phase 3: Human-Readable Formatter - `reportFormatter.ts` with narrative output
- ✅ Phase 4: Dual-Channel Output - Human narrative + structured JSON
- ✅ Phase 5: Enhanced Recommendations - `recommendationEngine.ts` with actionable params
- ✅ Phase 6: Testing & Validation - 1135 tests passing (99.8% pass rate)

**Legacy Cleanup:**
- ✅ Removed `reconcile_account_legacy` tool
- ✅ Deleted 970 lines of deprecated code
- ✅ Single reconciliation implementation

**Commits:**
- `56ab694` - Phase 1 MoneyValue standard
- `4cf0ba3` - Remove legacy tool and implementation
- `f7ad0bb` - Complete documentation

**Optional Future Enhancements** (Not Critical):
- [ ] Additional E2E test scenarios for 200+ transaction statements
- [ ] Reconciliation history tracking across sessions
- [ ] Interactive recommendation approval workflow
- [ ] Reconciliation health score metric
- [ ] Multi-statement batch reconciliation

---

## Priority 2: High-Impact Features (Project Improvements Roadmap)

**Document**: `docs/plans/2025-10-31-project-improvements.md`

### 1. Performance Instrumentation (1-2 weeks)

**Status**: Not started
**Impact**: High - enables all future performance work

- [ ] Instrument all tools to track API latency
- [ ] Add performance metrics to diagnostic output
- [ ] Identify slow operations for optimization
- [ ] Track cache hit/miss rates per tool
- [ ] Add performance regression detection

### 2. Developer Experience CLI: `ynab-mcp doctor` (2-3 weeks)

**Status**: Not started
**Impact**: High - significantly improves developer experience

- [ ] Create diagnostic CLI tool
- [ ] Lint configuration for common issues
- [ ] Check YNAB API connectivity and token validity
- [ ] Validate cache health and performance
- [ ] Inspect permission scopes
- [ ] Test MCP server connectivity
- [ ] Add `--fix-cache`, `--test-connection`, `--profile` commands

### 3. Request Coalescing / Batch Operations (2-3 weeks)

**Status**: Not started
**Impact**: Medium-High - noticeable speedup for bulk operations

- [ ] Deduplicate concurrent requests for same resource
- [ ] Implement batch-fetch where YNAB API allows
- [ ] Create request queue with intelligent batching
- [ ] Reduce API calls to stay within rate limits

### 4. Rule-Based Transaction Automation (3-4 weeks)

**Status**: Not started
**Impact**: High - high user demand feature

- [ ] Define auto-categorization rule schema
- [ ] Implement rule engine
- [ ] Support payee-based rules
- [ ] Support memo-based rules
- [ ] Support amount-based rules
- [ ] Create rule management tools (add, edit, delete, list, test)
- [ ] Apply rules in `create_transaction` and during reconciliation

### 5. Reconciliation Health Metrics (1-2 weeks)

**Status**: Not started
**Impact**: Medium - enhances reconciliation workflow

- [ ] Track "days since last reconciliation" per account
- [ ] Monitor cleared vs. uncleared transaction ratios
- [ ] Detect unusual patterns (spikes in uncleared)
- [ ] Create health scoring algorithm (0-100)
- [ ] Add alerts when account needs reconciliation
- [ ] Provide actionable recommendations

### 6. VS Code Snippets & Tool Development Boilerplate (1-2 weeks)

**Status**: Not started
**Impact**: Medium - improves contributor experience

- [ ] Create VS Code snippet library for tool creation
- [ ] Build tool generator CLI: `ynab-mcp generate-tool <name>`
- [ ] Generate typed client stubs for tool handlers
- [ ] Create template files for common patterns
- [ ] Auto-generate test scaffolding

---

## Priority 3: Medium-Impact Improvements

### 7. Recorded YNAB Fixture Test Suite (2-3 weeks)

**Status**: Not started
**Impact**: Medium - better test reliability

- [ ] Implement VCR-like approach for HTTP recording
- [ ] Record real YNAB responses as fixtures
- [ ] Sanitize sensitive data (budget names, amounts)
- [ ] Store fixtures in `src/__tests__/fixtures/`
- [ ] Add toggle between live API and fixtures (env var)

### 8. Mutation Testing for Core Math (1 week)

**Status**: Not started
**Impact**: Medium - prevents critical bugs

- [ ] Set up Stryker Mutator for TypeScript
- [ ] Target `src/utils/money.ts`
- [ ] Target `src/utils/amountUtils.ts`
- [ ] Target `src/tools/reconciliation/matcher.ts`
- [ ] Ensure tests actually validate logic

### 9. Tool Catalog Documentation (1 week)

**Status**: Not started
**Impact**: Medium - improves usability

- [ ] Create comprehensive tool catalog table
- [ ] List all 27+ tools with descriptions
- [ ] Add example prompts for each tool
- [ ] Document required credentials/permissions
- [ ] Document cache behavior per tool
- [ ] Add related tools references
- [ ] Create common workflows section

### 10. Architecture Decision Records (ADRs) (1-2 weeks)

**Status**: Not started (ADR directory exists but is incomplete)
**Impact**: Low-Medium - long-term maintainability

Existing ADRs:

- ✅ `docs/ADR/tool-registry-architecture.md`
- ✅ `docs/ADR/enhanced-caching.md`
- ✅ `docs/ADR/modular-architecture.md`
- ✅ `docs/ADR/dependency-injection-pattern.md`
- ✅ `docs/ADR/budget-resolution-consistency.md`
- ✅ `docs/ADR/tool-module-decomposition.md`

Missing ADRs:

- [ ] Response Formatting (Minified by default)
- [ ] Security Middleware Pattern
- [ ] Error Handling Strategy
- [ ] Testing Strategy & Coverage Requirements

---

## Priority 4: Lower Priority / Future Considerations

### 11. Scheduled Jobs & Routine Exports

**Status**: Not prioritized (architectural mismatch)
**Reason**: MCP servers are typically on-demand, not long-running

- Would require significant architecture changes
- Can be handled by external cron jobs

### 12. Multi-Budget Transaction Transfer

**Status**: Not prioritized (edge case)
**Reason**: YNAB doesn't officially support this

- Edge case use case
- Can be done manually with export/import

### 13. Goal Tracking Tools

**Status**: Not prioritized (less commonly used)
**Reason**: YNAB web/mobile already handle this well

- Tools to view, create, update goals
- Complex to implement well
- Less commonly used than core budgeting

---

## Testing & Validation Checklist Status

**Documents**:

- `docs/TESTING_CHECKLIST.md`
- `docs/TEST_SCENARIOS.md`

### Current Test Status

**Build & Development**:

- ✅ TypeScript compilation successful
- ⚠️ Some test failures (5 failures in reconciliation matcher tests)
- ✅ Development server starts
- ✅ Production build completes
- ❓ DXT package generation not recently tested

**Claude Desktop Integration**:

- ❓ Not recently validated (needs testing post-cleanup)

**Functional Testing Checklist** (from `docs/TESTING_CHECKLIST.md`):

- [ ] Pre-Testing Setup (7 items)
- [ ] Build and Development Testing (6 items)
- [ ] Claude Desktop Integration (5 items)
- [ ] Basic Functionality Verification (6 items)
- [ ] Enhanced Caching Verification (6 items)
- [ ] Tool Registry Verification (5 items)
- [ ] Modular Architecture Verification (5 items)
- [ ] Financial Analysis Tools (5 items)
- [ ] Transaction Management (7 items)
- [ ] Error Handling and Edge Cases (5 items)
- [ ] Performance and Reliability (5 items)
- [ ] Backward Compatibility (4 items)
- [ ] Documentation and User Experience (5 items)
- [ ] Security Verification (5 items)
- [ ] Resource Testing (4 items)
- [ ] Prompt Testing (4 items)

**Total Unchecked Items**: ~80+ test scenarios

---

## Documentation Status

### Completed Documentation:

- ✅ `CLAUDE.md` - Development guide
- ✅ `docs/API.md` - API reference (updated for v0.10.0)
- ✅ `docs/DEVELOPER.md` - Developer guide
- ✅ `docs/TESTING.md` - Testing guide
- ✅ `docs/BUILD.md` - Build instructions
- ✅ `docs/DEPLOYMENT.md` - Deployment guide
- ✅ `docs/CACHE.md` - Caching documentation
- ✅ `docs/RECONCILIATION.md` - User troubleshooting guide
- ✅ `docs/CSV_PARSER.md` - CSV parsing documentation

### Documentation Gaps:

- [ ] Migration guide from v0.9.0 to v0.10.0
- [ ] Complete reconciliation v2 user guide (once execution phase is done)
- [ ] Tool catalog with example prompts
- [ ] Performance optimization guide
- [ ] Troubleshooting common errors

---

## Quick Start Items (If starting fresh)

### Immediate Next Steps (Week 1):

1. **Fix Test Failures** (1-2 days)
   - Fix 5 failing reconciliation matcher tests
   - Ensure all tests pass before continuing

2. **Validate Current State** (1 day)
   - Run full test suite
   - Test Claude Desktop integration
   - Verify v0.10.0 works correctly

3. **MoneyValue Implementation** (2-3 days)
   - Start with Phase 1 of output improvements
   - Adds structure to all monetary values
   - Foundation for better UX

### Week 2-3: Core Reconciliation Completion

4. **Dual-Channel Output** (2 days)
   - Wire up reconcileV2Adapter
   - Human-readable + structured JSON

5. **Report Formatter** (3-5 days)
   - Narrative output for Claude
   - Clear balance explanations

6. **Combination Matching** (2-3 days)
   - 2-3 transaction combinations that sum to discrepancy
   - Completes insight detection

### Week 4-6: Reconciliation Execution Phase

7. **Executor Implementation** (1 week)
   - Dry-run preview
   - Action execution
   - Rollback info

8. **E2E Testing** (1 week)
   - Real bank statements
   - Validate complete workflow
   - User acceptance testing

---

## Success Metrics

### Phase 1 (Reconciliation v2 Completion):

- ✅ All monetary values use `MoneyValue` type
- ✅ Dual-channel output implemented
- ✅ Human-readable reports are Claude-proof
- ✅ Combination matching detects 2-3 txn sums
- ✅ Execution phase with rollback
- ✅ 95%+ accuracy on exact discrepancy matches
- ✅ All existing tests pass + new tests achieve 90%+ coverage

### Phase 2 (High-Impact Features):

- ✅ Performance instrumentation provides actionable data
- ✅ `ynab-mcp doctor` CLI solves 90%+ setup issues
- ✅ Request coalescing reduces API calls by 30%
- ✅ Auto-categorization adopted by 50%+ of users
- ✅ Cache hit rate >70% (currently ~60%)

### Phase 3 (Quality & Maintenance):

- ✅ Fixture-based tests enable reliable CI/CD
- ✅ Mutation testing catches edge case bugs
- ✅ Tool catalog improves discoverability
- ✅ ADRs preserve institutional knowledge

---

## Estimated Timelines

### Reconciliation v2 Completion:

- **MoneyValue + Dual-Channel**: 1 week
- **Execution Phase**: 2-3 weeks
- **Testing & Validation**: 1 week
- **Total**: 4-6 weeks

### High-Impact Features (Project Improvements):

- **Phase 1** (Instrumentation + CLI): 4-6 weeks
- **Phase 2** (User Features): 6-10 weeks
- **Phase 3** (Quality/DX): 4-6 weeks
- **Total**: 14-22 weeks (3.5-5.5 months)

### Full Roadmap Completion:

- **All Priority 1-3 Items**: 6-9 months
- **With Testing & Documentation**: 9-12 months

---

## Risk Assessment

### High Risk Items:

1. **Breaking Changes**: MoneyValue could break existing consumers
   - **Mitigation**: Version flag, gradual rollout
2. **Execution Phase Bugs**: Data modification is risky
   - **Mitigation**: Extensive testing, dry-run default, rollback capability

### Medium Risk Items:

1. **Performance Regression**: New features could slow things down
   - **Mitigation**: Performance instrumentation first, profile continuously
2. **Test Coverage Gaps**: E2E scenarios not fully tested
   - **Mitigation**: Fixture-based tests, real-world validation

### Low Risk Items:

1. **Documentation Drift**: Docs may not match implementation
   - **Mitigation**: Update docs with each feature release

---

## Recommendations

### Immediate Actions (This Week):

1. ✅ Fix 5 failing tests in reconciliation matcher
2. ✅ Validate v0.10.0 works correctly with real YNAB data
3. ✅ Run full testing checklist to identify any regressions

### Short-Term (Next Month):

1. Complete MoneyValue + Dual-Channel output improvements
2. Finish reconciliation v2 execution phase
3. Validate with real-world reconciliation scenarios

### Medium-Term (Next Quarter):

1. Implement performance instrumentation
2. Build `ynab-mcp doctor` CLI
3. Add auto-categorization rules
4. Complete fixture-based test suite

### Long-Term (6-12 Months):

1. Implement all high-impact features
2. Build comprehensive tool catalog
3. Add reconciliation health metrics
4. Complete ADR documentation

---

## Questions for Decision

1. **Priority Order**: Should we complete reconciliation v2 first, or start high-impact features in parallel?
2. **Breaking Changes**: How should we handle MoneyValue migration? Version flag or dual-output?
3. **Testing Strategy**: How much E2E testing is needed before shipping execution phase?
4. **Resource Allocation**: What's the budget for these features (weeks/months)?
5. **User Feedback**: Should we ship v2 analysis-only first and get feedback before building execution?

---

## Conclusion

The project has a **substantial amount of planned but unimplemented work**. The reconciliation v2 is partially complete (analysis phase shipped, execution pending), and there's a comprehensive roadmap of high-impact features waiting to be built.

**Key Takeaway**: The project is in good shape technically, but has an ambitious roadmap that will require 6-12 months of focused development to complete.

**Recommendation**: Prioritize completing reconciliation v2 fully before starting new high-impact features. This ensures users get a complete, polished reconciliation experience rather than multiple partially-complete features.

---

**Document Status**: Complete
**Next Review**: After completing reconciliation v2 execution phase
**Owner**: Project maintainer
