# YNAB MCP Server Documentation

Complete documentation for the YNAB Model Context Protocol Server.

## 📚 Documentation Overview

### Getting Started
New to the YNAB MCP Server? Start here:

- **[Quick Start](getting-started/QUICKSTART.md)** - Fast path to testing with Claude Desktop
- **[Installation](getting-started/INSTALLATION.md)** - Detailed installation instructions
- **[Configuration](getting-started/CONFIGURATION.md)** - Environment variables and settings

### Guides
Learn how to develop with and extend the server:

- **[Architecture](guides/ARCHITECTURE.md)** - v0.8.x modular architecture and core components
- **[Development](guides/DEVELOPMENT.md)** - Common patterns and best practices
- **[Testing](guides/TESTING.md)** - Automated and manual testing strategies
- **[Deployment](guides/DEPLOYMENT.md)** - Production deployment instructions

### Features
Detailed documentation for major features:

- **[Caching](features/CACHING.md)** - Enhanced caching system with LRU eviction and observability
- **[Reconciliation](features/RECONCILIATION.md)** - Smart account reconciliation with CSV import
- **[CSV Parser](features/CSV_PARSER.md)** - CSV parsing, amount handling, and format detection

### Reference
Complete API and technical reference:

- **[API Reference](reference/API.md)** - Complete tool documentation with examples
- **[Tools Quick Reference](reference/TOOLS.md)** - Quick tool catalog and parameter guide
- **[Examples](reference/EXAMPLES.md)** - Practical usage examples and workflows
- **[Troubleshooting](reference/TROUBLESHOOTING.md)** - Common issues, solutions, and debugging

### Development
For contributors and advanced users:

- **[Build Guide](development/BUILD.md)** - Build and development workflow
- **[Testing Checklist](development/TESTING_CHECKLIST.md)** - Systematic validation checklist
- **[PR Automation](development/PR_AUTOMATION.md)** - Pull request automation details
- **[Versioning](development/VERSIONING.md)** - Semantic versioning policy

### Architecture Decisions
Historical context for architectural choices:

- **[Architecture Decision Records](architecture/decisions/)** - ADRs documenting v0.8.x design decisions
  - [Budget Resolution Consistency](architecture/decisions/budget-resolution-consistency.md)
  - [Dependency Injection Pattern](architecture/decisions/dependency-injection-pattern.md)
  - [Enhanced Caching](architecture/decisions/enhanced-caching.md)
  - [Modular Architecture](architecture/decisions/modular-architecture.md)
  - [Tool Module Decomposition](architecture/decisions/tool-module-decomposition.md)
  - [Tool Registry Architecture](architecture/decisions/tool-registry-architecture.md)

## 🎯 Quick Navigation by Task

### I want to...

**Get Started**
- Install and configure → [Installation](getting-started/INSTALLATION.md)
- Test quickly → [Quick Start](getting-started/QUICKSTART.md)
- Understand the architecture → [Architecture](guides/ARCHITECTURE.md)

**Develop**
- Build a new feature → [Development Guide](guides/DEVELOPMENT.md)
- Create a new tool → [Architecture Guide](guides/ARCHITECTURE.md#developing-tools-with-v08x)
- Follow best practices → [Development Best Practices](guides/DEVELOPMENT.md#best-practices)

**Troubleshoot**
- Fix connection issues → [Troubleshooting](reference/TROUBLESHOOTING.md#connection-problems)
- Improve performance → [Troubleshooting](reference/TROUBLESHOOTING.md#performance-issues)
- Debug errors → [Troubleshooting](reference/TROUBLESHOOTING.md#error-messages)

**Test**
- Run automated tests → [Testing Guide](guides/TESTING.md)
- Perform manual testing → [Testing Scenarios](guides/TESTING.md#manual-test-scenarios)
- Validate a release → [Testing Checklist](development/TESTING_CHECKLIST.md)

**Deploy**
- Deploy to production → [Deployment Guide](guides/DEPLOYMENT.md)
- Configure for Claude Desktop → [Quick Start](getting-started/QUICKSTART.md#claude-desktop-integration)

## 📦 What's New in v0.8.x

The v0.8.x series introduces major improvements:

- **🏗️ Modular Architecture** - Composable service modules for better maintainability
- **⚡ Enhanced Caching** - LRU eviction, hit/miss tracking, stale-while-revalidate
- **🎯 Centralized Tool Registry** - Consistent validation and error handling
- **🔧 Improved Error Handling** - Dependency injection with clear error messages
- **📦 Decomposed Tool Modules** - Focused sub-modules for better organization
- **🔄 100% Backward Compatible** - All v0.7.x functionality preserved

Learn more in the [Architecture Guide](guides/ARCHITECTURE.md).

## 🔗 External Resources

- **[YNAB API Documentation](https://api.youneedabudget.com/)** - Official YNAB API docs
- **[Model Context Protocol](https://modelcontextprotocol.io/)** - MCP specification
- **[Project Repository](https://github.com/dizzlkheinz/mcp-for-ynab)** - GitHub repository
- **[Release Notes](https://github.com/dizzlkheinz/mcp-for-ynab/releases)** - Version history and changelog

## 💡 Need Help?

- **Documentation Issue?** Check the [Troubleshooting Guide](reference/TROUBLESHOOTING.md)
- **Bug Report?** [Open an issue](https://github.com/dizzlkheinz/mcp-for-ynab/issues/new?template=bug_report.md)
- **Feature Request?** [Request a feature](https://github.com/dizzlkheinz/mcp-for-ynab/issues/new?template=feature_request.md)
- **Question?** Check existing [GitHub Discussions](https://github.com/dizzlkheinz/mcp-for-ynab/discussions)

## 📄 License

This project is licensed under the GNU Affero General Public License v3.0 (AGPL-3.0). See the [LICENSE](../LICENSE) file for details.

---

**Quick Links**: [Main README](../README.md) | [API Reference](reference/API.md) | [Quick Start](getting-started/QUICKSTART.md) | [Architecture](guides/ARCHITECTURE.md)
