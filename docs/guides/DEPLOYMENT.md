# YNAB MCP Server Deployment Guide

This guide provides instructions for deploying the YNAB MCP Server with security best practices.

## Prerequisites

### System Requirements

- **Node.js**: Version 18.0.0 or higher
- **npm**: Version 8.0.0 or higher
- **Operating System**: Linux, macOS, or Windows
- **Memory**: Minimum 512MB RAM
- **Storage**: Minimum 100MB free space

### YNAB Requirements

- Active YNAB subscription
- YNAB Personal Access Token

## Environment Setup

### 1. YNAB Personal Access Token

1. Log in to your YNAB account at [app.youneedabudget.com](https://app.youneedabudget.com)
2. Go to Account Settings → Developer Settings
3. Click "New Token"
4. Enter a descriptive name (e.g., "MCP Server")
5. Copy the generated token immediately (it won't be shown again)

### 2. Environment Variables

Create a `.env` file in your project root:

```bash
# Required
YNAB_ACCESS_TOKEN=your_personal_access_token_here

# Optional
NODE_ENV=production
LOG_LEVEL=info
```

## Build Process

### Production Build

```bash
# Install dependencies
npm install

# Validate environment
npm run validate-env

# Run tests
npm run test:all

# Build for production
npm run build:prod
```

## Deployment Options

### Option 1: Local Development

```bash
# Start the server
npm start

# Or with environment variables inline
YNAB_ACCESS_TOKEN=your_token npm start
```

### Option 2: Docker Deployment

1. Create `Dockerfile`:
```dockerfile
FROM node:18-alpine

WORKDIR /usr/src/app

COPY package*.json ./
RUN npm ci --only=production

COPY dist/ ./dist/

RUN addgroup -g 1001 -S nodejs
RUN adduser -S nodejs -u 1001
RUN chown -R nodejs:nodejs /usr/src/app
USER nodejs

CMD ["node", "dist/index.js"]
```

2. Build and run:
```bash
docker build -t ynab-mcp-server .
docker run -d \
  --name ynab-mcp-server \
  -e YNAB_ACCESS_TOKEN=your_token \
  -e NODE_ENV=production \
  --restart unless-stopped \
  ynab-mcp-server
```

### Option 3: Claude Desktop Integration

1. Build the .dxt package:
```bash
npm run package:dxt
```

2. Extract and configure:
```bash
# Extract the .dxt file
Expand-Archive ynab-mcp-server-1.0.0.dxt

# Add to Claude Desktop MCP configuration
```

## Security Best Practices

### 1. Token Security

- **Never commit tokens to version control**
- Store tokens in environment variables only
- Use different tokens for different environments
- Rotate tokens regularly (every 90 days recommended)

### 2. File Permissions

```bash
# Set restrictive permissions on sensitive files
chmod 600 .env
chmod 700 scripts/
```

### 3. Process Security

- Run the server as a non-root user
- Use process managers with automatic restart capabilities
- Implement proper logging without exposing sensitive data

## Monitoring and Maintenance

### Health Checks

Monitor server health and performance:
- Monitor server response times
- Track API rate limiting and usage patterns
- Monitor for unusual access patterns

### Updates and Maintenance

1. **Regular Updates**:
   ```bash
   # Update dependencies
   npm audit
   npm update
   
   # Rebuild and test
   npm run build:prod
   npm run test:all
   ```

2. **Token Rotation**:
   - Generate new token in YNAB
   - Update environment variables
   - Restart the server
   - Revoke old token

## Troubleshooting

### Common Issues

#### Authentication Errors
**Symptoms**: 401 Unauthorized errors
**Solutions**:
- Verify `YNAB_ACCESS_TOKEN` is set correctly
- Check token hasn't expired in YNAB settings
- Ensure token has necessary permissions

#### Rate Limiting
**Symptoms**: 429 Too Many Requests errors
**Solutions**:
- Implement request throttling
- Add retry logic with exponential backoff
- Monitor API usage patterns

For more deployment information, see the [Environment Guide](ENVIRONMENT.md).