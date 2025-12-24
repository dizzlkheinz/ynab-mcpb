# Receipt Itemization Specification

## Overview

The `create_receipt_split_transaction` tool creates split transactions from receipts with proportional tax allocation. This spec defines the "smart collapse" behavior that reduces clutter for large receipts while preserving visibility for important items.

## Collapsing Rules

Items are processed in this order:

### 1. Extract Special Items (Always Get Own Subtransaction)

These items are never collapsed into a group:

| Type | Condition | Example |
|------|-----------|---------|
| **Big ticket** | Unit price > $50 | TV $500 |
| **Returns** | Negative amount | RETURN: Broken headphones -$29.99 |
| **Discounts** | Negative amount | Member discount -$5.00 |

**Clarifications:**

- **Unit price, not line total**: If a receipt shows "2x Widget @ $30 = $60", each widget is $30 (not big ticket). Only items with unit price > $50 qualify.
- **Returns and discounts** are both negative amounts. The AI calling this tool should provide appropriate memo text to distinguish them. Both always get their own subtransaction.

### 2. Apply Threshold to Remaining Items

After extracting special items, count the remaining positive items:

- **Fewer than 5 remaining items**: Itemize each individually (one subtransaction per item)
- **5 or more remaining items**: Collapse by category (see below)

### 3. Collapse by Category

When collapsing:

- Group items by category
- Maximum **5 items per subtransaction** memo
- If a category has more than 5 items, create multiple subtransactions for that category
- Memo format: `"Item1 $X.XX, Item2 $Y.YY, Item3 $Z.ZZ"`
- **Memo length limit**: 150 characters max. If exceeded, truncate item list and append "..."
- **Consistency rule**: If ANY category gets collapsed, ALL categories get collapsed. No mixed mode.

### 4. Tax Handling

**Allocation:**
- Tax is allocated **proportionally** across categories based on positive subtotals only
- Returns and discounts do NOT reduce the taxable base for other items
- Returns and discounts receive NO tax allocation

**Subtransactions:**
- Each category with a positive subtotal gets its own **separate tax subtransaction**
- Memo format: `"Tax - CategoryName"`
- Categories with zero or negative subtotal after discounts: **no tax subtransaction**

**Edge cases:**
- **Tax = 0**: Skip all tax subtransactions
- **Tax < 0** (refund scenario): Create a single `"Tax refund"` subtransaction with the negative amount, allocated to the category with the largest return

### 5. Output Ordering

Subtransactions are ordered as follows:

1. Special items (returns, discounts, big tickets) - in receipt order
2. Collapsed/itemized category groups - categories in input order
3. Tax subtransactions - in category order

## Validation Rules

- **Every item must have a category**. Uncategorized items cause validation failure.
- **Tax-exempt items**: Not supported in this version. All positive items are assumed taxable.

## Configuration

| Parameter | Value | Notes |
|-----------|-------|-------|
| Big ticket threshold | $50.00 | Unit price, not line total |
| Collapse threshold | 5 items | Total remaining positive items after extracting specials |
| Max items per memo | 5 | Creates additional subtransactions if exceeded |
| Max memo length | 150 chars | Truncates with "..." if exceeded |

## Examples

### Example 1: Small Receipt (fewer than 5 items)

Input: 3 grocery items

Output:
```
$4.99  -> Groceries | memo: "Milk"
$3.49  -> Groceries | memo: "Bread"
$5.99  -> Groceries | memo: "Eggs"
$1.16  -> Groceries | memo: "Tax - Groceries"
```

### Example 2: Large Single-Category Receipt

Input: 12 grocery items

Output:
```
$24.45 -> Groceries | memo: "Milk $4.99, Bread $3.49, Eggs $5.99, Cheese $10.99, Butter $2.99"
$19.46 -> Groceries | memo: "Yogurt $6.47, Apples $4.00, Bananas $2.01, OJ $3.00, Cereal $3.98"
$8.02  -> Groceries | memo: "Rice $5.00, Pasta $3.02"
$4.15  -> Groceries | memo: "Tax - Groceries"
```

### Example 3: Mixed Receipt with Big Ticket Item

Input: TV ($500), 8 grocery items

Output:
```
$500.00 -> Electronics | memo: "TV"
$24.45  -> Groceries   | memo: "Milk $4.99, Bread $3.49, Eggs $5.99, Cheese $10.99, Butter $2.99"
$15.48  -> Groceries   | memo: "Yogurt $6.47, Apples $4.00, Bananas $2.01, OJ $3.00"
$40.00  -> Electronics | memo: "Tax - Electronics"
$3.19   -> Groceries   | memo: "Tax - Groceries"
```

### Example 4: Receipt with Return

Input: 6 grocery items plus a return

Output:
```
-$29.99 -> Electronics | memo: "RETURN: Broken headphones"
$24.45  -> Groceries   | memo: "Milk $4.99, Bread $3.49, Eggs $5.99, Cheese $10.99, Butter $2.99"
$10.48  -> Groceries   | memo: "Yogurt $6.47, Apples $4.01"
$2.79   -> Groceries   | memo: "Tax - Groceries"
```

Note: The return receives no tax allocation. Tax is only applied to positive grocery items.

### Example 5: Receipt with Discount

Input: 6 grocery items with member discount

Output:
```
-$5.00  -> Groceries | memo: "Member discount"
$24.45  -> Groceries | memo: "Milk $4.99, Bread $3.49, Eggs $5.99, Cheese $10.99, Butter $2.99"
$15.48  -> Groceries | memo: "Yogurt $6.47, Apples $4.00, Bananas $2.01, OJ $3.00"
$3.19   -> Groceries | memo: "Tax - Groceries"
```

Note: The discount is a separate line item. Tax is calculated on the positive items only.

### Example 6: Quantity Items (Not Big Ticket)

Input: 3x Widgets @ $30 each ($90 line), plus 4 other items

Total items: 7 (3 widgets + 4 others) -> collapse mode

Output:
```
$90.00  -> Electronics | memo: "Widget $30.00, Widget $30.00, Widget $30.00"
$45.00  -> Groceries   | memo: "Milk $10.00, Bread $10.00, Eggs $10.00, Cheese $15.00"
$10.80  -> Electronics | memo: "Tax - Electronics"
$3.60   -> Groceries   | memo: "Tax - Groceries"
```

Note: Each widget is $30 (under $50 threshold), so they collapse normally.

### Example 7: Tax Refund Scenario

Input: Return of $100 item, receipt shows -$8.00 tax

Output:
```
-$100.00 -> Electronics | memo: "RETURN: Defective laptop"
-$8.00   -> Electronics | memo: "Tax refund"
```

## Implementation Notes

1. **Rounding**: Use largest-remainder method when distributing tax to avoid penny discrepancies
2. **Order of operations**: Extract specials -> count remaining -> decide collapse -> distribute tax
3. **Consistency**: If ANY category gets collapsed, ALL categories get collapsed (except specials)
4. **Negative detection**: Any item with amount < 0 is treated as return/discount (gets own subtransaction)
5. **Unit price extraction**: When items have quantity > 1, divide total by quantity to get unit price for $50 threshold check
