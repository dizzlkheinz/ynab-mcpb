#!/usr/bin/env node

/**
 * Environment Variable Validation Script
 * Validates required environment variables for YNAB MCP Server
 */

import { dirname } from 'path';
import { fileURLToPath } from 'url';
import { config } from 'dotenv';

// Load environment variables from .env file
config();

// Allow CI builds to skip strict validation when packaging artifacts
if (process.env['SKIP_ENV_VALIDATION'] === 'true') {
  console.log('Skipping environment validation (SKIP_ENV_VALIDATION=true)');
  process.exit(0);
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const requiredEnvVars = [
  {
    name: 'YNAB_ACCESS_TOKEN',
    description: 'YNAB Personal Access Token',
    validation: (value) => {
      if (!value) return 'YNAB_ACCESS_TOKEN is required';
      if (typeof value !== 'string') return 'YNAB_ACCESS_TOKEN must be a string';
      if (value.length < 10) return 'YNAB_ACCESS_TOKEN appears to be too short';
      return null;
    },
  },
];

const optionalEnvVars = [
  {
    name: 'NODE_ENV',
    description: 'Node.js environment (development, production, test)',
    default: 'development',
    validation: (value) => {
      const validEnvs = ['development', 'production', 'test'];
      if (value && !validEnvs.includes(value)) {
        return `NODE_ENV must be one of: ${validEnvs.join(', ')}`;
      }
      return null;
    },
  },
  {
    name: 'LOG_LEVEL',
    description: 'Logging level (error, warn, info, debug)',
    default: 'info',
    validation: (value) => {
      const validLevels = ['error', 'warn', 'info', 'debug'];
      if (value && !validLevels.includes(value)) {
        return `LOG_LEVEL must be one of: ${validLevels.join(', ')}`;
      }
      return null;
    },
  },
];

function validateEnvironment() {
  console.log('🔍 Validating environment variables...\n');

  let hasErrors = false;
  const warnings = [];

  // Validate required environment variables
  for (const envVar of requiredEnvVars) {
    const value = process.env[envVar.name];
    const error = envVar.validation(value);

    if (error) {
      console.error(`❌ ${envVar.name}: ${error}`);
      console.error(`   Description: ${envVar.description}\n`);
      hasErrors = true;
    } else {
      console.log(`✅ ${envVar.name}: Valid`);
    }
  }

  // Validate optional environment variables
  for (const envVar of optionalEnvVars) {
    const value = process.env[envVar.name];

    if (!value) {
      warnings.push(`⚠️  ${envVar.name}: Not set (using default: ${envVar.default})`);
      warnings.push(`   Description: ${envVar.description}`);
    } else {
      const error = envVar.validation(value);
      if (error) {
        console.error(`❌ ${envVar.name}: ${error}`);
        console.error(`   Description: ${envVar.description}\n`);
        hasErrors = true;
      } else {
        console.log(`✅ ${envVar.name}: ${value}`);
      }
    }
  }

  // Display warnings
  if (warnings.length > 0) {
    console.log('\nWarnings:');
    warnings.forEach((warning) => console.log(warning));
  }

  if (hasErrors) {
    console.error('\n❌ Environment validation failed. Please fix the errors above.');
    process.exit(1);
  } else {
    console.log('\n✅ Environment validation passed!');
  }
}

// Run validation if this script is executed directly
if (process.argv[1] === __filename) {
  validateEnvironment();
}

export { validateEnvironment };
