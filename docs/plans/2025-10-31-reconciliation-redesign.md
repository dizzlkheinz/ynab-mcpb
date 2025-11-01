# YNAB Reconciliation Tool - Complete Redesign

**Date**: 2025-10-31
**Status**: Design Phase
**Problem**: Current reconciliation tool produces incorrect matches due to date tolerance issues and overly aggressive automatic matching.

## Executive Summary

Replace the current automatic transaction matching approach with a **guided reconciliation workflow** that prioritizes accuracy over automation. The new design uses conservative auto-matching for high-confidence transactions, presents suggested matches for user review, and provides clear next steps for unmatched items.

**Key Goals**:
1. Make YNAB cleared balance match bank statement balance
2. Mark transactions as cleared when they appear on bank statement
3. Add missing bank transactions to YNAB as cleared
4. Handle unmatched YNAB transactions (unclear or delete)
5. Provide transparent, reviewable decisions before execution

## Core Architecture

### Three-Phase Workflow

**Phase 1: Analysis**
- Parse CSV bank statement (reuse existing `compareTransactions` parser)
- Fetch YNAB transactions for account within statement date range
- Run matching algorithm to categorize:
  - **Auto-matched** (high confidence ≥90%)
  - **Suggested matches** (medium confidence 60-89%)
  - **Unmatched bank** (no YNAB candidates)
  - **Unmatched YNAB** (in date range but not on statement)
- Return structured analysis with summary and next steps

**Phase 2: User Review** (Interactive via Claude)
- Claude presents analysis results
- User reviews auto-matches, suggested matches, unmatched items
- User provides decisions: match, add, ignore, unclear, delete
- Running balance calculation shows impact of decisions

**Phase 3: Execution**
- Apply approved actions in single atomic operation
- Default to dry-run mode (preview changes)
- Explicit `dry_run: false` required to commit
- Verify final cleared balance matches statement
- Provide rollback information

### Data Flow

```
┌─────────────────┐
│ Bank CSV File   │
└────────┬────────┘
         │
         ▼
┌──────────────────────────┐
│ Phase 1: Analysis        │
│ - Parse CSV              │
│ - Fetch YNAB txns        │
│ - Run matching algo      │
│ - Categorize results     │
└────────┬─────────────────┘
         │
         ▼
┌──────────────────────────┐
│ Return Analysis JSON     │
│ - Auto-matches           │
│ - Suggested matches      │
│ - Unmatched bank         │
│ - Unmatched YNAB         │
│ - Balance info           │
└────────┬─────────────────┘
         │
         ▼
┌──────────────────────────┐
│ User Reviews via Claude  │
│ - Approve auto-matches   │
│ - Choose from suggested  │
│ - Decide on unmatched    │
└────────┬─────────────────┘
         │
         ▼
┌──────────────────────────┐
│ Phase 3: Execution       │
│ - Dry-run preview (default)│
│ - Apply all actions      │
│ - Verify balance         │
│ - Return rollback info   │
└──────────────────────────┘
```

## Matching Algorithm

### Two-Tier Matching Strategy

**Tier 1: Normalized String Comparison**
- Lowercase both strings
- Remove spaces, punctuation, special characters
- Direct string equality check
- **Fast and catches 80%+ of matches**

**Tier 2: Fuzzy Matching** (only when Tier 1 fails)
- Levenshtein distance calculation
- Token-based comparison
- **Handles typos and minor variations**

### Confidence Scoring

**HIGH (90-100%)** - Auto-match candidates:
- Exact amount (±$0.01 tolerance)
- Date within ±2 days
- Normalized payee match OR fuzzy payee >80%
- **Action**: Auto-matched, presented for user approval

**MEDIUM (60-89%)** - Suggested matches:
- Exact amount (±$0.01 tolerance)
- Date within ±5 days
- Fuzzy payee >70% OR no payee data
- **Action**: Show as suggestion with alternatives

**LOW (30-59%)** - Weak candidates:
- Exact amount only
- Date within ±7 days
- No payee match
- **Action**: Show as possible match if no better candidates

**NO MATCH (<30%)** - Unmatched:
- Amount differs OR date >7 days
- **Action**: Show in unmatched lists

### Prioritization Rules

1. **Uncleared YNAB transactions rank higher** than cleared ones
   - Rationale: Uncleared transactions are expecting bank confirmation

2. **Multiple candidates**: Show best match first, include alternates
   - Rank by: confidence score, then date proximity, then payee similarity

3. **Opposite-signed transactions never auto-match**
   - Refunds (positive) vs. original purchase (negative) flagged for manual review
   - Prevents masking genuine reversals

4. **Amount tolerance: ±$0.01**
   - Handles rounding differences in bank statements
   - Stricter than current implementation to reduce false matches

### Payee Normalization Examples

```
Bank: "SHELL #1234 OAKVILLE ON"
YNAB: "Shell Gas Station"
→ Normalized: "shell", "shellgasstation"
→ Result: HIGH confidence match

Bank: "AMZN MKTP CA*123456789"
YNAB: "Amazon"
→ Normalized: "amznmktpca", "amazon"
→ Fuzzy: 60% similarity
→ Result: MEDIUM confidence suggestion

Bank: "NETFLIX.COM"
YNAB: "Netflix Subscription"
→ Normalized: "netflixcom", "netflixsubscription"
→ Result: HIGH confidence match
```

## Response Format (Hybrid Structure)

### Analysis Phase Response

```typescript
{
  success: true,
  phase: "analysis",

  // Human-readable summary
  summary: {
    statement_date_range: "2025-10-01 to 2025-10-31",
    bank_transactions_count: 67,
    ynab_transactions_count: 80,
    auto_matched: 45,
    suggested_matches: 12,
    unmatched_bank: 10,
    unmatched_ynab: 23,
    current_cleared_balance: -2937.51,
    target_statement_balance: -899.02,
    discrepancy: 2038.49,
    discrepancy_explanation: "Need to clear 45 transactions and add 10 missing"
  },

  // Structured data for processing
  auto_matches: [
    {
      bank_transaction: {
        id: "b1",  // Generated for tracking
        date: "2025-10-15",
        amount: -45.23,
        payee: "SHELL #1234",
        memo: ""
      },
      ynab_transaction: {
        id: "abc123",
        date: "2025-10-14",
        amount: -45230,  // Milliunits
        payee_name: "Shell Gas",
        cleared: "uncleared"
      },
      confidence: 95,
      match_reason: "exact_amount_and_date_and_payee"
    }
  ],

  suggested_matches: [
    {
      bank_transaction: {
        id: "b2",
        date: "2025-10-20",
        amount: -127.43,
        payee: "AMAZON.COM"
      },
      candidates: [
        {
          ynab_transaction: {...},
          confidence: 75,
          match_reason: "amount_and_date_fuzzy_payee",
          explanation: "Amount matches, date off by 3 days, payee 'Amazon Prime' similar"
        },
        {
          ynab_transaction: {...},
          confidence: 60,
          match_reason: "amount_and_date_only",
          explanation: "Amount matches, date off by 2 days, payee differs"
        }
      ],
      top_confidence: 75,
      action_hint: "review_and_choose"
    }
  ],

  unmatched_bank: [
    {
      id: "b3",
      date: "2025-10-25",
      amount: -15.99,
      payee: "NETFLIX",
      action_hint: "add_to_ynab",
      recommendation: "This transaction appears on bank statement but not in YNAB"
    }
  ],

  unmatched_ynab: [
    {
      id: "xyz789",
      date: "2025-10-18",
      amount: -50.00,
      payee_name: "Restaurant",
      cleared: "uncleared",
      action_hint: "unclear_or_delete",
      recommendation: "This transaction is in YNAB but not on bank statement"
    }
  ],

  next_steps: [
    "Review 45 auto-matched transactions for approval",
    "Review 12 suggested matches and choose best match",
    "Decide whether to add 10 missing bank transactions to YNAB",
    "Decide what to do with 23 unmatched YNAB transactions (unclear/delete/ignore)"
  ]
}
```

### Execution Phase Request

```typescript
{
  phase: "execute",
  dry_run: true,  // Default true, must explicitly set false

  actions: [
    // Match bank to YNAB transaction
    {
      type: "match",
      bank_txn_id: "b1",
      ynab_txn_id: "abc123",
      mark_cleared: true
    },

    // Add bank transaction to YNAB
    {
      type: "add",
      bank_txn_id: "b2",
      account_id: "acc123",
      create_as_cleared: true,
      // Bank transaction data is already in analysis, referenced by ID
    },

    // Mark YNAB transaction as unclear
    {
      type: "unclear",
      ynab_txn_id: "xyz789"
    },

    // Delete YNAB transaction
    {
      type: "delete",
      ynab_txn_id: "def456",
      reason: "not_on_statement"
    },

    // Ignore (no action)
    {
      type: "ignore",
      bank_txn_id: "b3",
      reason: "user_will_add_manually"
    }
  ]
}
```

### Execution Phase Response

```typescript
{
  success: true,
  phase: "execution",
  dry_run: true,

  results: [
    {
      action: {type: "match", bank_txn_id: "b1", ynab_txn_id: "abc123"},
      status: "success",
      message: "Would mark YNAB transaction 'Shell Gas $45.23' as cleared"
    },
    {
      action: {type: "add", bank_txn_id: "b2"},
      status: "success",
      message: "Would create new cleared transaction for 'AMAZON.COM $127.43'",
      transaction_id: "new123"  // Only in actual execution
    },
    {
      action: {type: "unclear", ynab_txn_id: "xyz789"},
      status: "success",
      message: "Would mark YNAB transaction 'Restaurant $50.00' as uncleared"
    }
  ],

  balance_impact: {
    before_cleared_balance: -2937.51,
    after_cleared_balance: -899.02,
    matches_target: true,
    target_statement_balance: -899.02
  },

  summary: {
    total_actions: 3,
    successful: 3,
    failed: 0,
    transactions_cleared: 1,
    transactions_created: 1,
    transactions_uncleared: 1,
    transactions_deleted: 0
  },

  rollback_info: {
    // Only populated in actual execution (dry_run: false)
    session_id: "rec_20251031_123456",
    modified_transaction_ids: ["abc123", "new123", "xyz789"],
    original_states: [...]  // For undo capability
  }
}
```

## Data Structures & Types

```typescript
// Matching confidence levels
type MatchConfidence = 'high' | 'medium' | 'low' | 'none';

// Match result for a single bank transaction
interface TransactionMatch {
  bank_transaction: BankTransaction;
  ynab_transaction?: YNABTransaction;
  candidates?: Array<{
    ynab_transaction: YNABTransaction;
    confidence: number;
    match_reason: string;
    explanation: string;
  }>;
  confidence: MatchConfidence;
  confidence_score: number; // 0-100
  match_reason: string;
}

// Bank transaction (parsed from CSV)
interface BankTransaction {
  id: string; // Generated UUID for tracking
  date: string; // YYYY-MM-DD
  amount: number; // In dollars
  payee: string;
  memo?: string;
  original_csv_row: number; // For debugging
}

// Analysis phase result
interface ReconciliationAnalysis {
  success: true;
  phase: 'analysis';
  summary: ReconciliationSummary;
  auto_matches: TransactionMatch[];
  suggested_matches: TransactionMatch[];
  unmatched_bank: BankTransaction[];
  unmatched_ynab: YNABTransaction[];
  balance_info: BalanceInfo;
  next_steps: string[];
}

// Execution action types
interface ReconciliationAction {
  type: 'match' | 'add' | 'unclear' | 'delete' | 'ignore';
  bank_txn_id?: string;
  ynab_txn_id?: string;
  metadata?: Record<string, unknown>;
}

interface ReconciliationSummary {
  statement_date_range: string;
  bank_transactions_count: number;
  ynab_transactions_count: number;
  auto_matched: number;
  suggested_matches: number;
  unmatched_bank: number;
  unmatched_ynab: number;
  current_cleared_balance: number;
  target_statement_balance: number;
  discrepancy: number;
  discrepancy_explanation: string;
}

interface BalanceInfo {
  current_cleared: number;
  current_uncleared: number;
  current_total: number;
  target_statement: number;
  discrepancy: number;
  on_track: boolean;
}
```

## Error Handling & Edge Cases

### Critical Edge Cases

1. **CSV Format Variations**
   - Use existing auto-detection from `compareTransactions`
   - Provide clear error if parsing fails with format suggestions
   - Handle different date formats (MM/DD/YYYY, YYYY-MM-DD, DD/MM/YYYY)

2. **Date Range Misalignment**
   - Bank statement: Oct 1-31
   - Transaction posts: Nov 1 (after statement date)
   - **Solution**: Allow configurable date tolerance, warn about out-of-range transactions

3. **Pending Transactions**
   - Bank shows pending with future date
   - YNAB has it uncleared with different date
   - **Solution**: Uncleared YNAB transactions get priority in matching

4. **Refunds/Reversals**
   - Bank: +$50.00 (refund)
   - YNAB: -$50.00 (original purchase)
   - **Solution**: Never auto-match opposite signs, flag for manual review

5. **Split Transactions**
   - Bank: Single $100 charge
   - YNAB: Split across 3 categories
   - **Solution**: Match by parent transaction amount, note split in explanation

6. **Duplicate Imports**
   - Re-running reconciliation shouldn't duplicate
   - **Solution**: Track reconciliation sessions, skip already-matched cleared transactions

7. **Foreign Currency**
   - Bank amount differs due to exchange rate timing
   - **Solution**: Wider amount tolerance (±1%) for foreign currency accounts

8. **Deleted/Cleared Transactions**
   - User already cleared some transactions
   - **Solution**: Only match against uncleared YNAB transactions by default

### Error Handling Strategy

**Validation Phase**:
- ✅ Verify CSV can be parsed
- ✅ Verify account exists and is accessible
- ✅ Verify date range is reasonable (<1 year)
- ✅ Verify statement balance is provided

**Matching Phase**:
- ⚠️ Warn if many unmatched transactions (>50%)
- ⚠️ Warn if balance discrepancy is large (>$100)
- ⚠️ Warn if date ranges don't overlap

**Execution Phase**:
- ❌ Fail if any YNAB transaction ID doesn't exist
- ❌ Fail if account is closed
- ⚠️ Warn if final balance doesn't match target
- ✅ Provide rollback info for all changes

**Idempotency**:
- Track reconciliation session IDs
- Store mapping of bank transaction hash → YNAB transaction
- Skip re-processing already matched cleared transactions

## Implementation Strategy

### Phase 1: Analysis-Only Mode (Week 1-2)

**Goals**:
- Implement matching algorithm
- Return analysis results only
- No execution capabilities yet
- Validate matching quality with real data

**Tasks**:
1. Create new `src/tools/reconciliation/` directory
2. Implement `matcher.ts` - matching algorithm
3. Implement `analyzer.ts` - analysis phase logic
4. Add comprehensive unit tests
5. Test with real bank statements
6. Tune confidence thresholds

**Success Criteria**:
- 95%+ accuracy on high-confidence matches
- <5% false positives on auto-matches
- Clear, actionable analysis output

### Phase 2: Execution Capability (Week 3-4)

**Goals**:
- Add execution phase with dry-run default
- Implement rollback tracking
- Full audit logging

**Tasks**:
1. Implement `executor.ts` - execution phase logic
2. Add dry-run preview functionality
3. Implement rollback info generation
4. Add execution validation
5. Integration tests with mock YNAB API
6. E2E tests with real YNAB account

**Success Criteria**:
- Dry-run shows accurate preview
- Execution applies all actions correctly
- Rollback info is complete and accurate
- No duplicate transaction creation

### Phase 3: Refinement (Week 5-6)

**Goals**:
- Tune based on user feedback
- Add advanced features
- Performance optimization

**Tasks**:
1. Implement idempotency checks
2. Add reconciliation history tracking
3. Performance profiling and optimization
4. Add configurable matching thresholds
5. Improve payee normalization
6. Add support for more CSV formats

**Success Criteria**:
- Tool handles 100+ transaction reconciliations smoothly
- Idempotency prevents duplicate imports
- User satisfaction with matching accuracy

### Migration from Current Implementation

**Backwards Compatibility**:
- Keep current tool as `reconcile_account_legacy`
- New tool as `reconcile_account_v2` initially
- After validation, replace `reconcile_account`

**Deprecation Plan**:
1. Ship v2 as opt-in
2. Collect user feedback (2 weeks)
3. Make v2 default, keep legacy available
4. After 1 month, deprecate legacy
5. Remove legacy after 2 months

## File Structure

```
src/tools/reconciliation/
├── index.ts              # Main entry point, exports handlers
├── types.ts              # TypeScript interfaces
├── analyzer.ts           # Analysis phase logic
├── matcher.ts            # Matching algorithm
├── executor.ts           # Execution phase logic
├── payeeNormalizer.ts    # Payee string normalization
├── validator.ts          # Input validation
└── __tests__/
    ├── analyzer.test.ts
    ├── matcher.test.ts
    ├── executor.test.ts
    ├── integration.test.ts
    └── e2e.test.ts
```

## Testing Strategy

### Unit Tests

**Matcher Tests**:
- Test confidence scoring
- Test payee normalization
- Test amount tolerance
- Test date matching
- Test prioritization rules

**Analyzer Tests**:
- Test categorization logic
- Test balance calculations
- Test summary generation

**Executor Tests**:
- Test action validation
- Test dry-run preview
- Test rollback info generation

### Integration Tests

- Test full analysis workflow with mock data
- Test execution workflow with mock YNAB API
- Test idempotency checks
- Test error handling

### E2E Tests

- Test with real bank CSV files
- Test with real YNAB account (test budget)
- Test complete reconciliation workflow
- Test rollback functionality

### Performance Tests

- Test with 500+ transaction reconciliation
- Measure matching algorithm performance
- Measure API call efficiency

## Success Metrics

**Matching Accuracy**:
- 95%+ precision on high-confidence matches
- <5% false positive rate on auto-matches
- 80%+ recall on all matches (with suggestions)

**User Experience**:
- Clear, understandable analysis output
- <10 seconds for analysis of 100 transactions
- <30 seconds for execution of 100 transactions
- 100% of executions reversible via rollback

**Reliability**:
- 0% duplicate transaction creation
- 100% balance accuracy after reconciliation
- 0% data loss on errors

## Open Questions

1. **Historical reconciliation sessions**: Should we store history of past reconciliations?
   - Pros: Audit trail, prevents re-processing
   - Cons: Storage requirements, complexity

2. **Split transaction handling**: How to present split transactions in analysis?
   - Show parent only or show all sub-transactions?

3. **Foreign currency**: Special handling or just wider tolerance?

4. **Batch size limits**: Max transactions per reconciliation?
   - Current thought: 500 transactions max per session

## Validation with Codex

### Validated Design Decisions

✅ **Guided workflow over full automation** (Codex confirmed)
- Reliability over convenience
- Human judgment for edge cases
- Transparent decision-making

✅ **Hybrid response format** (Codex recommended)
- Structured data for processing
- Human-readable summaries for UX
- Forward compatibility

✅ **Two-tier matching strategy** (Codex confirmed)
- Normalized string comparison first (fast, catches 80%)
- Fuzzy matching second (handles variations)
- Avoids expensive fuzzy matching on every comparison

✅ **Uncleared transaction priority** (Codex confirmed)
- Uncleared transactions expecting bank confirmation
- Higher priority than already-cleared transactions

✅ **Single execution call approach**
- Atomic operations
- Dry-run preview support
- Rollback capability
- Consistent UX

### Pending Validation

⏳ **Execution approach details** (Codex still processing)
- Transaction-level rollback implementation
- Error recovery strategies
- Partial execution handling

## Next Steps

1. ✅ Get user approval on this design
2. ⏳ Wait for Codex feedback on execution approach
3. Create detailed implementation plan
4. Set up git worktree for isolated development
5. Begin Phase 1 implementation

---

**Design Status**: Complete pending final Codex feedback on execution details
**Ready for**: User review and approval
**Estimated Implementation**: 4-6 weeks for all 3 phases
