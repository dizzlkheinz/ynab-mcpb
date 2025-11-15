# YNAB MCP Server

[![Download latest DXT](https://img.shields.io/badge/Download-latest%20DXT-blue?logo=github)](https://github.com/dizzlkheinz/mcp-for-ynab/releases/latest)
[![npm version](https://img.shields.io/npm/v/@dizzlkheinz/ynab-mcp-server.svg)](https://www.npmjs.com/package/@dizzlkheinz/ynab-mcp-server)
[![npm downloads](https://img.shields.io/npm/dm/@dizzlkheinz/ynab-mcp-server.svg)](https://www.npmjs.com/package/@dizzlkheinz/ynab-mcp-server)

[![Release](https://img.shields.io/github/v/release/dizzlkheinz/mcp-for-ynab?sort=semver)](https://github.com/dizzlkheinz/mcp-for-ynab/releases/latest)
[![Release DXT](https://github.com/dizzlkheinz/mcp-for-ynab/actions/workflows/release.yml/badge.svg)](https://github.com/dizzlkheinz/mcp-for-ynab/actions/workflows/release.yml)
[![Downloads](https://img.shields.io/github/downloads/dizzlkheinz/mcp-for-ynab/total.svg)](https://github.com/dizzlkheinz/mcp-for-ynab/releases)
[![License: AGPL v3](https://img.shields.io/badge/License-AGPL_v3-blue.svg)](LICENSE)
[![code style: prettier](https://img.shields.io/badge/code_style-prettier-ff69b4.svg)](https://prettier.io)
[![lint: eslint](https://img.shields.io/badge/lint-eslint-green.svg)](https://eslint.org)
[![Node](https://img.shields.io/badge/node-%E2%89%A518-brightgreen.svg)](#)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178c6.svg)](https://www.typescriptlang.org)
[![SemVer](https://img.shields.io/badge/SemVer-0.y.z-yellow.svg)](https://semver.org/)
[![Issues](https://img.shields.io/github/issues/dizzlkheinz/mcp-for-ynab)](https://github.com/dizzlkheinz/mcp-for-ynab/issues)
[![PRs](https://img.shields.io/github/issues-pr/dizzlkheinz/mcp-for-ynab)](https://github.com/dizzlkheinz/mcp-for-ynab/pulls)

Connect your YNAB budget to Claude Desktop and other AI assistants using the Model Context Protocol (MCP). Ask questions about your spending, create transactions, reconcile accounts, and manage your budget using natural language.

## What Can You Do?

- **Ask Questions**: "How much did I spend on groceries last month?" or "What's my credit card balance?"
- **Manage Transactions**: Create, update, or delete transactions without opening YNAB
- **Split Receipts**: Create itemized transactions from receipts with automatic tax allocation across items
- **Reconcile Accounts**: Import and compare bank statements to find missing transactions
- **Analyze Spending**: Get insights into spending patterns and budget performance
- **Set Budgets**: Adjust category budgets and move money between categories

All monetary amounts are automatically converted to dollars (YNAB stores them in milliunits internally), so everything is human-readable.

## Quick Start

### Step 1: Get Your YNAB Access Token

1. Log in to [YNAB Web App](https://app.youneedabudget.com)
2. Go to **Account Settings** → **Developer Settings**
3. Click **New Token**
4. Give it a name (e.g., "Claude Desktop")
5. Copy the token (you'll only see it once!)

### Step 2: Install in Claude Desktop

**Option A: Download the Extension (Recommended)**

1. Download the latest `.dxt` file from [Releases](https://github.com/dizzlkheinz/mcp-for-ynab/releases/latest)
2. Drag and drop it into Claude Desktop
3. Paste your YNAB Access Token when prompted
4. Restart Claude Desktop

**Option B: Use npx (Advanced)**

Add this to your Claude Desktop MCP settings file:

```json
{
  "mcpServers": {
    "ynab": {
      "command": "npx",
      "args": ["-y", "@dizzlkheinz/ynab-mcp-server"],
      "env": {
        "YNAB_ACCESS_TOKEN": "your-token-here"
      }
    }
  }
}
```

### Step 3: Start Using It

Ask Claude questions like:
- "What's my checking account balance?"
- "How much have I spent on dining out this month?"
- "List my recent transactions"
- "Set my groceries budget to $500"

That's it! You're ready to manage your budget with AI.

## Optional Configuration

Most users won't need to change these settings, but they're available if you need them:

**Export Location:**
- `YNAB_EXPORT_PATH` — Where to save exported transaction files (defaults to Downloads folder)

Example:
```json
{
  "mcpServers": {
    "ynab": {
      "command": "npx",
      "args": ["-y", "@dizzlkheinz/ynab-mcp-server"],
      "env": {
        "YNAB_ACCESS_TOKEN": "your-token-here",
        "YNAB_EXPORT_PATH": "C:\\Users\\YourName\\Documents"
      }
    }
  }
}
```

For advanced configuration options (caching, output formatting), see the [Configuration Guide](docs/getting-started/CONFIGURATION.md).

## What's Available

The server gives Claude access to 28 tools organized by function. You don't need to know the tool names - just ask Claude in natural language and it will use the right tools.

**Budget & Account Info**
- View budgets, accounts, categories, payees
- Check balances and category budgets
- See monthly spending summaries

**Transactions**
- List, create, update, or delete transactions
- Import and reconcile bank statements
- Export transactions to files
- Create split transactions from receipts

**Analysis**
- Compare spending across time periods
- Find missing transactions
- Track budget performance

For the complete list with technical details, see the [API Reference](docs/reference/API.md).

## Need Help?

- **[Troubleshooting Guide](docs/reference/TROUBLESHOOTING.md)** - Common issues and solutions
- **[Full Documentation](docs/README.md)** - Complete guides and API reference
- **[GitHub Issues](https://github.com/dizzlkheinz/mcp-for-ynab/issues)** - Report bugs or request features

## For Developers

Want to contribute or build from source?

- **[Development Guide](docs/guides/DEVELOPMENT.md)** - Setup and best practices
- **[Architecture Overview](docs/guides/ARCHITECTURE.md)** - How the code is organized
- **[Testing Guide](docs/guides/TESTING.md)** - Running and writing tests

Quick start for development:
```bash
git clone <repository-url>
cd ynab-mcp-server
npm install
npm run build
npm test
```

## Security & Privacy

Your YNAB access token is stored securely and never logged. All communication with YNAB's API uses HTTPS, and the server validates all inputs to prevent errors and security issues.

## Contributing

Contributions welcome! Please:
1. [Open an issue](https://github.com/dizzlkheinz/mcp-for-ynab/issues) to discuss your idea
2. Fork the repository and make your changes
3. Add tests for new features
4. Submit a pull request

See the [Development Guide](docs/guides/DEVELOPMENT.md) for details.

## License

Licensed under [AGPL-3.0](LICENSE). Free to use and modify, but derivative works must also be open source.

---

Built with:
- [YNAB API](https://api.youneedabudget.com/) - Official YNAB REST API
- [Model Context Protocol](https://modelcontextprotocol.io/) - AI integration standard
- [Claude Desktop](https://claude.ai/download) - AI assistant with MCP support
