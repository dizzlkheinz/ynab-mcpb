import type { MergeFn } from './deltaCache.js';
import * as ynab from 'ynab';

export const mergeFlatEntities: MergeFn<{ id: string; deleted?: boolean }> = (
  snapshot,
  delta,
  options,
) => {
  const entityMap = new Map(snapshot.map((entity) => [entity.id, { ...entity }]));

  for (const entity of delta) {
    if (entity.deleted && !options?.preserveDeleted) {
      entityMap.delete(entity.id);
      continue;
    }

    const base = entityMap.get(entity.id) ?? {};
    entityMap.set(entity.id, { ...base, ...entity });
  }

  return Array.from(entityMap.values());
};

export const mergeCategories: MergeFn<ynab.CategoryGroupWithCategories> = (
  snapshot,
  delta,
  options,
) => {
  const preserveDeleted = Boolean(options?.preserveDeleted);
  const groupMap = new Map(snapshot.map((group) => [group.id, cloneCategoryGroup(group)]));

  for (const deltaGroup of delta) {
    if (deltaGroup.deleted && !preserveDeleted) {
      groupMap.delete(deltaGroup.id);
      continue;
    }

    const existingGroup = groupMap.get(deltaGroup.id);
    if (!existingGroup) {
      groupMap.set(deltaGroup.id, cloneCategoryGroup(deltaGroup));
      continue;
    }

    const mergedGroup: ynab.CategoryGroupWithCategories = {
      ...existingGroup,
      ...deltaGroup,
      categories: existingGroup.categories ? existingGroup.categories.map((cat) => ({ ...cat })) : existingGroup.categories,
    };

    if (deltaGroup.categories) {
      const categoryMap = new Map((existingGroup.categories ?? []).map((cat) => [cat.id, { ...cat }]));
      for (const deltaCategory of deltaGroup.categories) {
        if (deltaCategory.deleted && !preserveDeleted) {
          categoryMap.delete(deltaCategory.id);
        } else {
          const base = categoryMap.get(deltaCategory.id) ?? {};
          categoryMap.set(deltaCategory.id, { ...base, ...deltaCategory });
        }
      }
      mergedGroup.categories = Array.from(categoryMap.values());
    }

    groupMap.set(deltaGroup.id, mergedGroup);
  }

  return Array.from(groupMap.values());
};

export const mergeTransactions: MergeFn<ynab.TransactionDetail> = (snapshot, delta, options) => {
  const preserveDeleted = Boolean(options?.preserveDeleted);
  const txnMap = new Map(snapshot.map((txn) => [txn.id, cloneTransaction(txn)]));

  for (const deltaTxn of delta) {
    if (deltaTxn.deleted && !preserveDeleted) {
      txnMap.delete(deltaTxn.id);
      continue;
    }

    const existingTxn = txnMap.get(deltaTxn.id);
    if (!existingTxn) {
      txnMap.set(deltaTxn.id, cloneTransaction(deltaTxn));
      continue;
    }

    const mergedTxn: ynab.TransactionDetail = {
      ...existingTxn,
      ...deltaTxn,
      subtransactions: existingTxn.subtransactions
        ? existingTxn.subtransactions.map((sub) => ({ ...sub }))
        : existingTxn.subtransactions,
    };

    if (deltaTxn.subtransactions) {
      const subMap = new Map((existingTxn.subtransactions ?? []).map((sub) => [sub.id, { ...sub }]));
      for (const deltaSub of deltaTxn.subtransactions) {
        if (deltaSub.deleted && !preserveDeleted) {
          subMap.delete(deltaSub.id);
        } else {
          const base = subMap.get(deltaSub.id) ?? {};
          subMap.set(deltaSub.id, { ...base, ...deltaSub });
        }
      }
      mergedTxn.subtransactions = Array.from(subMap.values());
    }

    txnMap.set(deltaTxn.id, mergedTxn);
  }

  return Array.from(txnMap.values());
};

const cloneCategoryGroup = (
  group: ynab.CategoryGroupWithCategories,
): ynab.CategoryGroupWithCategories => ({
  ...group,
  categories: group.categories ? group.categories.map((category) => ({ ...category })) : group.categories,
});

const cloneTransaction = (transaction: ynab.TransactionDetail): ynab.TransactionDetail => ({
  ...transaction,
  subtransactions: transaction.subtransactions
    ? transaction.subtransactions.map((sub) => ({ ...sub }))
    : transaction.subtransactions,
});
