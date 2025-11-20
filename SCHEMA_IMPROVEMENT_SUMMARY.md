# ExecutionActionRecord Schema Type Safety Improvements

## Summary

Addressed CodeRabbit's feedback about weak typing in `ExecutionActionRecordSchema` by replacing the generic `z.record(z.string(), z.unknown())` transaction field with a discriminated union based on action type.

## Problem

The original schema at line 370 in `reconciliationOutputs.ts` used:

```typescript
export const ExecutionActionRecordSchema = z.object({
  type: z.string(),
  transaction: z.record(z.string(), z.unknown()).nullable(),
  // ...
});
```

This provided no type safety for transaction data, making the code prone to runtime errors if assumptions about transaction structure were incorrect.

## Solution

Implemented a **discriminated union** based on the `type` field, with each action type having its own strongly-typed transaction schema:

### Action Types & Transaction Schemas

1. **`create_transaction`** - Successful transaction creation
   - Transaction: `CreatedTransactionSchema.nullable()`
   - Full YNAB API transaction response with `.passthrough()` for additional fields
   - Optional fields: `bulk_chunk_index`, `correlation_key`

2. **`create_transaction_failed`** - Failed transaction creation
   - Transaction: `TransactionCreationPayloadSchema` (required)
   - The request payload that failed to create
   - Optional fields: `bulk_chunk_index`, `correlation_key`

3. **`create_transaction_duplicate`** - Duplicate detection
   - Transaction: `DuplicateDetectionPayloadSchema` (required)
   - Contains `transaction_id` (nullable) and optional `import_id`
   - Required fields: `bulk_chunk_index`, `duplicate: true`
   - Optional: `correlation_key`

4. **`update_transaction`** - Transaction update (status/date)
   - Transaction: Union of `CreatedTransactionSchema.nullable()` (real execution) or `TransactionUpdatePayloadSchema` (dry run)
   - Handles both full transaction responses and minimal update payloads

5. **`balance_checkpoint`** - Balance alignment checkpoint
   - Transaction: `z.null()` (always null)
   - No optional fields

6. **`bulk_create_fallback`** - Bulk operation fallback to sequential
   - Transaction: `z.null()` (always null)
   - Required: `bulk_chunk_index`

### Helper Schemas

**`CreatedTransactionSchema`**

- Validates YNAB API transaction responses
- Uses `.passthrough()` to allow additional API fields
- Required: `id`, `date`, `amount`
- Optional: `memo`, `cleared`, `approved`, `payee_name`, `category_name`, `import_id`

**`TransactionCreationPayloadSchema`**

- Validates transaction creation requests
- Required: `account_id`, `date`, `amount`
- Optional: `payee_name`, `memo`, `cleared`, `approved`, `import_id`

**`TransactionUpdatePayloadSchema`**

- Validates transaction update requests
- Required: `transaction_id`
- Optional: `new_date`, `cleared`

**`DuplicateDetectionPayloadSchema`**

- Validates duplicate detection metadata
- Required: `transaction_id` (nullable)
- Optional: `import_id`

## Benefits

1. **Type Safety** - Compile-time checking of transaction field structure
2. **Self-Documenting** - Schema clearly shows what data each action type contains
3. **Runtime Validation** - Zod catches malformed data before it causes issues
4. **Better Errors** - Discriminated union provides clear validation error messages
5. **Flexibility** - `.passthrough()` on `CreatedTransactionSchema` allows future YNAB API additions
6. **Zero Breaking Changes** - Backward compatible, all existing data validates correctly

## Testing

Created comprehensive test suite (`reconciliationOutputs.test.ts`) with 26 passing tests covering:

- All 6 action types with valid data
- Negative cases (wrong types, missing required fields)
- Discriminated union behavior (unknown types, type mismatches)
- Helper schema validation
- Edge cases (null transactions, passthrough fields)

## Files Changed

1. `src/tools/schemas/outputs/reconciliationOutputs.ts` - Schema definitions
2. `src/tools/schemas/outputs/__tests__/reconciliationOutputs.test.ts` - New test suite

## Verification

- ✅ TypeScript compilation passes (`npm run type-check`)
- ✅ All 26 new schema tests pass
- ✅ Build succeeds (`npm run build`)
- ✅ MCPB package generation succeeds
- ✅ No runtime changes to executor.ts needed (schemas match actual usage)

## Implementation Notes

The discriminated union matches exactly how the executor currently constructs action records (verified by analyzing `src/tools/reconciliation/executor.ts` lines 226-580). No changes to runtime code were needed, proving this is a pure type-safety enhancement.

## Follow-up Opportunities

Consider applying the same pattern to other schemas with generic `z.record()` fields if similar type safety concerns exist elsewhere in the codebase.
