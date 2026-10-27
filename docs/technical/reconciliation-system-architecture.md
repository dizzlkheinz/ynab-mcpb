# YNAB Reconciliation System - Technical Architecture Documentation

**Document Version:** 2.0
**Last Updated:** 2025-12-01
**Code Version Compatibility:** v0.27.1+
**Last Verified Against Code:** v0.27.1 (2026-07-10); execution sections (2.1, 2.6, 3, 6, A.1) against v0.30.1 (2026-10-27)
**Status:** Active Implementation

---

## Executive Summary

The YNAB Reconciliation System is a sophisticated transaction matching and balance verification engine that automatically reconciles bank statement CSV files against YNAB transactions. The system achieves 90%+ auto-match accuracy through intelligent fuzzy matching, progressive confidence scoring, and robust CSV parsing with multi-bank format support.

**Key Capabilities:**
- Automated transaction matching with 85%+ confidence threshold
- Multi-bank CSV format detection (TD, RBC, Scotiabank, Wealthsimple, Tangerine)
- Integer-based milliunit arithmetic (eliminates floating-point errors)
- Bulk transaction operations with correlation tracking
- Smart sign detection for liability accounts
- Actionable recommendations with prioritization

**Target Accuracy:** 90%+ auto-match rate for Canadian bank statements

---

## Table of Contents

1. [System Architecture](#1-system-architecture)
2. [Core Components](#2-core-components)
3. [Data Flow](#3-data-flow)
4. [Transaction Matching Algorithm](#4-transaction-matching-algorithm)
5. [CSV Parsing Engine](#5-csv-parsing-engine)
6. [Execution Engine](#6-execution-engine)
7. [Type System](#7-type-system)
8. [Integration Points](#8-integration-points)
9. [Performance Characteristics](#9-performance-characteristics)
10. [Testing Strategy](#10-testing-strategy)

---

## 1. System Architecture

### 1.1 High-Level Architecture

```mermaid
graph TB
    A[MCP Tool Entry Point] --> B[index.ts Handler]
    B --> C{Parse CSV}
    C --> D[csvParser.ts]
    D --> E[BankTransaction[]]

    B --> F{Fetch YNAB Data}
    F --> G[DeltaFetcher]
    G --> H[ynabAdapter.ts]
    H --> I[NormalizedYNABTransaction[]]

    E --> J[analyzer.ts]
    I --> J

    J --> K[matcher.ts]
    K --> L[Match Results]

    J --> M[recommendationEngine.ts]
    M --> N[Actionable Recommendations]

    L --> O[plan.ts]
    O --> P[executor.ts]
    P -->|dry_run = false| R[YNAB API Updates]

    P --> S[reportFormatter.ts]
    L --> S
    N --> S
    S --> T[Human-Readable Report]

    T --> U[MCP Response]
```

### 1.2 Component Responsibility Matrix

| Component | Primary Role | Inputs | Outputs | Dependencies |
|-----------|-------------|--------|---------|--------------|
| **index.ts** | Orchestration | MCP Tool Request | CallToolResult | All components |
| **csvParser.ts** | CSV Parsing | Raw CSV string | BankTransaction[] | PapaParse, chrono-node |
| **ynabAdapter.ts** | YNAB Normalization | TransactionDetail[] | NormalizedYNABTransaction[] | YNAB SDK |
| **matcher.ts** | Matching Algorithm | Bank + YNAB Transactions | MatchResult[] | fuzzball |
| **analyzer.ts** | Analysis Orchestration | Parsed Data | ReconciliationAnalysis | matcher, recommendationEngine |
| **plan.ts** | Operation Planning | Analysis + Params | ReconciliationPlan | None (pure logic) |
| **executor.ts** | Plan Execution | ReconciliationPlan | ExecutionResult | YNAB API |
| **recommendationEngine.ts** | Recommendation Generation | Analysis | ActionableRecommendation[] | None (pure logic) |
| **reportFormatter.ts** | Human-Readable Output | Analysis + Execution | Formatted Report | None (pure formatting) |

### 1.3 Data Architecture

```mermaid
graph LR
    A[CSV Float Dollars] -->|parseAmount| B[BankTransaction Milliunits]
    C[YNAB API Milliunits] -->|normalizeYNABTransaction| D[NormalizedYNABTransaction]

    B --> E[Matcher Integer Comparison]
    D --> E

    E -->|amount === amount| F[Exact Match - BASE_SCORE 50]
    E -->|amount !== amount| G[Rejected - No Match]

    F --> H[High Confidence 85+]

    H --> I[Auto-Match Execution]
```

**Critical Design Decision:** All amounts use **milliunits (integers)** throughout the system. Conversion from CSV floats happens once at the parser boundary, then all comparisons use exact integer arithmetic (`===` instead of `Math.abs(a - b) < epsilon`).

---

## 2. Core Components

### 2.1 Entry Point: index.ts

**File:** `C:\Users\ksutk\projects\ynab-mcpb\src\tools\reconciliation\index.ts`

**Responsibilities:**
- MCP tool interface implementation
- Schema validation (ReconcileAccountSchema)
- CSV vs File input handling
- Date range auto-detection
- Smart sign inversion for liability accounts
- Orchestration of analysis and execution phases

**Key Functions:**

```typescript
export async function handleReconcileAccount(
  ynabAPI: ynab.API,
  deltaFetcher: DeltaFetcher,
  params: ReconcileAccountRequest,
): Promise<CallToolResult>
```

**Decision Tree:**

```mermaid
graph TD
    A[handleReconcileAccount] --> B{CSV Source?}
    B -->|csv_data| C[Use inline CSV]
    B -->|csv_file_path| D[Read from filesystem]

    C --> E{Account Type?}
    D --> E

    E -->|Liability| F[Negate statement_balance]
    E -->|Asset| G[Use statement_balance as-is]

    F --> H{sign_convention?}
    G --> H

    H -->|invert or as_is| I[Use explicit value]
    H -->|auto, the default| J[Auto-detect sign inversion]

    I --> K[analyzeReconciliation]
    J --> K

    K --> L[buildReconciliationPlan]
    L --> M{dry_run?}
    M -->|true, the default| N[executeReconciliationPlan: every operation marked planned]
    M -->|false| O[executeReconciliationPlan: writes the planned operations]

    N --> P[Build Response Payload]
    O --> P

    P --> Q[Return MCP Response]
```

The analysis, parameters and account snapshot are frozen before planning. In the
`preview` write mode the tool registry runs the handler with `dry_run: true`, and the
handler registers that same plan through `prepareExecution`. A confirmed call then
executes the stored plan; it does not re-read the CSV or recompute matches.

**Configuration Mapping:**

```typescript
// V2 Matching Configuration from Request Parameters
// Amounts must match exactly (no tolerance) — BASE_SCORE = 50 is awarded automatically
const config: MatchingConfig = {
  weights: {
    date: 0.15,     // 15% weight
    payee: 0.35,    // 35% weight
  },
  dateToleranceDays: params.date_tolerance_days ?? 7,
  // From STRICTNESS_THRESHOLDS[params.match_strictness ?? 'normal']:
  // loose 70/55, normal 85/60, strict 93/75
  autoMatchThreshold,
  suggestedMatchThreshold,
  minimumCandidateScore: 40,
  exactDateBonus: 5,
  exactPayeeBonus: 10,
};
```

---

### 2.2 CSV Parser: csvParser.ts

**File:** `C:\Users\ksutk\projects\ynab-mcpb\src\tools\reconciliation\csvParser.ts`

**Purpose:** Parse bank CSV exports into standardized BankTransaction objects with robust error handling and multi-format support.

**Architecture:**

```mermaid
graph TD
    A[Raw CSV String] --> B{Security Check}
    B -->|Size > 10MB| C[Throw Error]
    B -->|Size OK| D[Auto-Detect Format]

    D --> E{Preset Detected?}
    E -->|Yes| F[Load Bank Preset]
    E -->|No| G[Use Default Columns]

    F --> H[PapaParse]
    G --> H

    H --> I{Header Row?}
    I -->|Yes| J[Parse with Headers]
    I -->|No| K[Parse by Index]

    J --> L[Process Each Row]
    K --> L

    L --> M{Parse Date}
    M -->|ISO YYYY-MM-DD| N[Direct Parse]
    M -->|Format Hint| O[Apply Preset Format]
    M -->|Fallback| P[chrono-node Parse]

    N --> Q{Parse Amount}
    O --> Q
    P --> Q

    Q -->|Single Column| R[parseAmount]
    Q -->|Debit/Credit| S[Combine Columns]

    R --> T{Warnings?}
    S --> U{Both Populated?}

    U -->|Yes| V[Emit Warning]
    U -->|No| T
    V --> T

    T --> W[Create BankTransaction]
    W --> X[Sanitize Description]
    X --> Y[Return Results + Errors + Warnings]
```

**Bank Presets:**

```typescript
export const BANK_PRESETS: Record<string, BankPreset> = {
  'td': {
    name: 'TD Canada Trust',
    header: false,  // Headerless CSV support
    dateColumn: ['0', 'Date'],
    debitColumn: '2',
    creditColumn: '3',
    descriptionColumn: ['1', 'Description'],
    dateFormat: 'MDY',  // MM/DD/YYYY
  },
  'rbc': {
    name: 'RBC Royal Bank',
    dateColumn: ['Transaction Date', 'Date'],
    debitColumn: 'Debit',
    creditColumn: 'Credit',
    descriptionColumn: ['Description 1', 'Description'],
    dateFormat: 'YMD',  // YYYY-MM-DD
  },
  'wealthsimple': {
    name: 'Wealthsimple',
    dateColumn: ['Date'],
    amountColumn: ['Amount'],
    descriptionColumn: ['Description', 'Payee'],
    amountMultiplier: 1,  // Already in correct sign
    dateFormat: 'YMD',
  },
  // ... scotiabank, tangerine
};
```

**Amount Conversion Logic (validated via `parseAmount`):**

```typescript
function parseAmount(str: string): {
  valid: boolean;
  valueMilliunits: number;
  reason?: string;
} {
  if (!str || !str.trim()) {
    return { valid: false, valueMilliunits: 0, reason: 'Missing amount value' };
  }

  let cleaned = str.replace(/[$€£¥]/g, '').replace(/\b(CAD|USD|EUR|GBP)\b/gi, '').trim();

  if (cleaned.startsWith('(') && cleaned.endsWith(')')) {
    cleaned = '-' + cleaned.slice(1, -1);
  }

  if (/^-?\d{1,3}(\.\d{3})+,\d{2}$/.test(cleaned)) {
    cleaned = cleaned.replace(/\./g, '').replace(',', '.');
  }

  if (cleaned.includes('.')) {
    cleaned = cleaned.replace(/,/g, '');
  }

  const dollars = parseFloat(cleaned);
  if (!Number.isFinite(dollars)) {
    return { valid: false, valueMilliunits: 0, reason: `Invalid amount: "${str}"` };
  }

  return { valid: true, valueMilliunits: Math.round(dollars * 1000) };
}
```

**Security Measures:**

```typescript
// Security: Remove malicious Unicode characters
rawDesc = rawDesc
  .replace(/[\u0000-\u001F\u007F-\u009F]/g, '')  // ASCII + C1 control chars
  .replace(/[\u202A-\u202E\u2066-\u2069]/g, '')  // Bidirectional overrides
  .replace(/[\u200B-\u200D\uFEFF]/g, '')         // Zero-width chars
  .replace(/[\u2028-\u2029]/g, '')                // Line/paragraph separators
  .substring(0, 500);  // YNAB max memo length
```

---

### 2.3 Transaction Matcher: matcher.ts

**File:** `C:\Users\ksutk\projects\ynab-mcpb\src\tools\reconciliation\matcher.ts`

**Purpose:** Match bank transactions to YNAB transactions using multi-dimensional scoring with configurable thresholds.

**Matching Pipeline:**

```mermaid
graph TD
    A[BankTransaction] --> B{Sign Check}
    B -->|Signs Differ| C[Skip Candidate]
    B -->|Signs Match| D{Exact Amount Match?}

    D -->|amount !== amount| C
    D -->|amount === amount| E[Calculate Scores]

    E --> F[BASE_SCORE = 50]
    E --> G[Date Score 0-100]
    E --> H[Payee Score 0-100]

    F --> I[Combined = BASE + date×0.15 + payee×0.35]
    G --> I
    H --> I

    I --> J{Apply Bonuses}
    J -->|Date === exact| L[+5 bonus]
    J -->|Payee >= 95| M[+10 bonus]

    L --> N[Final Combined Score]
    M --> N

    N --> O{Score >= Min Candidate?}
    O -->|No| C
    O -->|Yes| P[Add to Candidates]

    P --> Q[Sort by Score Descending]
    Q --> R{Top Score >= Auto-Match?}

    R -->|Yes| S[confidence: high]
    R -->|No| T{Score >= Suggested?}

    T -->|Yes| U[confidence: medium]
    T -->|No| V{Score >= Min?}

    V -->|Yes| W[confidence: low]
    V -->|No| X[confidence: none]
```

**Scoring Algorithms:**

**Amount Matching (Exact Integer Comparison):**

```typescript
// Amounts must match exactly — candidates with different amounts are rejected
if (bankTxn.amount !== ynabTxn.amount) {
  continue; // Skip candidate — no tolerance
}
// BASE_SCORE = 50 is awarded for the exact match (replaces weighted amount score)
```

**Date Score (Days Difference):**

```typescript
const daysDiff = Math.abs(bankDate.getTime() - ynabDate.getTime()) / (1000 * 60 * 60 * 24);
let dateScore: number;

if (daysDiff < 0.5) {
  dateScore = 100;  // Same day
} else if (daysDiff <= 1) {
  dateScore = 95;   // 1 day
} else if (daysDiff <= config.dateToleranceDays) {  // Default: 7 days
  dateScore = 90 - ((daysDiff - 1) * (40 / config.dateToleranceDays));
} else {
  dateScore = Math.max(0, 50 - ((daysDiff - config.dateToleranceDays) * 5));
}
```

**Payee Score (Fuzzy Matching with Fuzzball):**

```typescript
import * as fuzz from 'fuzzball';

function calculatePayeeScore(bankPayee: string, ynabPayee: string | null): number {
  if (!ynabPayee) return 30;

  const scores = [
    fuzz.token_set_ratio(bankPayee, ynabPayee),    // Handles word order
    fuzz.token_sort_ratio(bankPayee, ynabPayee),   // Alphabetizes then compares
    fuzz.partial_ratio(bankPayee, ynabPayee),      // Best substring match
    fuzz.WRatio(bankPayee, ynabPayee),             // Weighted combination
  ];

  return Math.max(...scores);
}
```

**Why Fuzzball?**

| Input Bank | Input YNAB | Levenshtein | Fuzzball token_set_ratio |
|------------|------------|-------------|--------------------------|
| "AMZN MKTP CA*123456" | "Amazon" | 45 | 90 |
| "SQ *COFFEE SHOP TORONTO" | "Square Coffee" | 38 | 85 |
| "PAYPAL *NETFLIX" | "Netflix" | 54 | 100 |

**Tie-Breaking Rules:**

```typescript
candidates.sort((a, b) => {
  // 1. Sort by combined score
  const scoreDiff = b.scores.combined - a.scores.combined;
  if (scoreDiff !== 0) return scoreDiff;

  // 2. Prefer uncleared over cleared (expecting confirmation)
  const aUncleared = a.ynabTransaction.cleared === 'uncleared' ? 1 : 0;
  const bUncleared = b.ynabTransaction.cleared === 'uncleared' ? 1 : 0;
  if (aUncleared !== bUncleared) return bUncleared - aUncleared;

  // 3. Prefer closer date proximity
  const bankTime = new Date(bankTxn.date).getTime();
  const aDiff = Math.abs(bankTime - new Date(a.ynabTransaction.date).getTime());
  const bDiff = Math.abs(bankTime - new Date(b.ynabTransaction.date).getTime());
  if (aDiff !== bDiff) return aDiff - bDiff;

  return 0;
});
```

---

### 2.4 Analyzer: analyzer.ts

**File:** `C:\Users\ksutk\projects\ynab-mcpb\src\tools\reconciliation\analyzer.ts`

**Purpose:** Orchestrate the analysis phase, coordinating CSV parsing, YNAB normalization, matching, and insight generation.

**Analysis Pipeline:**

```mermaid
graph TD
    A[analyzeReconciliation] --> B{CSV Pre-Parsed?}
    B -->|Yes| C[Use Provided Result]
    B -->|No| D[parseCSV]

    C --> E[BankTransaction[]]
    D --> E

    A --> F[normalizeYNABTransactions]
    F --> G[NormalizedYNABTransaction[]]

    E --> H[findMatches]
    G --> H

    H --> I[MatchResult[]]

    I --> J[Categorize by Confidence]
    J --> K[auto_matches: high]
    J --> L[suggested_matches: medium]
    J --> M[unmatchedBank: low/none]

    G --> N[Find Unmatched YNAB]
    I --> N
    N --> O[unmatched_ynab]

    K --> P[calculateBalances]
    G --> P
    P --> Q[BalanceInfo]

    K --> R[generateSummary]
    L --> R
    M --> R
    O --> R
    Q --> R
    R --> S[ReconciliationSummary]

    S --> T[generateNextSteps]
    T --> U[next_steps: string[]]

    M --> V[detectInsights]
    S --> V
    Q --> V
    V --> W[insights: ReconciliationInsight[]]

    K --> X{Recommendations Enabled?}
    L --> X
    M --> X
    O --> X

    X -->|Yes| Y[generateRecommendations]
    Y --> Z[recommendations: ActionableRecommendation[]]

    S --> AA[Build ReconciliationAnalysis]
    U --> AA
    W --> AA
    Z --> AA

    AA --> AB[Return Analysis]
```

**Insight Detection:**

```typescript
function detectInsights(
  unmatchedBank: BankTransaction[],
  summary: ReconciliationSummary,
  balances: BalanceInfo,
  currency: string,
  csvErrors: ParseError[],
  csvWarnings: ParseWarning[],
): ReconciliationInsight[]
```

**Insight Types:**

| Type | Severity | Trigger | Purpose |
|------|----------|---------|---------|
| `csv-parse-errors` | critical/warning | CSV parsing errors | Surface parsing failures |
| `csv-parse-warnings` | info | CSV parsing warnings | Surface ambiguous data |
| `repeat_amount` | critical/warning | 2+ unmatched txns same amount | Highlight quick wins |
| `balance-gap` | critical/warning | Discrepancy > $1.00 | Focus attention on gap |

**Example Insight:**

```typescript
{
  id: 'repeat--45230',
  type: 'repeat_amount',
  severity: 'warning',
  title: '3 unmatched transactions at -$45.23',
  description: 'The bank statement shows 3 unmatched transaction(s) at -$45.23. Repeated amounts are usually the quickest wins — reconcile these first.',
  evidence: {
    amount: -45230,  // Milliunits
    occurrences: 3,
    dates: ['2025-09-15', '2025-09-20', '2025-09-25'],
    csv_rows: [2, 5, 8],
  },
}
```

---

### 2.5 Recommendation Engine: recommendationEngine.ts

**File:** `C:\Users\ksutk\projects\ynab-mcpb\src\tools\reconciliation\recommendationEngine.ts`

**Purpose:** Generate actionable, prioritized recommendations from reconciliation analysis results.

**Recommendation Types:**

```mermaid
graph TD
    A[ReconciliationAnalysis] --> B{Process Insights}
    B --> C{Insight Type?}

    C -->|near_match| D[createNearMatchRecommendation]
    C -->|repeat_amount| E[createRepeatAmountRecommendations]
    C -->|anomaly| F[createManualReviewRecommendation]

    D --> G[ManualReviewRecommendation]
    E --> G
    F --> G

    A --> H{Process Unmatched Bank}
    H --> I[createUnmatchedBankRecommendation]
    I --> J[CreateTransactionRecommendation]

    A --> K{Process Suggested Matches}
    K --> L{Has YNAB Transaction?}

    L -->|Yes + Confidence high/medium| M[createSuggestedMatchRecommendation]
    L -->|No| N[Create Missing Transaction]
    L -->|Multiple Candidates| O[Combination Match]

    M --> P[ReviewDuplicateRecommendation]
    N --> J
    O --> Q[createCombinationReviewRecommendation]
    Q --> G

    A --> R{Process Unmatched YNAB}
    R -->|Uncleared| S[createUpdateClearedRecommendation]
    S --> T[UpdateClearedRecommendation]

    G --> U[All Recommendations]
    J --> U
    P --> U
    T --> U

    U --> V[sortRecommendations]
    V --> W{Sort Order}

    W -->|1. Priority| X[High > Medium > Low]
    W -->|2. Confidence| Y[0.95 > 0.80 > 0.60]

    X --> Z[Sorted Recommendations]
    Y --> Z
```

**Recommendation Schema:**

```typescript
export type ActionableRecommendation =
  | CreateTransactionRecommendation
  | UpdateClearedRecommendation
  | ReviewDuplicateRecommendation
  | ManualReviewRecommendation;

interface CreateTransactionRecommendation {
  action_type: 'create_transaction';
  priority: 'high' | 'medium' | 'low';
  confidence: number;  // 0-1
  message: string;
  reason: string;
  estimated_impact: MoneyValue;
  parameters: {
    account_id: string;
    date: string;
    amount: number;  // Milliunits
    payee_name: string;
    memo?: string;
    cleared: 'cleared' | 'uncleared';
    approved: boolean;
  };
}
```

**Confidence Levels:**

```typescript
const CONFIDENCE = {
  CREATE_EXACT_MATCH: 0.95,
  NEAR_MATCH_REVIEW: 0.7,
  REPEAT_AMOUNT: 0.75,
  ANOMALY_REVIEW: 0.5,
  UNMATCHED_BANK: 0.8,
  UPDATE_CLEARED: 0.6,
} as const;
```

**Priority Assignment:**

| Scenario | Action Type | Priority | Confidence | Rationale |
|----------|-------------|----------|------------|-----------|
| Unmatched bank txn | create_transaction | medium | 0.80 | Safe to create, medium urgency |
| Exact match suggestion | review_duplicate | high | 0.95 | High confidence match needs confirmation |
| Combination match | manual_review | medium | 0.70 | Complex scenario, needs human judgment |
| Uncleared YNAB txn | update_cleared | low | 0.60 | Cleanup action, low urgency |
| Anomaly insight | manual_review | low | 0.50 | Investigation needed |

---

### 2.6 Planner and Executor: plan.ts, executor.ts

**Files:** `src/tools/reconciliation/plan.ts`, `src/tools/reconciliation/executor.ts`

**Purpose:** `buildReconciliationPlan` turns the analysis into a frozen, ordered list of
operations without calling the API. `executeReconciliationPlan` applies exactly those
operations and reports the outcome of each one.

**Planning (`buildReconciliationPlan`):**

```mermaid
graph TD
    A[buildReconciliationPlan] --> B{auto_create_transactions?}
    B -->|Yes| C[create: one per unmatched bank txn, newest first]
    B -->|No| D
    C --> D[update: one per auto-match that needs a cleared or date change]

    D --> E{auto_unclear_missing?}
    E -->|Yes| F[unclear: cleared, statement-missing txns, newest first, until the projected cleared balance is within 10 milliunits of the statement]
    E -->|No| G
    F --> G{auto_update_cleared_status and projected cleared balance equals the statement?}

    G -->|Yes| H[reconcile: one per cleared matched txn]
    G -->|No| I
    H --> I[Freeze plan with a fingerprint of the account's transactions]
```

Every operation records its payload, a reason, whether it changes the date, and its
effect on the cleared balance, so a preview shows the projected cleared balance.

**Execution (`executeReconciliationPlan`):**

```mermaid
graph TD
    A[executeReconciliationPlan] --> B{Plan budget and account match the request?}
    B -->|No| X[Throw: scope mismatch]
    B -->|Yes| C{dry_run?}

    C -->|No| D[Re-fetch the account's transactions]
    D --> E{Fingerprint unchanged?}
    E -->|No| Y[Throw: changed since preview, nothing applied]
    E -->|Yes| F
    C -->|Yes| F[Group consecutive operations of one kind, chunk by 100]

    F --> G{dry_run, or an earlier chunk stopped the run?}
    G -->|dry_run| H[Mark planned]
    G -->|stopped| I[Mark skipped]
    G -->|No| J[One API request for the chunk]

    J --> K{Request succeeded?}
    K -->|No| L[Mark the chunk uncertain and stop]
    K -->|Yes| M{Each operation acknowledged by a returned transaction?}
    M -->|Yes| N[Mark applied]
    M -->|No| O[Mark uncertain and stop]

    H --> P[Build summary]
    I --> P
    L --> P
    N --> P
    O --> P

    P --> Q{dry_run?}
    Q -->|No| R[buildBalanceReconciliation when statement_end_date is set, then refresh the account if anything was applied]
    Q -->|Yes| S[Projected balance from the plan]
    R --> T[Recommendations, plus any errors]
    S --> T
    T --> U[Return ExecutionResult]
```

**Acknowledgment matching:** YNAB may return saved transactions in any order. An
operation counts as applied only when a returned, non-deleted transaction carries every
field of its payload (an empty memo matches YNAB's `null`). Each returned transaction
can acknowledge one operation, and a created transaction is never counted twice.

```typescript
function acknowledges(operation: PlannedOperation, transaction: ynab.TransactionDetail): boolean {
  if (!transaction.id || transaction.deleted) return false;
  return Object.entries(operation.payload).every(([key, expected]) => {
    if (expected === undefined) return true;
    const actual = (transaction as unknown as Record<string, unknown>)[key];
    return key === 'memo' ? (actual ?? '') === (expected ?? '') : actual === expected;
  });
}
```

**Error handling:** a request that fails may still have committed in YNAB, so the
executor never retries it or falls back to per-row writes. The failed chunk is marked
`uncertain` (its message comes from `normalizeYnabError`), every later chunk is
`skipped`, and the tool returns an error that tells the user to check YNAB before
retrying. A failure during final verification is reported the same way, after the
applied writes are recorded.

**Operation results:**

```typescript
export interface OperationResult {
  operation: PlannedOperation;
  status: 'planned' | 'applied' | 'uncertain' | 'skipped';
  transaction_id?: string;
  error?: string;
}
```

---

### 2.7 Report Formatter: reportFormatter.ts

**File:** `C:\Users\ksutk\projects\ynab-mcpb\src\tools\reconciliation\reportFormatter.ts`

**Purpose:** Format reconciliation results into human-readable reports with structured sections.

**Report Structure:**

```
📊 [Account Name] Reconciliation Report
═══════════════════════════════════════════════════════════════

Statement Period: [date_range]

BALANCE CHECK
═══════════════════════════════════════════════════════════════
✓ YNAB Cleared Balance:  [amount]
✓ Statement Balance:     [amount]

[✅ BALANCES MATCH PERFECTLY | ❌ DISCREPANCY: [amount]]

TRANSACTION ANALYSIS
═══════════════════════════════════════════════════════════════
✓ Automatically matched:  [count] of [total] transactions
✓ Suggested matches:      [count]
✓ Unmatched bank:         [count]
✓ Unmatched YNAB:         [count]

❌ UNMATCHED BANK TRANSACTIONS:
   [date] - [payee]                         [±amount]
   ...

💡 SUGGESTED MATCHES:
   [date] - [payee]                         [±amount] ([confidence]% confidence)
   ...

KEY INSIGHTS
═══════════════════════════════════════════════════════════════
[🚨|⚠️|ℹ️] [insight.title]
   [insight.description]
   Evidence: [summary]

EXECUTION SUMMARY
═══════════════════════════════════════════════════════════════
• Transactions created:  [count]
• Transactions updated:  [count]
• Date adjustments:      [count]

Recommendations:
  • [recommendation 1]
  • [recommendation 2]
  ...

[⚠️ Dry run only — no YNAB changes were applied. | ✅ Changes applied to YNAB.]

RECOMMENDED ACTIONS
═══════════════════════════════════════════════════════════════
• [next_step 1]
• [next_step 2]
...
```

**Format Options:**

```typescript
export interface ReportFormatterOptions {
  accountName?: string;
  accountId?: string;
  currencyCode?: string;
  includeDetailedMatches?: boolean;
  maxUnmatchedToShow?: number;      // Default: 5
  maxInsightsToShow?: number;       // Default: 3
}
```

---

## 3. Data Flow

### 3.1 End-to-End Data Flow Diagram

```mermaid
sequenceDiagram
    participant User
    participant MCP as MCP Tool Interface
    participant Handler as index.ts Handler
    participant Parser as csvParser.ts
    participant Fetcher as DeltaFetcher
    participant Adapter as ynabAdapter.ts
    participant Analyzer as analyzer.ts
    participant Matcher as matcher.ts
    participant RecEngine as recommendationEngine.ts
    participant Executor as executor.ts
    participant YNAB as YNAB API
    participant Formatter as reportFormatter.ts

    User->>MCP: reconcile_account(csv_data, statement_balance, ...)
    MCP->>Handler: handleReconcileAccount(params)

    Handler->>Parser: parseCSV(csvContent, options)
    Parser->>Parser: Auto-detect format
    Parser->>Parser: PapaParse
    Parser->>Parser: parseAmount
    Parser-->>Handler: { transactions: BankTransaction[], errors, warnings }

    Handler->>Fetcher: fetchTransactionsByAccount(budget_id, account_id, since_date)
    Fetcher->>YNAB: GET /budgets/{id}/accounts/{id}/transactions
    YNAB-->>Fetcher: TransactionDetail[]
    Fetcher-->>Handler: { data: TransactionDetail[], wasCached, usedDelta }

    Handler->>Adapter: normalizeYNABTransactions(ynabTransactions)
    Adapter-->>Handler: NormalizedYNABTransaction[]

    Handler->>Analyzer: analyzeReconciliation(bankTxns, ynabTxns, config)

    Analyzer->>Matcher: findMatches(bankTxns, ynabTxns, config)

    loop For each bank transaction
        Matcher->>Matcher: findCandidates(bankTxn, ynabTxns, usedIds)
        Matcher->>Matcher: calculateScores(amount, date, payee)
        Matcher->>Matcher: Sort by combined score
    end

    Matcher-->>Analyzer: MatchResult[]

    Analyzer->>Analyzer: Categorize matches (auto, suggested, unmatched)
    Analyzer->>Analyzer: calculateBalances()
    Analyzer->>Analyzer: generateSummary()
    Analyzer->>Analyzer: detectInsights()

    Analyzer->>RecEngine: generateRecommendations(context)

    loop For each insight
        RecEngine->>RecEngine: processInsight()
    end

    loop For each unmatched bank txn
        RecEngine->>RecEngine: createUnmatchedBankRecommendation()
    end

    loop For each suggested match
        RecEngine->>RecEngine: createSuggestedMatchRecommendation()
    end

    RecEngine-->>Analyzer: ActionableRecommendation[]

    Analyzer-->>Handler: ReconciliationAnalysis

    Handler->>Executor: buildReconciliationPlan(options)
    Executor-->>Handler: ReconciliationPlan (frozen)
    Handler->>Executor: executeReconciliationPlan(plan, options)

    alt dry_run = false
        Executor->>YNAB: GET /budgets/{id}/accounts/{id}/transactions
        YNAB-->>Executor: Transactions (fingerprint check)

        loop For each chunk of up to 100 operations of one kind
            Executor->>YNAB: POST or PATCH /budgets/{id}/transactions
            YNAB-->>Executor: Saved transactions
            Executor->>Executor: Mark each operation applied or uncertain
        end

        opt statement_end_date set
            Executor->>YNAB: Balance reconciliation reads
        end

        opt Any operation applied
            Executor->>YNAB: GET /budgets/{id}/accounts/{id}
            YNAB-->>Executor: Account
        end
    else dry_run = true
        Executor->>Executor: Mark every operation planned
    end

    Executor-->>Handler: ExecutionResult

    Handler->>Formatter: formatHumanReadableReport(analysis, execution)
    Formatter-->>Handler: Formatted report string

    Handler->>Handler: buildReconciliationPayload(analysis, execution)
    Handler-->>MCP: CallToolResult { human, structured }
    MCP-->>User: Reconciliation report + structured data
```

### 3.2 Data Transformation Chain

```mermaid
graph LR
    A[CSV String] -->|parseCSV| B[BankTransaction[]]
    C[YNAB API] -->|normalizeYNABTransactions| D[NormalizedYNABTransaction[]]

    B --> E{Matching}
    D --> E

    E -->|findMatches| F[MatchResult[]]

    F -->|Categorize| G[auto_matches]
    F -->|Categorize| H[suggested_matches]
    F -->|Categorize| I[unmatched_bank]

    D -->|Filter| J[unmatched_ynab]

    G --> K[ReconciliationAnalysis]
    H --> K
    I --> K
    J --> K

    K -->|generateRecommendations| L[ActionableRecommendation[]]

    K -->|buildReconciliationPlan| M[ReconciliationPlan]
    M -->|executeReconciliationPlan| O[ExecutionResult]

    K --> Q[formatHumanReadableReport]
    L --> Q
    O --> Q

    Q --> R[Human-Readable Report]

    K --> S[buildReconciliationPayload]
    O --> S

    S --> T[Structured JSON Payload]

    R --> U[MCP Response]
    T --> U
```

---

## 4. Transaction Matching Algorithm

### 4.1 Matching Strategy

The reconciliation system uses a **multi-dimensional weighted scoring algorithm** with configurable thresholds and bonuses.

**Core Principles:**
1. **Amount is Exact** (hard filter) - Amounts must match exactly in milliunits; BASE_SCORE of 50 awarded
2. **Dates are Unreliable** (15% weight) - Banks delay posting 3-7 days
3. **Payees are Fuzzy** (35% weight) - Merchant names vary significantly

**Default Configuration:**

```typescript
// Fixed base score for exact amount match
const BASE_SCORE = 50;

export const DEFAULT_CONFIG: MatchingConfig = {
  weights: {
    date: 0.15,     // 15%
    payee: 0.35,    // 35%
  },
  dateToleranceDays: 7,
  autoMatchThreshold: 85,
  suggestedMatchThreshold: 60,
  minimumCandidateScore: 40,
  exactDateBonus: 5,
  exactPayeeBonus: 10,
};
```

### 4.2 Scoring Examples

**Example 1: Perfect Match**

```
Bank:   { date: '2025-09-15', amount: -45230, payee: 'Shell Gas' }
YNAB:   { date: '2025-09-15', amount: -45230, payee: 'Shell' }

Scores:
  Amount: exact match (-45230 === -45230) → BASE_SCORE = 50
  Date:   100 (same day)
  Payee:   85 (fuzz.token_set_ratio('Shell Gas', 'Shell'))

Combined = 50 + (100 * 0.15) + (85 * 0.35) = 94.75
Bonuses  = +5 (exact date) = +5
Final    = 94.75 + 5 = 99.75 → capped at 100

Confidence: HIGH (≥ 85)
```

**Example 2: Date Mismatch**

```
Bank:   { date: '2025-09-15', amount: -12799, payee: 'Amazon Marketplace' }
YNAB:   { date: '2025-09-20', amount: -12799, payee: 'Amazon' }

Scores:
  Amount: exact match → BASE_SCORE = 50
  Date:    55 (5 days diff within tolerance)
  Payee:   92 (fuzz.token_set_ratio)

Combined = 50 + (55 * 0.15) + (92 * 0.35) = 90.45
Bonuses  = 0 (payee 92 < 95)
Final    = 90.45

Confidence: HIGH (≥ 85)
```

**Example 3: No Match (Amount Differs)**

```
Bank:   { date: '2025-09-15', amount: -4520, payee: 'Coffee Shop A' }
YNAB:   { date: '2025-09-16', amount: -4530, payee: 'Coffee Shop B' }

Result: REJECTED — amounts differ (-4520 !== -4530), candidate skipped entirely.
(Exact amount matching means even 10 milliunits difference rejects the candidate.)
```

**Example 4: Low Confidence (Weak Payee/Date)**

```
Bank:   { date: '2025-09-15', amount: -5000, payee: 'Transfer' }
YNAB:   { date: '2025-09-22', amount: -5000, payee: 'Payment' }

Scores:
  Amount: exact match → BASE_SCORE = 50
  Date:    35 (7 days diff at edge of tolerance)
  Payee:   40 (weak match)

Combined = 50 + (35 * 0.15) + (40 * 0.35) = 69.25
Bonuses  = 0
Final    = 69.25

Confidence: MEDIUM (60-84)
```

### 4.3 Candidate Filtering

**Pre-Filtering (Before Scoring):**

```typescript
// 1. Sign Check - both must be same sign
const bankSign = Math.sign(bankTxn.amount);
const ynabSign = Math.sign(ynabTxn.amount);
if (bankSign !== ynabSign && bankSign !== 0 && ynabSign !== 0) {
  continue;  // Skip candidate
}

// 2. Exact Amount Match - hard filter (no tolerance)
if (bankTxn.amount !== ynabTxn.amount) {
  continue;  // Skip candidate
}
```

**Post-Filtering (After Scoring):**

```typescript
// Only include if score ≥ minimumCandidateScore (default: 40)
if (scores.combined >= config.minimumCandidateScore) {
  candidates.push({ ynabTransaction, scores, matchReasons });
}
```

### 4.4 Guardrails & Failure Modes

**Auto-Match Disabled When:**

| Condition | Rationale |
|-----------|-----------|
| Amount not exact match | Amount must match exactly in milliunits |
| Date gap > 14 days | Even with delays, 2+ weeks is suspicious |
| Multiple candidates within 5 points | Ambiguous, needs human review |
| Payee score < 40 AND date score < 60 | Neither secondary signal is strong |
| Transaction has warnings | Parser detected ambiguity |

**Known Failure Modes:**

| Failure Mode | Mitigation Strategy |
|--------------|---------------------|
| Similar merchants (Starbucks #1234 vs #5678) | Require exact amount + date ≤1 day |
| Recurring subscriptions | Use date as primary discriminator |
| Refunds | Sign check prevents cross-matching |
| Split transactions | Combination matching (future) |
| Merchant name drift | Payee normalization + token_set_ratio |
| Duplicate entries | Prefer uncleared; flag for review |

---

## 5. CSV Parsing Engine

### 5.1 Multi-Format Support

The CSV parser supports both **headered** and **headerless** CSV files with bank-specific presets.

**Auto-Detection Strategy:**

```mermaid
graph TD
    A[Raw CSV] --> B[Parse First 5 Lines]
    B --> C{Header Match?}

    C -->|RBC: Description 1| D[RBC Preset]
    C -->|Contains CAD$| E[TD Preset]
    C -->|No Match| F{Headerless Pattern?}

    F -->|MM/DD/YYYY + 4+ columns| G[TD Headerless Preset]
    F -->|No Pattern| H[Default Auto-Detect]

    D --> I[Apply Preset]
    E --> I
    G --> I
    H --> I

    I --> J[PapaParse with Detected Format]
```

### 5.2 Date Parsing Priority

```mermaid
graph TD
    A[Raw Date String] --> B{ISO Format?}
    B -->|YYYY-MM-DD| C[Direct Parse UTC]
    B -->|No| D{Format Hint from Preset?}

    D -->|YMD| E[Apply YYYY-MM-DD Pattern]
    D -->|MDY| F[Apply MM/DD/YYYY Pattern]
    D -->|DMY| G[Apply DD/MM/YYYY Pattern]
    D -->|No Hint| H[chrono-node Fallback]

    C --> I[formatLocalDate]
    E --> I
    F --> I
    G --> I
    H --> I

    I --> J[YYYY-MM-DD String]
```

**Why This Priority?**

1. **ISO format first** - Unambiguous, no parsing errors
2. **Preset format hint** - Handles ambiguous dates like 02/03/2025 correctly
3. **chrono-node fallback** - Handles natural language and weird formats

### 5.3 Amount Parsing Edge Cases

**Supported Formats:**

| Input | Detected Format | Output (Milliunits) |
|-------|-----------------|---------------------|
| `45.23` | Standard | 45230 |
| `$45.23` | USD Symbol | 45230 |
| `CAD 45.23` | Currency Code | 45230 |
| `1,234.56` | Thousands Separator | 1234560 |
| `1.234,56` | European Format | 1234560 |
| `(45.23)` | Parentheses Negative | -45230 |
| `-45.23` | Explicit Negative | -45230 |

**Debit/Credit Column Handling:**

```typescript
if (Math.abs(debitMilliunits) > 0 && Math.abs(creditMilliunits) > 0) {
  // WARNING: Both columns populated - use debit
  rowWarnings.push(`Both Debit (${debit}) and Credit (${credit}) have values - using Debit`);
  warnings.push({ row: rowNum, message: rowWarnings[0] });
}

if (Math.abs(debitMilliunits) > 0) {
  amountMilliunits = -Math.abs(debitMilliunits);  // Debits are outflows
} else if (Math.abs(creditMilliunits) > 0) {
  amountMilliunits = Math.abs(creditMilliunits);  // Credits are inflows
} else {
  amountMilliunits = 0;
}
```

### 5.4 Security Measures

**Input Validation:**

```typescript
// File size limit: 10MB default
const MAX_BYTES = options.maxBytes ?? 10 * 1024 * 1024;
if (content.length > MAX_BYTES) {
  throw new Error(`File size exceeds limit of ${Math.round(MAX_BYTES / 1024 / 1024)}MB`);
}

// Row limit: 10,000 default
const maxRows = options.maxRows ?? 10000;
```

**Unicode Sanitization:**

```typescript
// Remove malicious/confusing characters
rawDesc = rawDesc
  .replace(/[\u0000-\u001F\u007F-\u009F]/g, '')  // Control chars
  .replace(/[\u202A-\u202E\u2066-\u2069]/g, '')  // Bidirectional overrides
  .replace(/[\u200B-\u200D\uFEFF]/g, '')         // Zero-width chars
  .replace(/[\u2028-\u2029]/g, '')                // Line/paragraph separators
  .substring(0, 500);  // YNAB max memo length
```

---

## 6. Execution Engine

### 6.1 Operation Kinds

The plan lists operations in this order, and the executor keeps that order.

| Kind | Added when | Payload | Cleared-balance effect |
|------|-----------|---------|------------------------|
| `create` | `auto_create_transactions` | New cleared, approved transaction (memo truncated) | + amount |
| `update` | An auto-match needs a cleared or date change | `{ id, cleared?, date? }` | + amount when clearing |
| `unclear` | `auto_unclear_missing`, while the projected cleared balance is more than 10 milliunits from the statement | `{ id, cleared: 'uncleared' }` | − amount |
| `reconcile` | `auto_update_cleared_status` and the projected cleared balance equals the statement | `{ id, cleared: 'reconciled' }` | none |

### 6.2 Requests and Chunking

Consecutive operations of the same kind go out together, at most 100 per request:

| Operations | API call |
|-----------|----------|
| One `create` | `transactions.createTransaction` |
| Several `create` | `transactions.createTransactions` |
| `update`, `unclear`, `reconcile` | `transactions.updateTransactions` |

### 6.3 Stale-Preview Protection

The plan stores a SHA-256 fingerprint of the account's non-deleted transactions. Before
writing, the executor fetches them again and refuses to run if the fingerprint changed,
so a confirmed preview never applies to data that changed after it was shown.

### 6.4 Error Recovery

```mermaid
graph TD
    A[Send chunk] --> B{Request threw?}
    B -->|Yes| C[Mark the chunk uncertain]
    B -->|No| D{Every operation acknowledged?}
    D -->|No| E[Mark unacknowledged operations uncertain]
    D -->|Yes| F[Mark applied]

    C --> G[Stop: later chunks are skipped]
    E --> G
    F --> H{More chunks?}
    H -->|Yes| A
    H -->|No| I[Final verification]
    G --> I
```

Nothing is retried. A transport error can arrive after YNAB has committed the write, and
replaying it could create duplicates, so the response lists what was applied and what is
uncertain and asks the user to check YNAB before retrying.

---

## 7. Type System

### 7.1 Core Types

**Canonical Transaction Types:**

```typescript
// File: src/types/reconciliation.ts

/**
 * Bank transaction from CSV parsing.
 * CRITICAL: amount is in MILLIUNITS (integers, 1000 = $1.00)
 */
export interface BankTransaction {
  id: string;                 // UUID
  date: string;               // YYYY-MM-DD
  amount: number;             // Milliunits (integer)
  payee: string;
  memo?: string;
  sourceRow: number;          // CSV row number (1-indexed)
  raw: {
    date: string;
    amount: string;
    description: string;
  };
  warnings?: string[];
}

/**
 * Normalized YNAB transaction for matching.
 * CRITICAL: amount is in MILLIUNITS (same as YNAB API)
 */
export interface NormalizedYNABTransaction {
  id: string;
  date: string;               // YYYY-MM-DD
  amount: number;             // Milliunits (integer)
  payee: string | null;
  memo: string | null;
  categoryName: string | null;
  cleared: 'cleared' | 'uncleared' | 'reconciled';
  approved: boolean;
}
```

**Match Result Types:**

```typescript
// File: src/tools/reconciliation/types.ts

export type MatchConfidence = 'high' | 'medium' | 'low' | 'none';

export interface TransactionMatch {
  bankTransaction: BankTransaction;
  ynabTransaction?: YNABTransaction;
  candidates?: MatchCandidate[];
  confidence: MatchConfidence;
  confidenceScore: number;  // 0-100
  matchReason: string;
  topConfidence?: number;
  actionHint?: string;
  recommendation?: string;
}

export interface MatchCandidate {
  ynab_transaction: YNABTransaction;
  confidence: number;
  match_reason: string;
  explanation: string;
}
```

**Recommendation Types:**

```typescript
// File: src/tools/reconciliation/types.ts

export type ActionableRecommendation =
  | CreateTransactionRecommendation
  | UpdateClearedRecommendation
  | ReviewDuplicateRecommendation
  | ManualReviewRecommendation;

export interface CreateTransactionRecommendation {
  id: string;
  action_type: 'create_transaction';
  priority: 'high' | 'medium' | 'low';
  confidence: number;  // 0-1
  message: string;
  reason: string;
  estimated_impact: MoneyValue;
  account_id: string;
  parameters: {
    account_id: string;
    date: string;
    amount: number;  // Milliunits
    payee_name: string;
    memo?: string;
    cleared: 'cleared' | 'uncleared';
    approved: boolean;
  };
}
```

### 7.2 Analysis Result Type

```typescript
export interface ReconciliationAnalysis {
  success: true;
  phase: 'analysis';
  summary: ReconciliationSummary;
  auto_matches: TransactionMatch[];
  suggested_matches: TransactionMatch[];
  unmatched_bank: BankTransaction[];
  unmatched_ynab: YNABTransaction[];
  balance_info: BalanceInfo;
  next_steps: string[];
  insights: ReconciliationInsight[];
  recommendations?: ActionableRecommendation[];
}

export interface ReconciliationSummary {
  statement_date_range: string;
  bank_transactions_count: number;
  ynab_transactions_count: number;
  auto_matched: number;
  suggested_matches: number;
  unmatched_bank: number;
  unmatched_ynab: number;
  current_cleared_balance: MoneyValue;
  target_statement_balance: MoneyValue;
  discrepancy: MoneyValue;
  discrepancy_explanation: string;
}
```

---

## 8. Integration Points

### 8.1 YNAB API Integration

**Delta Fetching:**

```typescript
// Fetch transactions with delta support for efficiency
const transactionsResult = forceFullRefresh
  ? await deltaFetcher.fetchTransactionsByAccountFull(budget_id, account_id, since_date)
  : await deltaFetcher.fetchTransactionsByAccount(budget_id, account_id, since_date);

// Result includes metadata
{
  data: TransactionDetail[],
  wasCached: boolean,
  usedDelta: boolean,
  serverKnowledge: number,
}
```

**Bulk Operations:**

```typescript
// Create multiple transactions
const response = await ynabAPI.transactions.createTransactions(budgetId, {
  transactions: [
    { account_id, date, amount, payee_name, memo, cleared: 'cleared', approved: true },
    // ... more transactions
  ],
});

// Update multiple transactions
const response = await ynabAPI.transactions.updateTransactions(budgetId, {
  transactions: [
    { id: txn_id_1, cleared: 'cleared' },
    { id: txn_id_2, date: '2025-09-20' },
    // ... more updates
  ],
});
```

### 8.2 MCP Tool Interface

**Request Schema:**

```typescript
export const ReconcileAccountSchema = z.object({
  budget_id: z.string().min(1).optional(),
  account_id: z.string().min(1),

  // CSV Input (one required)
  csv_file_path: z.string().optional(),
  csv_data: z.string().optional(),

  csv_format: z.object({
    date_column: z.union([z.string(), z.number()]).optional(),
    amount_column: z.union([z.string(), z.number()]).optional(),
    debit_column: z.union([z.string(), z.number()]).optional(),
    credit_column: z.union([z.string(), z.number()]).optional(),
    description_column: z.union([z.string(), z.number()]).optional(),
    date_format: z.string().optional(),
    has_header: z.boolean().optional(),
    delimiter: z.string().optional(),
  }).strict().optional(),

  // Statement Information
  statement_balance: z.number(),
  statement_end_date: optionalDateSchema, // YYYY-MM-DD, or "" for none

  // Matching Configuration (amounts must match exactly, no tolerance parameter)
  date_tolerance_days: z.number().min(0).max(7).optional().default(7),
  match_strictness: z.enum(['loose', 'normal', 'strict']).optional().default('normal'),

  // Automation Toggles
  auto_create_transactions: z.boolean().optional().default(false),
  auto_update_cleared_status: z.boolean().optional().default(false),
  auto_unclear_missing: z.boolean().optional().default(false),
  auto_adjust_dates: z.boolean().optional().default(false),
  dry_run: z.boolean().optional().default(true),
  sign_convention: z.enum(['auto', 'invert', 'as_is']).optional().default('auto'),

  // Response Options
  max_suggestions_in_output: z.number().int().min(1).optional().default(20),
}).strict(); // plus a refine requiring csv_data or csv_file_path
```

**Response Format:**

```typescript
{
  content: [
    {
      type: 'text',
      text: responseFormatter.format(payload),
    },
  ],
  // payload = buildReconciliationPayload(analysis, options, execution):
  // {
  //   human: string,  // formatHumanReadableReport(...)
  //   structured: {
  //     unmatched_bank, unmatched_ynab, suggestions,
  //     execution_summary, operations, errors,
  //   },
  // }
  structuredContent: payload,
  ...(execution.errors.length ? { isError: true } : {}),
}
```

---

## 9. Performance Characteristics

### 9.1 Complexity Analysis

| Operation | Complexity | Notes |
|-----------|------------|-------|
| CSV Parsing | O(N) | N = rows; PapaParse streams large files |
| YNAB Normalization | O(M) | M = YNAB transactions |
| Basic Matching | O(N × M) | N = bank txns, M = YNAB txns |
| Payee Fuzzy Matching | O(L²) per pair | L = string length; fuzzball optimized |
| Create writes | O(N/100) API calls | Up to 100 operations per request |
| Update writes | O(M/100) API calls | Up to 100 operations per request |

### 9.2 Scale Limits

| CSV Size | Expected Performance | Recommendations |
|----------|---------------------|------------------|
| <100 txns | <500ms | Default settings |
| 100-500 txns | <2s | Default settings |
| 500-1000 txns | 2-10s | Consider chunking by month |
| >1000 txns | May timeout | Process in batches |

### 9.3 Optimization Strategies

**Current Optimizations:**

1. **Integer Arithmetic** - No floating-point comparisons
2. **Bounded Unclears** - `auto_unclear_missing` stops planning once the projected cleared balance is within 10 milliunits of the statement
3. **Bulk Operations** - Minimize API calls
4. **Delta Fetching** - Only fetch changed transactions

**Future Optimizations:**

1. **Amount Bucketing** - Index YNAB transactions by amount for O(1) lookup
2. **Date Windowing** - Only compare transactions within ±14 days
3. **Streaming CSV** - Parse in chunks for large files
4. **Parallel Matching** - Use worker threads for CPU-bound fuzzy matching

### 9.4 Memory Usage

**Estimated Memory Footprint:**

```
CSV (500 txns):     ~100 KB raw text
BankTransaction[]:  ~200 KB (400 bytes/txn × 500)
YNAB API (1000):    ~500 KB raw JSON
NormalizedYNAB[]:   ~400 KB (400 bytes/txn × 1000)
MatchResults[]:     ~300 KB (600 bytes/match × 500)
Total:              ~1.5 MB for 500-txn reconciliation
```

**Memory Safety:**

```typescript
// Security limits in csvParser.ts
const MAX_BYTES = options.maxBytes ?? 10 * 1024 * 1024;  // 10MB
const maxRows = options.maxRows ?? 10000;

// PapaParse preview limits rows in memory
const parsed = Papa.parse(content, {
  preview: maxRows + (hasHeader ? 1 : 0),
  skipEmptyLines: true,
});
```

---

## 10. Testing Strategy

### 10.1 Test Coverage

**Unit Tests:**

| Component | Test File | Coverage Focus |
|-----------|-----------|----------------|
| csvParser | csvParser.test.ts | Format detection, amount parsing, date parsing |
| matcher | matcher.test.ts | Scoring algorithm, candidate filtering, tie-breaking |
| analyzer | analyzer.test.ts | Orchestration, insight generation, balance calculation |
| executor | executor.test.ts | Bulk operations, correlation, error handling |
| recommendationEngine | recommendationEngine.test.ts | Recommendation generation, prioritization |

**Integration Tests:**

| Scenario | Test File | Purpose |
|----------|-----------|---------|
| TD Bank CSV | csvParser.integration.test.ts | Real-world TD format |
| RBC Debit/Credit | csvParser.integration.test.ts | Debit/credit column handling |
| Bulk Create | executor.integration.test.ts | Bulk API with mocked YNAB |
| End-to-End | reconciliation.e2e.test.ts | Full flow with real YNAB API |

### 10.2 Test Data

**Fixtures:**

```
test-exports/csv/
├── td-credit-card.csv           # TD headerless format
├── rbc-checking.csv             # RBC debit/credit columns
├── wealthsimple-cash.csv        # Wealthsimple headered format
├── scotiabank-savings.csv       # Scotiabank format
├── tangerine-checking.csv       # Tangerine format
└── edge-cases/
    ├── european-numbers.csv     # 1.234,56 format
    ├── both-debit-credit.csv    # Ambiguous columns
    └── malformed.csv            # Missing fields, bad dates
```

### 10.3 Accuracy Metrics

**Evaluation Dataset:**

```typescript
// test-exports/csv/labeled/
{
  "csv_file": "td-credit-card.csv",
  "ground_truth": [
    {
      "bank_row": 2,
      "ynab_transaction_id": "abc123",
      "expected_confidence": "high",
      "notes": "Exact amount and payee match"
    },
    {
      "bank_row": 3,
      "ynab_transaction_id": null,
      "expected_confidence": "none",
      "notes": "New transaction, should create"
    }
  ]
}
```

**Benchmark Metrics:**

```bash
npm run benchmark:reconciliation -- --dataset=test-exports/csv/labeled/

Output:
  Auto-Match Precision:  95.2% (20/21 correct)
  Auto-Match Recall:     90.9% (20/22 true matches)
  Overall Match Rate:    96.0% (48/50 matched at any level)
  False Positive Rate:    4.8% (1/21 incorrect)
  P95 Latency:          1.2s (500-txn CSV)
```

---

## Appendix A: Sequence Diagrams

### A.1 Execute Plan Flow

```mermaid
sequenceDiagram
    participant H as index.ts
    participant P as plan.ts
    participant E as executor.ts
    participant Y as YNAB API

    H->>P: buildReconciliationPlan(options)
    P-->>H: Frozen plan (operations + fingerprint)
    H->>E: executeReconciliationPlan(plan, options)

    E->>Y: GET account transactions
    Y-->>E: Transactions
    alt Fingerprint changed
        E-->>H: Error: changed since preview, nothing applied
    else Fingerprint unchanged
        loop For each chunk (up to 100 operations of one kind)
            alt Run already stopped
                E->>E: Mark chunk skipped
            else
                E->>Y: createTransaction / createTransactions / updateTransactions
                alt Request succeeded
                    Y-->>E: Saved transactions
                    loop For each operation in the chunk
                        alt Acknowledged
                            E->>E: Mark applied
                        else Not acknowledged
                            E->>E: Mark uncertain, stop the run
                        end
                    end
                else Request failed
                    Y-->>E: Error
                    E->>E: normalizeYnabError, mark chunk uncertain, stop the run
                end
            end
        end
        E->>Y: Balance reconciliation and account refresh
        Y-->>E: Account
        E-->>H: ExecutionResult (operation_results, errors)
    end
```

### A.2 Match Scoring Flow

```mermaid
sequenceDiagram
    participant M as matcher.ts
    participant B as BankTransaction
    participant Y as NormalizedYNABTransaction[]
    participant F as fuzzball

    M->>Y: Loop through YNAB transactions

    loop For each YNAB transaction
        M->>M: Check if already used

        alt Already matched
            M->>M: Skip candidate
        else Not matched
            M->>M: Sign check (bankSign === ynabSign)

            alt Signs differ
                M->>M: Skip candidate
            else Signs match
                M->>M: Check exact amount match

                alt amount !== amount
                    M->>M: Skip candidate
                else Exact match
                    M->>M: Award BASE_SCORE = 50

                    M->>M: Calculate date score (0-100)

                    Note over M: Date Scoring:<br/>same day → 100<br/>1 day → 95<br/>≤ tolerance → 90-50<br/>else → 50-0

                    M->>F: calculatePayeeScore(bankPayee, ynabPayee)

                    F->>F: token_set_ratio
                    F->>F: token_sort_ratio
                    F->>F: partial_ratio
                    F->>F: WRatio

                    F-->>M: max(scores)

                    M->>M: combined = 50 + date×0.15 + payee×0.35

                    M->>M: Apply bonuses

                    Note over M: Bonuses:<br/>date === 100 → +5<br/>payee >= 95 → +10

                    M->>M: combined = min(100, combined + bonuses)

                    alt combined >= minimumCandidateScore (40)
                        M->>M: Add to candidates[]
                    else Below threshold
                        M->>M: Skip candidate
                    end
                end
            end
        end
    end

    M->>M: Sort candidates by combined score (desc)
    M->>M: Tie-break: prefer uncleared, then closer date

    alt Top candidate >= autoMatchThreshold (85)
        M-->>M: confidence = 'high'
        M->>M: Mark YNAB transaction as used
    else Top >= suggestedMatchThreshold (60)
        M-->>M: confidence = 'medium'
    else Top >= minimumCandidateScore (40)
        M-->>M: confidence = 'low'
    else No candidates
        M-->>M: confidence = 'none'
    end

    M-->>M: Return MatchResult { bankTransaction, bestMatch, candidates, confidence, confidenceScore }
```

---

## Appendix B: Configuration Examples

### B.1 Conservative Matching

```json
{
  "date_tolerance_days": 3,
  "match_strictness": "strict",
  "auto_create_transactions": false,
  "auto_update_cleared_status": false,
  "dry_run": true
}
```

### B.2 Aggressive Matching

```json
{
  "date_tolerance_days": 7,
  "match_strictness": "loose",
  "auto_create_transactions": true,
  "auto_update_cleared_status": true,
  "auto_unclear_missing": true,
  "dry_run": false
}
```

### B.3 Manual Review Only

```json
{
  "auto_create_transactions": false,
  "auto_update_cleared_status": false,
  "auto_unclear_missing": false,
  "dry_run": true
}
```

---

## Appendix C: Troubleshooting

### C.1 Common Issues

| Issue | Likely Cause | Solution |
|-------|-------------|----------|
| Low match rate (<50%) | CSV format not detected | Specify the `csv_format` columns (`date_column`, `amount_column`, `description_column`) explicitly |
| All matches "none" | Sign inversion needed | Set `sign_convention: "invert"` |
| Date parsing errors | Ambiguous date format | Specify `csv_format.date_format` |
| Amount parsing errors | European number format | Parser auto-detects, check warnings |
| Balance never aligns | Missing transactions | Check `unmatched_bank` and `unmatched_ynab` |
| Operation marked `uncertain` | A write failed or YNAB did not acknowledge it | Check the account in YNAB before retrying; `structured.operations` in the response shows what was applied |

### C.2 Diagnostic Output

```typescript
{
  include_diagnostics: true
}
```

Returns:

```json
{
  "diagnostics": {
    "csvParsing": {
      "detectedDelimiter": ",",
      "detectedColumns": ["Date", "Description", "Amount"],
      "totalRows": 50,
      "validRows": 48,
      "errors": [
        { "row": 5, "field": "date", "message": "Could not parse date: '99/99/9999'", "rawValue": "99/99/9999" }
      ],
      "warnings": [
        { "row": 12, "message": "Both Debit ($50.00) and Credit ($25.00) have values - using Debit" }
      ]
    },
    "matchingDetails": [
      {
        "bankTxn": { "date": "2025-09-15", "amount": -45230, "payee": "Shell Gas" },
        "bestMatch": {
          "ynabTxn": { "date": "2025-09-15", "amount": -45230, "payee": "Shell" },
          "scores": { "amount": 100, "date": 100, "payee": 85, "combined": 100 }
        },
        "confidence": "high"
      }
    ]
  }
}
```

---

## Appendix D: Future Enhancements

### D.1 Roadmap

| Priority | Feature | Description | Complexity |
|----------|---------|-------------|------------|
| P0 | Split Transaction Detection | Match 1 bank txn to multiple YNAB txns | High |
| P1 | Merchant Learning | Cache successful payee mappings per user | Medium |
| P1 | Adaptive Thresholds | Learn from user confirmations/rejections | Medium |
| P2 | Vector Embeddings | Semantic merchant matching with embeddings | High |
| P2 | Recurring Pattern Detection | Use historical patterns to boost confidence | Medium |
| P3 | Multi-Currency Support | Handle FX transactions and conversions | High |

### D.2 Split Transaction Detection

**Design Sketch:**

```typescript
// Detect when one bank transaction = multiple YNAB transactions
function findCombinationMatches(
  bankTxn: BankTransaction,
  ynabTransactions: NormalizedYNABTransaction[],
  maxCombinationSize: number = 3,
): CombinationMatch[] {
  // Generate all combinations of size 2 to maxCombinationSize
  const combinations = generateCombinations(ynabTransactions, maxCombinationSize);

  for (const combo of combinations) {
    const totalAmount = combo.reduce((sum, txn) => sum + txn.amount, 0);

    if (Math.abs(totalAmount - bankTxn.amount) <= AMOUNT_TOLERANCE) {
      // Found matching combination
      return {
        bankTransaction: bankTxn,
        ynabTransactions: combo,
        confidence: calculateCombinationConfidence(combo, bankTxn),
      };
    }
  }

  return [];
}
```

---

**End of Document**

---

## Document Metadata

- **File Path:** `C:\Users\ksutk\projects\ynab-mcpb\docs\technical\reconciliation-system-architecture.md`
- **Related Files:**
  - Implementation: `C:\Users\ksutk\projects\ynab-mcpb\src\tools\reconciliation\`
  - Existing Docs: `C:\Users\ksutk\projects\ynab-mcpb\docs\reconciliation-flow.md`
  - Design Doc: `C:\Users\ksutk\projects\ynab-mcpb\docs\plans\reconciliation-v2-redesign.md`
- **Version:** 2.0
- **Status:** Active Implementation
- **Last Verified:** 2025-11-30
