/**
 * Test the auto-detect date range functionality
 */

import { extractDateRangeFromCSV, autoDetectCSVFormat } from './dist/tools/compareTransactions/parser.js';

const csvContent = `Date,Description,Debit,Credit,Balance
11/10/2025,DOLLARAMA # 109,10.91,,
10/15/2025,Uber Trip,30.50,,
09/22/2025,CIRCLE K # 05844 A,18.84,,`;

console.log('Testing auto-detection...');

try {
  // Test 1: Auto-detect format
  console.log('\n1. Auto-detecting CSV format...');
  const csvFormat = autoDetectCSVFormat(csvContent);
  console.log('  ✓ Format detected:', JSON.stringify(csvFormat, null, 2));

  // Test 2: Extract date range
  console.log('\n2. Extracting date range...');
  const { minDate, maxDate } = extractDateRangeFromCSV(csvContent, csvFormat);
  console.log(`  ✓ Date range: ${minDate} to ${maxDate}`);

  // Test 3: Calculate buffer date
  console.log('\n3. Calculating YNAB fetch date with 7-day buffer...');
  const minDateObj = new Date(minDate);
  minDateObj.setDate(minDateObj.getDate() - 7);
  const fetchDate = minDateObj.toISOString().split('T')[0];
  console.log(`  ✓ YNAB fetch from: ${fetchDate}`);

  console.log('\n✅ All tests passed!');
} catch (error) {
  console.error('\n❌ ERROR:', error.message);
  console.error(error.stack);
  process.exit(1);
}
