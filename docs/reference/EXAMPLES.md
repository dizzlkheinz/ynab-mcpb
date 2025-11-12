# YNAB MCP Server Usage Examples

This document provides practical examples of using the YNAB MCP Server tools in real-world scenarios. Each example includes complete code with error handling and best practices.

## Table of Contents

- [Basic Examples](#basic-examples)
- [Budget Management Examples](#budget-management-examples)
- [Account Management Examples](#account-management-examples)
- [Transaction Management Examples](#transaction-management-examples)
- [Category Management Examples](#category-management-examples)
- [Financial Analysis Examples](#financial-analysis-examples)
- [Advanced Workflows](#advanced-workflows)
- [Integration Examples](#integration-examples)

## Basic Examples

### Getting Started - User Information

```javascript
// Get authenticated user information
async function getUserInfo() {
  try {
    const result = await client.callTool('get_user', {});
    const data = JSON.parse(result.content[0].text);
    
    console.log('User Information:');
    console.log(`Email: ${data.user.email}`);
    console.log(`Subscription: ${data.user.subscription.frequency}`);
    
    return data.user;
  } catch (error) {
    console.error('Failed to get user info:', error.message);
    throw error;
  }
}
```

### Amount Conversion Examples

```javascript
// Convert dollars to milliunits for API calls
async function convertToMilliunits(dollarAmount) {
  const result = await client.callTool('convert_amount', {
    amount: dollarAmount,
    to_milliunits: true
  });
  const data = JSON.parse(result.content[0].text);
  return data.converted_amount;
}

// Convert milliunits to dollars for display
async function convertToDollars(milliunits) {
  const result = await client.callTool('convert_amount', {
    amount: milliunits,
    to_milliunits: false
  });
  const data = JSON.parse(result.content[0].text);
  return data.converted_amount;
}

// Example usage
const userInput = 25.50; // User enters $25.50
const milliunits = await convertToMilliunits(userInput);
console.log(`$${userInput} = ${milliunits} milliunits`);

const displayAmount = await convertToDollars(milliunits);
console.log(`${milliunits} milliunits = $${displayAmount}`);
```

## Budget Management Examples

### List All Budgets

```javascript
async function listAllBudgets() {
  try {
    const result = await client.callTool('list_budgets', {});
    const data = JSON.parse(result.content[0].text);
    
    console.log('Available Budgets:');
    data.budgets.forEach((budget, index) => {
      console.log(`${index + 1}. ${budget.name} (${budget.id})`);
      console.log(`   Last modified: ${new Date(budget.last_modified_on).toLocaleDateString()}`);
      console.log(`   Currency: ${budget.currency_format.currency_symbol}`);
    });
    
    return data.budgets;
  } catch (error) {
    console.error('Failed to list budgets:', error.message);
    throw error;
  }
}
```

### Get Detailed Budget Information

```javascript
async function getBudgetDetails(budgetId) {
  try {
    const result = await client.callTool('get_budget', {
      budget_id: budgetId
    });
    const data = JSON.parse(result.content[0].text);
    
    const budget = data.budget;
    console.log(`Budget: ${budget.name}`);
    console.log(`Accounts: ${budget.accounts.length}`);
    console.log(`Categories: ${budget.categories.length}`);
    console.log(`Transactions: ${budget.transactions.length}`);
    
    return budget;
  } catch (error) {
    console.error('Failed to get budget details:', error.message);
    throw error;
  }
}
```

## Account Management Examples

### List Accounts by Type

```javascript
async function listAccountsByType(budgetId, accountType = null) {
  try {
    const result = await client.callTool('list_accounts', {
      budget_id: budgetId
    });
    const data = JSON.parse(result.content[0].text);
    
    let accounts = data.accounts.filter(account => !account.closed);
    
    if (accountType) {
      accounts = accounts.filter(account => account.type === accountType);
    }
    
    console.log(`${accountType || 'All'} Accounts:`);
    accounts.forEach(account => {
      const balance = (account.balance / 1000).toFixed(2);
      console.log(`- ${account.name}: $${balance} (${account.type})`);
    });
    
    return accounts;
  } catch (error) {
    console.error('Failed to list accounts:', error.message);
    throw error;
  }
}

// Usage examples
await listAccountsByType(budgetId); // All accounts
await listAccountsByType(budgetId, 'checking'); // Only checking accounts
await listAccountsByType(budgetId, 'creditCard'); // Only credit cards
```

### Create New Account

```javascript
async function createNewAccount(budgetId, accountName, accountType, initialBalance = 0) {
  try {
    // Convert initial balance to milliunits
    const balanceMilliunits = await convertToMilliunits(initialBalance);
    
    const result = await client.callTool('create_account', {
      budget_id: budgetId,
      name: accountName,
      type: accountType,
      balance: balanceMilliunits
    });
    const data = JSON.parse(result.content[0].text);
    
    const account = data.account;
    console.log(`Created account: ${account.name}`);
    console.log(`Type: ${account.type}`);
    console.log(`Initial balance: $${(account.balance / 1000).toFixed(2)}`);
    
    return account;
  } catch (error) {
    console.error('Failed to create account:', error.message);
    throw error;
  }
}

// Example: Create a new savings account with $1000 initial balance
const newAccount = await createNewAccount(
  budgetId, 
  'Emergency Fund', 
  'savings', 
  1000.00
);
```

### Get Account Balance Summary

```javascript
async function getAccountBalanceSummary(budgetId) {
  try {
    const result = await client.callTool('list_accounts', {
      budget_id: budgetId
    });
    const data = JSON.parse(result.content[0].text);
    
    const summary = {
      totalAssets: 0,
      totalLiabilities: 0,
      netWorth: 0,
      accountsByType: {}
    };
    
    data.accounts.forEach(account => {
      if (account.closed) return;
      
      const balance = account.balance / 1000;
      
      // Group by account type
      if (!summary.accountsByType[account.type]) {
        summary.accountsByType[account.type] = {
          count: 0,
          totalBalance: 0,
          accounts: []
        };
      }
      
      summary.accountsByType[account.type].count++;
      summary.accountsByType[account.type].totalBalance += balance;
      summary.accountsByType[account.type].accounts.push({
        name: account.name,
        balance: balance
      });
      
      // Calculate assets vs liabilities
      if (['checking', 'savings', 'cash', 'otherAsset'].includes(account.type)) {
        summary.totalAssets += balance;
      } else if (['creditCard', 'lineOfCredit', 'otherLiability'].includes(account.type)) {
        summary.totalLiabilities += Math.abs(balance);
      }
    });
    
    summary.netWorth = summary.totalAssets - summary.totalLiabilities;
    
    console.log('Account Balance Summary:');
    console.log(`Total Assets: $${summary.totalAssets.toFixed(2)}`);
    console.log(`Total Liabilities: $${summary.totalLiabilities.toFixed(2)}`);
    console.log(`Net Worth: $${summary.netWorth.toFixed(2)}`);
    
    return summary;
  } catch (error) {
    console.error('Failed to get balance summary:', error.message);
    throw error;
  }
}
```

## Transaction Management Examples

### Create Simple Transaction

```javascript
async function createSimpleTransaction(budgetId, accountId, amount, payeeName, memo = '') {
  try {
    // Convert amount to milliunits
    const milliunits = await convertToMilliunits(Math.abs(amount));
    const transactionAmount = amount < 0 ? -milliunits : milliunits;
    
    // Use today's date
    const today = new Date().toISOString().split('T')[0];
    
    const result = await client.callTool('create_transaction', {
      budget_id: budgetId,
      account_id: accountId,
      amount: transactionAmount,
      date: today,
      payee_name: payeeName,
      memo: memo,
      cleared: 'uncleared',
      approved: true
    });
    const data = JSON.parse(result.content[0].text);
    
    const transaction = data.transaction;
    console.log(`Created transaction: ${payeeName} for $${Math.abs(amount)}`);
    
    return transaction;
  } catch (error) {
    console.error('Failed to create transaction:', error.message);
    throw error;
  }
}

// Example: Record a $25.50 coffee purchase
const transaction = await createSimpleTransaction(
  budgetId,
  checkingAccountId,
  -25.50,
  'Coffee Shop',
  'Morning coffee'
);
```

### Get Recent Transactions

```javascript
async function getRecentTransactions(budgetId, days = 30, accountId = null) {
  try {
    // Calculate date filter
    const sinceDate = new Date();
    sinceDate.setDate(sinceDate.getDate() - days);
    const sinceDateStr = sinceDate.toISOString().split('T')[0];
    
    const params = {
      budget_id: budgetId,
      since_date: sinceDateStr
    };
    
    if (accountId) {
      params.account_id = accountId;
    }
    
    const result = await client.callTool('list_transactions', params);
    const data = JSON.parse(result.content[0].text);
    
    console.log(`Recent Transactions (last ${days} days):`);
    data.transactions.forEach(transaction => {
      const amount = (transaction.amount / 1000).toFixed(2);
      const sign = transaction.amount < 0 ? '-' : '+';
      console.log(`${transaction.date}: ${transaction.payee_name} ${sign}$${Math.abs(amount)}`);
      if (transaction.memo) {
        console.log(`  Memo: ${transaction.memo}`);
      }
    });
    
    return data.transactions;
  } catch (error) {
    console.error('Failed to get recent transactions:', error.message);
    throw error;
  }
}
```

### Update Transaction

```javascript
async function updateTransaction(budgetId, transactionId, updates) {
  try {
    const params = {
      budget_id: budgetId,
      transaction_id: transactionId
    };
    
    // Convert amount if provided
    if (updates.amount !== undefined) {
      const milliunits = await convertToMilliunits(Math.abs(updates.amount));
      params.amount = updates.amount < 0 ? -milliunits : milliunits;
    }
    
    // Add other updates
    Object.keys(updates).forEach(key => {
      if (key !== 'amount') {
        params[key] = updates[key];
      }
    });
    
    const result = await client.callTool('update_transaction', params);
    const data = JSON.parse(result.content[0].text);
    
    console.log('Transaction updated successfully');
    return data.transaction;
  } catch (error) {
    console.error('Failed to update transaction:', error.message);
    throw error;
  }
}

// Example: Update transaction amount and add flag
const updatedTransaction = await updateTransaction(budgetId, transactionId, {
  amount: -30.00,
  flag_color: 'red',
  memo: 'Updated amount'
});
```

### Bulk Transaction Import

```javascript
async function importTransactions(budgetId, transactions) {
  const results = [];
  const errors = [];
  
  console.log(`Importing ${transactions.length} transactions...`);
  
  for (let i = 0; i < transactions.length; i++) {
    const transaction = transactions[i];
    
    try {
      // Validate transaction data
      if (!transaction.accountId || !transaction.amount || !transaction.date) {
        throw new Error('Missing required fields: accountId, amount, date');
      }
      
      // Convert amount
      const milliunits = await convertToMilliunits(Math.abs(transaction.amount));
      const amount = transaction.amount < 0 ? -milliunits : milliunits;
      
      const result = await client.callTool('create_transaction', {
        budget_id: budgetId,
        account_id: transaction.accountId,
        amount: amount,
        date: transaction.date,
        payee_name: transaction.payeeName || 'Unknown',
        category_id: transaction.categoryId,
        memo: transaction.memo || '',
        cleared: transaction.cleared || 'uncleared',
        approved: transaction.approved !== false
      });
      
      const data = JSON.parse(result.content[0].text);
      results.push({
        index: i,
        success: true,
        transaction: data.transaction
      });
      
      console.log(`✓ Imported: ${transaction.payeeName} ($${Math.abs(transaction.amount)})`);
      
    } catch (error) {
      errors.push({
        index: i,
        transaction: transaction,
        error: error.message
      });
      
      console.log(`✗ Failed: ${transaction.payeeName} - ${error.message}`);
    }
    
    // Add delay to respect rate limits
    if (i < transactions.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 200));
    }
  }
  
  console.log(`Import complete: ${results.length} successful, ${errors.length} failed`);
  
  return { results, errors };
}

// Example usage
const transactionsToImport = [
  {
    accountId: 'checking-account-id',
    amount: -25.50,
    date: '2024-01-15',
    payeeName: 'Coffee Shop',
    memo: 'Morning coffee'
  },
  {
    accountId: 'checking-account-id',
    amount: -45.00,
    date: '2024-01-15',
    payeeName: 'Gas Station',
    memo: 'Fill up'
  }
];

const importResults = await importTransactions(budgetId, transactionsToImport);
```

## Category Management Examples

### List Categories with Budget Analysis

```javascript
async function analyzeCategoryBudgets(budgetId) {
  try {
    const result = await client.callTool('list_categories', {
      budget_id: budgetId
    });
    const data = JSON.parse(result.content[0].text);
    
    const analysis = {
      totalBudgeted: 0,
      totalActivity: 0,
      overspentCategories: [],
      underspentCategories: []
    };
    
    console.log('Category Budget Analysis:');
    console.log('========================');
    
    data.category_groups.forEach(group => {
      if (group.hidden || group.deleted) return;
      
      console.log(`\n${group.name}:`);
      
      group.categories.forEach(category => {
        if (category.hidden || category.deleted) return;
        
        const budgeted = category.budgeted / 1000;
        const activity = category.activity / 1000;
        const balance = category.balance / 1000;
        
        analysis.totalBudgeted += budgeted;
        analysis.totalActivity += Math.abs(activity);
        
        const percentUsed = budgeted !== 0 ? (Math.abs(activity) / budgeted) * 100 : 0;
        
        console.log(`  ${category.name}:`);
        console.log(`    Budgeted: $${budgeted.toFixed(2)}`);
        console.log(`    Activity: $${activity.toFixed(2)}`);
        console.log(`    Balance: $${balance.toFixed(2)}`);
        console.log(`    Used: ${percentUsed.toFixed(1)}%`);
        
        // Track overspent categories
        if (balance < 0) {
          analysis.overspentCategories.push({
            name: category.name,
            overspent: Math.abs(balance)
          });
        }
        
        // Track significantly underspent categories
        if (budgeted > 0 && percentUsed < 50) {
          analysis.underspentCategories.push({
            name: category.name,
            budgeted: budgeted,
            used: percentUsed
          });
        }
      });
    });
    
    console.log('\n=== SUMMARY ===');
    console.log(`Total Budgeted: $${analysis.totalBudgeted.toFixed(2)}`);
    console.log(`Total Activity: $${analysis.totalActivity.toFixed(2)}`);
    
    if (analysis.overspentCategories.length > 0) {
      console.log('\nOverspent Categories:');
      analysis.overspentCategories.forEach(cat => {
        console.log(`  ${cat.name}: -$${cat.overspent.toFixed(2)}`);
      });
    }
    
    if (analysis.underspentCategories.length > 0) {
      console.log('\nUnderspent Categories (< 50% used):');
      analysis.underspentCategories.forEach(cat => {
        console.log(`  ${cat.name}: ${cat.used.toFixed(1)}% of $${cat.budgeted.toFixed(2)}`);
      });
    }
    
    return analysis;
  } catch (error) {
    console.error('Failed to analyze categories:', error.message);
    throw error;
  }
}
```

### Update Category Budget

```javascript
async function updateCategoryBudget(budgetId, categoryId, newBudgetAmount) {
  try {
    // Convert to milliunits
    const milliunits = await convertToMilliunits(newBudgetAmount);
    
    const result = await client.callTool('update_category', {
      budget_id: budgetId,
      category_id: categoryId,
      budgeted: milliunits
    });
    const data = JSON.parse(result.content[0].text);
    
    console.log(`Updated category budget to $${newBudgetAmount}`);
    return data.category;
  } catch (error) {
    console.error('Failed to update category budget:', error.message);
    throw error;
  }
}
```

## Financial Analysis Examples

### Comprehensive Financial Overview

### Advanced Workflows


### Monthly Budget Review

```javascript
async function monthlyBudgetReview(budgetId, month = null) {
  try {
    // Use current month if not specified
    if (!month) {
      const now = new Date();
      month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
    }
    
    console.log(`Monthly Budget Review for ${month}`);
    console.log('=====================================');
    
    // Get monthly data
    const monthResult = await client.callTool('get_month', {
      budget_id: budgetId,
      month: month
    });
    const monthData = JSON.parse(monthResult.content[0].text);
    
    // Get category structure for names
    const categoriesResult = await client.callTool('list_categories', {
      budget_id: budgetId
    });
    const categoriesData = JSON.parse(categoriesResult.content[0].text);
    
    // Create category lookup
    const categoryLookup = {};
    categoriesData.category_groups.forEach(group => {
      group.categories.forEach(category => {
        categoryLookup[category.id] = {
          name: category.name,
          groupName: group.name
        };
      });
    });
    
    const review = {
      month: month,
      income: monthData.month.income / 1000,
      budgeted: monthData.month.budgeted / 1000,
      activity: monthData.month.activity / 1000,
      toBeBudgeted: monthData.month.to_be_budgeted / 1000,
      categoryPerformance: []
    };
    
    console.log(`Income: $${review.income.toFixed(2)}`);
    console.log(`Budgeted: $${review.budgeted.toFixed(2)}`);
    console.log(`Activity: $${review.activity.toFixed(2)}`);
    console.log(`To Be Budgeted: $${review.toBeBudgeted.toFixed(2)}`);
    
    console.log('\nCategory Performance:');
    monthData.month.categories.forEach(category => {
      const categoryInfo = categoryLookup[category.id];
      if (!categoryInfo) return;
      
      const budgeted = category.budgeted / 1000;
      const activity = category.activity / 1000;
      const balance = category.balance / 1000;
      
      if (budgeted === 0 && activity === 0) return; // Skip inactive categories
      
      const performance = {
        name: categoryInfo.name,
        group: categoryInfo.groupName,
        budgeted: budgeted,
        activity: activity,
        balance: balance,
        percentUsed: budgeted !== 0 ? (Math.abs(activity) / budgeted) * 100 : 0,
        status: balance < 0 ? 'OVERSPENT' : balance > budgeted * 0.8 ? 'UNDERUSED' : 'GOOD'
      };
      
      review.categoryPerformance.push(performance);
      
      const status = performance.status === 'OVERSPENT' ? '🔴' : 
                    performance.status === 'UNDERUSED' ? '🟡' : '🟢';
      
      console.log(`${status} ${categoryInfo.name}: $${activity.toFixed(2)} of $${budgeted.toFixed(2)} (${performance.percentUsed.toFixed(1)}%)`);
    });
    
    return review;
  } catch (error) {
    console.error('Failed to generate monthly review:', error.message);
    throw error;
  }
}
```

### Account Reconciliation Helper

```javascript
async function reconcileAccount(budgetId, accountId, statementBalance, statementDate) {
  try {
    console.log('Account Reconciliation Helper');
    console.log('============================');
    
    // Get account details
    const accountResult = await client.callTool('get_account', {
      budget_id: budgetId,
      account_id: accountId
    });
    const accountData = JSON.parse(accountResult.content[0].text);
    const account = accountData.account;
    
    console.log(`Account: ${account.name}`);
    console.log(`YNAB Balance: $${(account.balance / 1000).toFixed(2)}`);
    console.log(`Statement Balance: $${statementBalance.toFixed(2)}`);
    console.log(`Statement Date: ${statementDate}`);
    
    // Get uncleared transactions
    const transactionsResult = await client.callTool('list_transactions', {
      budget_id: budgetId,
      account_id: accountId,
      since_date: statementDate
    });
    const transactionsData = JSON.parse(transactionsResult.content[0].text);
    
    const unclearedTransactions = transactionsData.transactions.filter(
      transaction => transaction.cleared === 'uncleared'
    );
    
    const clearedBalance = account.cleared_balance / 1000;
    const unclearedAmount = unclearedTransactions.reduce(
      (sum, transaction) => sum + (transaction.amount / 1000), 0
    );
    
    console.log(`\nCleared Balance: $${clearedBalance.toFixed(2)}`);
    console.log(`Uncleared Amount: $${unclearedAmount.toFixed(2)}`);
    console.log(`Difference from Statement: $${(clearedBalance - statementBalance).toFixed(2)}`);
    
    if (Math.abs(clearedBalance - statementBalance) > 0.01) {
      console.log('\n⚠️  Reconciliation needed!');
      console.log('Uncleared transactions:');
      unclearedTransactions.forEach(transaction => {
        const amount = (transaction.amount / 1000).toFixed(2);
        const sign = transaction.amount < 0 ? '-' : '+';
        console.log(`  ${transaction.date}: ${transaction.payee_name} ${sign}$${Math.abs(amount)}`);
      });
    } else {
      console.log('\n✅ Account is reconciled!');
    }
    
    return {
      account: account,
      clearedBalance: clearedBalance,
      statementBalance: statementBalance,
      difference: clearedBalance - statementBalance,
      unclearedTransactions: unclearedTransactions,
      isReconciled: Math.abs(clearedBalance - statementBalance) <= 0.01
    };
  } catch (error) {
    console.error('Failed to reconcile account:', error.message);
    throw error;
  }
}
```

## Integration Examples

### Express.js API Integration

```javascript
const express = require('express');
const app = express();

app.use(express.json());

// Middleware to validate YNAB connection
async function validateYNABConnection(req, res, next) {
  try {
    await client.callTool('get_user', {});
    next();
  } catch (error) {
    res.status(401).json({ error: 'YNAB connection failed' });
  }
}

// Get budgets endpoint
app.get('/api/budgets', validateYNABConnection, async (req, res) => {
  try {
    const result = await client.callTool('list_budgets', {});
    const data = JSON.parse(result.content[0].text);
    res.json(data.budgets);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Create transaction endpoint
app.post('/api/budgets/:budgetId/transactions', validateYNABConnection, async (req, res) => {
  try {
    const { budgetId } = req.params;
    const { accountId, amount, payeeName, memo, date } = req.body;
    
    // Validate required fields
    if (!accountId || !amount || !payeeName || !date) {
      return res.status(400).json({ 
        error: 'Missing required fields: accountId, amount, payeeName, date' 
      });
    }
    
    // Convert amount to milliunits
    const milliunits = await convertToMilliunits(Math.abs(amount));
    const transactionAmount = amount < 0 ? -milliunits : milliunits;
    
    const result = await client.callTool('create_transaction', {
      budget_id: budgetId,
      account_id: accountId,
      amount: transactionAmount,
      date: date,
      payee_name: payeeName,
      memo: memo || '',
      cleared: 'uncleared',
      approved: true
    });
    
    const data = JSON.parse(result.content[0].text);
    res.status(201).json(data.transaction);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.listen(3000, () => {
  console.log('YNAB API server running on port 3000');
});
```

### Slack Bot Integration

```javascript
const { App } = require('@slack/bolt');

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET
});

// Command to add expense
app.command('/expense', async ({ command, ack, respond }) => {
  await ack();
  
  try {
    // Parse command text: "/expense 25.50 Coffee Shop Starbucks"
    const parts = command.text.split(' ');
    const amount = parseFloat(parts[0]);
    const payeeName = parts.slice(1).join(' ');
    
    if (isNaN(amount) || !payeeName) {
      await respond('Usage: /expense <amount> <payee name>');
      return;
    }
    
    // Get user's default budget and account (you'd store this per user)
    const budgetId = 'user-default-budget-id';
    const accountId = 'user-default-account-id';
    
    // Create transaction
    const milliunits = await convertToMilliunits(amount);
    const result = await client.callTool('create_transaction', {
      budget_id: budgetId,
      account_id: accountId,
      amount: -milliunits, // Negative for expense
      date: new Date().toISOString().split('T')[0],
      payee_name: payeeName,
      cleared: 'uncleared',
      approved: true
    });
    
    await respond(`✅ Added expense: ${payeeName} for $${amount.toFixed(2)}`);
  } catch (error) {
    await respond(`❌ Failed to add expense: ${error.message}`);
  }
});

// Command to check balance
app.command('/balance', async ({ command, ack, respond }) => {
  await ack();
  
  try {
    const budgetId = 'user-default-budget-id';
    
    const result = await client.callTool('list_accounts', {
      budget_id: budgetId
    });
    const data = JSON.parse(result.content[0].text);
    
    const balanceText = data.accounts
      .filter(account => !account.closed && account.on_budget)
      .map(account => {
        const balance = (account.balance / 1000).toFixed(2);
        return `${account.name}: $${balance}`;
      })
      .join('\n');
    
    await respond(`💰 Account Balances:\n${balanceText}`);
  } catch (error) {
    await respond(`❌ Failed to get balances: ${error.message}`);
  }
});

(async () => {
  await app.start(process.env.PORT || 3000);
  console.log('⚡️ Slack bot is running!');
})();
```

### CSV Import Script

```javascript
const fs = require('fs');
const csv = require('csv-parser');

async function importCSV(budgetId, accountId, csvFilePath) {
  const transactions = [];
  
  return new Promise((resolve, reject) => {
    fs.createReadStream(csvFilePath)
      .pipe(csv())
      .on('data', (row) => {
        // Assuming CSV format: Date,Payee,Amount,Memo
        transactions.push({
          date: row.Date,
          payeeName: row.Payee,
          amount: parseFloat(row.Amount),
          memo: row.Memo || ''
        });
      })
      .on('end', async () => {
        try {
          console.log(`Importing ${transactions.length} transactions from CSV...`);
          
          const results = await importTransactions(budgetId, transactions.map(t => ({
            ...t,
            accountId: accountId
          })));
          
          resolve(results);
        } catch (error) {
          reject(error);
        }
      })
      .on('error', reject);
  });
}

// Usage
const importResults = await importCSV(
  'budget-id',
  'account-id', 
  './transactions.csv'
);

console.log(`Import completed: ${importResults.results.length} successful, ${importResults.errors.length} failed`);
```

These examples demonstrate practical usage patterns for the YNAB MCP Server. Each example includes proper error handling, data validation, and follows best practices for working with the YNAB API through the MCP server.
