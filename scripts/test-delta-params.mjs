import * as ynab from 'ynab';

const ACCESS_TOKEN = process.env.YNAB_ACCESS_TOKEN;

if (!ACCESS_TOKEN) {
  console.error('Missing YNAB_ACCESS_TOKEN environment variable.');
  process.exit(1);
}

const ynabAPI = new ynab.API(ACCESS_TOKEN);

const results = [];

function recordResult(name, signature, supported, notes, error) {
  results.push({ name, signature, supported, notes, error: error?.message ?? null });
  const status = supported ? '✓' : '✗';
  const suffix = notes ? ` - ${notes}` : '';
  console.log(`${status} ${name} (${signature})${suffix}`);
  if (error) {
    console.log(`   Error: ${error.message}`);
  }
}

async function verifySimpleEndpoint({ name, signature, fetchFull, fetchDelta }) {
  try {
    const full = await fetchFull();
    const knowledge = full?.data?.server_knowledge;
    if (typeof knowledge !== 'number') {
      throw new Error('Response missing server_knowledge');
    }

    await fetchDelta(knowledge);
    recordResult(name, signature, true, `server_knowledge=${knowledge}`);
  } catch (error) {
    recordResult(name, signature, false, '', error);
  }
}

async function main() {
  console.log('Verifying YNAB SDK delta request signatures...\n');
  const budgetsResponse = await ynabAPI.budgets.getBudgets();
  const budget = budgetsResponse?.data?.budgets?.[0];
  if (!budget) {
    throw new Error('No budget available to test.');
  }
  const budgetId = budget.id;
  console.log(`Using budget: ${budget.name} (${budgetId})\n`);

  // Budgets API
  await verifySimpleEndpoint({
    name: 'budgets.getBudgetById',
    signature: 'getBudgetById(budgetId, lastKnowledge?)',
    fetchFull: () => ynabAPI.budgets.getBudgetById(budgetId),
    fetchDelta: (knowledge) => ynabAPI.budgets.getBudgetById(budgetId, knowledge),
  });

  // Accounts API
  await verifySimpleEndpoint({
    name: 'accounts.getAccounts',
    signature: 'getAccounts(budgetId, lastKnowledge?)',
    fetchFull: () => ynabAPI.accounts.getAccounts(budgetId),
    fetchDelta: (knowledge) => ynabAPI.accounts.getAccounts(budgetId, knowledge),
  });

  // Categories API
  await verifySimpleEndpoint({
    name: 'categories.getCategories',
    signature: 'getCategories(budgetId, lastKnowledge?)',
    fetchFull: () => ynabAPI.categories.getCategories(budgetId),
    fetchDelta: (knowledge) => ynabAPI.categories.getCategories(budgetId, knowledge),
  });

  // Payees API
  await verifySimpleEndpoint({
    name: 'payees.getPayees',
    signature: 'getPayees(budgetId, lastKnowledge?)',
    fetchFull: () => ynabAPI.payees.getPayees(budgetId),
    fetchDelta: (knowledge) => ynabAPI.payees.getPayees(budgetId, knowledge),
  });

  // Months API
  await verifySimpleEndpoint({
    name: 'months.getBudgetMonths',
    signature: 'getBudgetMonths(budgetId, lastKnowledge?)',
    fetchFull: () => ynabAPI.months.getBudgetMonths(budgetId),
    fetchDelta: (knowledge) => ynabAPI.months.getBudgetMonths(budgetId, knowledge),
  });

  // Scheduled Transactions API
  await verifySimpleEndpoint({
    name: 'scheduledTransactions.getScheduledTransactions',
    signature: 'getScheduledTransactions(budgetId, lastKnowledge?)',
    fetchFull: () => ynabAPI.scheduledTransactions.getScheduledTransactions(budgetId),
    fetchDelta: (knowledge) =>
      ynabAPI.scheduledTransactions.getScheduledTransactions(budgetId, knowledge),
  });

  // Transactions API
  try {
    const full = await ynabAPI.transactions.getTransactions(budgetId);
    const knowledge = full?.data?.server_knowledge;
    if (typeof knowledge !== 'number') {
      throw new Error('Response missing server_knowledge');
    }

    let supported = false;
    let notes = '';

    try {
      await ynabAPI.transactions.getTransactions(budgetId, undefined, undefined, knowledge);
      supported = true;
      notes = 'Signature: (budgetId, sinceDate?, type?, lastKnowledge?)';
    } catch (error) {
      notes = 'Failed with lastKnowledge as 4th parameter';
      throw error;
    }

    recordResult(
      'transactions.getTransactions',
      notes,
      supported,
      `server_knowledge=${knowledge}`,
    );
  } catch (error) {
    recordResult(
      'transactions.getTransactions',
      'getTransactions(budgetId, since?, type?, lastKnowledge?)',
      false,
      '',
      error,
    );
  }

  console.log('\nSummary:\n');
  for (const row of results) {
    console.log(
      `${row.supported ? '✓' : '✗'} ${row.name} -> ${row.supported ? 'supports delta' : 'no delta'} (${row.signature})`,
    );
  }
}

main().catch((error) => {
  console.error('Verification failed:', error);
  process.exit(1);
});
