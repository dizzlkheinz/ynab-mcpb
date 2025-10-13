# YNAB MCP Server

[![Download latest DXT](https://img.shields.io/badge/Download-latest%20DXT-blue?logo=github)](https://github.com/dizzlkheinz/mcp-for-ynab/releases/latest)

[![Release](https://img.shields.io/github/v/release/dizzlkheinz/mcp-for-ynab?sort=semver)](https://github.com/dizzlkheinz/mcp-for-ynab/releases/latest)
[![Release DXT](https://github.com/dizzlkheinz/mcp-for-ynab/actions/workflows/release.yml/badge.svg)](https://github.com/dizzlkheinz/mcp-for-ynab/actions/workflows/release.yml)
[![Downloads](https://img.shields.io/github/downloads/dizzlkheinz/mcp-for-ynab/total.svg)](https://github.com/dizzlkheinz/mcp-for-ynab/releases)
[![License: AGPL v3](https://img.shields.io/badge/License-AGPL_v3-blue.svg)](LICENSE)
[![code style: prettier](https://img.shields.io/badge/code_style-prettier-ff69b4.svg)](https://prettier.io)
[![lint: eslint](https://img.shields.io/badge/lint-eslint-green.svg)](https://eslint.org)
[![Node](https://img.shields.io/badge/node-%E2%89%A518-brightgreen.svg)](#)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178c6.svg)](https://www.typescriptlang.org)
[![SemVer](https://img.shields.io/badge/SemVer-0.y.z-yellow.svg)](docs/VERSIONING.md)
[![Issues](https://img.shields.io/github/issues/dizzlkheinz/mcp-for-ynab)](https://github.com/dizzlkheinz/mcp-for-ynab/issues)
[![PRs](https://img.shields.io/github/issues-pr/dizzlkheinz/mcp-for-ynab)](https://github.com/dizzlkheinz/mcp-for-ynab/pulls)

A Model Context Protocol (MCP) server that provides AI assistants with secure access to You Need A Budget (YNAB) data and functionality. This server enables AI applications to help users manage their personal finances by interacting with YNAB budgets, accounts, transactions, and categories through a comprehensive set of tools.

## 🎉 What's New in v0.8.2

- **🧾 Receipt Split Tool**: `create_receipt_split_transaction` converts confirmed receipt breakdowns into multi-line splits with proportional tax allocation and optional dry-run previews.
- **🔸 Split Transaction Support**: `create_transaction` accepts subtransactions out of the box, enabling granular category assignments without manual math.
- **🧪 Strengthened Validation**: Schema safeguards ensure parent transaction totals match their split lines, preventing malformed requests.
- **📘 Documentation Refresh**: API guides, quick start, and testing checklists highlight the receipt workflow and split best practices.

### Highlights from v0.8.0

- **🏗️ Modular Architecture**: Redesigned server architecture with composable services (Config, Resources, Prompts, Diagnostics) for improved maintainability and testability
- **🎯 Centralized Tool Registry**: Unified tool registration system with consistent validation, security, and error handling across all tools
- **⚡ Enhanced Caching**: Advanced caching with LRU eviction, hit/miss tracking, stale-while-revalidate, and cache warming for improved performance
- **🔧 Improved Error Handling**: Dependency injection pattern with consistent, actionable error messages across all tools
- **📦 Decomposed Tool Modules**: Large tool files broken into focused sub-modules for better code organization and reusability
- **⏱️ Cache Warming**: Automatic cache warming after budget selection for faster subsequent operations
- **📊 Enhanced Observability**: Comprehensive cache metrics and diagnostics for better system monitoring
- **🔄 100% Backward Compatibility**: All v0.7.x functionality preserved with identical API behavior

## Features

- **Complete YNAB Integration**: Access all major YNAB features including budgets, accounts, transactions, categories, payees, and monthly data
- **Automatic Amount Conversion**: All monetary values automatically converted from YNAB's internal milliunits to human-readable dollars
- **Advanced Bank Reconciliation**: Smart duplicate matching, automatic date adjustment, exact balance matching, and comprehensive reporting
- **Modular Architecture**: Composable service modules for improved maintainability and extensibility
- **Enhanced Caching**: Advanced caching with observability, LRU eviction, and cache warming
- **Centralized Tool Registry**: Consistent validation and error handling across all tools

## Architecture Overview

The v0.8.x series introduces a completely refactored modular architecture that improves maintainability, testability, and performance while maintaining 100% backward compatibility.

### Core Components

- **Tool Registry**: Centralized metadata management, validation, and execution for all tools with consistent security and error handling
- **Config Module**: Environment validation and server configuration management
- **Resource Manager**: MCP resource definitions and handlers for seamless resource access
- **Prompt Manager**: MCP prompt definitions and handlers for enhanced AI interactions
- **Diagnostic Manager**: System diagnostics and health monitoring with comprehensive metrics
- **YNABMCPServer**: Main orchestration layer that coordinates all service modules

### Enhanced Caching System

- **Hit/Miss Tracking**: Comprehensive cache observability with detailed metrics
- **LRU Eviction**: Configurable maximum entries with least-recently-used eviction strategy
- **Stale-While-Revalidate**: Serve stale data while refreshing in background for improved performance
- **Cache Warming**: Automatic cache warming after budget selection for faster subsequent operations
- **Concurrent Deduplication**: Prevent duplicate API calls for the same cache key

### Budget Resolution & Error Handling

- **Consistent Budget Resolution**: Standardized budget ID resolution across all tools
- **Improved Error Messages**: Clear, actionable error messages with specific suggestions
- **Dependency Injection**: Enhanced testability and maintainability through explicit dependencies
- **Centralized Validation**: Uniform input validation and security checks via tool registry

## Quick Start

### Prerequisites

- Node.js 18.0.0 or higher
- npm 8.0.0 or higher
- Active YNAB subscription
- YNAB Personal Access Token

### Installation

```bash
# Clone the repository
git clone <repository-url>
cd ynab-mcp-server

# Install dependencies
npm install

# Create environment file
cp .env.example .env
# Edit .env with your YNAB_ACCESS_TOKEN

# Build the project
npm run build

# Run tests
npm test

# Start the server
npm start
```

### Getting Your YNAB Access Token

1. Log in to [YNAB Web App](https://app.youneedabudget.com)
2. Go to Account Settings → Developer Settings
3. Click "New Token"
4. Provide a descriptive name (e.g., "MCP Server")
5. Copy the generated token immediately (it's only shown once)
6. Add it to your `.env` file: `YNAB_ACCESS_TOKEN=your_token_here`

## Use with Claude Desktop (.dxt)

There are two ways to use this server as a Claude Desktop MCP extension: download a release DXT or build it locally.

### Option A: Install from Releases

- Download the latest `.dxt` from the GitHub Releases page: https://github.com/dizzlkheinz/mcp-for-ynab/releases/latest
- Open Claude Desktop and drag-and-drop the `.dxt` file into the app.
- Open the extension’s settings in Claude Desktop and set `YNAB_ACCESS_TOKEN` when prompted.
- Restart Claude Desktop if requested.

### Option B: Build locally and install

```bash
# Build a bundled DXT (includes lint + format checks)
npm run package:dxt

# The .dxt will be created at
dist/ynab-mcp-server-<version>.dxt
```

- Drag-and-drop the generated `.dxt` into Claude Desktop.
- In the extension’s settings, set `YNAB_ACCESS_TOKEN` (your YNAB Personal Access Token).

### Verify the token and connectivity

- Run the diagnostic tool `get_env_status` to confirm the token is present (masked preview shown).
- Try a simple call:
  - Read resource `ynab://user` (should return your user id), or
  - Run the `list_budgets` tool.

### Troubleshooting

- “Invalid or expired token” → Recheck `YNAB_ACCESS_TOKEN` in the extension settings; generate a new token in YNAB if needed.
- Use `get_env_status` to confirm Claude passed the token into the server (shows token_present and token_length).
- This DXT is a single-file Node bundle (no node_modules). If Claude Desktop reports a Node/runtime issue, update Claude Desktop to a recent version and try again.

### Configuration Options

Tool responses are JSON strings. To save context, outputs are minified by default. You can control this behavior and other settings via environment variables:

**Output Formatting:**

- `YNAB_MCP_MINIFY_OUTPUT` (default: `true`) — when `true`, responses are compact (no whitespace).
- `YNAB_MCP_PRETTY_SPACES` (default: `2`) — number of spaces used only if minification is disabled.

**Enhanced Caching (v0.8.0):**

- `YNAB_MCP_CACHE_MAX_ENTRIES` (default: `1000`) — Maximum number of cache entries before LRU eviction
- `YNAB_MCP_CACHE_DEFAULT_TTL_MS` (default: `1800000` - 30 minutes) — Default cache TTL in milliseconds
- `YNAB_MCP_CACHE_STALE_MS` (default: `120000` - 2 minutes) — Stale-while-revalidate window in milliseconds

**Export Settings:**

- `YNAB_EXPORT_PATH` — Directory for exported transaction files. Defaults to platform-specific locations:
  - Windows/Mac: `~/Downloads`
  - Linux/Unix: `~/Documents` (or `$XDG_DOCUMENTS_DIR`)

Examples:

```bash
# Output formatting
YNAB_MCP_MINIFY_OUTPUT=true
YNAB_MCP_PRETTY_SPACES=2

# Enhanced caching configuration
YNAB_MCP_CACHE_MAX_ENTRIES=1000
YNAB_MCP_CACHE_DEFAULT_TTL_MS=1800000
YNAB_MCP_CACHE_STALE_MS=120000

# Custom export location
YNAB_EXPORT_PATH=~/Desktop
# Or absolute paths
YNAB_EXPORT_PATH=C:\Users\YourName\Documents
YNAB_EXPORT_PATH=/home/user/exports
```

## Available Tools

The server provides 25 core tools for budgets, accounts, transactions, categories, payees, months, and financial analysis, plus 2 streamlined diagnostic tools (27 total). All tools are managed through the centralized Tool Registry for consistent validation, security, and error handling:

### Budget Management

- `list_budgets` - List all user budgets
- `get_budget` - Get detailed budget information
- `set_default_budget` - Set a default budget for subsequent calls
- `get_default_budget` - Get the currently set default budget

### Account Management

- `list_accounts` - List accounts for a budget
- `get_account` - Get specific account details
- `create_account` - Create new account

### Transaction Management

- `list_transactions` - List transactions with filtering options (auto-suggests export for large results)
- `export_transactions` - Export all transactions to JSON file with descriptive filename and platform-specific default paths
- `compare_transactions` - Compare bank transactions from CSV with YNAB transactions to find missing entries and reconcile accounts
- `reconcile_account` - Comprehensive account reconciliation with smart duplicate matching, automatic date adjustment, exact balance matching, and detailed reporting
- `get_transaction` - Get specific transaction details
- `create_transaction` - Create new transaction
- `update_transaction` - Update existing transaction
- `delete_transaction` - Delete transaction

### Category Management

- `list_categories` - List budget categories
- `get_category` - Get specific category details
- `update_category` - Update category budget allocation

### Payee Management

- `list_payees` - List payees for a budget
- `get_payee` - Get specific payee details

### Monthly Data

- `get_month` - Get monthly budget data
- `list_months` - List all months summary

### Financial Analysis & Insights (work in progress)

- `financial_overview` - Comprehensive multi-month financial analysis with trends and AI insights
- `spending_analysis` - Detailed spending analysis with category breakdowns and trends
- `budget_health_check` - Budget health assessment with scoring and actionable recommendations

### Utilities

- `get_user` - Get authenticated user information
- `convert_amount` - Convert between dollars and milliunits

### Diagnostics

- `diagnostic_info` - Comprehensive server diagnostic information (memory, environment, server info, security stats, cache stats)
- `clear_cache` - Clear the in-memory cache

## Documentation

- **[API Reference](docs/API.md)** - Complete tool documentation with examples
- **[Developer Guide](docs/DEVELOPER.md)** - Best practices and common patterns
- **[Usage Examples](docs/EXAMPLES.md)** - Practical usage examples
- **[Testing Guide](docs/TESTING.md)** - Comprehensive testing information
- **[Build Guide](docs/BUILD.md)** - Build and development workflow
- **[Deployment Guide](docs/DEPLOYMENT.md)** - Production deployment instructions
- **[Environment Guide](docs/ENVIRONMENT.md)** - Environment configuration details

## Project Structure

```
ynab-mcp-server/
├── src/
│   ├── server/           # Core server implementation (v0.8.0 modular architecture)
│   │   ├── YNABMCPServer.ts     # Main orchestration server
│   │   ├── toolRegistry.ts     # Centralized tool registry
│   │   ├── cacheManager.ts     # Enhanced caching with observability
│   │   ├── config.ts           # Environment validation module
│   │   ├── resources.ts        # Resource management module
│   │   ├── prompts.ts          # Prompt management module
│   │   ├── diagnostics.ts      # Diagnostic management module
│   │   ├── budgetResolver.ts   # Consistent budget resolution
│   │   ├── errorHandler.ts     # Dependency injection error handling
│   │   └── __tests__/          # Server component tests
│   ├── tools/            # MCP tool implementations (decomposed modules)
│   │   ├── compareTransactions/ # Modular CSV comparison tools
│   │   │   ├── types.ts        # Shared type definitions
│   │   │   ├── parser.ts       # CSV parsing logic
│   │   │   ├── matcher.ts      # Transaction matching algorithms
│   │   │   ├── formatter.ts    # Response formatting
│   │   │   └── index.ts        # Main handler & exports
│   │   ├── financialOverview/  # Modular financial analysis tools
│   │   │   ├── schemas.ts      # Zod schemas & types
│   │   │   ├── trendAnalysis.ts # Statistical analysis
│   │   │   ├── insightGenerator.ts # Business logic
│   │   │   ├── formatter.ts    # Response formatting
│   │   │   ├── handlers.ts     # Handler orchestration
│   │   │   └── index.ts        # Barrel exports
│   │   └── __tests__/          # Tool-specific tests
│   ├── types/            # Type definitions and utilities
│   │   └── __tests__/    # Type definition tests
│   └── __tests__/        # Global test utilities and E2E tests
├── dist/                 # Built JavaScript output
├── docs/                 # Complete documentation
│   └── ADR/              # Architecture Decision Records (v0.8.0)
├── scripts/              # Build and utility scripts
└── README.md            # This file
```

## Development

### Development Workflow

```bash
# Start development server with file watching
npm run dev

# Run linting
npm run lint

# Fix linting issues
npm run lint:fix

# Type checking
npm run type-check

# Run tests in watch mode
npm run test:watch
```

### Testing

```bash
# Run all tests
npm test

# Run specific test types
npm run test:unit           # Unit tests only
npm run test:integration    # Integration tests only
npm run test:e2e           # End-to-end tests (requires real API key)
npm run test:performance   # Performance tests

# Generate coverage report
npm run test:coverage

# Run comprehensive test suite
npm run test:comprehensive
```

## Security

This server follows security best practices:

- **Token Security**: Access tokens are stored securely and never logged
- **Input Validation**: All tool parameters are validated using Zod schemas
- **Error Handling**: Errors are sanitized to prevent information leakage
- **Rate Limiting**: Respects YNAB API rate limits
- **Secure Defaults**: Production-ready security configurations

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Make your changes following the coding standards
4. Add tests for new functionality
5. Ensure all tests pass (`npm run test:all`)
6. Commit your changes (`git commit -m 'Add amazing feature'`)
7. Push to the branch (`git push origin feature/amazing-feature`)
8. Open a Pull Request

### Issues & PRs

- Report a bug: https://github.com/dizzlkheinz/mcp-for-ynab/issues/new?template=bug_report.md
- Request a feature: https://github.com/dizzlkheinz/mcp-for-ynab/issues/new?template=feature_request.md
- Open a PR: https://github.com/dizzlkheinz/mcp-for-ynab/compare

Notes:

- PRs use an auto-applied template and a public API checklist (see docs/VERSIONING.md)
- For release planning, use the “Release Checklist” issue template

## License

This project is licensed under the GNU Affero General Public License v3.0 (AGPL-3.0). See the
[LICENSE](LICENSE) file for details.

## Support

- **Documentation**: Check the [docs/](docs/) directory for detailed guides
- **Issues**: Report bugs and request features via GitHub Issues
- **YNAB API**: [Official YNAB API Documentation](https://api.youneedabudget.com/)
- **MCP Protocol**: [Model Context Protocol Documentation](https://modelcontextprotocol.io/)

## Acknowledgments

- Built with the [YNAB JavaScript SDK](https://github.com/ynab/ynab-sdk-js)
- Uses the [Model Context Protocol SDK](https://github.com/modelcontextprotocol/typescript-sdk)
- Developed and automated with the OpenAI Codex CLI and Anthropic Claude Code
- Packaged as a DXT extension for Anthropic Claude Desktop (thanks to DXT)
