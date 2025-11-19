import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import * as ynab from 'ynab';
import { z } from 'zod/v4';
import { withToolErrorHandling } from '../types/index.js';
import { responseFormatter } from '../server/responseFormatter.js';
import { writeFileSync, mkdirSync } from 'fs';
import { format } from 'date-fns';
import { join, resolve } from 'path';
import { homedir } from 'os';

/**
 * Schema for ynab:export_transactions tool parameters
 */
export const ExportTransactionsSchema = z
  .object({
    budget_id: z.string().min(1, 'Budget ID is required'),
    account_id: z.string().optional(),
    category_id: z.string().optional(),
    since_date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in ISO format (YYYY-MM-DD)')
      .optional(),
    type: z.enum(['uncategorized', 'unapproved']).optional(),
    filename: z.string().optional(),
    minimal: z.boolean().optional().default(true),
  })
  .strict();

export type ExportTransactionsParams = z.infer<typeof ExportTransactionsSchema>;

/**
 * Generate a descriptive filename for transaction export
 */
function generateExportFilename(
  params: ExportTransactionsParams,
  transactionCount: number,
): string {
  if (params.filename) {
    return params.filename.endsWith('.json') ? params.filename : `${params.filename}.json`;
  }

  const timestamp = format(new Date(), 'yyyy-MM-dd_HH-mm-ss');
  let description = 'transactions';

  // Add filters to filename for clarity
  const filters = [];

  if (params.since_date) {
    filters.push(`since_${params.since_date}`);
  }

  if (params.account_id) {
    filters.push(`account_${params.account_id.substring(0, 8)}`);
  }

  if (params.category_id) {
    filters.push(`category_${params.category_id.substring(0, 8)}`);
  }

  if (params.type) {
    filters.push(params.type);
  }

  if (params.minimal !== false) {
    // Default true, only false if explicitly set
    filters.push('minimal');
  }

  if (filters.length > 0) {
    description = filters.join('_');
  }

  return `ynab_${description}_${transactionCount}items_${timestamp}.json`;
}

/**
 * Get platform-specific default export directory
 */
function getDefaultExportPath(): string {
  const platform = process.platform;
  const home = homedir();

  switch (platform) {
    case 'win32':
      // Windows: Downloads folder
      return join(home, 'Downloads');
    case 'darwin':
      // macOS: Downloads folder
      return join(home, 'Downloads');
    case 'linux':
    case 'freebsd':
    case 'openbsd':
    case 'sunos':
    case 'aix':
      // Linux/Unix: Documents folder (more common for data files)
      // Try XDG_DOCUMENTS_DIR first, fallback to ~/Documents
      return process.env['XDG_DOCUMENTS_DIR'] || join(home, 'Documents');
    default:
      // Fallback for unknown platforms
      return join(home, 'Downloads');
  }
}

/**
 * Get the export directory path, with platform-specific defaults
 */
function getExportPath(): string {
  const exportPath = process.env['YNAB_EXPORT_PATH']?.trim();

  let targetPath: string;

  if (!exportPath) {
    // Use platform-specific default
    targetPath = getDefaultExportPath();
  } else {
    // Handle ~ expansion manually for cross-platform compatibility
    if (exportPath.startsWith('~/')) {
      targetPath = join(homedir(), exportPath.slice(2));
    } else {
      targetPath = resolve(exportPath);
    }
  }

  // Ensure directory exists
  try {
    mkdirSync(targetPath, { recursive: true });
  } catch (error) {
    console.warn(`Failed to create export directory ${targetPath}, using platform default:`, error);
    // Fallback to platform-specific default if custom path fails
    const fallbackPath = getDefaultExportPath();
    try {
      mkdirSync(fallbackPath, { recursive: true });
      return fallbackPath;
    } catch (fallbackError) {
      console.warn('Failed to create default folder, using current directory:', fallbackError);
      return process.cwd();
    }
  }

  return targetPath;
}

/**
 * Handles the ynab:export_transactions tool call
 * Exports all transactions to a JSON file with descriptive filename
 */
export async function handleExportTransactions(
  ynabAPI: ynab.API,
  params: ExportTransactionsParams,
): Promise<CallToolResult> {
  return await withToolErrorHandling(
    async () => {
      let response;

      // Use conditional API calls based on filter parameters
      if (params.account_id) {
        response = await ynabAPI.transactions.getTransactionsByAccount(
          params.budget_id,
          params.account_id,
          params.since_date,
        );
      } else if (params.category_id) {
        response = await ynabAPI.transactions.getTransactionsByCategory(
          params.budget_id,
          params.category_id,
          params.since_date,
        );
      } else {
        response = await ynabAPI.transactions.getTransactions(
          params.budget_id,
          params.since_date,
          params.type,
        );
      }

      const transactions = response.data.transactions;

      // Get export directory and generate full path
      const exportDir = getExportPath();
      const filename = generateExportFilename(params, transactions.length);
      const fullPath = join(exportDir, filename);

      // Prepare transaction data for export
      const exportData = {
        export_info: {
          exported_at: new Date().toISOString(),
          total_transactions: transactions.length,
          minimal: params.minimal !== false, // Default true, only false if explicitly set
          filters: {
            budget_id: params.budget_id,
            account_id: params.account_id || null,
            category_id: params.category_id || null,
            since_date: params.since_date || null,
            type: params.type || null,
          },
        },
        transactions: transactions.map((transaction) => {
          if (params.minimal !== false) {
            // Default true, only false if explicitly set
            // Minimal export: only essential fields
            return {
              id: transaction.id,
              date: transaction.date,
              amount: transaction.amount,
              payee_name: transaction.payee_name,
              cleared: transaction.cleared,
            };
          } else {
            // Full export: all available fields
            return {
              id: transaction.id,
              date: transaction.date,
              amount: transaction.amount,
              memo: transaction.memo,
              cleared: transaction.cleared,
              approved: transaction.approved,
              flag_color: transaction.flag_color,
              account_id: transaction.account_id,
              payee_id: transaction.payee_id,
              category_id: transaction.category_id,
              transfer_account_id: transaction.transfer_account_id,
              transfer_transaction_id: transaction.transfer_transaction_id,
              matched_transaction_id: transaction.matched_transaction_id,
              import_id: transaction.import_id,
              deleted: transaction.deleted,
              account_name: transaction.account_name,
              payee_name: transaction.payee_name,
              category_name: transaction.category_name,
            };
          }
        }),
      };

      // Write to file
      writeFileSync(fullPath, JSON.stringify(exportData, null, 2), 'utf-8');

      // Return first few transactions as preview
      const previewCount = Math.min(10, transactions.length);
      const preview = transactions.slice(0, previewCount);

      return {
        content: [
          {
            type: 'text',
            text: responseFormatter.format({
              message: `Successfully exported ${transactions.length} transactions${params.minimal !== false ? ' (minimal fields)' : ' (full fields)'}`,
              filename: filename,
              full_path: fullPath,
              export_directory: exportDir,
              export_mode: params.minimal !== false ? 'minimal' : 'full',
              minimal_fields:
                params.minimal !== false ? 'id, date, amount, payee_name, cleared' : null,
              filename_explanation:
                'Filename format: ynab_{filters}_{count}items_{timestamp}.json - identifies what data was exported, when, and how many transactions',
              preview_count: previewCount,
              total_count: transactions.length,
              preview_transactions: preview.map((transaction) => ({
                id: transaction.id,
                date: transaction.date,
                amount: transaction.amount,
                memo: transaction.memo,
                payee_name: transaction.payee_name,
                category_name: transaction.category_name,
              })),
            }),
          },
        ],
      };
    },
    'ynab:export_transactions',
    'exporting transactions',
  );
}
