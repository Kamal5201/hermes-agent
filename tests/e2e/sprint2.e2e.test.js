const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

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

function pickExport(moduleExports, key) {
  if (!moduleExports) {
    return null;
  }

  return moduleExports[key] ?? moduleExports.default ?? null;
}

test('learning cycle persists completed days', async (t) => {
  const databaseModule = requireBuilt('database/DatabaseManager.js');
  const learningModule = requireBuilt('learning/LearningEngine.js');

  if (!databaseModule || !learningModule || !hasFreshBuild('learning/LearningEngine.ts', 'learning/LearningEngine.js')) {
    t.skip('fresh dist build not found');
    return;
  }

  const DatabaseManager = pickExport(databaseModule, 'default');
  const LearningEngine = pickExport(learningModule, 'LearningEngine');

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-e2e-'));
  const dbPath = path.join(tempDir, 'hermes.db');

  DatabaseManager.resetInstance();
  const db = DatabaseManager.getInstance(dbPath);
  db.initialize();

  try {
    const engine = new LearningEngine(db);
    await engine.learnFromDay(1);
    const status = engine.getCycleStatus();

    assert.equal(status.currentDay, 1);
    assert.deepEqual(status.completedDays, [1]);
    assert.ok(typeof status.persistenceSavedAt === 'number');
  } finally {
    db.close();
    DatabaseManager.resetInstance();
  }
});

test('sync conflict resolver prioritizes ACTIVE state', async (t) => {
  const syncProtocol = requireBuilt('sync/Protocol.js');

  if (!syncProtocol || !hasFreshBuild('sync/Protocol.ts', 'sync/Protocol.js')) {
    t.skip('fresh dist build not found');
    return;
  }

  const { resolveStateConflict } = syncProtocol;

  const result = resolveStateConflict(
    {
      deviceId: 'local',
      deviceName: 'Local',
      platform: 'macos',
      state: 'OBSERVING',
      lastSync: 100,
    },
    {
      deviceId: 'remote',
      deviceName: 'Remote',
      platform: 'windows',
      state: 'ACTIVE',
      lastSync: 50,
    },
  );

  assert.equal(result.strategy, 'active_priority');
  assert.equal(result.resolved.state, 'ACTIVE');
});

test('mcp tool catalog includes Sprint 2 tools', async (t) => {
  const toolModule = requireBuilt('mcp/ToolDefinitions.js');

  if (!toolModule || !hasFreshBuild('mcp/ToolDefinitions.ts', 'mcp/ToolDefinitions.js')) {
    t.skip('fresh dist build not found');
    return;
  }

  const toolNames = toolModule.TOOL_DEFINITIONS.map((tool) => tool.name);

  assert.ok(toolNames.includes('execution.drag'));
  assert.ok(toolNames.includes('learning.get_cycle_status'));
  assert.ok(toolNames.includes('mcp.list_tools'));
});
