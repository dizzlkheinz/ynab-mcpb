# Installation Guide

Complete installation instructions for the YNAB MCP Server.

## Table of Contents

- [Prerequisites](#prerequisites)
- [Getting Your YNAB Access Token](#getting-your-ynab-access-token)
- [Installation Options](#installation-options)
  - [Option A: From Source](#option-a-from-source)
  - [Option B: From Release DXT](#option-b-from-release-dxt)
- [Claude Desktop Integration](#claude-desktop-integration)
- [Verification](#verification)
- [Troubleshooting](#troubleshooting)

## Prerequisites

Before installing, ensure you have:

- **Node.js**: Version 18.0.0 or higher ([Download](https://nodejs.org/))
- **npm**: Version 8.0.0 or higher (included with Node.js)
- **YNAB Account**: Active YNAB subscription with budget data
- **YNAB Personal Access Token**: From YNAB developer settings
- **Claude Desktop** (optional): For Claude Desktop integration

### Verify Prerequisites

```bash
# Check Node.js version (should be 18+)
node --version

# Check npm version (should be 8+)
npm --version
```

## Getting Your YNAB Access Token

You need a YNAB Personal Access Token to authenticate with the YNAB API:

1. Log in to [YNAB Web App](https://app.youneedabudget.com)
2. Navigate to **Account Settings** → **Developer Settings**
3. Click **"New Token"**
4. Provide a descriptive name (e.g., "MCP Server" or "Claude Desktop")
5. **Copy the generated token immediately** (it's only shown once)
6. Store it securely - you'll need it for configuration

**Important**: Treat your access token like a password. Never commit it to version control or share it publicly.

## Installation Options

### Option A: From Source

Install and build the project from source code.

#### 1. Clone the Repository

```bash
git clone https://github.com/dizzlkheinz/mcp-for-ynab.git
cd mcp-for-ynab
```

#### 2. Install Dependencies

```bash
npm install
```

#### 3. Configure Environment

Create a `.env` file in the project root:

```bash
cp .env.example .env
```

Edit `.env` and add your YNAB access token:

```env
# Required
YNAB_ACCESS_TOKEN=your_token_here

# Optional Configuration
YNAB_MCP_MINIFY_OUTPUT=true
YNAB_MCP_PRETTY_SPACES=2

# Enhanced Caching (v0.8.x)
YNAB_MCP_CACHE_MAX_ENTRIES=1000
YNAB_MCP_CACHE_DEFAULT_TTL_MS=1800000
YNAB_MCP_CACHE_STALE_MS=120000

# Export Settings
YNAB_EXPORT_PATH=~/Downloads
```

#### 4. Build the Project

```bash
npm run build
```

This will:
- Compile TypeScript to JavaScript
- Run linting and formatting checks
- Generate the bundled output in `dist/`

#### 5. Run Tests (Optional but Recommended)

```bash
npm test
```

#### 6. Start the Server

```bash
npm start
```

The server should start successfully and be ready to accept MCP connections.

### Option B: From Release DXT

Install a pre-built DXT package from GitHub Releases (recommended for most users).

#### 1. Download the DXT

Visit the [Latest Release](https://github.com/dizzlkheinz/mcp-for-ynab/releases/latest) and download the `.dxt` file.

#### 2. Install in Claude Desktop

1. Open Claude Desktop
2. Drag and drop the `.dxt` file into the Claude Desktop window
3. Follow the installation prompts
4. The extension will be installed automatically

#### 3. Configure the Extension

1. Open Claude Desktop Settings
2. Navigate to Extensions or MCP Servers
3. Find "ynab-mcp-server" in the list
4. Click settings/configure
5. Set `YNAB_ACCESS_TOKEN` to your YNAB Personal Access Token
6. Optionally configure other environment variables

#### 4. Restart Claude Desktop

Close and reopen Claude Desktop completely for the changes to take effect.

## Claude Desktop Integration

### Configure MCP Server (Option A - From Source)

If you built from source, configure Claude Desktop to use the local installation:

1. Open Claude Desktop Settings
2. Navigate to **"Extensions"** or **"MCP Servers"** section
3. Click **"Add New Server"**
4. Configure with these settings:

```json
{
  "name": "ynab-mcp-server",
  "command": "node",
  "args": ["dist/index.js"],
  "cwd": "/absolute/path/to/ynab-mcp-dxt",
  "env": {
    "YNAB_ACCESS_TOKEN": "your_token_here"
  }
}
```

**Important**: Replace `/absolute/path/to/ynab-mcp-dxt` with the actual absolute path to your installation directory.

### Verify Configuration

After configuration, verify in Claude Desktop:

1. Check that "ynab-mcp-server" appears in the connected servers list
2. Look for a green connection indicator
3. No error messages in the logs

## Verification

### Verify Token and Connectivity

Test the installation with these steps:

#### 1. Check Diagnostic Info

Ask Claude (if using Claude Desktop):

```
Can you run the diagnostic_info tool for the YNAB MCP server?
```

Expected response should include:
- `authenticated: true`
- User information
- Server version
- Cache configuration

#### 2. Test Basic Functionality

Ask Claude:

```
Can you list my YNAB budgets using the list_budgets tool?
```

Expected response should show your budget(s) with names and IDs.

#### 3. Alternative: Command Line Testing

If not using Claude Desktop, test directly:

```bash
# Start the server
npm start

# In another terminal, send a test request
# (requires MCP client setup)
```

### Success Indicators

✅ Server starts without errors
✅ Authentication shows as successful
✅ Budget listing returns your budgets
✅ No connection errors in logs

## Troubleshooting

### "Invalid or expired token"

**Problem**: Authentication fails with invalid token error.

**Solutions**:
- Verify token is correctly copied (no extra spaces)
- Check token in YNAB Developer Settings
- Generate a new token if expired
- Ensure token is set in correct location (.env or Claude Desktop settings)
- Restart the server/Claude Desktop after updating

### "Command not found: node"

**Problem**: Node.js is not installed or not in PATH.

**Solutions**:
- Install Node.js 18+ from [nodejs.org](https://nodejs.org/)
- Verify installation with `node --version`
- Restart terminal/command prompt after installation

### "Cannot find module" errors

**Problem**: Dependencies not installed or build not completed.

**Solutions**:
```bash
# Reinstall dependencies
rm -rf node_modules package-lock.json
npm install

# Rebuild the project
npm run build
```

### "Port already in use"

**Problem**: Another instance is already running.

**Solutions**:
```bash
# Find and stop the existing process
# On Unix/Mac:
ps aux | grep "ynab-mcp"
kill <process_id>

# On Windows:
tasklist | findstr "node"
taskkill /PID <process_id> /F
```

### Claude Desktop Connection Issues

**Problem**: Claude Desktop can't connect to the server.

**Solutions**:
- Verify `dist/index.js` exists (run `npm run build` if not)
- Check working directory path is absolute (not relative)
- Ensure YNAB_ACCESS_TOKEN is set in extension settings
- Check Claude Desktop logs for specific error messages
- Restart Claude Desktop completely
- Try removing and re-adding the server configuration

### Build Failures

**Problem**: TypeScript compilation fails.

**Solutions**:
```bash
# Check for TypeScript errors
npm run type-check

# View detailed build output
npm run build -- --verbose

# Clear cache and rebuild
rm -rf dist/
npm run build
```

## Next Steps

After successful installation:

1. **Quick Start**: Follow the [Quick Start Guide](QUICKSTART.md) to test basic functionality
2. **Configuration**: Review [Configuration Guide](CONFIGURATION.md) for advanced settings
3. **Development**: Read the [Development Guide](../guides/DEVELOPMENT.md) for usage patterns
4. **API Reference**: Explore available tools in the [API Reference](../reference/API.md)

## Getting Help

If you encounter issues not covered here:

- Check the [Troubleshooting Guide](../reference/TROUBLESHOOTING.md)
- Review [GitHub Issues](https://github.com/dizzlkheinz/mcp-for-ynab/issues)
- Open a [new issue](https://github.com/dizzlkheinz/mcp-for-ynab/issues/new) with:
  - Your environment (OS, Node version, Claude Desktop version)
  - Error messages
  - Steps to reproduce

---

**Navigation**: [← Back to Getting Started](../README.md#getting-started) | [Configuration Guide →](CONFIGURATION.md) | [Quick Start →](QUICKSTART.md)
