# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.8.1] - 2025-10-02

### Added

- Support for creating split transactions via the `create_transaction` tool, including schema validation and response formatting for subtransactions.

### Changed

- Updated transaction creation responses to include detailed subtransaction data alongside refreshed account balances.
- Refreshed documentation and tests to cover split transaction workflows.

## [0.8.0] - 2025-09-28

### Fixed

- Resolved a persistent TypeScript build error in the `compareTransactions` tool by inlining the `inWindow` date comparison logic, removing an unused import, and adding non-null assertions to address `noUncheckedIndexedAccess` compiler issues.

## [0.7.0] - 2025-09-23

### Added

- Automatic conversion of all monetary amounts from YNAB's internal milliunits to human-readable dollars
- New utility functions for amount conversion (`milliunitsToAmount`, `amountToMilliunits`, `formatAmount`)
- Comprehensive test coverage for amount conversion functionality

### Changed

- **BREAKING**: All API responses now return monetary amounts in dollars instead of milliunits
- Account balances, transaction amounts, and budget figures now display in standard dollar format
- Enhanced developer and AI assistant experience with consistent amount formatting

### Fixed

- Eliminated confusion where amounts like `-1924370` milliunits were misinterpreted as `-$1,924,370` instead of the correct `-$1,924.37`
- Updated all test expectations to match new dollar-based responses

### Documentation

- Updated README.md with v0.7.0 features and automatic amount conversion details
- Enhanced API documentation with new monetary amount format specifications
- Added examples showing before/after amount formatting

## [0.6.0] - 2025-09-16

### Added

- Consolidated debug tools into single comprehensive `diagnostic_info` tool
- Enhanced bank reconciliation with smart duplicate amount matching
- Automatic date adjustment for transaction synchronization
- Exact balance matching with zero tolerance reconciliation
- Improved date range reporting for reconciliation visibility

### Changed

- Better tool organization with 80% reduction in debug tool clutter
- Cleaner MCP interface for improved user experience

### Fixed

- Multiple identical transactions handling in reconciliation process
- Chronological order preference for duplicate matching
