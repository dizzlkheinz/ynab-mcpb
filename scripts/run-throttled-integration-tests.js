#!/usr/bin/env node
/**
 * Runs the full integration suite with simple rate-limit-aware throttling.
 */
import { spawn } from 'node:child_process';
import { readdirSync } from 'node:fs';
import path from 'node:path';

const RATE_LIMIT = Number(process.env['RATE_LIMIT_PER_HOUR'] ?? 200);
const RATE_LIMIT_BUFFER = Number(process.env['RATE_LIMIT_BUFFER'] ?? 20);
const RATE_LIMIT_WINDOW_MS = Number(process.env['RATE_LIMIT_WINDOW_MS'] ?? 60 * 60 * 1000);
const MAX_WAIT_MS = Number(process.env['RATE_LIMIT_MAX_WAIT_MS'] ?? 60 * 60 * 1000);
const projectRoot = process.cwd();

const testFiles = collectIntegrationTests(path.join(projectRoot, 'src'));
const toPosixPath = (value) => value.split(path.sep).join(path.posix.sep);
if (testFiles.length === 0) {
  console.error('No integration test files found.');
  process.exit(1);
}

const requestHistory = [];

await runSequentially(testFiles);

async function runSequentially(files) {
  for (const filePath of files) {
    const estimatedCalls = estimateCalls(filePath);
    await throttleIfNeeded(estimatedCalls);
    const relativePath = path.relative(projectRoot, filePath);
    console.log(
      `▶️  Running ${relativePath} (estimated ${estimatedCalls} API calls)`,
    );
    await runVitestFile(relativePath);
    requestHistory.push({ timestamp: Date.now(), calls: estimatedCalls });
  }
}

function collectIntegrationTests(dir) {
  const entries = readdirSync(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectIntegrationTests(fullPath));
    } else if (entry.isFile() && entry.name.endsWith('.integration.test.ts')) {
      files.push(fullPath);
    }
  }
  return files.sort((a, b) => a.localeCompare(b));
}

async function throttleIfNeeded(nextCalls) {
  pruneHistory();
  while (getRecentCalls() + nextCalls > RATE_LIMIT - RATE_LIMIT_BUFFER) {
    const nextWindowTime = requestHistory[0]?.timestamp ?? Date.now();
    const waitUntil = nextWindowTime + RATE_LIMIT_WINDOW_MS;
    const waitMs = Math.min(Math.max(waitUntil - Date.now(), 1000), MAX_WAIT_MS);
    const minutes = Math.max(1, Math.round(waitMs / 60000));
    console.warn(
      `⏳ Approaching rate limit (${getRecentCalls()}/${RATE_LIMIT}). Waiting ${minutes} minute${
        minutes === 1 ? '' : 's'
      }...`,
    );
    await sleep(waitMs);
    pruneHistory();
  }
}

function pruneHistory() {
  const cutoff = Date.now() - RATE_LIMIT_WINDOW_MS;
  while (requestHistory.length && requestHistory[0].timestamp < cutoff) {
    requestHistory.shift();
  }
}

function getRecentCalls() {
  return requestHistory.reduce((sum, entry) => sum + entry.calls, 0);
}

function estimateCalls(filePath) {
  const name = filePath.toLowerCase();
  if (name.includes('delta')) return 15;
  if (name.includes('reconciliation')) return 25;
  if (name.includes('transaction')) return 12;
  if (name.includes('budget')) return 8;
  if (name.includes('account')) return 8;
  if (name.includes('payee')) return 10;
  if (name.includes('category')) return 10;
  if (name.includes('month')) return 10;
  return 10;
}

async function runVitestFile(testFile) {
  const normalized = toPosixPath(testFile);
  const vitestArgs = ['vitest', 'run', '--project', 'integration:full', normalized];
  const runner = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  const child = spawn(runner, vitestArgs, {
    stdio: 'inherit',
    env: {
      ...process.env,
      INTEGRATION_TEST_TIER: 'full',
      INTEGRATION_TEST_DOMAINS: '',
    },
  });

  await new Promise((resolve, reject) => {
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Vitest exited with code ${code}`));
    });
    child.on('error', reject);
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
