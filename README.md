# YNAB MCP Server

[![Download MCPB](https://img.shields.io/badge/Download-MCPB-blue?logo=github)](https://github.com/dizzlkheinz/ynab-mcpb/releases/latest)
[![npm](https://img.shields.io/npm/v/@dizzlkheinz/ynab-mcpb.svg)](https://www.npmjs.com/package/@dizzlkheinz/ynab-mcpb)
[![License: AGPL v3](https://img.shields.io/badge/License-AGPL_v3-blue.svg)](LICENSE)

Connect your YNAB budget to Claude Desktop (or any MCP client) and manage your finances with natural language.

### Highlights

**Receipt Itemization** — Paste a receipt, get split transactions with tax allocated across items. No more manual entry for Costco runs.

**Bank Reconciliation** _(beta)_ — Import a CSV from your bank, fuzzy-match against YNAB, find discrepancies. Presets for TD, RBC, Scotiabank, Wealthsimple, Tangerine. _This is the most ambitious feature—it works well but has rough edges. [Bug reports welcome!](https://github.com/dizzlkheinz/ynab-mcpb/issues)_

**Everything Else** — Check balances, create transactions, analyze spending, adjust budgets. Just ask.

## Quick Start

### Step 1: Get Your YNAB Access Token

1. Log in to [YNAB Web App](https://app.youneedabudget.com)
2. Go to **Account Settings** → **Developer Settings**
3. Click **New Token**
4. Give it a name (e.g., "MCP Server")
5. Copy the token (you'll only see it once!)

### Step 2: Install in Your MCP Client

<details>
<summary><b>Claude Desktop</b> (Recommended)</summary>

#### Option A: Download the Extension

1. Download the latest `.mcpb` file from [Releases](https://github.com/dizzlkheinz/ynab-mcpb/releases/latest)
2. Drag and drop it into Claude Desktop
3. Paste your YNAB Access Token when prompted
4. Restart Claude Desktop

#### Option B: Use npx

Add this to your Claude Desktop MCP settings file:

```json
{
  "mcpServers": {
    "ynab": {
      "command": "npx",
      "args": ["-y", "@dizzlkheinz/ynab-mcpb@latest"],
      "env": {
        "YNAB_ACCESS_TOKEN": "your-token-here"
      }
    }
  }
}
```

</details>

<details>
<summary><b>Cline (VS Code Extension)</b></summary>

Add this to your Cline MCP settings:

```json
{
  "mcpServers": {
    "ynab": {
      "command": "npx",
      "args": ["-y", "@dizzlkheinz/ynab-mcpb@latest"],
      "env": {
        "YNAB_ACCESS_TOKEN": "your-token-here"
      }
    }
  }
}
```

</details>

<details>
<summary><b>Codex</b></summary>

Add this to your configuration file:

```toml
[mcp_servers.ynab-mcpb]
command = "npx"
args = ["-y", "@dizzlkheinz/ynab-mcpb@latest"]
env = {"YNAB_ACCESS_TOKEN" = "your-token-here"}
startup_timeout_sec = 120
```

</details>

<details>
<summary><b>Other MCP Clients</b></summary>

For any MCP-compatible client, configure the server with:

**Command:** `npx`
**Arguments:** `["-y", "@dizzlkheinz/ynab-mcpb@latest"]`
**Environment Variables:**

- `YNAB_ACCESS_TOKEN`: Your YNAB Personal Access Token

See the [full list of MCP clients](https://modelcontextprotocol.io/docs/clients/) for more options.

</details>

### Step 3: Start Using It

Ask your AI assistant questions like:

- "What's my checking account balance?"
- "How much have I spent on dining out this month?"
- "List my recent transactions"
- "Set my groceries budget to $500"

That's it! You're ready to manage your budget with AI.

<details>
<summary><b>Optional Configuration</b></summary>

- `YNAB_EXPORT_PATH` — Directory for exported files (default: Downloads)

See `.env.example` for caching and output options.

</details>

## Available Tools

29 tools for budgets, accounts, transactions, categories, payees, and analysis. Just ask in natural language.

For the complete list, see the [API Reference](docs/reference/API.md).

## Need Help?

[API Reference](docs/reference/API.md) · [Issues](https://github.com/dizzlkheinz/ynab-mcpb/issues)

<details>
<summary><b>For Developers</b></summary>

```bash
git clone https://github.com/dizzlkheinz/ynab-mcpb.git && cd ynab-mcpb
npm install
cp .env.example .env  # add your YNAB_ACCESS_TOKEN
npm run build && npm test
```

See `CLAUDE.md` for architecture details.

</details>

## Contributing

**Bug reports are especially valuable** — particularly for the reconciliation tool. If your bank's CSV doesn't parse right or matching behaves unexpectedly, [open an issue](https://github.com/dizzlkheinz/ynab-mcpb/issues) with sample data (anonymized) and I'll fix it.

PRs welcome too. See `CLAUDE.md` for architecture.

## License

[AGPL-3.0](LICENSE) — Free to use; derivative works must be open source.
