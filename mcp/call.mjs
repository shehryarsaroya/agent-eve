#!/usr/bin/env node
// Operator CLI that actually uses MCP initialization, tool discovery and tools/call.
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const client = new Client({ name: 'agenteve-playtest', version: '0.1.0' });
await client.connect(new StdioClientTransport({ command: process.execPath, args: [fileURLToPath(new URL('./server.mjs', import.meta.url))], env: process.env, stderr: 'inherit' }));
try {
  const name = process.argv[2];
  if (!name) console.log(JSON.stringify(await client.listTools(), null, 2));
  else {
    const result = await client.callTool({ name, arguments: JSON.parse(process.argv[3] || '{}') });
    console.log(JSON.stringify({ ...JSON.parse(result.content[0].text), mcpError: result.isError === true }, null, 2));
    if (result.isError) process.exitCode = 1;
  }
} finally { await client.close(); }
