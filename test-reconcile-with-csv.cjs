/**
 * Test reconciliation with merged CSV data
 * Run this script using the YNAB MCP server in your other context
 */

const fs = require('fs');
const path = require('path');

// Read the CSV files
const downloadsPath = path.join(process.env.USERPROFILE, 'Downloads');
const csv1Path = path.join(downloadsPath, 'accountactivity.csv');
const csv2Path = path.join(downloadsPath, 'accountactivity1.csv');
const csv3Path = path.join(downloadsPath, 'accountactivity2.csv');

let csv1, csv2, csv3;
try {
  csv1 = fs.readFileSync(csv1Path, 'utf-8');
  csv2 = fs.readFileSync(csv2Path, 'utf-8');
  csv3 = fs.readFileSync(csv3Path, 'utf-8');
} catch (error) {
  console.error('Error reading CSV files:', error.message);
  process.exit(1);
}
// Merge CSVs (skip header from second and third files)
const lines1 = csv1.split('\n');
const lines2 = csv2.split('\n');
const lines3 = csv3.split('\n');

// Get header from first file
const header = lines1[0];

// Get data rows (skip header from all files, skip empty lines)
const data1 = lines1.slice(1).filter(line => line.trim());
const data2 = lines2.slice(1).filter(line => line.trim());
const data3 = lines3.slice(1).filter(line => line.trim());

// Combine and deduplicate
const allData = [...data1, ...data2, ...data3];
const uniqueData = [...new Set(allData)];

// Reconstruct CSV
const mergedCsv = [header, ...uniqueData].join('\n');

const BUDGET_ID = process.env.YNAB_BUDGET_ID || '00dd8b56-cca8-4a1f-a3ea-02b13df8c2ff';
const ACCOUNT_ID = process.env.YNAB_ACCOUNT_ID || '083f96c0-ed01-497d-93ab-f94c5ba89509';
const STATEMENT_BALANCE = parseFloat(process.env.STATEMENT_BALANCE || '-1234.91');
if (isNaN(STATEMENT_BALANCE)) {
  console.error('Invalid STATEMENT_BALANCE value');
  process.exit(1);
}const STATEMENT_DATE = process.env.STATEMENT_DATE || '2025-01-11';

const reconciliationCall = {
  tool: 'reconcile_account',
  params: {
    budget_id: BUDGET_ID,
    account_id: ACCOUNT_ID,
    statement_balance: STATEMENT_BALANCE,
    statement_date: STATEMENT_DATE,
    csv_data: mergedCsv,
    csv_format: {
      date_column: 'Transaction Date',
      description_column: 'Description',
      amount_column: 'Amount',
      date_format: 'YYYY-MM-DD',
      has_header: true,
      delimiter: ','
    },
    dry_run: false,
    auto_create_transactions: true,
    auto_update_cleared_status: true,
    auto_unclear_missing: true,
    include_structured_data: false
  }
};    auto_update_cleared_status: true,
    auto_unclear_missing: true,
    include_structured_data: false
  }
};
const mergedCsvPath = path.join(downloadsPath, 'accountactivity-merged.csv');
try {
  fs.writeFileSync(mergedCsvPath, mergedCsv);
  console.log(`\n\nMerged CSV saved to: ${mergedCsvPath}`);
} catch (error) {
  console.error('Error saving merged CSV:', error.message);
}
// Also save the merged CSV for reference
const mergedCsvPath = path.join(downloadsPath, 'accountactivity-merged.csv');
fs.writeFileSync(mergedCsvPath, mergedCsv);
console.log(`\n\nMerged CSV saved to: ${mergedCsvPath}`);
