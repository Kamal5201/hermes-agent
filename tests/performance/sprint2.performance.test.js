const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { performance } = require('node:perf_hooks');

function requireBuilt(relativePath) {
  const absolutePath = path.resolve(__dirname, '../../dist', relativePath);
  if (!fs.existsSync(absolutePath)) {
    return null;
  }

  return require(absolutePath);
}

function hasFreshBuild(sourceRelativePath, distRelativePath) {
  const sourcePath = path.resolve(__dirname, '../../src', sourceRelativePath);
  const distPath = path.resolve(__dirname, '../../dist', distRelativePath);

  if (!fs.existsSync(sourcePath) || !fs.existsSync(distPath)) {
    return false;
  }

  return fs.statSync(distPath).mtimeMs >= fs.statSync(sourcePath).mtimeMs;
}

test('conflict resolution stays under baseline threshold', async (t) => {
  const syncProtocol = requireBuilt('sync/Protocol.js');

  if (!syncProtocol || !hasFreshBuild('sync/Protocol.ts', 'sync/Protocol.js')) {
    t.skip('fresh dist build not found');
    return;
  }

  const { resolveStateConflict } = syncProtocol;
  const iterations = 5000;
  const start = performance.now();

  for (let index = 0; index < iterations; index += 1) {
    resolveStateConflict(
      {
        deviceId: `local-${index}`,
        deviceName: 'Local',
        platform: 'macos',
        state: index % 2 === 0 ? 'OBSERVING' : 'HINT',
        lastSync: index,
        vectorClock: { counter: index, updatedAt: index },
      },
      {
        deviceId: `remote-${index}`,
        deviceName: 'Remote',
        platform: 'windows',
        state: 'ACTIVE',
        lastSync: index + 1,
        vectorClock: { counter: index + 1, updatedAt: index + 1 },
      },
    );
  }

  const durationMs = performance.now() - start;
  assert.ok(durationMs < 250, `conflict resolution baseline exceeded: ${durationMs.toFixed(2)}ms`);
});
