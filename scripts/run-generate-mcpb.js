#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import process from 'node:process';

if (process.env['SKIP_MCPB'] === '1') {
  console.log('Skipping MCPB generation because SKIP_MCPB=1');
  process.exit(0);
}

const commands = [];
if (process.platform === 'win32') {
  commands.push([
    'powershell',
    ['-ExecutionPolicy', 'Bypass', '-File', 'scripts/generate-mcpb.ps1'],
  ]);
  commands.push(['pwsh', ['-File', 'scripts/generate-mcpb.ps1']]);
} else {
  commands.push(['pwsh', ['-File', 'scripts/generate-mcpb.ps1']]);
}

for (const [cmd, args] of commands) {
  const result = spawnSync(cmd, args, { stdio: 'inherit' });
  if (result.status === 0) {
    process.exit(0);
  }
}

console.log('PowerShell is not available on this runner; skipping MCPB generation.');
process.exit(0);
