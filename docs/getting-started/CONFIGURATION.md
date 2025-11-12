# Environment Configuration Guide

This document provides detailed information about environment variables and configuration options for the YNAB MCP Server.

## Environment Variables

### Required Variables

#### YNAB_ACCESS_TOKEN

- **Type**: String
- **Required**: Yes
- **Description**: Your YNAB Personal Access Token for API authentication
- **Security**: Highly sensitive - never commit to version control
- **Format**: Alphanumeric string (typically 64 characters)
- **Example**: `YNAB_ACCESS_TOKEN=1234567890abcdef...`

**How to obtain**:
1. Log in to [YNAB Web App](https://app.youneedabudget.com)
2. Go to Account Settings → Developer Settings
3. Click "New Token"
4. Provide a descriptive name
5. Copy the token immediately (it's only shown once)

### Optional Variables

#### YNAB_DEFAULT_BUDGET_ID

- **Type**: String
- **Required**: No
- **Description**: Sets the default budget ID to use for all operations if not explicitly provided.
- **Example**: `YNAB_DEFAULT_BUDGET_ID=12345678-1234-1234-1234-123456789012`

#### NODE_ENV

- **Type**: String
- **Required**: No
- **Default**: `development`
- **Valid Values**: `development`, `production`, `test`
- **Description**: Specifies the runtime environment
- **Example**: `NODE_ENV=production`

#### LOG_LEVEL

- **Type**: String
- **Required**: No
- **Default**: `info`
- **Valid Values**: `error`, `warn`, `info`, `debug`
- **Description**: Controls the verbosity of application logging
- **Example**: `LOG_LEVEL=warn`

#### YNAB_MCP_MINIFY_OUTPUT

- **Type**: Boolean
- **Required**: No
- **Default**: `true`
- **Valid Values**: `true`, `false`, `1`, `0`, `yes`, `no`, `on`, `off`
- **Description**: Controls whether tool responses are returned as minified JSON to save context.
- **Example**: `YNAB_MCP_MINIFY_OUTPUT=true`

#### YNAB_MCP_PRETTY_SPACES

- **Type**: Number
- **Required**: No
- **Default**: `2`
- **Description**: Number of spaces to use when pretty-printing JSON. Only used when `YNAB_MCP_MINIFY_OUTPUT=false`.
- **Example**: `YNAB_MCP_PRETTY_SPACES=2`

## Configuration Files

### .env File

Create a `.env` file in your project root for local development:

```bash
# YNAB Configuration
YNAB_ACCESS_TOKEN=your_personal_access_token_here

# Application Configuration
NODE_ENV=development
LOG_LEVEL=info

# Output formatting
# Minify JSON output (saves context)
YNAB_MCP_MINIFY_OUTPUT=true
# Pretty spaces when not minifying
YNAB_MCP_PRETTY_SPACES=2
```

**Important**: 
- Add `.env` to your `.gitignore` file
- Never commit `.env` files to version control
- Use different `.env` files for different environments

## Environment Validation

The server includes built-in environment validation that runs automatically during startup:

```bash
# Validate current environment
npm run validate-env
```

### Validation Rules

The validation script checks:

1. **Required Variables**:
   - Presence of `YNAB_ACCESS_TOKEN`
   - Token format and minimum length

2. **Optional Variables**:
   - Valid values for `NODE_ENV`
   - Valid values for `LOG_LEVEL`

3. **Security Checks**:
   - Warns if using development tokens in production
   - Validates environment consistency

## Platform-Specific Setup

### Windows (PowerShell)

```powershell
$env:YNAB_ACCESS_TOKEN="your_token_here"
$env:NODE_ENV="production"
```

### Linux/macOS

```bash
export YNAB_ACCESS_TOKEN="your_token_here"
export NODE_ENV="production"
```

### Docker

```dockerfile
ENV NODE_ENV=production
ENV YNAB_ACCESS_TOKEN=your_token_here
```

## Security Best Practices

### Token Management

1. **Rotation Strategy**: Rotate tokens every 90 days
2. **Access Control**: Limit who can access production environment variables
3. **Monitoring**: Log authentication attempts without exposing tokens

### Environment Isolation

1. **Separate Tokens**: Use different YNAB tokens for each environment
2. **Network Isolation**: Deploy environments in separate networks
3. **Access Controls**: Limit who can access production environment variables

## Troubleshooting

### Common Issues

#### Token Not Found
**Error**: `YNAB_ACCESS_TOKEN is required`
**Solutions**:
- Verify the environment variable is set
- Check `.env` file exists and contains the token
- Ensure the token is not wrapped in quotes incorrectly

#### Invalid Token Format
**Error**: `YNAB_ACCESS_TOKEN appears to be too short`
**Solutions**:
- Verify you copied the complete token from YNAB
- Check for extra spaces or characters
- Generate a new token if the current one is corrupted

For more environment configuration details, see the [Deployment Guide](DEPLOYMENT.md).
