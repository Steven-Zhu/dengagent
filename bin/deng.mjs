#!/usr/bin/env node
if (Number(process.versions.node.split('.')[0]) < 24) {
  process.stderr.write('DengAgent requires Node.js 24+. Upgrade Node.js before running deng, or use a matching optional bundled runtime.\n');
  process.exit(1);
}
await import('../src/cli.mjs');
