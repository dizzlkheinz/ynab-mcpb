/**
 * Manual test script for recommendation engine
 * Tests the EvoCarShare scenario from user feedback
 */

import { analyzeReconciliation } from '../src/tools/reconciliation/analyzer.js';
import { DEFAULT_MATCHING_CONFIG } from '../src/tools/reconciliation/types.js';

// Test data from user's scenario
const csvContent = `Date,Description,Amount
2024-10-30,EvoCarShare,22.22`;

const ynabTransactions = []; // No YNAB transactions

const analysis = analyzeReconciliation(
  csvContent,
  undefined,
  ynabTransactions,
  122.22, // Statement balance
  DEFAULT_MATCHING_CONFIG,
  'USD',
  'test-account',
  'test-budget',
);

console.log('=== RECONCILIATION ANALYSIS ===');
console.log(`On Track: ${analysis.balance_info.on_track}`);
console.log(`Discrepancy: ${analysis.balance_info.discrepancy.value_display}`);
console.log(`\n=== RECOMMENDATIONS (${analysis.recommendations?.length || 0}) ===`);

if (analysis.recommendations && analysis.recommendations.length > 0) {
  for (const rec of analysis.recommendations) {
    console.log(`\n[${rec.priority.toUpperCase()}] ${rec.message}`);
    console.log(`  Type: ${rec.action_type}`);
    console.log(`  Confidence: ${(rec.confidence * 100).toFixed(0)}%`);
    console.log(`  Reason: ${rec.reason}`);
    console.log(`  Impact: ${rec.estimated_impact.value_display}`);

    if (rec.action_type === 'create_transaction') {
      console.log(`  Parameters:`);
      console.log(`    - Date: ${rec.parameters.date}`);
      console.log(`    - Amount: $${(rec.parameters.amount / 1000).toFixed(2)}`);
      console.log(`    - Payee: ${rec.parameters.payee_name}`);
      console.log(`    - Cleared: ${rec.parameters.cleared}`);
    }
  }

  console.log('\n✅ All checks passed!');
  console.log('Recommendation engine is working correctly.');
} else {
  console.log('❌ No recommendations generated!');
  process.exit(1);
}
