# Codex Consultation: YNAB Reconciliation UX Improvement

## Context
We have a YNAB MCP server with a reconciliation tool that compares bank statement data with YNAB transactions. The tool works, but the user experience was "miserable" due to:

1. Claude (AI assistant) misread the cleared balance from the tool output
2. Claude got confused about which direction a $22.22 discrepancy was
3. Claude didn't notice an obvious missing transaction (Oct 30 EvoCarShare $22.22) that exactly matched the discrepancy

## Current Architecture
- **reconcileAccount.ts** - Main reconciliation orchestrator
- **compareTransactions/** - Transaction matching logic (amount + date priority, payee as tiebreaker)
- Tool returns detailed JSON with matches, unmatched transactions, balance analysis

## The Problem
The tool returns correct data, but when Claude interprets the JSON:
- Balance values can be misread (milliunits vs dollars confusion)
- Discrepancy direction gets confused (positive vs negative)
- Missing transactions aren't highlighted as likely causes of balance discrepancies

## Proposed Solution
Make the tool output more "Claude-proof" by:
1. Using clear, human-readable text format instead of raw JSON
2. Explicitly highlighting when an unmatched transaction amount matches the balance discrepancy
3. Providing clear next-step recommendations

## Design Question
Should we:

**Option A:** Keep JSON output but improve Claude's interpretation
- Add better prompts/instructions for Claude to follow
- Provide examples of correct interpretation
- Rely on Claude getting better at parsing the data

**Option B:** Change tool output to be human-first
- Return formatted text with clear labels
- Highlight key insights (e.g., "This $22.22 transaction matches your $22.22 discrepancy!")
- Include explicit recommendations
- Make it hard to misinterpret

**Option C:** Hybrid approach
- Return both machine-readable JSON AND human-readable summary
- Let Claude use whichever makes more sense
- Summary helps Claude understand the data structure

## Specific Technical Questions

1. **Balance Representation:** How should we present balances to avoid confusion?
   - Current: returns milliunits (integers), Claude has to convert
   - Should we return both formats? Labels?

2. **Discrepancy Highlighting:** Should the tool itself detect when an unmatched transaction exactly matches a balance discrepancy?
   - Currently: Claude has to notice the pattern
   - Should this be explicit in the output?

3. **Transaction Matching:** The matching algorithm prioritizes amount (50pts) + date (40pts) over payee names (10pts). Is this correct?
   - User confirmed payee names will never match exactly between bank and YNAB
   - Current approach seems right, but why didn't transactions match initially?

## What We Need from Codex

1. **Architecture advice:** Should financial tools return machine-readable or human-readable output when the consumer is an AI assistant?

2. **Error prevention:** What patterns prevent AI assistants from misinterpreting financial data (balances, signs, units)?

3. **UX design:** For a reconciliation tool, what information should be presented vs. what should be computed on-demand?

4. **Best practices:** Are there examples of tools that work well with AI assistants? What makes them successful?

## User's Ideal Experience
User provides:
- Bank statement CSV data
- Statement ending balance
- Account to reconcile

Tool should:
- Automatically match transactions (amount + date, ignore payee name differences)
- Identify any discrepancies
- Highlight missing transactions
- Make it obvious when a missing transaction explains a balance difference
- Guide the user to resolution

The user shouldn't have to explain basic facts like "the cleared balance is -$523.20" when YNAB already knows this.
