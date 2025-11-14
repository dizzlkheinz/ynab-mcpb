import { describe, expect, it } from 'vitest';
import * as ynab from 'ynab';
import {
  mergeCategories,
  mergeFlatEntities,
  mergeTransactions,
} from '../deltaCache.merge.js';

const buildCategory = (
  overrides: Partial<ynab.Category> = {},
): ynab.Category => ({
  id: overrides.id ?? 'cat-1',
  category_group_id: overrides.category_group_id ?? 'group-1',
  category_group_name: overrides.category_group_name,
  name: overrides.name ?? 'Category 1',
  hidden: overrides.hidden ?? false,
  original_category_group_id: overrides.original_category_group_id ?? null,
  note: overrides.note ?? null,
  budgeted: overrides.budgeted ?? 0,
  activity: overrides.activity ?? 0,
  balance: overrides.balance ?? 0,
  goal_type: overrides.goal_type ?? null,
  goal_needs_whole_amount: overrides.goal_needs_whole_amount ?? null,
  goal_day: overrides.goal_day ?? null,
  goal_cadence: overrides.goal_cadence ?? null,
  goal_cadence_frequency: overrides.goal_cadence_frequency ?? null,
  goal_creation_month: overrides.goal_creation_month ?? null,
  goal_target: overrides.goal_target ?? null,
  goal_target_month: overrides.goal_target_month ?? null,
  goal_percentage_complete: overrides.goal_percentage_complete ?? null,
  goal_months_to_budget: overrides.goal_months_to_budget ?? null,
  goal_under_funded: overrides.goal_under_funded ?? null,
  goal_overall_funded: overrides.goal_overall_funded ?? null,
  goal_overall_left: overrides.goal_overall_left ?? null,
  goal_snoozed_at: overrides.goal_snoozed_at ?? null,
  deleted: overrides.deleted ?? false,
});

const buildCategoryGroup = (
  overrides: Partial<ynab.CategoryGroupWithCategories> = {},
): ynab.CategoryGroupWithCategories => ({
  id: overrides.id ?? 'group-1',
  name: overrides.name ?? 'Group 1',
  hidden: overrides.hidden ?? false,
  deleted: overrides.deleted ?? false,
  categories: overrides.categories
    ? overrides.categories.map((category) => ({ ...category }))
    : [buildCategory()],
});

const buildSubTransaction = (
  overrides: Partial<ynab.SubTransaction> = {},
): ynab.SubTransaction => ({
  id: overrides.id ?? 'sub-1',
  transaction_id: overrides.transaction_id ?? 'txn-1',
  amount: overrides.amount ?? 500,
  memo: overrides.memo ?? null,
  payee_id: overrides.payee_id ?? null,
  payee_name: overrides.payee_name ?? null,
  category_id: overrides.category_id ?? null,
  category_name: overrides.category_name ?? null,
  transfer_account_id: overrides.transfer_account_id ?? null,
  transfer_transaction_id: overrides.transfer_transaction_id ?? null,
  deleted: overrides.deleted ?? false,
});

const buildTransaction = (
  overrides: Partial<ynab.TransactionDetail> = {},
): ynab.TransactionDetail => ({
  id: overrides.id ?? 'txn-1',
  date: overrides.date ?? '2024-01-01',
  amount: overrides.amount ?? 1000,
  memo: overrides.memo ?? null,
  cleared: overrides.cleared ?? ynab.TransactionClearedStatus.Cleared,
  approved: overrides.approved ?? true,
  flag_color: overrides.flag_color ?? null,
  flag_name: overrides.flag_name ?? null,
  account_id: overrides.account_id ?? 'account-1',
  payee_id: overrides.payee_id ?? null,
  category_id: overrides.category_id ?? null,
  transfer_account_id: overrides.transfer_account_id ?? null,
  transfer_transaction_id: overrides.transfer_transaction_id ?? null,
  matched_transaction_id: overrides.matched_transaction_id ?? null,
  import_id: overrides.import_id ?? null,
  import_payee_name: overrides.import_payee_name ?? null,
  import_payee_name_original: overrides.import_payee_name_original ?? null,
  debt_transaction_type: overrides.debt_transaction_type ?? null,
  deleted: overrides.deleted ?? false,
  account_name: overrides.account_name ?? 'Checking',
  payee_name: overrides.payee_name ?? null,
  category_name: overrides.category_name ?? null,
  subtransactions: overrides.subtransactions
    ? overrides.subtransactions.map((sub) => ({ ...sub }))
    : [],
});

describe('mergeFlatEntities', () => {
  it('should merge new entities into snapshot', () => {
    const snapshot = [{ id: '1' }];
    const delta = [{ id: '2' }];

    const result = mergeFlatEntities(snapshot, delta);
    expect(result).toEqual([{ id: '1' }, { id: '2' }]);
  });

  it('should update existing entities with latest data', () => {
    const snapshot = [{ id: '1', name: 'old' }];
    const delta = [{ id: '1', name: 'new' }];

    const result = mergeFlatEntities(snapshot, delta);
    expect(result).toEqual([{ id: '1', name: 'new' }]);
  });

  it('should delete entities when delta marks them deleted', () => {
    const snapshot = [
      { id: '1' },
      { id: '2' },
    ];
    const delta = [{ id: '1', deleted: true }];

    const result = mergeFlatEntities(snapshot, delta);
    expect(result).toEqual([{ id: '2' }]);
  });

  it('should preserve deleted entities when preserveDeleted enabled', () => {
    const snapshot = [{ id: '1' }];
    const delta = [{ id: '1', deleted: true, name: 'archived' }];

    const result = mergeFlatEntities(snapshot, delta, { preserveDeleted: true });
    expect(result).toEqual([{ id: '1', deleted: true, name: 'archived' }]);
  });

  it('should handle empty snapshot gracefully', () => {
    const result = mergeFlatEntities([], [{ id: '1' }]);
    expect(result).toEqual([{ id: '1' }]);
  });

  it('should handle empty delta by returning snapshot', () => {
    const snapshot = [{ id: '1' }];
    expect(mergeFlatEntities(snapshot, [])).toEqual(snapshot);
  });

  it('should handle both arrays empty', () => {
    expect(mergeFlatEntities([], [])).toEqual([]);
  });

  it('should process multiple operations in single delta batch', () => {
    const snapshot = [
      { id: '1', status: 'keep' },
      { id: '2', status: 'update-me' },
      { id: '3', status: 'delete-me' },
    ];
    const delta = [
      { id: '2', status: 'updated' },
      { id: '3', deleted: true },
      { id: '4', status: 'new' },
    ];

    const result = mergeFlatEntities(snapshot, delta);
    expect(result).toEqual([
      { id: '1', status: 'keep' },
      { id: '2', status: 'updated' },
      { id: '4', status: 'new' },
    ]);
  });

  it('should maintain insertion order for unchanged entities', () => {
    const snapshot = [
      { id: '1' },
      { id: '2' },
    ];
    const delta = [{ id: '2', name: 'updated' }];

    const result = mergeFlatEntities(snapshot, delta);
    expect(result).toEqual([
      { id: '1' },
      { id: '2', name: 'updated' },
    ]);
  });

  it('should keep additional fields intact', () => {
    const snapshot = [{ id: '1', extra: { nested: true } }];
    const delta = [{ id: '1', extra: { nested: false }, label: 'v2' }];

    const result = mergeFlatEntities(snapshot, delta);
    expect(result).toEqual([{ id: '1', extra: { nested: false }, label: 'v2' }]);
  });
});

describe('mergeCategories', () => {
  it('should merge new category groups into snapshot', () => {
    const snapshot = [buildCategoryGroup({ id: 'group-1' })];
    const delta = [buildCategoryGroup({ id: 'group-2', name: 'Group 2' })];

    const result = mergeCategories(snapshot, delta);
    expect(result.map((group) => group.id)).toEqual(['group-1', 'group-2']);
  });

  it('should update existing group metadata', () => {
    const snapshot = [buildCategoryGroup({ id: 'group-1', name: 'Original' })];
    const delta = [buildCategoryGroup({ id: 'group-1', name: 'Renamed' })];

    const result = mergeCategories(snapshot, delta);
    expect(result[0].name).toBe('Renamed');
  });

  it('should delete groups flagged as deleted', () => {
    const snapshot = [
      buildCategoryGroup({ id: 'group-1' }),
      buildCategoryGroup({ id: 'group-2' }),
    ];
    const delta = [buildCategoryGroup({ id: 'group-2', deleted: true })];

    const result = mergeCategories(snapshot, delta);
    expect(result.map((group) => group.id)).toEqual(['group-1']);
  });

  it('should preserve deleted groups when preserveDeleted is true', () => {
    const snapshot = [buildCategoryGroup({ id: 'group-1' })];
    const delta = [buildCategoryGroup({ id: 'group-1', deleted: true })];

    const result = mergeCategories(snapshot, delta, { preserveDeleted: true });
    expect(result[0].deleted).toBe(true);
  });

  it('should merge new categories within existing group', () => {
    const snapshot = [
      buildCategoryGroup({
        id: 'group-1',
        categories: [buildCategory({ id: 'cat-1', name: 'Existing' })],
      }),
    ];
    const delta = [
      buildCategoryGroup({
        id: 'group-1',
        categories: [buildCategory({ id: 'cat-2', name: 'New' })],
      }),
    ];

    const result = mergeCategories(snapshot, delta);
    expect(result[0].categories.map((cat) => cat.id)).toEqual(['cat-1', 'cat-2']);
  });

  it('should update existing categories during merge', () => {
    const snapshot = [
      buildCategoryGroup({
        id: 'group-1',
        categories: [buildCategory({ id: 'cat-1', name: 'Old' })],
      }),
    ];
    const delta = [
      buildCategoryGroup({
        id: 'group-1',
        categories: [buildCategory({ id: 'cat-1', name: 'New Name' })],
      }),
    ];

    const result = mergeCategories(snapshot, delta);
    expect(result[0].categories[0].name).toBe('New Name');
  });

  it('should delete categories marked as deleted', () => {
    const snapshot = [
      buildCategoryGroup({
        id: 'group-1',
        categories: [
          buildCategory({ id: 'cat-1' }),
          buildCategory({ id: 'cat-2' }),
        ],
      }),
    ];
    const delta = [
      buildCategoryGroup({
        id: 'group-1',
        categories: [buildCategory({ id: 'cat-2', deleted: true })],
      }),
    ];

    const result = mergeCategories(snapshot, delta);
    expect(result[0].categories.map((cat) => cat.id)).toEqual(['cat-1']);
  });

  it('should preserve deleted categories when preserveDeleted is true', () => {
    const snapshot = [
      buildCategoryGroup({
        id: 'group-1',
        categories: [buildCategory({ id: 'cat-1' })],
      }),
    ];
    const delta = [
      buildCategoryGroup({
        id: 'group-1',
        categories: [buildCategory({ id: 'cat-1', deleted: true })],
      }),
    ];

    const result = mergeCategories(snapshot, delta, { preserveDeleted: true });
    expect(result[0].categories[0].deleted).toBe(true);
  });

  it('should handle groups with empty category lists', () => {
    const snapshot = [
      buildCategoryGroup({
        id: 'group-1',
        categories: [],
      }),
    ];
    const delta = [buildCategoryGroup({ id: 'group-1', categories: [] })];

    const result = mergeCategories(snapshot, delta);
    expect(result[0].categories).toEqual([]);
  });

  it('should handle metadata-only updates (no categories provided)', () => {
    const snapshot = [
      buildCategoryGroup({
        id: 'group-1',
        name: 'Original',
        categories: [buildCategory({ id: 'cat-1' })],
      }),
    ];
    const delta = [
      {
        id: 'group-1',
        name: 'Updated',
        hidden: true,
        deleted: false,
        categories: [],
      },
    ];

    const result = mergeCategories(snapshot, delta);
    expect(result[0].name).toBe('Updated');
    expect(result[0].categories).toEqual([buildCategory({ id: 'cat-1' })]);
  });

  it('should apply nested updates to metadata and categories simultaneously', () => {
    const snapshot = [
      buildCategoryGroup({
        id: 'group-1',
        name: 'Old',
        categories: [
          buildCategory({ id: 'cat-1', name: 'Old Cat' }),
          buildCategory({ id: 'cat-2', name: 'Keep' }),
        ],
      }),
    ];
    const delta = [
      buildCategoryGroup({
        id: 'group-1',
        name: 'New',
        categories: [
          buildCategory({ id: 'cat-1', name: 'New Cat' }),
          buildCategory({ id: 'cat-3', name: 'Added' }),
        ],
      }),
    ];

    const result = mergeCategories(snapshot, delta);
    expect(result[0].name).toBe('New');
    expect(result[0].categories.map((cat) => cat.id)).toEqual(['cat-1', 'cat-2', 'cat-3']);
  });

  it('should maintain category order after merges', () => {
    const snapshot = [
      buildCategoryGroup({
        id: 'group-1',
        categories: [
          buildCategory({ id: 'cat-1', name: 'First' }),
          buildCategory({ id: 'cat-2', name: 'Second' }),
        ],
      }),
    ];
    const delta = [
      buildCategoryGroup({
        id: 'group-1',
        categories: [buildCategory({ id: 'cat-3', name: 'Third' })],
      }),
    ];

    const result = mergeCategories(snapshot, delta);
    expect(result[0].categories.map((cat) => cat.name)).toEqual(['First', 'Second', 'Third']);
  });

  it('should handle multiple groups with multiple category updates', () => {
    const snapshot = [
      buildCategoryGroup({
        id: 'group-1',
        categories: [buildCategory({ id: 'cat-1' })],
      }),
      buildCategoryGroup({
        id: 'group-2',
        categories: [buildCategory({ id: 'cat-2', category_group_id: 'group-2' })],
      }),
    ];
    const delta = [
      buildCategoryGroup({
        id: 'group-1',
        categories: [buildCategory({ id: 'cat-3' })],
      }),
      buildCategoryGroup({
        id: 'group-2',
        categories: [buildCategory({ id: 'cat-2', deleted: true })],
      }),
    ];

    const result = mergeCategories(snapshot, delta);
    expect(result.find((group) => group.id === 'group-1')?.categories.map((cat) => cat.id)).toEqual([
      'cat-1',
      'cat-3',
    ]);
    expect(result.find((group) => group.id === 'group-2')?.categories).toEqual([]);
  });

  it('should keep nested structures immutable', () => {
    const snapshot = [
      buildCategoryGroup({
        id: 'group-1',
        categories: [buildCategory({ id: 'cat-1', name: 'Original' })],
      }),
    ];
    const delta = [
      buildCategoryGroup({
        id: 'group-1',
        categories: [buildCategory({ id: 'cat-1', name: 'Updated' })],
      }),
    ];

    const result = mergeCategories(snapshot, delta);
    expect(snapshot[0].categories[0].name).toBe('Original');
    expect(result[0].categories[0].name).toBe('Updated');
  });
});

describe('mergeTransactions', () => {
  it('should merge new transactions into snapshot', () => {
    const snapshot = [buildTransaction({ id: 'txn-1' })];
    const delta = [buildTransaction({ id: 'txn-2' })];

    const result = mergeTransactions(snapshot, delta);
    expect(result.map((txn) => txn.id)).toEqual(['txn-1', 'txn-2']);
  });

  it('should update existing transactions', () => {
    const snapshot = [buildTransaction({ id: 'txn-1', memo: 'old' })];
    const delta = [buildTransaction({ id: 'txn-1', memo: 'new' })];

    const result = mergeTransactions(snapshot, delta);
    expect(result[0].memo).toBe('new');
  });

  it('should delete transactions marked as deleted', () => {
    const snapshot = [
      buildTransaction({ id: 'txn-1' }),
      buildTransaction({ id: 'txn-2' }),
    ];
    const delta = [buildTransaction({ id: 'txn-2', deleted: true })];

    const result = mergeTransactions(snapshot, delta);
    expect(result.map((txn) => txn.id)).toEqual(['txn-1']);
  });

  it('should preserve deleted transactions when preserveDeleted is true', () => {
    const snapshot = [buildTransaction({ id: 'txn-1' })];
    const delta = [buildTransaction({ id: 'txn-1', deleted: true })];

    const result = mergeTransactions(snapshot, delta, { preserveDeleted: true });
    expect(result[0].deleted).toBe(true);
  });

  it('should merge new subtransactions into existing transaction', () => {
    const snapshot = [
      buildTransaction({
        id: 'txn-1',
        subtransactions: [buildSubTransaction({ id: 'sub-1', transaction_id: 'txn-1' })],
      }),
    ];
    const delta = [
      buildTransaction({
        id: 'txn-1',
        subtransactions: [buildSubTransaction({ id: 'sub-2', transaction_id: 'txn-1' })],
      }),
    ];

    const result = mergeTransactions(snapshot, delta);
    expect(result[0].subtransactions.map((sub) => sub.id)).toEqual(['sub-1', 'sub-2']);
  });

  it('should update existing subtransactions', () => {
    const snapshot = [
      buildTransaction({
        id: 'txn-1',
        subtransactions: [buildSubTransaction({ id: 'sub-1', amount: 100 })],
      }),
    ];
    const delta = [
      buildTransaction({
        id: 'txn-1',
        subtransactions: [buildSubTransaction({ id: 'sub-1', amount: 200 })],
      }),
    ];

    const result = mergeTransactions(snapshot, delta);
    expect(result[0].subtransactions[0].amount).toBe(200);
  });

  it('should delete subtransactions when flagged deleted', () => {
    const snapshot = [
      buildTransaction({
        id: 'txn-1',
        subtransactions: [
          buildSubTransaction({ id: 'sub-1' }),
          buildSubTransaction({ id: 'sub-2' }),
        ],
      }),
    ];
    const delta = [
      buildTransaction({
        id: 'txn-1',
        subtransactions: [buildSubTransaction({ id: 'sub-2', deleted: true })],
      }),
    ];

    const result = mergeTransactions(snapshot, delta);
    expect(result[0].subtransactions.map((sub) => sub.id)).toEqual(['sub-1']);
  });

  it('should preserve deleted subtransactions when preserveDeleted is true', () => {
    const snapshot = [
      buildTransaction({
        id: 'txn-1',
        subtransactions: [buildSubTransaction({ id: 'sub-1' })],
      }),
    ];
    const delta = [
      buildTransaction({
        id: 'txn-1',
        subtransactions: [buildSubTransaction({ id: 'sub-1', deleted: true })],
      }),
    ];

    const result = mergeTransactions(snapshot, delta, { preserveDeleted: true });
    expect(result[0].subtransactions[0].deleted).toBe(true);
  });

  it('should handle transactions without subtransactions arrays', () => {
    const snapshot = [buildTransaction({ id: 'txn-1', subtransactions: [] })];
    const delta = [buildTransaction({ id: 'txn-1', memo: 'updated', subtransactions: [] })];

    const result = mergeTransactions(snapshot, delta);
    expect(result[0].memo).toBe('updated');
  });

  it('should handle delta updates without subtransactions list', () => {
    const snapshot = [buildTransaction({ id: 'txn-1', subtransactions: [buildSubTransaction()] })];
    const delta = [
      {
        id: 'txn-1',
        date: '2024-02-01',
        amount: 2000,
        cleared: ynab.TransactionClearedStatus.Cleared,
        approved: true,
        account_id: 'account-1',
        deleted: false,
        account_name: 'Checking',
        subtransactions: [],
      },
    ];

    const result = mergeTransactions(snapshot, delta);
    expect(result[0].date).toBe('2024-02-01');
    expect(result[0].subtransactions.length).toBe(1);
  });

  it('should apply nested operations to transaction and subtransactions', () => {
    const snapshot = [
      buildTransaction({
        id: 'txn-1',
        memo: 'old',
        subtransactions: [buildSubTransaction({ id: 'sub-1', amount: 50 })],
      }),
    ];
    const delta = [
      buildTransaction({
        id: 'txn-1',
        memo: 'new',
        subtransactions: [
          buildSubTransaction({ id: 'sub-1', amount: 75 }),
          buildSubTransaction({ id: 'sub-2', amount: 100 }),
        ],
      }),
    ];

    const result = mergeTransactions(snapshot, delta);
    expect(result[0].memo).toBe('new');
    expect(result[0].subtransactions.map((sub) => sub.id)).toEqual(['sub-1', 'sub-2']);
  });

  it('should maintain subtransaction order', () => {
    const snapshot = [
      buildTransaction({
        id: 'txn-1',
        subtransactions: [
          buildSubTransaction({ id: 'sub-1' }),
          buildSubTransaction({ id: 'sub-2' }),
        ],
      }),
    ];
    const delta = [
      buildTransaction({
        id: 'txn-1',
        subtransactions: [buildSubTransaction({ id: 'sub-3' })],
      }),
    ];

    const result = mergeTransactions(snapshot, delta);
    expect(result[0].subtransactions.map((sub) => sub.id)).toEqual(['sub-1', 'sub-2', 'sub-3']);
  });

  it('should handle multiple transactions with distinct updates', () => {
    const snapshot = [
      buildTransaction({ id: 'txn-1', memo: 'keep' }),
      buildTransaction({ id: 'txn-2', memo: 'replace' }),
    ];
    const delta = [
      buildTransaction({ id: 'txn-2', memo: 'updated' }),
      buildTransaction({ id: 'txn-3', memo: 'new' }),
    ];

    const result = mergeTransactions(snapshot, delta);
    expect(result.map((txn) => txn.id)).toEqual(['txn-1', 'txn-2', 'txn-3']);
    expect(result.find((txn) => txn.id === 'txn-2')?.memo).toBe('updated');
  });

  it('should avoid mutating input arrays', () => {
    const snapshot = [buildTransaction({ id: 'txn-1', memo: 'old' })];
    const delta = [buildTransaction({ id: 'txn-1', memo: 'new' })];

    mergeTransactions(snapshot, delta);
    expect(snapshot[0].memo).toBe('old');
    expect(delta[0].memo).toBe('new');
  });
});

describe('Merge Edge Cases', () => {
  it('should handle duplicate IDs in delta with last write winning', () => {
    const snapshot = [{ id: '1', name: 'original' }];
    const delta = [
      { id: '1', name: 'first' },
      { id: '1', name: 'second' },
    ];

    const result = mergeFlatEntities(snapshot, delta);
    expect(result[0].name).toBe('second');
  });

  it('should handle null and undefined optional fields', () => {
    const snapshot = [buildTransaction({ id: 'txn-1', memo: 'existing' })];
    const delta = [
      buildTransaction({
        id: 'txn-1',
        memo: undefined,
        payee_name: null,
        subtransactions: [],
      }),
    ];

    const result = mergeTransactions(snapshot, delta);
    expect(result[0].memo).toBeNull();
  });

  it('should efficiently handle large snapshots', () => {
    const largeSnapshot = Array.from({ length: 1200 }, (_, index) => ({ id: `id-${index}` }));
    const delta = [{ id: 'new-id' }];
    const result = mergeFlatEntities(largeSnapshot, delta);

    expect(result.length).toBe(1201);
    expect(result[result.length - 1]).toEqual({ id: 'new-id' });
  });

  it('should efficiently handle large delta payloads', () => {
    const snapshot = [{ id: 'base' }];
    const largeDelta = Array.from({ length: 1000 }, (_, index) => ({ id: `delta-${index}` }));
    const result = mergeFlatEntities(snapshot, largeDelta);

    expect(result.length).toBe(1001);
  });

  it('should handle deeply nested category structures', () => {
    const snapshot = [
      buildCategoryGroup({
        id: 'group-1',
        categories: Array.from({ length: 10 }, (_, index) =>
          buildCategory({ id: `cat-${index}` }),
        ),
      }),
    ];
    const delta = [
      buildCategoryGroup({
        id: 'group-1',
        categories: Array.from({ length: 10 }, (_, index) =>
          buildCategory({ id: `cat-${index}`, name: `Updated ${index}` }),
        ),
      }),
    ];

    const result = mergeCategories(snapshot, delta);
    expect(result[0].categories.every((cat) => cat.name?.startsWith('Updated'))).toBe(true);
  });

  it('should handle transactions with many subtransactions', () => {
    const snapshot = [
      buildTransaction({
        id: 'txn-1',
        subtransactions: Array.from({ length: 10 }, (_, index) =>
          buildSubTransaction({ id: `sub-${index}` }),
        ),
      }),
    ];
    const delta = [
      buildTransaction({
        id: 'txn-1',
        subtransactions: [
          buildSubTransaction({ id: 'sub-3', amount: 999 }),
          buildSubTransaction({ id: 'sub-11', amount: 100 }),
        ],
      }),
    ];

    const result = mergeTransactions(snapshot, delta);
    expect(result[0].subtransactions.length).toBe(11);
    expect(result[0].subtransactions.find((sub) => sub.id === 'sub-3')?.amount).toBe(999);
  });

  it('should not mutate snapshot or delta arrays', () => {
    const snapshot = [buildCategoryGroup({ id: 'group-1', name: 'Old' })];
    const delta = [buildCategoryGroup({ id: 'group-1', name: 'New' })];

    mergeCategories(snapshot, delta);
    expect(snapshot[0].name).toBe('Old');
    expect(delta[0].name).toBe('New');
  });

  it('should handle special characters in IDs and names', () => {
    const snapshot = [{ id: 'payee:ä', name: 'Old' }];
    const delta = [{ id: 'payee:ä', name: 'New' }];

    const result = mergeFlatEntities(snapshot, delta);
    expect(result[0].name).toBe('New');
  });
});
