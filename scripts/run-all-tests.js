#!/usr/bin/env node
/**
 * Clean test runner for all test suites
 * Runs unit, integration, e2e, and performance tests with summarized output
 */

// Filter out DEP0190 deprecation warning for shell spawn (safe in this controlled context)
// We use shell:true intentionally for cross-platform npm execution
// Must remove default listeners first, then add filtered handler
process.removeAllListeners('warning');
process.on('warning', (warning) => {
  // Check both code and message for DEP0190 (shell spawn with args)
  const isDep0190 =
    warning.code === 'DEP0190' ||
    (warning.name === 'DeprecationWarning' && warning.message?.includes('DEP0190'));
  if (isDep0190) {
    return; // Suppress only this specific warning
  }
  console.warn(warning);
});

import { spawn } from 'child_process';

const isFull = process.argv.includes('--full');

const SUITES = [
  { name: 'Unit', script: 'test:unit' },
  { name: 'Integration', script: isFull ? 'test:integration:full' : 'test:integration:core' },
  { name: 'E2E', script: 'test:e2e' },
  { name: 'Performance', script: 'test:performance' },
];

const results = [];
let hasFailure = false;

async function runSuite(suite) {
  return new Promise((resolve) => {
    const start = Date.now();
    process.stdout.write(`Running ${suite.name} tests... `);

    const proc = spawn('npm', ['run', suite.script], {
      stdio: ['inherit', 'pipe', 'pipe'],
      shell: true,
      cwd: process.cwd(),
      env: { ...process.env, FORCE_COLOR: '0' },
    });

    let stdout = '';
    let stderr = '';

    proc.stdout?.on('data', (data) => {
      stdout += data.toString();
    });

    proc.stderr?.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('close', (code) => {
      const duration = ((Date.now() - start) / 1000).toFixed(1);

      // Parse results from output
      // Vitest format: "Tests  1584 passed | 13 skipped (1597)"
      // Also handles: "Tests  1584 passed (1584)"
      let passed = 0;
      let failed = 0;
      let skipped = 0;

      // Look for the Tests summary line (last occurrence)
      const lines = stdout.split('\n');
      for (const line of lines) {
        // Skip "Test Files" line, we want "Tests" line
        if (line.includes('Tests') && !line.includes('Test Files')) {
          const passMatch = line.match(/(\d+)\s+passed/);
          const failMatch = line.match(/(\d+)\s+failed/);
          const skipMatch = line.match(/(\d+)\s+skipped/);

          if (passMatch) passed = parseInt(passMatch[1], 10);
          if (failMatch) failed = parseInt(failMatch[1], 10);
          if (skipMatch) skipped = parseInt(skipMatch[1], 10);
        }
      }

      const success = code === 0;
      if (!success) hasFailure = true;

      const status = success ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m';
      console.log(`${status} (${duration}s)`);

      results.push({
        name: suite.name,
        passed,
        failed,
        skipped,
        duration,
        success,
        stdout: success ? '' : stdout,
        stderr: success ? '' : stderr,
      });

      resolve();
    });
  });
}

async function main() {
  const title = isFull ? 'Running All Tests (Full Suite)' : 'Running All Tests';
  console.log(`\n\x1b[1m━━━ ${title} ━━━\x1b[0m\n`);

  for (const suite of SUITES) {
    await runSuite(suite);
  }

  // Print summary
  console.log('\n\x1b[1m━━━ Test Summary ━━━\x1b[0m\n');

  const totalPassed = results.reduce((sum, r) => sum + r.passed, 0);
  const totalFailed = results.reduce((sum, r) => sum + r.failed, 0);
  const totalSkipped = results.reduce((sum, r) => sum + r.skipped, 0);
  const totalDuration = results.reduce((sum, r) => sum + parseFloat(r.duration), 0).toFixed(1);

  // Table header
  console.log('Suite          Passed   Failed   Skipped   Time');
  console.log('─'.repeat(50));

  for (const r of results) {
    const status = r.success ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m';
    const name = r.name.padEnd(12);
    const passed = String(r.passed).padStart(6);
    const failed =
      r.failed > 0
        ? `\x1b[31m${String(r.failed).padStart(8)}\x1b[0m`
        : String(r.failed).padStart(8);
    const skipped = String(r.skipped).padStart(9);
    const time = `${r.duration}s`.padStart(7);
    console.log(`${status} ${name} ${passed} ${failed} ${skipped} ${time}`);
  }

  console.log('─'.repeat(50));

  const totalStatus = hasFailure ? '\x1b[31m✗\x1b[0m' : '\x1b[32m✓\x1b[0m';
  const totalLabel = 'Total'.padEnd(12);
  const passedStr = String(totalPassed).padStart(6);
  const failedStr =
    totalFailed > 0
      ? `\x1b[31m${String(totalFailed).padStart(8)}\x1b[0m`
      : String(totalFailed).padStart(8);
  const skippedStr = String(totalSkipped).padStart(9);
  const timeStr = `${totalDuration}s`.padStart(7);
  console.log(`${totalStatus} ${totalLabel} ${passedStr} ${failedStr} ${skippedStr} ${timeStr}`);

  console.log();

  // Print failures if any
  if (hasFailure) {
    console.log('\x1b[31m━━━ Failures ━━━\x1b[0m\n');
    for (const r of results.filter((r) => !r.success)) {
      console.log(`\x1b[1m${r.name}:\x1b[0m`);
      if (r.stdout) {
        // Show last 3000 chars of stdout to capture test failures without overwhelming output
        const trimmedStdout = r.stdout.length > 3000 ? '...' + r.stdout.slice(-3000) : r.stdout;
        console.log('\x1b[2mOutput:\x1b[0m');
        console.log(trimmedStdout);
      }
      if (r.stderr) {
        console.log('\x1b[2mErrors:\x1b[0m');
        console.log(r.stderr);
      }
      console.log();
    }
    process.exit(1);
  }

  console.log('\x1b[32mAll tests passed!\x1b[0m\n');
}

main().catch((err) => {
  console.error('Test runner error:', err);
  process.exit(1);
});
