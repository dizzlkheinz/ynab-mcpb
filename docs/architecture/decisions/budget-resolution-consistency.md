# ADR: Budget Resolution Consistency

**Status**: Accepted
**Date**: 2024-12-21
**Decision Makers**: v0.8.0 Refactor Team
**Related**: [Tool Registry Architecture ADR](tool-registry-architecture.md), [Dependency Injection ADR](dependency-injection-pattern.md)

## Context

In v0.7.x, budget ID resolution was scattered across the codebase with inconsistent error handling and validation. This created several user experience and maintainability problems:

### Problems with v0.7.x Budget Resolution

1. **Inconsistent Error Messages**: Different tools provided different error messages for the same budget-related failures
2. **Scattered Validation Logic**: Budget ID validation was duplicated across multiple tool handlers
3. **Poor Error Format Consistency**: Some tools threw generic Error objects, others had custom validation responses
4. **Maintenance Complexity**: Changes to budget resolution logic required updates in multiple locations
5. **User Experience Issues**: Users received confusing or unhelpful error messages when budget resolution failed

### Specific Error Inconsistencies

```typescript
// v0.7.x - Inconsistent error handling examples
// Tool A
if (!budgetId) {
  throw new Error('Budget ID is required');
}

// Tool B
if (!budgetId) {
  return {
    success: false,
    error: 'No budget provided'
  };
}

// Tool C
if (!budgetId) {
  throw new Error('Missing budget parameter');
}

// Tool D
const budget = getBudgetId(budgetId);
if (!budget) {
  throw new Error('Budget not found');
}
```

### User Impact

Users experienced inconsistent behavior when:
- No default budget was set
- Invalid budget IDs were provided
- Budget IDs were in wrong format
- Default budget functionality wasn't working

This led to frustration and difficulty troubleshooting budget-related issues.

## Decision

We decided to create a centralized BudgetResolver that standardizes budget ID resolution across all tools with consistent error handling and user-friendly messages.

### Core Components

1. **Centralized BudgetResolver**: Single source of truth for budget ID resolution logic
2. **Consistent Error Responses**: All budget-related errors use ErrorHandler.createValidationError
3. **Default Argument Resolution**: Integration with tool registry's defaultArgumentResolver
4. **User-Friendly Messages**: Clear, actionable error messages with specific suggestions

### Implementation Architecture

```typescript
export class BudgetResolver {
  /**
   * Resolves budget ID with consistent error handling
   * @param providedBudgetId - Budget ID provided by user (optional)
   * @param defaultBudgetId - Default budget ID from context (optional)
   * @returns Resolved budget ID or error response
   */
  static resolveBudgetId(
    providedBudgetId?: string,
    defaultBudgetId?: string
  ): string | CallToolResult {
    // Priority: provided > default > error
    const budgetId = providedBudgetId || defaultBudgetId;

    if (!budgetId) {
      return ErrorHandler.createValidationError(
        'No default budget set. Use set_default_budget first or provide budget_id parameter.',
        {
          suggestion: 'Call set_default_budget tool or include budget_id in your request',
          code: 'MISSING_BUDGET_ID'
        }
      );
    }

    // Validate budget ID format
    if (!this.isValidBudgetIdFormat(budgetId)) {
      return ErrorHandler.createValidationError(
        `Invalid budget ID format: "${budgetId}". Expected UUID v4 format or 'default'.`,
        {
          suggestion: 'Provide a valid UUID v4 budget ID or use "default"',
          code: 'INVALID_BUDGET_ID_FORMAT',
          provided: budgetId
        }
      );
    }

    return budgetId;
  }

  /**
   * Validates budget ID format
   */
  private static isValidBudgetIdFormat(budgetId: string): boolean {
    if (budgetId === 'default') return true;

    // UUID v4 format validation
    const uuidV4Regex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    return uuidV4Regex.test(budgetId);
  }
}
```

### Tool Registry Integration

```typescript
// Default argument resolver for automatic budget ID injection
export const resolveBudgetId = (): DefaultArgumentResolver =>
  async (args: Record<string, any>, context: ToolExecutionContext) => {
    if (!args.budget_id) {
      const defaultBudget = context.getDefaultBudget();
      const result = BudgetResolver.resolveBudgetId(undefined, defaultBudget);

      if (typeof result !== 'string') {
        return result; // Return error response
      }

      args.budget_id = result;
    }

    return null; // No error, continue with resolved args
  };

// Tool registration with automatic budget resolution
registry.register({
  name: 'list_accounts',
  description: 'List accounts for a budget',
  inputSchema: ListAccountsSchema,
  handler: adapt(handleListAccounts),
  defaultArgumentResolver: resolveBudgetId() // Automatic budget injection
});
```

## Technical Implementation Details

### 1. Centralized Resolution Logic

**Problem**: Budget resolution logic was duplicated across 15+ tool handlers.

**Solution**: Single `BudgetResolver.resolveBudgetId()` method used by all tools.

```typescript
// Before v0.8.0 - Duplicated logic
export async function handleListAccounts(params: ListAccountsRequest) {
  const budgetId = params.budget_id || getDefaultBudgetId();
  if (!budgetId) {
    throw new Error('No budget ID provided'); // Inconsistent message
  }
  // ... rest of handler
}

export async function handleListCategories(params: ListCategoriesRequest) {
  if (!params.budget_id && !getDefaultBudgetId()) {
    throw new Error('Budget ID is required'); // Different message
  }
  const budgetId = params.budget_id || getDefaultBudgetId();
  // ... rest of handler
}

// After v0.8.0 - Centralized resolution
export async function handleListAccounts(params: ListAccountsRequest) {
  // Budget resolution handled automatically by defaultArgumentResolver
  // params.budget_id is guaranteed to be valid at this point
  const { budget_id } = params;
  // ... rest of handler
}

export async function handleListCategories(params: ListCategoriesRequest) {
  // Same pattern - budget_id automatically resolved and validated
  const { budget_id } = params;
  // ... rest of handler
}
```

### 2. Consistent Error Response Format

**Problem**: Error responses varied in format and content across tools.

**Solution**: Standardized error response format with actionable messages.

```typescript
// Standardized error response structure
interface BudgetResolutionError {
  success: false;
  error: {
    code: 'MISSING_BUDGET_ID' | 'INVALID_BUDGET_ID_FORMAT';
    message: string;
    suggestion: string;
    provided?: string;
  };
}

// Example error responses
const missingBudgetError = {
  success: false,
  error: {
    code: 'MISSING_BUDGET_ID',
    message: 'No default budget set. Use set_default_budget first or provide budget_id parameter.',
    suggestion: 'Call set_default_budget tool or include budget_id in your request'
  }
};

const invalidFormatError = {
  success: false,
  error: {
    code: 'INVALID_BUDGET_ID_FORMAT',
    message: 'Invalid budget ID format: "not-a-uuid". Expected UUID v4 format or "default".',
    suggestion: 'Provide a valid UUID v4 budget ID or use "default"',
    provided: 'not-a-uuid'
  }
};
```

### 3. User-Friendly Error Messages

**Problem**: Error messages were technical and didn't provide actionable guidance.

**Solution**: Clear, actionable error messages with specific next steps.

```typescript
// Error message design principles
const errorMessageGuidelines = {
  clarity: 'Use plain language, avoid technical jargon',
  actionable: 'Always provide specific next steps',
  context: 'Include relevant information about what was provided',
  consistency: 'Use same terminology and format across all tools'
};

// Example implementations
const errorMessages = {
  noBudgetSet: {
    message: 'No default budget set. Use set_default_budget first or provide budget_id parameter.',
    suggestion: 'Call set_default_budget tool or include budget_id in your request',
    example: 'set_default_budget(budget_id="12345678-1234-1234-1234-123456789abc")'
  },

  invalidFormat: {
    message: 'Invalid budget ID format: "{provided}". Expected UUID v4 format or "default".',
    suggestion: 'Provide a valid UUID v4 budget ID or use "default"',
    validExamples: [
      '12345678-1234-4xxx-yxxx-123456789abc',
      'default'
    ]
  },

  budgetNotFound: {
    message: 'Budget "{provided}" not found or access denied.',
    suggestion: 'Check budget ID is correct and you have access permissions',
    helpfulAction: 'Use list_budgets to see available budgets'
  }
};
```

### 4. Integration with Tool Registry

**Problem**: Manual budget resolution in every tool handler was error-prone.

**Solution**: Automatic budget resolution through defaultArgumentResolver.

```typescript
// Tool handler before resolution (simplified)
export async function handleListAccounts(params: ListAccountsRequest) {
  // params.budget_id may be undefined

  // Resolution happens automatically before this handler is called
  // by the defaultArgumentResolver in the tool registry

  const { budget_id } = params; // Guaranteed to be valid string

  return await cacheManager.wrap(`accounts_${budget_id}`, {
    ttl: CACHE_TTLS.ACCOUNTS,
    loader: () => ynabAPI.accounts.getAccounts(budget_id)
  });
}

// Tool registration with automatic resolution
registry.register({
  name: 'list_accounts',
  description: 'List accounts for a budget',
  inputSchema: ListAccountsSchema,
  handler: adapt(handleListAccounts),
  defaultArgumentResolver: resolveBudgetId() // <-- Automatic resolution
});

// How defaultArgumentResolver works
export const resolveBudgetId = (): DefaultArgumentResolver =>
  async (args: Record<string, any>, context: ToolExecutionContext) => {
    if (!args.budget_id) {
      const defaultBudget = context.getDefaultBudget();
      const result = BudgetResolver.resolveBudgetId(undefined, defaultBudget);

      if (typeof result !== 'string') {
        return result; // Return error - tool handler won't be called
      }

      args.budget_id = result; // Inject resolved budget ID
    }

    // Validate format even if provided
    const result = BudgetResolver.resolveBudgetId(args.budget_id);
    if (typeof result !== 'string') {
      return result; // Return validation error
    }

    return null; // Success - continue to tool handler
  };
```

## Error Message Strategy

### Design Principles

1. **Clarity First**: Use simple, non-technical language
2. **Actionable Guidance**: Always tell users what to do next
3. **Context Preservation**: Include relevant information about what went wrong
4. **Consistency**: Same terminology and format across all tools
5. **Progressive Disclosure**: Start with the essential information, provide details as needed

### Message Templates

```typescript
const messageTemplates = {
  missingBudget: {
    template: 'No default budget set. Use set_default_budget first or provide budget_id parameter.',
    variables: [],
    suggestion: 'Call set_default_budget tool or include budget_id in your request'
  },

  invalidFormat: {
    template: 'Invalid budget ID format: "{provided}". Expected UUID v4 format or "default".',
    variables: ['provided'],
    suggestion: 'Provide a valid UUID v4 budget ID or use "default"'
  },

  budgetNotFound: {
    template: 'Budget "{provided}" not found. Check the budget ID and your access permissions.',
    variables: ['provided'],
    suggestion: 'Use list_budgets to see available budgets'
  }
};

// Usage in BudgetResolver
static resolveBudgetId(provided?: string, default?: string): string | CallToolResult {
  const budgetId = provided || default;

  if (!budgetId) {
    return ErrorHandler.createValidationError(
      messageTemplates.missingBudget.template,
      {
        suggestion: messageTemplates.missingBudget.suggestion,
        code: 'MISSING_BUDGET_ID'
      }
    );
  }

  if (!this.isValidBudgetIdFormat(budgetId)) {
    return ErrorHandler.createValidationError(
      messageTemplates.invalidFormat.template.replace('{provided}', budgetId),
      {
        suggestion: messageTemplates.invalidFormat.suggestion,
        code: 'INVALID_BUDGET_ID_FORMAT',
        provided: budgetId
      }
    );
  }

  return budgetId;
}
```

### Error Response Examples

```typescript
// Example 1: No default budget set
{
  "success": false,
  "error": {
    "code": "MISSING_BUDGET_ID",
    "message": "No default budget set. Use set_default_budget first or provide budget_id parameter.",
    "suggestion": "Call set_default_budget tool or include budget_id in your request"
  }
}

// Example 2: Invalid budget ID format
{
  "success": false,
  "error": {
    "code": "INVALID_BUDGET_ID_FORMAT",
    "message": "Invalid budget ID format: \"not-a-uuid\". Expected UUID v4 format or \"default\".",
    "suggestion": "Provide a valid UUID v4 budget ID or use \"default\"",
    "provided": "not-a-uuid"
  }
}

// Example 3: Budget not found (from YNAB API)
{
  "success": false,
  "error": {
    "code": "BUDGET_NOT_FOUND",
    "message": "Budget \"12345678-1234-1234-1234-123456789abc\" not found. Check the budget ID and your access permissions.",
    "suggestion": "Use list_budgets to see available budgets",
    "provided": "12345678-1234-1234-1234-123456789abc"
  }
}
```

## Rationale

### Benefits of Centralized Budget Resolution

1. **Consistent User Experience**
   - All tools provide identical error messages for budget resolution failures
   - Users learn the patterns once and can apply them everywhere
   - Reduced support burden due to clear, actionable error messages

2. **Maintainability**
   - Single place to update budget resolution logic
   - Changes to error messages or validation rules only need one update
   - Easier to add new validation rules or improve error messages

3. **Testability**
   - Budget resolution logic can be thoroughly tested in isolation
   - Tool handlers can focus on business logic testing
   - Easier to verify error message consistency

4. **Developer Experience**
   - Tool developers don't need to implement budget resolution
   - Automatic budget injection reduces boilerplate code
   - Consistent patterns across all tools

5. **Error Handling Quality**
   - Professional, user-friendly error messages
   - Actionable guidance helps users resolve issues quickly
   - Consistent error format across all budget-dependent operations

### User Experience Improvements

| Scenario | v0.7.x Experience | v0.8.0 Experience |
|----------|-------------------|-------------------|
| No default budget | "Budget ID is required" | "No default budget set. Use set_default_budget first or provide budget_id parameter." |
| Invalid format | "Invalid budget ID" | "Invalid budget ID format: 'xyz'. Expected UUID v4 format or 'default'." |
| Multiple tools | Inconsistent messages | Identical, helpful messages across all tools |
| Troubleshooting | Generic errors | Specific suggestions for resolution |

### Development Experience Improvements

```typescript
// v0.7.x - Manual budget resolution in every tool
export async function handleListAccounts(params: ListAccountsRequest) {
  // 10+ lines of budget resolution boilerplate
  let budgetId = params.budget_id;
  if (!budgetId) {
    budgetId = getDefaultBudgetId();
    if (!budgetId) {
      throw new Error('No budget ID provided'); // Inconsistent message
    }
  }

  if (!isValidUUID(budgetId) && budgetId !== 'default') {
    throw new Error('Invalid budget ID format'); // Inconsistent message
  }

  // Actual business logic starts here
  return await ynabAPI.accounts.getAccounts(budgetId);
}

// v0.8.0 - Automatic budget resolution
export async function handleListAccounts(params: ListAccountsRequest) {
  // budget_id is guaranteed to be valid - zero boilerplate
  const { budget_id } = params;

  // Business logic only
  return await cacheManager.wrap(`accounts_${budget_id}`, {
    ttl: CACHE_TTLS.ACCOUNTS,
    loader: () => ynabAPI.accounts.getAccounts(budget_id)
  });
}
```

## Implementation Strategy

### Phase 1: BudgetResolver Creation
1. Create centralized BudgetResolver with validation logic
2. Define standard error message templates
3. Implement format validation for budget IDs

### Phase 2: Tool Registry Integration
1. Create defaultArgumentResolver for automatic budget injection
2. Integrate with ErrorHandler for consistent error formatting
3. Test resolver behavior with various input scenarios

### Phase 3: Tool Migration
1. Update all budget-dependent tools to use registry-based resolution
2. Remove manual budget resolution logic from tool handlers
3. Verify error message consistency across all tools

### Phase 4: Testing and Validation
1. Create comprehensive tests for budget resolution scenarios
2. Validate error message consistency across tools
3. Test user experience with various error conditions

## Testing Strategy

### Unit Testing BudgetResolver

```typescript
describe('BudgetResolver', () => {
  describe('resolveBudgetId', () => {
    it('returns provided budget ID when valid', () => {
      const validUUID = '12345678-1234-4xxx-yxxx-123456789abc';
      const result = BudgetResolver.resolveBudgetId(validUUID);

      expect(result).toBe(validUUID);
    });

    it('returns default budget ID when no provided ID', () => {
      const defaultUUID = '87654321-4321-4xxx-yxxx-987654321abc';
      const result = BudgetResolver.resolveBudgetId(undefined, defaultUUID);

      expect(result).toBe(defaultUUID);
    });

    it('returns error for missing budget ID', () => {
      const result = BudgetResolver.resolveBudgetId();

      expect(result).toMatchObject({
        success: false,
        error: {
          code: 'MISSING_BUDGET_ID',
          message: expect.stringContaining('No default budget set'),
          suggestion: expect.stringContaining('set_default_budget')
        }
      });
    });

    it('returns error for invalid budget ID format', () => {
      const result = BudgetResolver.resolveBudgetId('invalid-format');

      expect(result).toMatchObject({
        success: false,
        error: {
          code: 'INVALID_BUDGET_ID_FORMAT',
          message: expect.stringContaining('Invalid budget ID format'),
          provided: 'invalid-format'
        }
      });
    });

    it('accepts "default" as valid budget ID', () => {
      const result = BudgetResolver.resolveBudgetId('default');

      expect(result).toBe('default');
    });
  });
});
```

### Integration Testing with Tool Registry

```typescript
describe('Budget Resolution Integration', () => {
  let mockContext: ToolExecutionContext;

  beforeEach(() => {
    mockContext = {
      getDefaultBudget: jest.fn()
    } as any;
  });

  it('injects default budget ID when not provided', async () => {
    const defaultBudgetId = '12345678-1234-4xxx-yxxx-123456789abc';
    mockContext.getDefaultBudget.mockReturnValue(defaultBudgetId);

    const resolver = resolveBudgetId();
    const args = { account_id: 'some-account' };

    const result = await resolver(args, mockContext);

    expect(result).toBeNull(); // No error
    expect(args.budget_id).toBe(defaultBudgetId);
  });

  it('returns error when no default budget available', async () => {
    mockContext.getDefaultBudget.mockReturnValue(null);

    const resolver = resolveBudgetId();
    const args = { account_id: 'some-account' };

    const result = await resolver(args, mockContext);

    expect(result).toMatchObject({
      success: false,
      error: {
        code: 'MISSING_BUDGET_ID'
      }
    });
  });

  it('validates provided budget ID format', async () => {
    const resolver = resolveBudgetId();
    const args = { budget_id: 'invalid-format' };

    const result = await resolver(args, mockContext);

    expect(result).toMatchObject({
      success: false,
      error: {
        code: 'INVALID_BUDGET_ID_FORMAT',
        provided: 'invalid-format'
      }
    });
  });
});
```

### Error Message Consistency Testing

```typescript
describe('Error Message Consistency', () => {
  const budgetDependentTools = [
    'list_accounts',
    'list_categories',
    'list_payees',
    'list_transactions',
    'get_account',
    'get_category',
    'create_account',
    'create_transaction'
  ];

  budgetDependentTools.forEach(toolName => {
    it(`${toolName} returns consistent error for missing budget`, async () => {
      // Clear default budget
      await executeToolCall(server, 'set_default_budget', { budget_id: null });

      try {
        await executeToolCall(server, toolName, {});
        fail(`${toolName} should have thrown error`);
      } catch (error) {
        const errorObj = JSON.parse(error.content[0].text);

        expect(errorObj.error.code).toBe('MISSING_BUDGET_ID');
        expect(errorObj.error.message).toContain('No default budget set');
        expect(errorObj.error.suggestion).toContain('set_default_budget');
      }
    });

    it(`${toolName} returns consistent error for invalid budget format`, async () => {
      try {
        await executeToolCall(server, toolName, { budget_id: 'invalid-format' });
        fail(`${toolName} should have thrown error`);
      } catch (error) {
        const errorObj = JSON.parse(error.content[0].text);

        expect(errorObj.error.code).toBe('INVALID_BUDGET_ID_FORMAT');
        expect(errorObj.error.message).toContain('Invalid budget ID format');
        expect(errorObj.error.provided).toBe('invalid-format');
      }
    });
  });
});
```

## Consequences

### Positive Consequences

1. **Dramatically Improved User Experience**
   - Consistent, helpful error messages across all tools
   - Clear guidance on how to resolve budget-related issues
   - Reduced frustration and support burden

2. **Enhanced Developer Productivity**
   - Zero boilerplate budget resolution code in tool handlers
   - Consistent patterns reduce cognitive load
   - Easier to add new budget-dependent tools

3. **Better Code Maintainability**
   - Single source of truth for budget resolution logic
   - Easy to update error messages or validation rules
   - Reduced code duplication across tools

4. **Improved Testing**
   - Budget resolution logic tested in isolation
   - Tool handlers can focus on business logic testing
   - Easier to verify error message consistency

### Neutral Consequences

1. **Additional Abstraction Layer**
   - BudgetResolver adds one more component to understand
   - Tool registry integration adds complexity
   - **Mitigation**: Clear documentation and examples

2. **Slightly More Complex Tool Registration**
   - Need to specify defaultArgumentResolver
   - **Mitigation**: Standard patterns and helper functions

### Potential Negative Consequences

1. **Less Flexible Error Handling**
   - Tools can't customize budget error messages
   - **Mitigation**: Standard messages are comprehensive and user-friendly

2. **Magic Behavior**
   - Budget ID injection might not be obvious to new developers
   - **Mitigation**: Clear documentation and consistent patterns

## Alternatives Considered

### Alternative 1: Keep Scattered Budget Resolution

**Pros**:
- No refactoring required
- Individual tools have full control

**Cons**:
- Continued inconsistency in error messages
- Maintenance burden for updates
- Poor user experience

**Decision**: Rejected due to UX and maintenance issues

### Alternative 2: Middleware-Based Resolution

**Pros**:
- Automatic resolution without tool registry changes
- Transparent to tool developers

**Cons**:
- Less explicit than registry integration
- Harder to test in isolation
- Limited customization options

**Decision**: Rejected in favor of explicit registry integration

### Alternative 3: Decorator Pattern

**Pros**:
- Flexible application to specific tools
- Clear intention in code

**Cons**:
- More complex than registry integration
- Potential for inconsistent application
- Additional learning curve

**Decision**: Rejected due to complexity and inconsistency risk

### Alternative 4: Global Budget Context

**Pros**:
- Very simple implementation
- No tool modifications required

**Cons**:
- Hidden dependencies
- Difficult to test
- Poor error handling control

**Decision**: Rejected due to hidden dependencies and testing difficulties

## Monitoring and Success Metrics

### User Experience Metrics

1. **Error Message Clarity**: User feedback on error message helpfulness
2. **Support Ticket Reduction**: Fewer support requests related to budget resolution
3. **User Success Rate**: Percentage of users who successfully resolve budget errors
4. **Time to Resolution**: How quickly users resolve budget-related issues

### Technical Metrics

1. **Error Consistency**: All budget-dependent tools return identical error formats
2. **Code Duplication**: Zero budget resolution boilerplate in tool handlers
3. **Test Coverage**: 100% coverage of budget resolution scenarios
4. **Maintenance Efficiency**: Single-point updates for error message improvements

### Quality Assurance

```typescript
// Automated error message consistency testing
const budgetErrorTests = {
  missingBudget: {
    expectedCode: 'MISSING_BUDGET_ID',
    expectedMessage: /No default budget set/,
    expectedSuggestion: /set_default_budget/
  },

  invalidFormat: {
    expectedCode: 'INVALID_BUDGET_ID_FORMAT',
    expectedMessage: /Invalid budget ID format/,
    expectedSuggestion: /valid UUID v4/
  }
};

// Verify all tools return consistent errors
for (const tool of budgetDependentTools) {
  for (const [scenario, expected] of Object.entries(budgetErrorTests)) {
    const error = await testToolError(tool, scenario);
    expect(error.code).toBe(expected.expectedCode);
    expect(error.message).toMatch(expected.expectedMessage);
    expect(error.suggestion).toMatch(expected.expectedSuggestion);
  }
}
```

## Future Enhancements

### Planned Improvements

1. **Enhanced Validation**
   - Check budget existence during resolution
   - Validate user access permissions
   - Cache validation results

2. **Improved Error Context**
   - Include available budgets in error responses
   - Provide links to budget setup documentation
   - Context-sensitive help based on user state

3. **Multi-Budget Support**
   - Resolution for cross-budget operations
   - Budget scope validation
   - Enhanced default budget management

### Extension Points

```typescript
// Future: Enhanced budget validation
interface BudgetValidator {
  validateExists(budgetId: string): Promise<boolean>;
  validateAccess(budgetId: string, userId: string): Promise<boolean>;
  getSuggestions(userId: string): Promise<string[]>;
}

class EnhancedBudgetResolver extends BudgetResolver {
  constructor(private validator: BudgetValidator) {
    super();
  }

  static async resolveBudgetId(
    provided?: string,
    default?: string,
    context?: ValidationContext
  ): Promise<string | CallToolResult> {
    const budgetId = await super.resolveBudgetId(provided, default);

    if (typeof budgetId === 'string' && context) {
      const exists = await this.validator.validateExists(budgetId);
      if (!exists) {
        const suggestions = await this.validator.getSuggestions(context.userId);
        return this.createBudgetNotFoundError(budgetId, suggestions);
      }
    }

    return budgetId;
  }
}

// Future: Context-aware error messages
interface ErrorContext {
  userId: string;
  hasDefaultBudget: boolean;
  availableBudgets: string[];
  lastUsedBudget?: string;
}

const contextualMessages = {
  noDefault: (context: ErrorContext) => {
    if (context.availableBudgets.length === 1) {
      return `No default budget set. You have one budget available: ${context.availableBudgets[0]}. Use set_default_budget to make it your default.`;
    }

    return `No default budget set. You have ${context.availableBudgets.length} budgets available. Use set_default_budget to choose your default.`;
  }
};
```

## Conclusion

The centralized budget resolution system successfully addresses the consistency and user experience issues present in v0.7.x. By standardizing budget ID resolution, validation, and error handling across all tools, we've created a more professional and user-friendly experience while simplifying development and maintenance.

**Key Achievements**:
- 100% consistent error messages across all budget-dependent tools
- Zero budget resolution boilerplate in tool handlers
- Clear, actionable error messages with specific guidance
- Automatic budget ID injection through tool registry integration
- Comprehensive test coverage for all budget resolution scenarios

The implementation demonstrates that architectural improvements can significantly enhance both user experience and developer productivity without introducing complexity or breaking changes. The patterns established here serve as a template for other cross-cutting concerns in the system.

**Success Factors**:
- User-centered error message design with actionable guidance
- Seamless integration with existing tool registry architecture
- Comprehensive testing of all error scenarios
- Clear documentation and examples for developers
- Maintained backward compatibility throughout implementation