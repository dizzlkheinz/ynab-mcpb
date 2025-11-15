#!/usr/bin/env node
/**
 * Runs domain-scoped integration tests with tier filtering.
 */
import { spawn } from 'node:child_process';

const rawArgs = process.argv.slice(2);
const separatorIndex = rawArgs.indexOf('--');
const domainArgs = separatorIndex === -1 ? rawArgs : rawArgs.slice(0, separatorIndex);
const passthroughArgs = separatorIndex === -1 ? [] : rawArgs.slice(separatorIndex + 1);

if (domainArgs.length === 0) {
  console.error('Usage: node scripts/run-domain-integration-tests.js <domain> [domain ...]');
  process.exit(1);
}

const domains = domainArgs.join(',');
const env = {
  ...process.env,
  INTEGRATION_TEST_TIER: 'domain',
  INTEGRATION_TEST_DOMAINS: domains,
};

const vitestArgs = ['vitest', 'run', '--project', 'integration:domain', ...passthroughArgs];
const runner = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const child = spawn(runner, vitestArgs, {
  stdio: 'inherit',
  env,
});

child.on('close', (code) => {
  process.exit(code ?? 1);
});
