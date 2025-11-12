# Build and Development Guide

This document provides comprehensive information about building, developing, and maintaining the YNAB MCP Server.

## Quick Start

```bash
# Install dependencies
npm install

# Validate environment
npm run validate-env

# Build the project
npm run build

# Run tests
npm test

# Start the server
npm start
```

## Development Workflow

### 1. Setup Development Environment

```bash
# Clone the repository
git clone <repository-url>
cd ynab-mcp-server

# Install dependencies
npm install

# Create environment file
cp .env.example .env
# Edit .env with your YNAB_ACCESS_TOKEN
```

### 2. Development Commands

```bash
# Start development server with file watching
npm run dev

# Run linting
npm run lint

# Fix linting issues automatically
npm run lint:fix

# Type checking without building
npm run type-check

# Run tests in watch mode
npm run test:watch
```

### 3. Code Quality

The project includes several code quality tools:

- **ESLint**: Code linting and style enforcement
- **TypeScript**: Static type checking
- **Prettier**: Code formatting (via ESLint integration)
- **Vitest**: Testing framework

## Build Process

### Development Build

```bash
npm run build
```

This creates a development build with:
- Source maps for debugging
- TypeScript declarations
- Unminified code
- Development optimizations

### Production Build

```bash
npm run build:prod
```

This creates an optimized production build with:
- No source maps
- Minified code
- Production optimizations
- Build verification
- Environment validation

### Build Steps Explained

1. **Pre-build**: Cleans previous builds and validates environment
2. **TypeScript Compilation**: Compiles TypeScript to JavaScript
3. **Declaration Generation**: Creates TypeScript declaration files
4. **Build Verification**: Ensures all required files are present
5. **Post-build**: Runs any additional build steps

## Scripts Reference

### Build Scripts

| Script | Description |
|--------|-------------|
| `build` | Development build with source maps |
| `build:prod` | Production build (optimized) |
| `clean` | Remove build artifacts |
| `prebuild` | Pre-build validation and cleanup |
| `verify-build` | Verify build output completeness |

### Development Scripts

| Script | Description |
|--------|-------------|
| `dev` | Start development server with watching |
| `start` | Start production server |
| `start:prod` | Start with production environment |
| `validate-env` | Validate environment variables |

### Quality Scripts

| Script | Description |
|--------|-------------|
| `lint` | Run ESLint on source code |
| `lint:fix` | Fix ESLint issues automatically |
| `type-check` | Run TypeScript type checking |

### Test Scripts

| Script | Description |
|--------|-------------|
| `test` | Run all tests once |
| `test:watch` | Run tests in watch mode |
| `test:unit` | Run unit tests only |
| `test:integration` | Run integration tests only |
| `test:e2e` | Run end-to-end tests only |
| `test:coverage` | Run tests with coverage report |
| `test:performance` | Run performance tests |
| `test:comprehensive` | Run comprehensive test suite |
| `test:all` | Run all test types sequentially |

### Package Scripts

| Script | Description |
|--------|-------------|
| `generate:dxt` | Generate .dxt package file |
| `package:dxt` | Build and generate .dxt package |

For more detailed information, see the [Developer Guide](DEVELOPER.md).