---
title: 'Automated Reconciliation Flow'
status: 'active'
last_updated: '2025-11-12'
owners:
  - '@ynab-dxt/tooling'
related_docs:
  - reference/API.md#reconcile_account
  - reference/TOOLS.md#reconcile_account
  - guides/TESTING.md#comprehensive-account-reconciliation
  - reference/TROUBLESHOOTING.md#reconciliation
---

# Automated Reconciliation Flow

Deterministic playbook for reconciling a YNAB account with a bank statement inside the MCP host. The flow runs newest → oldest, stops the moment balances align, and emits both a narrative and machine-readable payload for assistants and downstream automation.

## Prerequisites & Environment
- Provide a valid `.env` cloned from `.env.example`, including `YNAB_ACCESS_TOKEN`, cache knobs, and any per-budget rate limits. Run `npm run validate-env` whenever secrets change.
- Install dependencies with `npm install`, keep `node` ≥ 20, and prefer `npm run dev` while editing to recompile TypeScript incrementally.
- Reconciliation tools assume access to CSV statements on disk (`csv_file_path`) or piped data (`csv_data`). Files should stay inside the workspace to avoid sandbox denials.
- Vitest snapshot directories (`test-results/`) must be writable; dry-run audits reference these to highlight regression diffs.

## Schema & Data Contracts
- **Input contract** – `ReconcileAccountSchema` (`src/tools/reconciliation/index.ts`) enforces budget/account ids, CSV source, statement balance, and guard rails like date/amount tolerances, automation toggles, and confidence thresholds. Every entry path calls `ReconcileAccountSchema.parse(...)` before touching the YNAB API.
- **CSV normalization** – `autoDetectCSVFormat` plus `extractDateRangeFromCSV` deduce header presence, delimiter, debit/credit pairs, and generate the reconciliation window (min/max ± 5 days buffer).
- **Structured output** – `buildReconciliationPayload` + `responseFormatter` return `version: '2.0'` JSON (see `docs/schemas/reconciliation-v2.json`) alongside the human narrative. This payload captures matches, actions, balance deltas, and flags like `audit_trail_complete`.
- **Audit snapshot** – `buildBalanceReconciliation` records `precision_calculations`, `discrepancy_analysis`, and `final_verification` booleans, ensuring downstream tooling can prove reconciliation outcomes without re-querying YNAB.

## Configuration Knobs (Schema Excerpts)
- Matching tolerances: `date_tolerance_days` (0-7, default 2) and `amount_tolerance_cents` (default 1¢) gate candidate searches; `confidence_threshold` (0.8) controls risk when auto-clearing.
- Automation toggles: `auto_create_transactions`, `auto_update_cleared_status`, `auto_adjust_dates`, `auto_unclear_missing`, `dry_run`, and `balance_verification_mode` (`ANALYSIS_ONLY`, `GUIDED_RESOLUTION`, `AUTO_RESOLVE`).
- CSV format overrides: `csv_format.{date_column, amount_column, debit_column, credit_column, date_format, has_header, delimiter}` keep unusual exports usable without retooling the parser.
- Safety rails: `require_exact_match` and `max_resolution_attempts` prevent runaway loops; `include_structured_data` controls whether assistants receive the payload blob.

## Logging & Auditability
- Every mutation funnels through `responseFormatter` with `execution.summary` stats plus `matches_found`, `transactions_created`, and `transactions_updated` counts for dashboards.
- `buildBalanceReconciliation` emits `audit_trail_complete`, balance math, and likely-cause hints whenever a discrepancy persists.
- `executor.ts` annotates each action with reasons (e.g., "marked as cleared, date adjusted"), giving a linear log for SOC review.
- Tests under `src/tools/reconciliation/__tests__/` assert both narrative text and structured payloads; failures drop sanitized artifacts into `test-results/` for diffing.

## Numbered Steps, Rationale, and Validation Hooks
### Step 1 — Input validation & window detection
- **Rationale**: Prevents wasting API calls on malformed CSVs and ensures the comparison window brackets all relevant transactions.
- **What happens**: Parse CSV metadata, normalize amounts/dates, derive min/max window ±5 days, and hydrate default tolerances through `ReconcileAccountSchema.parse(...)`. Liability accounts invert statement balance sign for consistent delta math.
- **Validation**: Unit coverage in `src/tools/reconciliation/__tests__/parser.*` plus `npm run validate-env` to guarantee credentials before file I/O occurs.
- **Open questions**: Should we persist detected CSV format to `test-exports/` for reuse, or is in-memory derivation sufficient for multi-pass sessions?

### Step 2 — Phase 1 statement pass (newest → oldest)
- **Rationale**: Mirroring experienced YNAB workflows short-circuits once balances match, avoiding needless mutation of ancient rows.
- **What happens**: Sort bank rows descending, compute `cleared_delta = ynab.cleared - statement_balance`, and for each row find best YNAB candidate within tolerances + payee similarity. If confidence ≥ `auto_match_threshold` and automation toggles allow, clear/update/auto-create transactions. Recalculate `cleared_delta` after every action; halt once |delta| ≤ tolerance.
- **Validation**: `findBestMatch` integration tests ensure deterministic candidate ordering; we also assert log completeness (`audit_trail_complete`) in executor tests.
- **Open questions**: Do we need adaptive confidence thresholds for larger ledgers (>1k rows) to limit runtime, or is the static percentage enough?

### Step 3 — Phase 2 cleared-YNAB sanity pass
- **Rationale**: Detects stale cleared transactions that never appeared on the bank statement, a common source of lingering deltas.
- **What happens**: Iterate YNAB transactions with `cleared === 'cleared'` but `reconciled === false` inside the CSV window ±5 days. Attempt to re-match them to leftover bank rows; otherwise flip to `uncleared` when `auto_unclear_missing` is true and recompute `cleared_delta`.
- **Validation**: Executor tests (`executor.sanity-pass.test.ts`) verify we never un-clear reconciled items, and dry-run mode logs intended actions without mutating YNAB.
- **Open questions**: Should we surface a preview of would-be un-cleared transactions in dry-run mode to the structured payload for UI display?

### Step 4 — Finalize reconciliation
- **Rationale**: Once balances align, we need a trusted checkpoint recording statement date/balance plus an auditable list of touched transactions.
- **What happens**: Prompt the assistant/user to finish reconciliation, set involved transactions to `reconciled`, and call `buildBalanceReconciliation` to persist precision math and `final_verification` booleans.
- **Validation**: Snapshot tests assert the `execution.account_balance.before/after` objects stay monotonic; manual validation by rerunning `npm test -- --runInBand` ensures no race with parallel Vitest workers.
- **Open questions**: Should we enforce that `statement_date` is required at this stage, or keep the current fallback to `statement_end_date` if missing?

### Step 5 — Leftover escalation & operator handoff
- **Rationale**: Keeping humans in the loop for medium/low-confidence matches prevents silent drift when automation can’t safely conclude.
- **What happens**: Surface structured `recommendations` containing low-confidence suggestions, unmatched bank-only rows, and the list of transactions auto un-cleared during Step 3. The narrative outlines manual review order, while the JSON payload allows clients to build UI cards (see `reference/TROUBLESHOOTING.md#reconciliation`).
- **Validation**: Adapter tests verify `buildReconciliationPayload` includes each unresolved set with counts, and E2E scripts (`test-reconcile-autodetect.js`) confirm the CLI prints the same inventory of leftovers.
- **Open questions**: Do we need a SLA timer/escalation hook (e.g., Slack webhook) when leftovers include more than N transactions, or is assistant messaging enough?

### Step 6 — Retriable automation & telemetry feedback
- **Rationale**: Audit logs inform future tuning (e.g., tolerance adjustments) and enable replays without re-parsing inputs.
- **What happens**: Persist log streams, emit `execution.summary` stats, and optionally rerun the flow with updated knobs (e.g., `balance_verification_mode = 'GUIDED_RESOLUTION'`) using the same CSV payload. Telemetry consumers watch `audit_trail_complete` and `discrepancy_analysis` to decide whether another automated attempt is viable.
- **Validation**: `docs/guides/TESTING.md#comprehensive-account-reconciliation` details the manual harness; CI pipelines run `npm run test:comprehensive` to ensure telemetry fields stay backwards compatible.
- **Open questions**: Should we snapshot anonymized telemetry for regression dashboards, or does that introduce privacy concerns with customer CSVs?

## Testing Hooks & Cross-links
- Follow the **Comprehensive Account Reconciliation** playbook in `[docs/guides/TESTING.md](guides/TESTING.md#comprehensive-account-reconciliation)` to exercise CSV parsing, matching, and execution paths end-to-end.
- Tool contract reference lives in `[docs/reference/API.md#reconcile_account](reference/API.md#reconcile_account)` and `[docs/reference/TOOLS.md#reconcile_account](reference/TOOLS.md#reconcile_account)`; keep this doc updated when schemas there change.
- Troubleshooting steps for stubborn discrepancies are cataloged in `[docs/reference/TROUBLESHOOTING.md#reconciliation](reference/TROUBLESHOOTING.md#reconciliation)`; link to this when raising escalation tickets.
- Local scripts (`test-reconcile-tool.js`, `test-reconcile-autodetect.js`) double as reproducible demonstrations—capture their JSON output and attach to `.pr-description.md` when documenting reconciliation changes.
