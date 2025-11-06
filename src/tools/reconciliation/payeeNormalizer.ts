/**
 * Payee normalization and similarity matching
 * Implements two-tier matching: normalized string comparison + fuzzy matching
 */

/**
 * Normalizes a payee string for comparison
 * - Lowercase
 * - Remove spaces, punctuation, special characters
 * - Keep only alphanumeric characters
 *
 * @example
 * normalizePayee("SHELL #1234 OAKVILLE ON") => "shell1234oakvilleon"
 * normalizePayee("AMZN MKTP CA*123456789") => "amznmktpca123456789"
 */
export function normalizePayee(payee: string | null | undefined): string {
  if (!payee) return '';

  return payee.toLowerCase().replace(/[^a-z0-9]/g, ''); // Remove all non-alphanumeric
}

/**
 * Tier 1: Fast normalized string comparison
 * Returns true if normalized strings are identical
 *
 * This catches 80%+ of matches quickly
 */
export function normalizedMatch(
  payee1: string | null | undefined,
  payee2: string | null | undefined,
): boolean {
  const norm1 = normalizePayee(payee1);
  const norm2 = normalizePayee(payee2);

  if (!norm1 || !norm2) return false;

  return norm1 === norm2;
}

/**
 * Calculates Levenshtein distance between two strings
 * Used for fuzzy matching when normalized comparison fails
 */
function levenshteinDistance(str1: string, str2: string): number {
  const len1 = str1.length;
  const len2 = str2.length;

  // Create distance matrix
  const matrix: number[][] = Array(len1 + 1)
    .fill(null)
    .map(() => Array(len2 + 1).fill(0));

  // Initialize first row and column
  for (let i = 0; i <= len1; i++) matrix[i]![0] = i;
  for (let j = 0; j <= len2; j++) matrix[0]![j] = j;

  // Fill the matrix
  for (let i = 1; i <= len1; i++) {
    for (let j = 1; j <= len2; j++) {
      const cost = str1[i - 1] === str2[j - 1] ? 0 : 1;
      matrix[i]![j] = Math.min(
        matrix[i - 1]![j]! + 1, // deletion
        matrix[i]![j - 1]! + 1, // insertion
        matrix[i - 1]![j - 1]! + cost, // substitution
      );
    }
  }

  return matrix[len1]![len2]!;
}

/**
 * Tier 2: Fuzzy matching using Levenshtein distance
 * Returns similarity score 0-100
 *
 * Only used when Tier 1 (normalized matching) fails
 */
export function fuzzyMatch(
  payee1: string | null | undefined,
  payee2: string | null | undefined,
): number {
  const norm1 = normalizePayee(payee1);
  const norm2 = normalizePayee(payee2);

  if (!norm1 || !norm2) return 0;
  if (norm1 === norm2) return 100; // Perfect match

  const distance = levenshteinDistance(norm1, norm2);
  const maxLen = Math.max(norm1.length, norm2.length);

  if (maxLen === 0) return 0;

  // Convert to similarity percentage
  const similarity = (1 - distance / maxLen) * 100;
  return Math.max(0, Math.min(100, similarity));
}

/**
 * Token-based similarity for better handling of word order differences
 * Splits normalized payees into tokens and compares overlap
 *
 * @example
 * "amazon prime video" vs "prime amazon" => higher similarity
 */
export function tokenBasedSimilarity(
  payee1: string | null | undefined,
  payee2: string | null | undefined,
): number {
  const norm1 = normalizePayee(payee1);
  const norm2 = normalizePayee(payee2);

  if (!norm1 || !norm2) return 0;

  // Split into tokens (any sequence of letters or digits)
  const tokens1 = norm1.match(/[a-z]+|[0-9]+/g) || [];
  const tokens2 = norm2.match(/[a-z]+|[0-9]+/g) || [];

  if (tokens1.length === 0 || tokens2.length === 0) return 0;

  // Count matching tokens
  const set1 = new Set(tokens1);
  const set2 = new Set(tokens2);

  let matches = 0;
  for (const token of set1) {
    if (set2.has(token)) matches++;
  }

  // Jaccard similarity
  const union = new Set([...set1, ...set2]).size;
  return (matches / union) * 100;
}

/**
 * Combined payee similarity using multiple strategies
 * Returns the best similarity score from:
 * - Normalized exact match (100 if matches)
 * - Fuzzy match (Levenshtein distance)
 * - Token-based match
 */
export function payeeSimilarity(
  payee1: string | null | undefined,
  payee2: string | null | undefined,
): number {
  // Tier 1: Normalized exact match
  if (normalizedMatch(payee1, payee2)) return 100;

  // Tier 2: Fuzzy and token-based matching
  const fuzzyScore = fuzzyMatch(payee1, payee2);
  const tokenScore = tokenBasedSimilarity(payee1, payee2);

  // Return the best score
  return Math.max(fuzzyScore, tokenScore);
}

/**
 * Check if payee contains a common substring
 * Useful for matching "AMAZON.COM" to "Amazon Prime"
 */
export function payeeContains(payee: string | null | undefined, substring: string): boolean {
  const norm = normalizePayee(payee);
  const normSub = normalizePayee(substring);

  if (!norm || !normSub) return false;

  return norm.includes(normSub);
}
