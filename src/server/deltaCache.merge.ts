import type * as ynab from "ynab";
import type { MergeFn, MergeOptions } from "./deltaCache.js";

export function mergeFlatEntities<T extends { id: string; deleted?: boolean }>(
	snapshot: T[],
	delta: T[],
	options?: MergeOptions,
): T[] {
	const entityMap = new Map(
		snapshot.map((entity) => [entity.id, { ...entity }]),
	);

	for (const entity of delta) {
		if (entity.deleted && !options?.preserveDeleted) {
			entityMap.delete(entity.id);
			continue;
		}

		const base = entityMap.get(entity.id) ?? {};
		entityMap.set(entity.id, { ...base, ...entity });
	}

	return Array.from(entityMap.values()) as T[];
}

export const mergeMonths: MergeFn<ynab.MonthSummary> = (
	snapshot,
	delta,
	options,
) => {
	const preserveDeleted = Boolean(options?.preserveDeleted);
	const monthMap = new Map(
		snapshot.map((month) => [month.month, { ...month }]),
	);

	for (const month of delta) {
		if (month.deleted && !preserveDeleted) {
			monthMap.delete(month.month);
			continue;
		}

		const base = monthMap.get(month.month) ?? {};
		monthMap.set(month.month, { ...base, ...month });
	}

	return Array.from(monthMap.values());
};

function mergeNestedItems<T extends { id: string; deleted?: boolean }>(
	existing: T[] | undefined,
	delta: T[],
	preserveDeleted: boolean,
): T[] {
	const itemMap = new Map(
		(existing ?? []).map((item) => [item.id, { ...item }]),
	);
	for (const deltaItem of delta) {
		if (deltaItem.deleted && !preserveDeleted) {
			itemMap.delete(deltaItem.id);
		} else {
			const base = itemMap.get(deltaItem.id) ?? {};
			itemMap.set(deltaItem.id, { ...base, ...deltaItem } as T);
		}
	}
	return Array.from(itemMap.values());
}

export const mergeCategories: MergeFn<ynab.CategoryGroupWithCategories> = (
	snapshot,
	delta,
	options,
) => {
	const preserveDeleted = Boolean(options?.preserveDeleted);
	const groupMap = new Map(
		snapshot.map((group) => [group.id, cloneCategoryGroup(group)]),
	);

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
			categories: deltaGroup.categories
				? mergeNestedItems(
						existingGroup.categories,
						deltaGroup.categories,
						preserveDeleted,
					)
				: existingGroup.categories?.map((cat) => ({ ...cat })),
		};

		groupMap.set(deltaGroup.id, mergedGroup);
	}

	return Array.from(groupMap.values());
};

export const mergeTransactions: MergeFn<ynab.TransactionDetail> = (
	snapshot,
	delta,
	options,
) => {
	const preserveDeleted = Boolean(options?.preserveDeleted);
	const txnMap = new Map(
		snapshot.map((txn) => [txn.id, cloneTransaction(txn)]),
	);

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
			subtransactions: deltaTxn.subtransactions
				? mergeNestedItems(
						existingTxn.subtransactions,
						deltaTxn.subtransactions,
						preserveDeleted,
					)
				: existingTxn.subtransactions?.map((sub) => ({ ...sub })),
		};

		txnMap.set(deltaTxn.id, mergedTxn);
	}

	return Array.from(txnMap.values());
};

const cloneCategoryGroup = (
	group: ynab.CategoryGroupWithCategories,
): ynab.CategoryGroupWithCategories => ({
	...group,
	categories: group.categories
		? group.categories.map((category) => ({ ...category }))
		: group.categories,
});

const cloneTransaction = (
	transaction: ynab.TransactionDetail,
): ynab.TransactionDetail => ({
	...transaction,
	subtransactions: transaction.subtransactions
		? transaction.subtransactions.map((sub) => ({ ...sub }))
		: transaction.subtransactions,
});
