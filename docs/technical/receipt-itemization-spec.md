# Receipt Itemization Specification

`ynab_create_receipt_split_transaction` turns itemized receipt data into one split transaction. Tax is allocated across categories and many small items are collapsed into a few lines. Code: `src/tools/transactionWriteTools.ts` (handler), `src/tools/receiptSplit/collapseLogic.ts` (collapse and tax), `src/tools/transactionSchemas.ts` (input schema).

## Input

- Required: `account_id`, `payee_name`, `receipt_total` (greater than 0), `receipt_tax` (any sign; 0 for none), `categories` (at least one; each has `category_id` and at least one item).
- Item: `name`, `amount` (negative for returns and discounts), optional `quantity` (greater than 0; `amount` is the line total) and `memo`.
- Optional: `budget_id`, `date`, `memo`, `receipt_subtotal`, `cleared` (default `uncleared`), `approved`, `flag_color`, `dry_run`, `category_name` (used in tax memos).
- `date` defaults to the earlier of today's local and UTC dates, so the receipt is never dated in the future.
- Every item must belong to a category; there is no tax-exempt flag, so all positive items are taxable.

## Validation

- Item amounts, `receipt_total`, `receipt_tax` and `receipt_subtotal` must not be finer than the budget currency allows. The budget currency must be readable, or the tool returns an error rather than guessing.
- Totals must match exactly: the sum of item amounts must equal `receipt_subtotal` (if given), and items plus `receipt_tax` must equal `receipt_total`.
- The subtransactions always sum to the parent amount (`-receipt_total`). Item and tax lines are outflows (negative).

## Collapse rules

Applied in order, to the items of all categories together:

1. **Special items always get their own subtransaction**: any item with a negative amount (return or discount), and any item whose unit price (`amount / quantity`, or `amount` when no quantity) is greater than 50.00.
2. **Count the remaining items.** Fewer than 5: each is its own subtransaction. 5 or more: collapse. This is one decision for the whole receipt, so either every category collapses or none does.
3. **Collapse by category.** Items of a category are grouped in input order, at most 5 items per line. Memo format is `Name $X.XX, Name $Y.YY`; per-item memos and quantities are not included. A memo is limited to 150 characters: if the next item does not fit, the line is closed and the item starts a new one; a single over-long name is truncated with `...`.

Itemized (non-collapsed) and special lines use the memo `Name (xQty) - item memo`, where the quantity and item memo parts appear only when given, truncated to 150 characters with `...`.

## Tax

- `receipt_tax = 0`: no tax lines.
- `receipt_tax > 0`: allocated in proportion to each category's sum of positive item amounts (big-ticket items count; returns and discounts do not reduce the base and receive no tax). Each category with a non-zero share gets one line with the memo `Tax - <category_name>` (`Uncategorized` when no name was given).
  - The allocation works in the currency's smallest unit (for example whole cents) using the largest-remainder method: every share is floored to a unit, and the leftover units go to the largest fractional remainders (ties to the earlier category). Shares therefore sum exactly to the tax and are never finer than the currency allows. 1.00 over three equal categories is 0.34 / 0.33 / 0.33.
  - If no category has a positive item (only free or returned items), all the tax goes to the first category so the split stays balanced.
- `receipt_tax < 0` (tax refund; `receipt_total` must still be greater than 0): a single line with the memo `Tax refund` for the full amount, on the category with the largest total of returns (the first category if there are none).
- `receipt_summary` per-category tax comes from the same allocation as the tax lines.

## Output order

1. Special items, in category order and then input order.
2. Remaining items, itemized or collapsed, in category order.
3. Tax lines, in category order.

With `dry_run: true` (and in preview write mode) the tool returns `transaction_preview`, `subtransactions` and `receipt_summary` without writing. A real write returns the created transaction plus `receipt_summary`.

## Constants

| Name | Value |
|------|-------|
| Big-ticket threshold | unit price greater than 50.00 |
| Collapse threshold | 5 remaining items |
| Max items per collapsed line | 5 |
| Max memo length | 150 characters |

## Examples

Amounts are shown as positive outflows; a return or tax refund is an inflow on the transaction.

**Few items.** Milk 4.99, Bread 3.49, Eggs 5.99 in Groceries, tax 1.16, total 15.63:

```
4.99  Groceries  "Milk"
3.49  Groceries  "Bread"
5.99  Groceries  "Eggs"
1.16  Groceries  "Tax - Groceries"
```

**Collapsed.** Six 2.00 items A to F in Groceries, tax 0.96, total 12.96:

```
10.00 Groceries  "A $2.00, B $2.00, C $2.00, D $2.00, E $2.00"
2.00  Groceries  "F $2.00"
0.96  Groceries  "Tax - Groceries"
```

**Special items.** A 500.00 TV in Electronics plus three 2.00 grocery items, tax 40.50, total 546.50 (base 506.00 gives Electronics 40.02, Groceries 0.48):

```
500.00 Electronics "TV"
2.00 / 2.00 / 2.00 Groceries (itemized, 3 remaining items)
40.02  Electronics "Tax - Electronics"
0.48   Groceries   "Tax - Groceries"
```

A return `-29.99` is also its own line and adds nothing to the tax base.

**No positive item.** A free sample 0.00 and a coupon -2.00 in Groceries, tax 3.00, total 1.00: lines `0.00`, `-2.00`, and `3.00 "Tax - Groceries"`.
