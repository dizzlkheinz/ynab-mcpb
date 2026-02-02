# Schema Definitions - YNAB MCP Server

This directory contains centralized Zod schemas for input/output validation across all YNAB MCP tools.

## Purpose & Responsibilities

The `src/tools/schemas/` directory provides:

1. **Input Validation** - Type-safe validation of tool inputs
2. **Output Validation** - Ensure API responses match expected structure
3. **Shared Schemas** - Common validation patterns (emptyObject, looseObject)
4. **Type Generation** - Zod schemas generate TypeScript types
5. **Runtime Safety** - Bridge between TypeScript types and runtime values

## Directory Structure

```
src/tools/schemas/
├── common.ts               # Shared schemas (emptyObject, looseObject)
└── outputs/                # Output validation schemas
    ├── budgetOutputs.ts              # Budget response schemas
    ├── accountOutputs.ts             # Account response schemas
    ├── transactionOutputs.ts         # Transaction read response schemas
    ├── transactionMutationOutputs.ts # Transaction mutation response schemas
    ├── categoryOutputs.ts            # Category response schemas
    ├── payeeOutputs.ts               # Payee response schemas
    ├── monthOutputs.ts               # Month response schemas
    ├── utilityOutputs.ts             # Utility response schemas
    ├── reconciliationOutputs.ts      # Reconciliation response schemas
    ├── comparisonOutputs.ts          # Comparison response schemas
    └── index.ts                      # Central export surface
```

## Key Files & Responsibilities

| File | Responsibility | Lines | Critical |
|------|---------------|-------|----------|
| **common.ts** | Shared schemas (emptyObject, looseObject) | ~50 | HIGH |
| **outputs/*.ts** | Output validation schemas for each tool domain | ~100-200 each | MEDIUM |

## Critical Patterns & Conventions

### 1. Always Use `.strict()` on Input Schemas

**CRITICAL SECURITY REQUIREMENT**: All input schemas must use `.strict()` to reject unknown fields.

```typescript
// GOOD: Strict schema (rejects unknown fields)
const CreateTransactionSchema = z
  .object({
    budget_id: z.string().optional(),
    account_id: z.string(),
    amount: z.number(),
    date: z.string(),
  })
  .strict(); // CRITICAL!

// BAD: Non-strict schema (accepts unknown fields)
const CreateTransactionSchema = z.object({
  budget_id: z.string().optional(),
  account_id: z.string(),
  amount: z.number(),
  date: z.string(),
}); // Security vulnerability!
```

**Why CRITICAL**: Without `.strict()`, unknown fields are silently accepted, which can lead to:
- Security vulnerabilities (injection attacks)
- Data corruption (unexpected fields stored)
- API errors (YNAB API may reject unknown fields)

**What Breaks**: Missing `.strict()` → security vulnerability, unknown fields accepted.

### 2. Shared Schemas in `common.ts`

Common validation patterns are defined in `common.ts`:

```typescript
// common.ts
import { z } from 'zod';

// Empty object schema (for tools with no input)
export const emptyObjectSchema = z.object({}).strict();

// Loose object schema (for passthrough scenarios)
export const looseObjectSchema = z.object({}).passthrough();
```

**Usage**:

```typescript
import { emptyObjectSchema } from './schemas/common.js';

// Tool with no input
const ListBudgetsSchema = emptyObjectSchema;

// Tool with budget_id
const GetBudgetSchema = z
  .object({
    budget_id: z.string().optional(),
  })
  .strict();
```

### 3. Clear Validation Messages

Provide clear, actionable error messages for validation failures:

```typescript
const CreateTransactionSchema = z
  .object({
    amount: z
      .number()
      .refine((val) => Number.isFinite(val), {
        message: 'Amount must be a finite number',
      })
      .refine((val) => val !== 0, {
        message: 'Amount cannot be zero',
      }),

    date: z.string().refine(
      (val) => /^\d{4}-\d{2}-\d{2}$/.test(val),
      {
        message: 'Date must be in ISO format (YYYY-MM-DD)',
      }
    ),
  })
  .strict();
```

**Why Important**: Clear error messages help developers and users understand validation failures.

**What Breaks**: Generic errors → hard to debug, poor user experience.

### 4. Cross-Field Validation with `.refine()`

Use `.refine()` for validation that depends on multiple fields:

```typescript
const ReconcileSchema = z
  .object({
    auto_create: z.boolean().optional(),
    auto_update: z.boolean().optional(),
    dry_run: z.boolean().optional(),
  })
  .strict()
  .refine(
    (data) => {
      // Can't auto-create if dry_run is true
      if (data.dry_run && data.auto_create) {
        return false;
      }
      return true;
    },
    {
      message: 'Cannot use auto_create with dry_run',
    }
  );
```

**Why Important**: Some validation rules depend on relationships between fields.

**What Breaks**: Missing cross-field validation → invalid state, API errors.

### 5. Output Schema Organization

Output schemas are organized by domain in the `outputs/` directory:

```typescript
// outputs/transactionOutputs.ts
import { z } from 'zod';

export const TransactionSchema = z.object({
  id: z.string(),
  date: z.string(),
  amount: z.number(), // Dollars
  memo: z.string().nullable(),
  cleared: z.enum(['uncleared', 'cleared', 'reconciled']),
  approved: z.boolean(),
  payee_id: z.string().nullable(),
  payee_name: z.string().nullable(),
  category_id: z.string().nullable(),
  category_name: z.string().nullable(),
  account_id: z.string(),
  account_name: z.string(),
  deleted: z.boolean(),
});

export type Transaction = z.infer<typeof TransactionSchema>;
```

**Why Important**: Validates API responses, catches unexpected data structures.

**What Breaks**: Missing output validation → runtime errors when API changes, uncaught malformed data.

### 6. Type Inference with `z.infer<>`

Always infer TypeScript types from Zod schemas:

```typescript
// Define schema
const MySchema = z
  .object({
    field1: z.string(),
    field2: z.number().optional(),
  })
  .strict();

// Infer TypeScript type
type MyType = z.infer<typeof MySchema>;

// Use in handler
async function handleMyTool(input: MyType): Promise<void> {
  // input.field1 is string
  // input.field2 is number | undefined
}
```

**Why Important**: Single source of truth for both runtime and compile-time validation.

**What Breaks**: Separate type definitions → type-runtime mismatch, maintenance burden.

## Common Development Tasks

### Adding a New Input Schema

When adding a new tool with input:

1. **Define schema** in the tool file:
   ```typescript
   import { z } from 'zod';

   const MyToolSchema = z
     .object({
       budget_id: z.string().optional(),
       my_field: z.string(),
     })
     .strict(); // CRITICAL!
   ```

2. **Infer TypeScript type**:
   ```typescript
   type MyToolInput = z.infer<typeof MyToolSchema>;
   ```

3. **Use in handler**:
   ```typescript
   async function handleMyTool(
     input: MyToolInput,
     context: ToolContext
   ): Promise<MyToolOutput> {
     // ...
   }
   ```

4. **Register with tool**:
   ```typescript
   registry.register({
     name: 'my_tool',
     inputSchema: MyToolSchema,
     handler: adapt(handleMyTool, context),
   });
   ```

### Adding a New Output Schema

When adding validation for tool output:

1. **Create schema** in `outputs/`:
   ```typescript
   // outputs/myOutputs.ts
   import { z } from 'zod';

   export const MyOutputSchema = z.object({
     id: z.string(),
     name: z.string(),
   });

   export type MyOutput = z.infer<typeof MyOutputSchema>;
   ```

2. **Use in handler**:
   ```typescript
   import { MyOutputSchema, type MyOutput } from './schemas/outputs/myOutputs.js';

   async function handleMyTool(input: MyInput): Promise<MyOutput> {
     const data = await fetchData();
     return MyOutputSchema.parse(data); // Validates!
   }
   ```

### Adding Cross-Field Validation

When validation depends on multiple fields:

1. **Use `.refine()` after schema definition**:
   ```typescript
   const MySchema = z
     .object({
       start_date: z.string(),
       end_date: z.string(),
     })
     .strict()
     .refine(
       (data) => {
         const start = new Date(data.start_date);
         const end = new Date(data.end_date);
         return start <= end;
       },
       {
         message: 'start_date must be before or equal to end_date',
       }
     );
   ```

### Adding a Shared Schema

When multiple tools need the same validation pattern:

1. **Add to `common.ts`**:
   ```typescript
   export const mySharedSchema = z.string().min(1).max(100);
   ```

2. **Import and use**:
   ```typescript
   import { mySharedSchema } from './schemas/common.js';

   const MyToolSchema = z
     .object({
       my_field: mySharedSchema,
     })
     .strict();
   ```

## Testing Approach

Schemas are tested through:

1. **Schema Validation Tests** - Test schema parsing and rejection
2. **Tool Integration Tests** - Verify schemas catch invalid inputs
3. **Output Validation Tests** - Ensure API responses match schemas

### Example Schema Test

```typescript
describe('CreateTransactionSchema', () => {
  it('should accept valid input', () => {
    const validInput = {
      account_id: 'acc123',
      amount: 25.5,
      date: '2025-01-31',
    };

    expect(() => CreateTransactionSchema.parse(validInput)).not.toThrow();
  });

  it('should reject invalid date format', () => {
    const invalidInput = {
      account_id: 'acc123',
      amount: 25.5,
      date: '01/31/2025', // Wrong format!
    };

    expect(() => CreateTransactionSchema.parse(invalidInput)).toThrow();
  });

  it('should reject unknown fields', () => {
    const invalidInput = {
      account_id: 'acc123',
      amount: 25.5,
      date: '2025-01-31',
      unknown_field: 'value', // Unknown field!
    };

    expect(() => CreateTransactionSchema.parse(invalidInput)).toThrow();
  });
});
```

## What Will Break If Violated

### 1. Missing `.strict()` on Input Schemas

**Problem**: Input schemas without `.strict()` modifier.

**Impact**: SECURITY VULNERABILITY - Unknown fields accepted, potential injection attacks.

**Fix**: Always use `.strict()` on input schemas:

```typescript
// BAD (security vulnerability)
const MySchema = z.object({
  field: z.string(),
});

// GOOD (secure)
const MySchema = z
  .object({
    field: z.string(),
  })
  .strict();
```

### 2. Separate Type Definitions

**Problem**: Defining TypeScript types separately from Zod schemas.

**Impact**: Type-runtime mismatch, maintenance burden, validation bugs.

**Fix**: Always infer types from schemas:

```typescript
// BAD (separate definitions)
interface MyType {
  field: string;
}
const MySchema = z.object({ field: z.string() });

// GOOD (single source of truth)
const MySchema = z.object({ field: z.string() }).strict();
type MyType = z.infer<typeof MySchema>;
```

### 3. Missing Output Validation

**Problem**: Not validating API responses with output schemas.

**Impact**: Runtime errors when API changes, uncaught malformed data.

**Fix**: Validate all API responses:

```typescript
// BAD (no validation)
async function handleMyTool(input: MyInput): Promise<MyOutput> {
  const data = await api.fetchData();
  return data; // Unvalidated!
}

// GOOD (validated)
async function handleMyTool(input: MyInput): Promise<MyOutput> {
  const data = await api.fetchData();
  return MyOutputSchema.parse(data); // Validates!
}
```

### 4. Generic Validation Error Messages

**Problem**: Using default Zod error messages without customization.

**Impact**: Poor developer experience, hard to debug validation failures.

**Fix**: Provide clear, actionable error messages:

```typescript
// BAD (generic error)
amount: z.number();

// GOOD (clear error)
amount: z.number().refine((val) => Number.isFinite(val), {
  message: 'Amount must be a finite number (not NaN or Infinity)',
});
```

### 5. Missing Cross-Field Validation

**Problem**: Not validating relationships between fields.

**Impact**: Invalid state accepted, API errors, data corruption.

**Fix**: Use `.refine()` for cross-field validation:

```typescript
const MySchema = z
  .object({
    min: z.number(),
    max: z.number(),
  })
  .strict()
  .refine((data) => data.min <= data.max, {
    message: 'min must be less than or equal to max',
  });
```

### 6. Overly Permissive Schemas

**Problem**: Using `.passthrough()` when `.strict()` should be used.

**Impact**: Unknown fields silently accepted, potential security issues.

**Fix**: Use `.strict()` for input validation, `.passthrough()` only for specific cases:

```typescript
// Input schemas (ALWAYS .strict())
const InputSchema = z.object({ field: z.string() }).strict();

// Output schemas (MAY use .passthrough() if needed)
const OutputSchema = z.object({ field: z.string() }).passthrough();
```

## Validation Best Practices

1. **Always `.strict()` on Inputs** - Security requirement
2. **Infer Types from Schemas** - Single source of truth
3. **Validate Outputs** - Catch API changes early
4. **Clear Error Messages** - Help debugging
5. **Cross-Field Validation** - Use `.refine()` when needed
6. **Share Common Patterns** - DRY via `common.ts`

## Integration Points

### With Tools (`src/tools/`)

- **Input Validation**: All tool inputs validated via Zod schemas
- **Output Validation**: Optional validation of API responses
- **Type Inference**: Tool handlers use `z.infer<>` types

### With Server (`src/server/`)

- **Tool Registry**: Schemas passed to `registry.register()`
- **Security Middleware**: Uses schemas for validation
- **Error Handling**: Zod validation errors formatted by errorHandler

### With Types (`src/types/`)

- **Type Generation**: Schemas generate TypeScript types
- **Runtime Validation**: Bridge between types and runtime

## Performance Considerations

Schema validation has performance implications:

1. **Parse vs. SafeParse**: Use `.parse()` for expected valid data, `.safeParse()` for uncertain data
2. **Output Validation**: Consider skipping for high-frequency tools (if API is trusted)
3. **Complex Refinements**: Minimize expensive validation logic in `.refine()`
4. **Schema Composition**: Reuse schemas instead of duplicating

## Related Documentation

- [Root CLAUDE.md](../../../CLAUDE.md) - Project overview
- [Tools CLAUDE.md](../CLAUDE.md) - Tool implementation using these schemas
- [Types CLAUDE.md](../../types/CLAUDE.md) - Type definitions
- [Server CLAUDE.md](../../server/CLAUDE.md) - Server components
