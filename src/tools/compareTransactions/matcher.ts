import type { BankTransaction, TransactionMatch, YNABTransaction } from './types.js';

/**
 * Calculate match score between bank and YNAB transactions
 */
export function calculateMatchScore(
  bankTxn: BankTransaction,
  ynabTxn: YNABTransaction,
  amountTolerance: number,
  dateTolerance: number,
): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  let score = 0;

  // Date matching (40 points max)
  const dateDiff = Math.abs(bankTxn.date.getTime() - ynabTxn.date.getTime());
  const daysDiff = dateDiff / (1000 * 60 * 60 * 24);

  if (daysDiff === 0) {
    score += 40;
    reasons.push('Exact date match');
  } else if (daysDiff <= dateTolerance) {
    score += Math.max(20, 40 - daysDiff * 10);
    reasons.push(`Date within ${daysDiff.toFixed(1)} days`);
  }

  // Amount matching (50 points max)
  const amountDiff = Math.abs(bankTxn.amount - ynabTxn.amount);
  const amountDiffPercent = amountDiff / Math.abs(bankTxn.amount);

  if (amountDiff === 0) {
    score += 50;
    reasons.push('Exact amount match');
  } else if (amountDiffPercent <= amountTolerance) {
    score += Math.max(25, 50 - amountDiffPercent * 1000);
    reasons.push(`Amount within ${(amountDiffPercent * 100).toFixed(2)}% tolerance`);
  }

  // Description/payee matching (10 points max)
  const bankDesc = bankTxn.description.toLowerCase();
  const ynabPayee = (ynabTxn.payee_name || '').toLowerCase();
  const ynabMemo = (ynabTxn.memo || '').toLowerCase();

  if (bankDesc && ynabPayee && (ynabPayee.includes(bankDesc) || bankDesc.includes(ynabPayee))) {
    score += 10;
    reasons.push('Payee name similarity');
  } else if (bankDesc && ynabMemo && (ynabMemo.includes(bankDesc) || bankDesc.includes(ynabMemo))) {
    score += 5;
    reasons.push('Memo similarity');
  }

  return { score, reasons };
}

/**
 * Group transactions by amount to detect duplicates
 */
export function groupTransactionsByAmount(
  transactions: (BankTransaction | YNABTransaction)[],
): Map<number, (BankTransaction | YNABTransaction)[]> {
  const groups = new Map<number, (BankTransaction | YNABTransaction)[]>();

  for (const txn of transactions) {
    const amount = txn.amount;
    if (!groups.has(amount)) {
      groups.set(amount, []);
    }
    groups.get(amount)!.push(txn);
  }

  return groups;
}

/**
 * Match duplicate amounts using sequential date-based approach
 */
export function matchDuplicateAmounts(
  bankTxns: BankTransaction[],
  ynabTxns: YNABTransaction[],
  _amount: number,
  amountTolerance: number,
  dateTolerance: number,
  enableChronologyBonus = false,
): TransactionMatch[] {
  // Sort both arrays by date for sequential matching
  const sortedBank = [...bankTxns].sort((a, b) => a.date.getTime() - b.date.getTime());
  const sortedYnab = [...ynabTxns].sort((a, b) => a.date.getTime() - b.date.getTime());

  const matches: TransactionMatch[] = [];
  const usedYnabIds = new Set<string>();

  // For each bank transaction, find the best available YNAB transaction
  // considering both score and chronological order
  for (const bankTxn of sortedBank) {
    let bestMatch: { ynab: YNABTransaction; score: number; reasons: string[] } | null = null;

    for (const ynabTxn of sortedYnab) {
      if (usedYnabIds.has(ynabTxn.id)) continue;

      const { score, reasons } = calculateMatchScore(
        bankTxn,
        ynabTxn,
        amountTolerance,
        dateTolerance,
      );

      // Apply chronology bonus if enabled (for duplicates, heavily prefer chronological order)
      let chronologyBonus = 0;
      if (enableChronologyBonus) {
        const daysDiff =
          Math.abs(bankTxn.date.getTime() - ynabTxn.date.getTime()) / (1000 * 60 * 60 * 24);
        chronologyBonus = daysDiff <= 1 ? 15 : daysDiff <= 3 ? 10 : 0;
      }
      const adjustedScore = score + chronologyBonus;

      if (adjustedScore >= 30 && (!bestMatch || adjustedScore > bestMatch.score)) {
        const enhancedReasons = [...reasons];
        if (chronologyBonus > 0) {
          enhancedReasons.push(`Chronological order bonus (+${chronologyBonus})`);
        }
        bestMatch = { ynab: ynabTxn, score: adjustedScore, reasons: enhancedReasons };
      }
    }

    if (bestMatch) {
      matches.push({
        bank_transaction: bankTxn,
        ynab_transaction: bestMatch.ynab,
        match_score: bestMatch.score,
        match_reasons: bestMatch.reasons,
      });
      usedYnabIds.add(bestMatch.ynab.id);
    }
  }

  return matches;
}

/**
 * Find the best matches between bank and YNAB transactions
 */
export function findMatches(
  bankTransactions: BankTransaction[],
  ynabTransactions: YNABTransaction[],
  amountTolerance: number,
  dateTolerance: number,
  enableChronologyBonus = false,
): {
  matches: TransactionMatch[];
  unmatched_bank: BankTransaction[];
  unmatched_ynab: YNABTransaction[];
} {
  const matches: TransactionMatch[] = [];
  const usedYnabIds = new Set<string>();
  const usedBankIndices = new Set<number>();

  // Group transactions by amount to detect duplicates
  const bankByAmount = groupTransactionsByAmount(bankTransactions);
  const ynabByAmount = groupTransactionsByAmount(ynabTransactions);

  // Find amounts that appear multiple times (duplicates)
  const duplicateAmounts = new Set<number>();
  for (const [amount, txns] of bankByAmount) {
    if (txns.length > 1 || (ynabByAmount.get(amount)?.length || 0) > 1) {
      duplicateAmounts.add(amount);
    }
  }

  // Handle duplicate amounts with special sequential matching
  for (const amount of duplicateAmounts) {
    const bankDuplicates =
      bankByAmount
        .get(amount)
        ?.filter(
          (txn): txn is BankTransaction =>
            'raw_amount' in txn && !usedBankIndices.has(bankTransactions.indexOf(txn)),
        ) || [];
    const ynabDuplicates =
      ynabByAmount
        .get(amount)
        ?.filter((txn): txn is YNABTransaction => 'id' in txn && !usedYnabIds.has(txn.id)) || [];

    if (bankDuplicates.length > 0 && ynabDuplicates.length > 0) {
      const duplicateMatches = matchDuplicateAmounts(
        bankDuplicates,
        ynabDuplicates,
        amount,
        amountTolerance,
        dateTolerance,
        enableChronologyBonus,
      );

      for (const match of duplicateMatches) {
        matches.push(match);
        usedYnabIds.add(match.ynab_transaction.id);
        usedBankIndices.add(bankTransactions.indexOf(match.bank_transaction));
      }
    }
  }

  // Handle non-duplicate amounts with original algorithm
  for (let i = 0; i < bankTransactions.length; i++) {
    const bankTxn = bankTransactions[i];
    if (!bankTxn || usedBankIndices.has(i) || duplicateAmounts.has(bankTxn.amount)) continue;

    let bestMatch: { ynab: YNABTransaction; score: number; reasons: string[] } | null = null;

    for (const ynabTxn of ynabTransactions) {
      if (usedYnabIds.has(ynabTxn.id) || duplicateAmounts.has(ynabTxn.amount)) continue;

      const { score, reasons } = calculateMatchScore(
        bankTxn,
        ynabTxn,
        amountTolerance,
        dateTolerance,
      );

      if (score >= 30 && (!bestMatch || score > bestMatch.score)) {
        bestMatch = { ynab: ynabTxn, score, reasons };
      }
    }

    if (bestMatch) {
      matches.push({
        bank_transaction: bankTxn,
        ynab_transaction: bestMatch.ynab,
        match_score: bestMatch.score,
        match_reasons: bestMatch.reasons,
      });
      usedYnabIds.add(bestMatch.ynab.id);
      usedBankIndices.add(i);
    }
  }

  // Collect unmatched transactions
  const unmatched_bank = bankTransactions.filter((_, i) => !usedBankIndices.has(i));
  const unmatched_ynab = ynabTransactions.filter((txn) => !usedYnabIds.has(txn.id));

  return { matches, unmatched_bank, unmatched_ynab };
}
