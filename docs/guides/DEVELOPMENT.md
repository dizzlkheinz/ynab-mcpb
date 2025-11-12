# YNAB MCP Server Development Guide

Practical patterns, best practices, and workflows for developing with the YNAB MCP Server.

## Table of Contents

- [Getting Started](#getting-started)
- [Common Patterns](#common-patterns)
- [Best Practices](#best-practices)
- [Error Handling Strategies](#error-handling-strategies)
- [Performance Optimization](#performance-optimization)
- [Security Considerations](#security-considerations)
- [Common Pitfalls](#common-pitfalls)
- [Example Workflows](#example-workflows)

## Getting Started

### Basic Setup

```javascript
// Initialize MCP client (example using hypothetical MCP client)
import { MCPClient } from '@modelcontextprotocol/client';

const client = new MCPClient({
  transport: 'stdio',
  command: 'node',
  args: ['path/to/ynab-mcp-server/dist/index.js']
});

await client.connect();
```

### First API Call

```javascript
// Get user information to verify connection
try {
  const userResult = await client.callTool('get_user', {});
  const user = JSON.parse(userResult.content[0].text);
  console.log(`Connected as: ${user.user.email}`);
} catch (error) {
  console.error('Connection failed:', error);
}
```

## Common Patterns

### 1. Budget Discovery Pattern

Most operations require a budget ID. Start by discovering available budgets:

```javascript
async function discoverBudgets() {
  const result = await client.callTool('list_budgets', {});
  const data = JSON.parse(result.content[0].text);

  return data.budgets.map(budget => ({
    id: budget.id,
    name: budget.name,
    lastModified: new Date(budget.last_modified_on)
  }));
}

// Use the first budget or let user choose
const budgets = await discoverBudgets();
const primaryBudget = budgets[0];
```

### 2. Account Selection Pattern

After selecting a budget, discover available accounts:

```javascript
async function getAccountsByType(budgetId, accountType = null) {
  const result = await client.callTool('list_accounts', {
    budget_id: budgetId
  });
  const data = JSON.parse(result.content[0].text);

  let accounts = data.accounts.filter(account => !account.closed);

  if (accountType) {
    accounts = accounts.filter(account => account.type === accountType);
  }

  return accounts.map(account => ({
    id: account.id,
    name: account.name,
    type: account.type,
    balance: account.balance / 1000, // Convert to dollars
    onBudget: account.on_budget
  }));
}

// Get checking accounts only
const checkingAccounts = await getAccountsByType(budgetId, 'checking');
```

### 3. Category Hierarchy Pattern

YNAB organizes categories in groups. Handle the hierarchy properly:

```javascript
async function getCategorizedStructure(budgetId) {
  const result = await client.callTool('list_categories', {
    budget_id: budgetId
  });
  const data = JSON.parse(result.content[0].text);

  return data.category_groups
    .filter(group => !group.hidden && !group.deleted)
    .map(group => ({
      id: group.id,
      name: group.name,
      categories: group.categories
        .filter(cat => !cat.hidden && !cat.deleted)
        .map(cat => ({
          id: cat.id,
          name: cat.name,
          budgeted: cat.budgeted / 1000,
          activity: cat.activity / 1000,
          balance: cat.balance / 1000
        }))
    }));
}
```

### 4. Transaction Filtering Pattern

Use server-side filtering for better performance:

```javascript
async function getRecentTransactions(budgetId, accountId = null, days = 30) {
  const sinceDate = new Date();
  sinceDate.setDate(sinceDate.getDate() - days);

  const params = {
    budget_id: budgetId,
    since_date: sinceDate.toISOString().split('T')[0] // YYYY-MM-DD
  };

  if (accountId) {
    params.account_id = accountId;
  }

  const result = await client.callTool('list_transactions', params);
  const data = JSON.parse(result.content[0].text);

  return data.transactions.map(transaction => ({
    id: transaction.id,
    date: transaction.date,
    amount: transaction.amount / 1000, // Convert to dollars
    payeeName: transaction.payee_name,
    categoryName: transaction.category_name,
    memo: transaction.memo,
    cleared: transaction.cleared,
    approved: transaction.approved
  }));
}
```

### 5. Amount Conversion Pattern

Always use the conversion utility for accuracy:

```javascript
class AmountConverter {
  static async toMilliunits(dollars) {
    const result = await client.callTool('convert_amount', {
      amount: dollars,
      to_milliunits: true
    });
    const data = JSON.parse(result.content[0].text);
    return data.converted_amount;
  }

  static async toDollars(milliunits) {
    const result = await client.callTool('convert_amount', {
      amount: milliunits,
      to_milliunits: false
    });
    const data = JSON.parse(result.content[0].text);
    return data.converted_amount;
  }

  // For display purposes, you can also do simple division
  static displayDollars(milliunits) {
    return (milliunits / 1000).toFixed(2);
  }
}

// Usage
const userAmount = 25.50; // User enters $25.50
const milliunits = await AmountConverter.toMilliunits(userAmount);
// Use milliunits in API calls
```

## Best Practices

### 1. Error Handling

Implement comprehensive error handling with specific responses:

```javascript
class YNABErrorHandler {
  static async handleToolCall(toolName, params, operation) {
    try {
      const result = await client.callTool(toolName, params);
      return JSON.parse(result.content[0].text);
    } catch (error) {
      return this.handleError(error, toolName, operation);
    }
  }

  static handleError(error, toolName, operation) {
    const errorData = JSON.parse(error.content[0].text);

    switch (errorData.error.code) {
      case 'AUTHENTICATION_ERROR':
        throw new Error('YNAB token is invalid or expired. Please update your token.');

      case 'AUTHORIZATION_ERROR':
        throw new Error('Insufficient permissions for this operation.');

      case 'RESOURCE_NOT_FOUND':
        throw new Error(`The requested ${operation} was not found. Please verify the ID.`);

      case 'RATE_LIMIT_EXCEEDED':
        throw new Error('Too many requests. Please wait before trying again.');

      case 'VALIDATION_ERROR':
        throw new Error(`Invalid input: ${errorData.error.message}`);

      default:
        throw new Error(`Operation failed: ${errorData.error.message}`);
    }
  }
}

// Usage
try {
  const budgets = await YNABErrorHandler.handleToolCall(
    'list_budgets',
    {},
    'budget listing'
  );
} catch (error) {
  console.error('User-friendly error:', error.message);
}
```

### 2. Caching Strategy

Implement intelligent caching for better performance:

```javascript
class YNABCache {
  constructor() {
    this.cache = new Map();
    this.ttl = new Map();
  }

  set(key, value, ttlMinutes = 30) {
    this.cache.set(key, value);
    this.ttl.set(key, Date.now() + (ttlMinutes * 60 * 1000));
  }

  get(key) {
    if (this.ttl.get(key) < Date.now()) {
      this.cache.delete(key);
      this.ttl.delete(key);
      return null;
    }
    return this.cache.get(key);
  }

  async getBudgets() {
    const cached = this.get('budgets');
    if (cached) return cached;

    const result = await client.callTool('list_budgets', {});
    const budgets = JSON.parse(result.content[0].text);

    this.set('budgets', budgets, 60); // Cache for 1 hour
    return budgets;
  }

  async getAccounts(budgetId) {
    const key = `accounts_${budgetId}`;
    const cached = this.get(key);
    if (cached) return cached;

    const result = await client.callTool('list_accounts', {
      budget_id: budgetId
    });
    const accounts = JSON.parse(result.content[0].text);

    this.set(key, accounts, 30); // Cache for 30 minutes
    return accounts;
  }

  // Don't cache transactions - they change frequently
  async getTransactions(budgetId, filters = {}) {
    return await client.callTool('list_transactions', {
      budget_id: budgetId,
      ...filters
    });
  }
}
```

### 3. Batch Operations

When possible, batch related operations:

```javascript
async function createMultipleTransactions(budgetId, transactions) {
  const results = [];
  const errors = [];

  // Process in small batches to avoid rate limiting
  const batchSize = 5;
  for (let i = 0; i < transactions.length; i += batchSize) {
    const batch = transactions.slice(i, i + batchSize);

    const batchPromises = batch.map(async (transaction, index) => {
      try {
        const milliunits = await AmountConverter.toMilliunits(transaction.amount);

        const result = await client.callTool('create_transaction', {
          budget_id: budgetId,
          account_id: transaction.accountId,
          amount: transaction.amount < 0 ? -milliunits : milliunits,
          date: transaction.date,
          payee_name: transaction.payeeName,
          category_id: transaction.categoryId,
          memo: transaction.memo
        });

        results.push({
          index: i + index,
          success: true,
          data: JSON.parse(result.content[0].text)
        });
      } catch (error) {
        errors.push({
          index: i + index,
          error: error.message,
          transaction: transaction
        });
      }
    });

    await Promise.all(batchPromises);

    // Add delay between batches to respect rate limits
    if (i + batchSize < transactions.length) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  return { results, errors };
}
```

### 4. Data Validation

Validate data before making API calls:

```javascript
class YNABValidator {
  static validateDate(date) {
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(date)) {
      throw new Error('Date must be in YYYY-MM-DD format');
    }

    const dateObj = new Date(date);
    if (isNaN(dateObj.getTime())) {
      throw new Error('Invalid date');
    }

    return true;
  }

  static validateAmount(amount) {
    if (typeof amount !== 'number' || isNaN(amount)) {
      throw new Error('Amount must be a valid number');
    }

    if (Math.abs(amount) > 999999999) {
      throw new Error('Amount is too large');
    }

    return true;
  }

  static validateAccountType(type) {
    const validTypes = [
      'checking', 'savings', 'creditCard', 'cash',
      'lineOfCredit', 'otherAsset', 'otherLiability'
    ];

    if (!validTypes.includes(type)) {
      throw new Error(`Invalid account type. Must be one of: ${validTypes.join(', ')}`);
    }

    return true;
  }

  static validateTransaction(transaction) {
    this.validateDate(transaction.date);
    this.validateAmount(transaction.amount);

    if (!transaction.accountId || typeof transaction.accountId !== 'string') {
      throw new Error('Account ID is required');
    }

    if (transaction.memo && transaction.memo.length > 200) {
      throw new Error('Memo cannot exceed 200 characters');
    }

    return true;
  }
}
```

## Error Handling Strategies

### 1. Retry Logic with Exponential Backoff

```javascript
class RetryHandler {
  static async withRetry(operation, maxRetries = 3, baseDelay = 1000) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error) {
        const errorData = JSON.parse(error.content[0].text);

        // Don't retry certain errors
        if (['AUTHENTICATION_ERROR', 'AUTHORIZATION_ERROR', 'VALIDATION_ERROR'].includes(errorData.error.code)) {
          throw error;
        }

        // Retry rate limit and server errors
        if (attempt === maxRetries) {
          throw error;
        }

        const delay = baseDelay * Math.pow(2, attempt - 1);
        console.log(`Attempt ${attempt} failed, retrying in ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
}

// Usage
const budgets = await RetryHandler.withRetry(async () => {
  return await client.callTool('list_budgets', {});
});
```

### 2. Circuit Breaker Pattern

```javascript
class CircuitBreaker {
  constructor(threshold = 5, timeout = 60000) {
    this.failureThreshold = threshold;
    this.timeout = timeout;
    this.failureCount = 0;
    this.lastFailureTime = null;
    this.state = 'CLOSED'; // CLOSED, OPEN, HALF_OPEN
  }

  async call(operation) {
    if (this.state === 'OPEN') {
      if (Date.now() - this.lastFailureTime > this.timeout) {
        this.state = 'HALF_OPEN';
      } else {
        throw new Error('Circuit breaker is OPEN');
      }
    }

    try {
      const result = await operation();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  onSuccess() {
    this.failureCount = 0;
    this.state = 'CLOSED';
  }

  onFailure() {
    this.failureCount++;
    this.lastFailureTime = Date.now();

    if (this.failureCount >= this.failureThreshold) {
      this.state = 'OPEN';
    }
  }
}
```

## Performance Optimization

The v0.8.x series provides automatic performance improvements through enhanced caching. See the [Architecture Guide](ARCHITECTURE.md#cache-management) for detailed caching strategies.

### Cache-Aware Data Access

```javascript
// Trigger cache warming for better subsequent performance
async function optimizedBudgetSetup(budgetId) {
  // Set default budget (triggers automatic cache warming)
  await client.callTool('set_default_budget', { budget_id: budgetId });

  // Cache is now warmed with accounts, categories, and payees
  // Subsequent calls will be significantly faster

  // These calls will hit cache
  const [accounts, categories, payees] = await Promise.all([
    client.callTool('list_accounts', { budget_id: budgetId }),
    client.callTool('list_categories', { budget_id: budgetId }),
    client.callTool('list_payees', { budget_id: budgetId })
  ]);

  return {
    accounts: JSON.parse(accounts.content[0].text),
    categories: JSON.parse(categories.content[0].text),
    payees: JSON.parse(payees.content[0].text)
  };
}
```

## Security Considerations

### 1. Token Management

```javascript
class SecureTokenManager {
  constructor() {
    this.token = process.env.YNAB_ACCESS_TOKEN;
    this.validateToken();
  }

  validateToken() {
    if (!this.token) {
      throw new Error('YNAB_ACCESS_TOKEN environment variable is required');
    }

    if (this.token.length < 64) {
      console.warn('YNAB token appears to be too short');
    }

    // Never log the actual token
    console.log(`Token loaded: ${this.token.substring(0, 8)}...`);
  }

  // Never expose the token in error messages or logs
  sanitizeError(error) {
    const errorStr = error.toString();
    return errorStr.replace(this.token, '[REDACTED]');
  }
}
```

### 2. Input Sanitization

```javascript
class InputSanitizer {
  static sanitizeString(input, maxLength = 200) {
    if (typeof input !== 'string') {
      return '';
    }

    // Remove potentially dangerous characters
    const sanitized = input
      .replace(/[<>]/g, '') // Remove HTML tags
      .replace(/['"]/g, '') // Remove quotes
      .trim();

    return sanitized.substring(0, maxLength);
  }

  static sanitizeAmount(input) {
    const amount = parseFloat(input);
    if (isNaN(amount)) {
      throw new Error('Invalid amount');
    }

    // Limit to reasonable range
    if (Math.abs(amount) > 1000000) {
      throw new Error('Amount exceeds maximum allowed value');
    }

    return amount;
  }
}
```

## Common Pitfalls

### 1. Milliunits Confusion

**Problem**: Forgetting to convert between dollars and milliunits

```javascript
// ❌ Wrong - using dollars directly
await client.callTool('create_transaction', {
  budget_id: budgetId,
  account_id: accountId,
  amount: -25.50, // This will be interpreted as -25.50 milliunits ($-0.02550)
  date: '2024-01-15'
});

// ✅ Correct - convert to milliunits
const milliunits = await AmountConverter.toMilliunits(25.50);
await client.callTool('create_transaction', {
  budget_id: budgetId,
  account_id: accountId,
  amount: -milliunits, // -25500 milliunits ($-25.50)
  date: '2024-01-15'
});
```

### 2. Date Format Issues

**Problem**: Using incorrect date formats

```javascript
// ❌ Wrong - various incorrect formats
const badDates = [
  '01/15/2024',    // US format
  '15/01/2024',    // European format
  '2024-1-15',     // Missing zero padding
  '2024-01-15T10:30:00Z' // ISO with time
];

// ✅ Correct - ISO date format (YYYY-MM-DD)
const goodDate = '2024-01-15';
```

### 3. Ignoring Account Types

**Problem**: Not considering account types when creating transactions

```javascript
// ❌ Wrong - positive amount for credit card payment
await client.callTool('create_transaction', {
  budget_id: budgetId,
  account_id: creditCardAccountId,
  amount: 50000, // This increases credit card debt
  date: '2024-01-15',
  memo: 'Payment'
});

// ✅ Correct - negative amount for credit card payment
await client.callTool('create_transaction', {
  budget_id: budgetId,
  account_id: creditCardAccountId,
  amount: -50000, // This reduces credit card debt
  date: '2024-01-15',
  memo: 'Payment'
});
```

### 4. Not Handling Deleted/Hidden Items

**Problem**: Including deleted or hidden categories/accounts in operations

```javascript
// ❌ Wrong - including all categories
const allCategories = categories.category_groups
  .flatMap(group => group.categories);

// ✅ Correct - filter out deleted/hidden items
const activeCategories = categories.category_groups
  .filter(group => !group.hidden && !group.deleted)
  .flatMap(group => group.categories.filter(cat => !cat.hidden && !cat.deleted));
```

## Example Workflows

### 1. Complete Transaction Creation Workflow

```javascript
async function createTransactionWorkflow(userInput) {
  try {
    // 1. Validate input
    YNABValidator.validateTransaction(userInput);

    // 2. Get budget
    const budgets = await cache.getBudgets();
    const budget = budgets.budgets[0]; // Use first budget or let user choose

    // 3. Find account
    const lazyData = new LazyYNABData(budget.id);
    const account = await lazyData.findAccountByName(userInput.accountName);
    if (!account) {
      throw new Error(`Account "${userInput.accountName}" not found`);
    }

    // 4. Find category (optional)
    let categoryId = null;
    if (userInput.categoryName) {
      const category = await lazyData.findCategoryByName(userInput.categoryName);
      if (category) {
        categoryId = category.id;
      }
    }

    // 5. Convert amount
    const milliunits = await AmountConverter.toMilliunits(Math.abs(userInput.amount));
    const amount = userInput.amount < 0 ? -milliunits : milliunits;

    // 6. Create transaction
    const result = await RetryHandler.withRetry(async () => {
      return await client.callTool('create_transaction', {
        budget_id: budget.id,
        account_id: account.id,
        amount: amount,
        date: userInput.date,
        payee_name: userInput.payeeName,
        category_id: categoryId,
        memo: InputSanitizer.sanitizeString(userInput.memo),
        cleared: 'uncleared',
        approved: true
      });
    });

    const transaction = JSON.parse(result.content[0].text);
    return {
      success: true,
      transaction: transaction.transaction,
      message: `Transaction created successfully: ${userInput.payeeName} for $${Math.abs(userInput.amount)}`
    };

  } catch (error) {
    return {
      success: false,
      error: error.message
    };
  }
}

// Usage
const result = await createTransactionWorkflow({
  accountName: 'Checking',
  amount: -25.50,
  date: '2024-01-15',
  payeeName: 'Coffee Shop',
  categoryName: 'Dining Out',
  memo: 'Morning coffee'
});
```

### 2. Budget Analysis Workflow

```javascript
async function analyzeBudgetWorkflow(budgetId, month = null) {
  try {
    // Use current month if not specified
    if (!month) {
      const now = new Date();
      month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
    }

    // Get monthly data
    const monthResult = await client.callTool('get_month', {
      budget_id: budgetId,
      month: month
    });
    const monthData = JSON.parse(monthResult.content[0].text);

    // Analyze categories
    const analysis = {
      month: month,
      totalBudgeted: 0,
      totalActivity: 0,
      totalAvailable: 0,
      overspentCategories: [],
      underspentCategories: [],
      categoryBreakdown: []
    };

    for (const category of monthData.month.categories) {
      if (category.hidden || category.deleted) continue;

      const budgeted = category.budgeted / 1000;
      const activity = category.activity / 1000;
      const balance = category.balance / 1000;

      analysis.totalBudgeted += budgeted;
      analysis.totalActivity += Math.abs(activity);
      analysis.totalAvailable += balance;

      const categoryInfo = {
        name: category.name,
        budgeted: budgeted,
        activity: activity,
        balance: balance,
        percentUsed: budgeted !== 0 ? (Math.abs(activity) / budgeted) * 100 : 0
      };

      analysis.categoryBreakdown.push(categoryInfo);

      // Identify overspent categories
      if (balance < 0) {
        analysis.overspentCategories.push(categoryInfo);
      }

      // Identify significantly underspent categories
      if (budgeted > 0 && categoryInfo.percentUsed < 50) {
        analysis.underspentCategories.push(categoryInfo);
      }
    }

    return analysis;

  } catch (error) {
    throw new Error(`Budget analysis failed: ${error.message}`);
  }
}
```

---

For architecture and caching details, see [`ARCHITECTURE.md`](ARCHITECTURE.md).
For troubleshooting guidance, see [`../reference/TROUBLESHOOTING.md`](../reference/TROUBLESHOOTING.md).
For testing strategies, see [`TESTING.md`](TESTING.md).
