#!/usr/bin/env node
/**
 * Test script for reconcile_account_v2 tool
 *
 * Usage:
 *   node test-reconcile-tool.js <csv-file> <budget-id> <account-id> <statement-balance>
 *
 * Example:
 *   node test-reconcile-tool.js test.csv last-used checking -1500.00
 */

import { API } from 'ynab';
import { handleReconcileAccountV2 } from './dist/tools/reconciliation/index.js';
import { readFileSync } from 'fs';

async function testReconciliation() {
  // Parse arguments
  const csvFile = process.argv[2];
  const budgetId = process.argv[3] || 'last-used';
  const accountId = process.argv[4];
  const statementBalance = parseFloat(process.argv[5] || '0');

  if (!csvFile || !accountId) {
    console.error(
      'Usage: node test-reconcile-tool.js <csv-file> <budget-id> <account-id> <statement-balance>',
    );
    console.error('Example: node test-reconcile-tool.js test.csv last-used checking -1500.00');
    process.exit(1);
  }

  // Check for YNAB token
  const token = process.env.YNAB_ACCESS_TOKEN;
  if (!token) {
    console.error('❌ YNAB_ACCESS_TOKEN environment variable not set');
    process.exit(1);
  }

  // Initialize YNAB API
  const ynabAPI = new API(token);

  console.log('🔍 Testing reconcile_account_v2...\n');
  console.log(`CSV File: ${csvFile}`);
  console.log(`Budget ID: ${budgetId}`);
  console.log(`Account ID: ${accountId}`);
  console.log(`Statement Balance: $${statementBalance}`);
  console.log('\n---\n');

  try {
    // Read CSV content
    const csvContent = readFileSync(csvFile, 'utf-8');

    // Call the tool
    const result = await handleReconcileAccountV2(ynabAPI, {
      budget_id: budgetId,
      account_id: accountId,
      csv_data: csvContent,
      statement_balance: statementBalance,
      date_tolerance_days: 2,
      amount_tolerance_cents: 1,
      auto_match_threshold: 90,
      suggestion_threshold: 60,
    });

    // Parse and display results
    const analysis = JSON.parse(result.content[0].text);

    console.log('✅ Analysis Complete!\n');
    console.log('📊 Summary:');
    console.log(`  Bank Transactions: ${analysis.summary.bank_transactions_count}`);
    console.log(`  YNAB Transactions: ${analysis.summary.ynab_transactions_count}`);
    console.log(`  Auto-Matched: ${analysis.summary.auto_matched} (≥90% confidence)`);
    console.log(`  Suggested Matches: ${analysis.summary.suggested_matches} (60-89% confidence)`);
    console.log(`  Unmatched Bank: ${analysis.summary.unmatched_bank}`);
    console.log(`  Unmatched YNAB: ${analysis.summary.unmatched_ynab}`);
    console.log('\n💰 Balance:');
    console.log(`  Current Cleared: $${analysis.balance_info.current_cleared.toFixed(2)}`);
    console.log(`  Target Statement: $${analysis.balance_info.target_statement.toFixed(2)}`);
    console.log(`  Discrepancy: $${analysis.balance_info.discrepancy.toFixed(2)}`);
    console.log(`  On Track: ${analysis.balance_info.on_track ? '✅' : '❌'}`);

    if (analysis.auto_matches.length > 0) {
      console.log('\n✨ Auto-Matched Transactions:');
      analysis.auto_matches.slice(0, 5).forEach((match, i) => {
        console.log(
          `  ${i + 1}. ${match.bank_transaction.payee} - $${match.bank_transaction.amount.toFixed(2)}`,
        );
        console.log(`     → Matched to YNAB: ${match.ynab_transaction.payee_name}`);
        console.log(`     Confidence: ${match.confidence_score}%`);
      });
      if (analysis.auto_matches.length > 5) {
        console.log(`  ... and ${analysis.auto_matches.length - 5} more`);
      }
    }

    if (analysis.suggested_matches.length > 0) {
      console.log('\n💡 Suggested Matches (need review):');
      analysis.suggested_matches.slice(0, 3).forEach((match, i) => {
        console.log(
          `  ${i + 1}. ${match.bank_transaction.payee} - $${match.bank_transaction.amount.toFixed(2)}`,
        );
        if (match.candidates && match.candidates.length > 0) {
          console.log(
            `     Top candidate: ${match.candidates[0].ynab_transaction.payee_name} (${match.candidates[0].confidence}%)`,
          );
        }
      });
      if (analysis.suggested_matches.length > 3) {
        console.log(`  ... and ${analysis.suggested_matches.length - 3} more`);
      }
    }

    if (analysis.unmatched_bank.length > 0) {
      console.log('\n❓ Unmatched Bank Transactions (not in YNAB):');
      analysis.unmatched_bank.slice(0, 3).forEach((txn, i) => {
        console.log(`  ${i + 1}. ${txn.payee} - $${txn.amount.toFixed(2)} on ${txn.date}`);
      });
      if (analysis.unmatched_bank.length > 3) {
        console.log(`  ... and ${analysis.unmatched_bank.length - 3} more`);
      }
    }

    if (analysis.insights && analysis.insights.length > 0) {
      console.log('\n💡 Insights:');
      analysis.insights.forEach((insight) => {
        const icon =
          insight.severity === 'critical' ? '🔴' : insight.severity === 'warning' ? '⚠️' : 'ℹ️';
        console.log(`  ${icon} ${insight.title}`);
        console.log(`     ${insight.description}`);
      });
    }

    console.log('\n📋 Next Steps:');
    analysis.next_steps.forEach((step, i) => {
      console.log(`  ${i + 1}. ${step}`);
    });

    console.log('\n✅ Test complete!');
    console.log('\nFull results saved to: reconcile-analysis-result.json');

    // Save full results
    require('fs').writeFileSync(
      'reconcile-analysis-result.json',
      JSON.stringify(analysis, null, 2),
    );
  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error);
    process.exit(1);
  }
}

testReconciliation();
