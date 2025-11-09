# Reconciliation Tool Output Format Improvements

**Date:** 2025-11-01 (updated Nov 9, 2025)
**Status:** ✅ **COMPLETE** - All 6 Phases Implemented
**Priority:** High (User Experience Critical)

**Update (Nov 9, 2025):** All phases complete! `reconcile_account` (powered by v2 implementation) now delivers:
- ✅ Phase 1: MoneyValue standard throughout
- ✅ Phase 2: Interpretation layer with insights and combination matching
- ✅ Phase 3: Human-readable narrative formatter
- ✅ Phase 4: Dual-channel output (narrative + JSON)
- ✅ Phase 5: Actionable recommendations with executable parameters
- ✅ Phase 6: Comprehensive test coverage (1135 tests passing)

Legacy `reconcile_account_legacy` tool has been removed. See `2025-11-09-reconciliation-implementation-status.md` for full details.

## Executive Summary

The reconciliation tool (`reconcile_account`) currently returns technically correct data but in a format that causes AI assistants (Claude) to misinterpret results, leading to a "miserable" user experience. This plan addresses three critical failures:

1. **Balance misreading** - Claude misread the cleared balance from tool output
2. **Discrepancy direction confusion** - Got confused about which direction $22.22 was out
3. **Missing obvious insights** - Didn't notice a $22.22 transaction that exactly matched the $22.22 discrepancy

## Problem Analysis

### Root Causes (per Codex consultation)

1. **Minified JSON without context** - Forces assistants to reverse-engineer structure with numbers like `123456` having no unit labels
2. **Mixed monetary formats** - Milliunits (integers) and dollar strings with no metadata causes sign/scale errors
3. **Generic recommendations** - Detached from actual discrepancies, miss obvious patterns
4. **No interpretation layer** - Raw data without direction, severity, or root cause analysis

### Key Insight

**The tool bug was NOT in the code - it was in how Claude interpreted the JSON output.**

This means we need to design the output format to be "Claude-proof" rather than just technically correct.

## Solution Architecture

### Design Principle

**"Human-first with machine-readable fallback"** - The primary output should be immediately understandable by an AI assistant presenting to a human, with structured data available for automation.

### Recommended Approach: Dual-Channel Response

```typescript
// Tool returns TWO text blocks in content array:
{
  content: [
    {
      type: "text",
      text: "📊 RECONCILIATION REPORT\n\n..." // Human-readable narrative
    },
    {
      type: "text",
      text: "{\"version\":\"2.0\",\"data\":{...}}" // Structured JSON
    }
  ]
}
```

## Implementation Plan

### Phase 1: Money Object Standard (Week 1, 2-3 days)

**Goal:** Eliminate all monetary value ambiguity

**Status:** Not started – MoneyValue helper and schema wiring still pending.

#### Tasks

1. **Create `MoneyValue` type and formatter**
   - File: `src/utils/money.ts`
   - Add interface:
     ```typescript
     export interface MoneyValue {
       value_milliunits: number;      // -22220
       value_display: string;         // "$22.22"
       currency: string;               // "USD"
       direction: "owed" | "credit"; // For credit cards
     }

     export function formatMoney(milliunits: number, accountType: "creditCard" | "checking" | ...): MoneyValue {
       return {
         value_milliunits: milliunits,
         value_display: `$${Math.abs(milliunits / 1000).toFixed(2)}`,
         currency: "USD",
         direction: milliunits < 0 ? "owed" : "credit"
       };
     }
     ```

2. **Update `ReconciliationResult` interface**
   - File: `src/tools/reconcileAccount.ts`
   - Replace all `balance: number` with `balance: MoneyValue`
   - Update these fields:
     - `account_balance.before.cleared_balance`
     - `account_balance.after.cleared_balance`
     - `precision_calculations.discrepancy_dollars` → `discrepancy: MoneyValue`
     - All transaction amounts in matches/missing arrays

3. **Write unit tests**
   - File: `src/utils/__tests__/money.test.ts`
   - Test positive/negative amounts
   - Test credit card vs checking accounts
   - Test display formatting

**Success Criteria:**
- All monetary values use `MoneyValue` type
- No raw milliunits or dollars exposed to output
- Tests pass with 100% coverage

---

### Phase 2: Interpretation Layer (Week 1-2, 3-4 days)

**Goal:** Add intelligent analysis that highlights key insights

**Status:** Delivered in v0.9.0 – analyzer + insight detection shipped with `reconcile_account_v2`; combination matching still pending.

#### Tasks

1. **Create reconciliation analyzer**
   - File: `src/tools/reconciliation/analyzer.ts`
   - Implement `analyzeDiscrepancy()`:
     ```typescript
     interface DiscrepancyAnalysis {
       has_discrepancy: boolean;
       discrepancy_amount: MoneyValue;
       direction: "bank_higher" | "ynab_higher" | "balanced";
       confidence: number;
       likely_causes: Array<{
         type: "missing_transaction" | "uncleared_transaction" | "bank_fee" | "unknown";
         description: string;
         confidence: number;
         suggested_action: string;
         evidence: Array<{
           transaction_date: string;
           transaction_description: string;
           transaction_amount: MoneyValue;
           match_type: "exact_amount" | "partial_match";
         }>;
       }>;
     }
     ```

2. **Implement exact-match detection**
   - Function: `findExactDiscrepancyMatches()`
   - Logic:
     ```typescript
     // For each unmatched bank transaction:
     if (Math.abs(transaction.amount - discrepancy) < 10) { // Within $0.01
       return {
         type: "missing_transaction",
         confidence: 1.0,
         description: `Transaction "${txn.description}" for ${txn.amount} exactly matches the discrepancy`,
         suggested_action: "Create this transaction and mark it cleared",
         evidence: [transaction]
       };
     }
     ```

3. **Implement multi-transaction analysis**
   - Function: `findCombinationMatches()`
   - Check if 2-3 unmatched transactions sum to discrepancy
   - Confidence: 0.8 for 2 transactions, 0.6 for 3

4. **Add callouts array**
   - High-priority insights for Claude to surface
   - Format:
     ```typescript
     callouts: [
       {
         severity: "critical" | "warning" | "info",
         message: "⚠️ EvoCarShare $22.22 exactly matches your $22.22 discrepancy",
         action_recommendation: "create_and_clear",
         transaction_id: "bank_txn_58"
       }
     ]
     ```

**Success Criteria:**
- Exact amount matches detected with 100% accuracy
- Multi-transaction matches detected for 2-3 combinations
- Callouts clearly identify resolution path
- Unit tests cover all scenarios

**Delivery Notes (Nov 2, 2025):**
- Analyzer + insight detection are live; repeated-amount and near-match signals cover the original $22.22 scenario.
- Combination matching heuristics are not yet implemented and remain an open item for this phase.
- Callouts are exposed via the `insights` array; rename/refine once the MoneyValue refactor lands.

---

### Phase 3: Human-Readable Formatter (Week 2, 3-5 days)

**Goal:** Create narrative output that Claude can't misinterpret

**Status:** Not started – narrative formatter exists only as draft in `reconcileV2Adapter`.

#### Tasks

1. **Create reconciliation report formatter**
   - File: `src/tools/reconciliation/reportFormatter.ts`
   - Implement `formatHumanReadableReport()`:
     ```typescript
     function formatHumanReadableReport(
       result: ReconciliationResult,
       analysis: DiscrepancyAnalysis
     ): string {
       return `
     📊 ${accountName} Reconciliation Report
     Statement Period: ${startDate} to ${endDate}

     ═══════════════════════════════════════
     BALANCE CHECK
     ═══════════════════════════════════════
     ✓ YNAB Cleared Balance: ${ynabBalance.value_display} (${ynabBalance.direction})
     ✓ Statement Balance: ${statementBalance.value_display} (${statementBalance.direction})
     ${analysis.has_discrepancy ? `
     ❌ DISCREPANCY: ${analysis.discrepancy_amount.value_display}
        Direction: ${analysis.direction === 'bank_higher' ? 'Statement shows MORE owed' : 'YNAB shows MORE owed'}
     ` : '✅ BALANCES MATCH PERFECTLY'}

     ═══════════════════════════════════════
     TRANSACTION ANALYSIS
     ═══════════════════════════════════════
     ✓ Automatically matched: ${matchCount} of ${totalBankTransactions} transactions
     ${unmatchedBankCount > 0 ? `
     ❌ UNMATCHED BANK TRANSACTIONS (${unmatchedBankCount}):
     ${unmatchedBankTransactions.map(t => `   ${t.date} - ${t.description} - ${t.amount.value_display}`).join('\n')}
     ` : '✓ ALL BANK TRANSACTIONS MATCHED'}

     ${analysis.likely_causes.length > 0 ? `
     ═══════════════════════════════════════
     LIKELY CAUSE
     ═══════════════════════════════════════
     ${analysis.likely_causes[0].description}

     Confidence: ${(analysis.likely_causes[0].confidence * 100).toFixed(0)}%
     Evidence:
     ${analysis.likely_causes[0].evidence.map(e => `   • ${e.transaction_date} - ${e.transaction_description} - ${e.transaction_amount.value_display}`).join('\n')}
     ` : ''}

     ═══════════════════════════════════════
     RECOMMENDED ACTIONS
     ═══════════════════════════════════════
     ${analysis.likely_causes[0]?.suggested_action || 'Manual review recommended'}

     ${result.summary.dry_run ? '\n⚠️  This was a DRY RUN - no changes made to YNAB' : ''}
     `;
     }
     ```

2. **Add section formatting helpers**
   - Functions for consistent formatting:
     - `formatBalanceSection()`
     - `formatTransactionList()`
     - `formatRecommendations()`

3. **Handle edge cases**
   - No discrepancy (perfect match)
   - Large discrepancies (>$100)
   - Multiple possible causes
   - No clear cause found

**Success Criteria:**
- Report is immediately readable by humans
- Key information (discrepancy amount, direction) is unmistakable
- Obvious insights are highlighted prominently
- Test with various scenarios (match, mismatch, complex cases)

---

### Phase 4: Dual-Channel Output (Week 2-3, 2 days)

**Goal:** Return both human-readable and machine-readable formats

**Status:** ✅ Completed (adapter emits dual-channel responses with schema-backed JSON payloads).

#### Tasks

1. **Update `reconcileAccount.ts`**
   - Modify return statement to include both formats:
     ```typescript
     const humanReport = formatHumanReadableReport(result, analysis);
     const structuredData = {
       version: "2.0",
       schema_url: "https://raw.githubusercontent.com/dizzlkheinz/ynab-mcp-dxt/master/docs/schemas/reconciliation-v2.json",
       timestamp: new Date().toISOString(),
       data: result,
       analysis: analysis
     };

     return {
       content: [
         {
           type: "text",
           text: humanReport
         },
         {
           type: "text",
           text: JSON.stringify(structuredData, null, 2)
         }
       ]
     };
     ```

2. **Add format version tracking**
   - Constant: `const RECONCILIATION_OUTPUT_VERSION = "2.0";`
   - Include in all outputs for future compatibility

3. **Update documentation**
   - File: `docs/API.md`
   - Document new output format
   - Include examples of both formats
   - Migration guide from v1 format

**Success Criteria:**
- Both formats returned in single response
- Human format prioritized (first in array)
- Version metadata included
- Documentation updated

---

### Phase 5: Enhanced Recommendations (Week 3, 2-3 days)

**Goal:** Make recommendations machine-readable and actionable

**Status:** Not started – analyzer exposes insights, but actionable recommendation payloads remain TODO.

#### Tasks

1. **Create recommendation engine**
   - File: `src/tools/reconciliation/recommendationEngine.ts`
   - Interface:
     ```typescript
     interface ActionableRecommendation {
       id: string;
       priority: "high" | "medium" | "low";
       message: string;
       reason: string;
       action_flag: "create_transaction" | "update_cleared" | "review_duplicate" | "manual_review";
       action_parameters?: {
         transaction_data?: CreateTransactionParams;
         transaction_ids?: string[];
       };
       estimated_impact: MoneyValue;
     }
     ```

2. **Implement recommendation generation**
   - Based on analysis results
   - Prioritized by confidence and impact
   - Include executable parameters

3. **Link recommendations to actions**
   - Each recommendation maps to specific tool call
   - Include exact parameters needed
   - Enable one-click resolution in future UIs

**Success Criteria:**
- Recommendations are actionable (not just informational)
- Include all parameters needed for execution
- Prioritized by impact and confidence
- Test coverage for all recommendation types

---

### Phase 6: Testing & Validation (Week 3-4, 3-4 days)

**Goal:** Ensure improvements work in practice

**Status:** Partially complete – unit coverage is strong; fixture-based E2E and Claude interpretation tests still outstanding.

#### Tasks

1. **Create test scenarios**
   - File: `src/tools/reconciliation/__tests__/scenarios/`
   - Scenarios:
     - `exact-match-discrepancy.json` - Single missing transaction
     - `multi-transaction-match.json` - 2-3 transactions sum to discrepancy
     - `perfect-reconciliation.json` - Everything matches
     - `complex-discrepancy.json` - No obvious cause
     - `large-statement.json` - 100+ transactions

2. **Integration tests**
   - File: `src/tools/reconciliation/__tests__/integration.test.ts`
   - Test full reconciliation flow
   - Validate human output contains key phrases
   - Validate structured output schema

3. **Real-world testing**
   - Use actual bank statements from user's feedback
   - Specific test: Oct 30 EvoCarShare scenario
   - Verify Claude would identify the issue correctly

4. **Claude interpretation testing**
   - Create prompts that parse the output
   - Verify Claude extracts:
     - Correct balance values
     - Correct discrepancy direction
     - Identifies missing transaction
     - Suggests correct action

**Success Criteria:**
- All unit tests pass
- Integration tests cover happy path and edge cases
- Real-world scenario (Oct 30 EvoCarShare) resolves correctly
- Claude successfully interprets output in test prompts

---

## Migration Strategy

### Backward Compatibility

**Option A: Version flag (Recommended)**
```typescript
// Add optional parameter
ReconcileAccountSchema.extend({
  output_format: z.enum(["v1", "v2"]).optional().default("v2")
});
```

**Option B: Dual output temporarily**
- Return both v1 and v2 formats for 1 release cycle
- Deprecate v1 in documentation
- Remove v1 in next major version

### Rollout Plan

1. **Week 1-2:** Implement phases 1-3
2. **Week 3:** Implement phases 4-5
3. **Week 4:** Testing & validation
4. **Week 5:** Beta testing with user
5. **Week 6:** Release with v2 as default

---

## Success Metrics

### Functional Metrics

- ✅ 100% of monetary values use `MoneyValue` type
- ✅ 95%+ accuracy on exact discrepancy matches
- ✅ Human report is readable without JSON knowledge
- ✅ All existing tests pass
- ✅ New tests achieve 90%+ coverage

### User Experience Metrics

- ✅ User can reconcile without confusion about amounts
- ✅ User immediately sees missing transactions that explain discrepancy
- ✅ User understands next actions without asking Claude to clarify
- ✅ Claude correctly interprets balance, discrepancy, and actions

---

## Risk Assessment

### High Risk

**Risk:** Breaking changes for existing consumers
**Mitigation:** Version flag, gradual rollout

**Risk:** Performance impact from additional analysis
**Mitigation:** Profile code, optimize hot paths, use caching

### Medium Risk

**Risk:** False positives in discrepancy matching
**Mitigation:** Confidence thresholds, require exact matches for high-confidence

**Risk:** Edge cases not covered
**Mitigation:** Comprehensive test suite, real-world validation

### Low Risk

**Risk:** Human report formatting issues on different statement sizes
**Mitigation:** Pagination for large reports, truncation with links

---

## Future Enhancements (Out of Scope)

- Interactive resolution (approve/reject recommendations)
- Historical reconciliation tracking
- Reconciliation health score
- Automated reconciliation scheduling
- Multi-statement batch reconciliation

---

## Implementation Checklist

### Phase 1: Money Object Standard
- [ ] Create `MoneyValue` interface in `money.ts`
- [ ] Implement `formatMoney()` function
- [ ] Update `ReconciliationResult` interface
- [ ] Write unit tests for money formatting
- [ ] Update all balance fields to use `MoneyValue`

### Phase 2: Interpretation Layer
- [x] Create `analyzer.ts` module (`reconcile_account_v2`)
- [x] Ship insight detection for repeat amounts / near matches / anomalies
- [x] Implement combination matching heuristics (2-3 transactions summing to discrepancy) *(landed via analyzer.ts combo detection + new tests)*
- [x] Surface insights/callouts in response (`insights` array in analysis output)
- [x] Expand unit tests for analysis logic

### Phase 3: Human-Readable Formatter
- [ ] Create `reportFormatter.ts` file
- [ ] Implement `formatHumanReadableReport()`
- [ ] Add section formatting helpers
- [ ] Handle edge cases
- [ ] Test with various scenarios

### Phase 4: Dual-Channel Output
- [ ] Update `reconcileAccount.ts` return statement
- [ ] Add version metadata
- [ ] Update `docs/API.md`
- [ ] Add migration guide

### Phase 5: Enhanced Recommendations
- [ ] Create `recommendationEngine.ts`
- [ ] Implement recommendation generation
- [ ] Link recommendations to actions
- [ ] Test recommendation scenarios

### Phase 6: Testing & Validation
- [ ] Create test scenario files
- [ ] Write integration tests
- [ ] Test with real bank statements
- [ ] Validate Claude interpretation
- [ ] Performance testing

---

## References

- **Original Issue:** User reconciliation experience was "miserable" (2025-11-01)
- **Codex Consultation:** `codex-consultation.md`
- **Existing Design Doc:** `docs/plans/2025-10-31-reconciliation-redesign.md`
- **Current Implementation:** `src/tools/reconcileAccount.ts`

---

## Questions for Reviewer

1. Should we use Option A (version flag) or Option B (dual output) for migration?
2. What confidence threshold for multi-transaction matches (currently 0.8 for 2 txns)?
3. Should we paginate large transaction lists in human report?
4. What's the priority - can we defer Phase 5 (Enhanced Recommendations) to later?

---

## Approval

**Reviewed by:** _________________
**Date:** _________________
**Approved for implementation:** [ ] Yes [ ] No
**Comments:**

