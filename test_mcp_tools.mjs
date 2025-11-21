import { spawn } from 'child_process';

const server = spawn('node', ['dist/index.js'], {
  stdio: ['pipe', 'pipe', 'inherit'],
  env: process.env,
});

// Send initialize request
const initRequest = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: {
      name: 'test-client',
      version: '1.0.0',
    },
  },
};

// Send list tools request
const listToolsRequest = {
  jsonrpc: '2.0',
  id: 2,
  method: 'tools/list',
  params: {},
};

let buffer = '';
server.stdout.on('data', (data) => {
  buffer += data.toString();
  const lines = buffer.split('\n');
  buffer = lines.pop() || '';

  for (const line of lines) {
    if (line.trim()) {
      try {
        const response = JSON.parse(line);
        console.log('Response:', JSON.stringify(response, null, 2));

        if (response.id === 1) {
          // After init, send list tools
          server.stdin.write(JSON.stringify(listToolsRequest) + '\n');
        } else if (response.id === 2) {
          // Got tools list
          if (response.result && response.result.tools) {
            console.log(`\n✅ Found ${response.result.tools.length} tools`);
            response.result.tools.forEach((tool) => {
              const desc = tool.description.substring(0, 60);
              console.log(`  - ${tool.name}: ${desc}...`);
            });
          } else {
            console.log('\n❌ No tools found in response');
          }
          server.kill();
        }
      } catch (e) {
        // Ignore parse errors for non-JSON output
      }
    }
  }
});

setTimeout(() => {
  console.log('\n⏱️ Timeout - sending requests');
  server.stdin.write(JSON.stringify(initRequest) + '\n');
}, 1000);

setTimeout(() => {
  console.log('❌ Test timed out');
  server.kill();
  process.exit(1);
}, 10000);
