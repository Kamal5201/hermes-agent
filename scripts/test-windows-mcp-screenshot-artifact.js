#!/usr/bin/env node

const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');

const ADAPTER_POLL_INTERVAL_MS = 25;
const ADAPTER_POLL_TIMEOUT_MS = 5_000;
const DIST_ADAPTER_PATH = resolveAdapterPath();
const TASKS_ROOT = path.resolve(__dirname, '../artifacts/windows-tasks');
const TERMINAL_STATUSES = new Set([
  'completed',
  'cancelled',
  'failed_terminal',
  'failed_retryable',
  'blocked',
  'needs_input',
  'wait_login',
]);

const PNG_BYTES = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c6360000000020001e221bc330000000049454e44ae426082',
  'hex',
);
const JPEG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);

const CASES = [
  {
    name: 'structured-image-default-png',
    taskId: 'regression-windows-mcp-structured-image-png',
    expectedFilename: 'latest-screenshot.png',
    expectedBytes: PNG_BYTES,
    toolResult: {
      content: [
        { type: 'text', text: 'Screenshot completed.' },
        { type: 'image', data: PNG_BYTES.toString('base64') },
      ],
    },
  },
  {
    name: 'structured-image-jpg-mime',
    taskId: 'regression-windows-mcp-structured-image-jpg',
    expectedFilename: 'latest-screenshot.jpg',
    expectedBytes: JPEG_BYTES,
    toolResult: {
      content: [
        { type: 'text', text: 'Screenshot completed.' },
        { type: 'image', data: JPEG_BYTES.toString('base64'), mimeType: 'IMAGE/JPG' },
      ],
    },
  },
  {
    name: 'structured-image-pjpeg-mime',
    taskId: 'regression-windows-mcp-structured-image-pjpeg',
    expectedFilename: 'latest-screenshot.jpg',
    expectedBytes: JPEG_BYTES,
    toolResult: {
      content: [
        { type: 'text', text: 'Screenshot completed.' },
        { type: 'image', data: JPEG_BYTES.toString('base64'), mimeType: 'image/pjpeg' },
      ],
    },
  },
];

main().catch((error) => {
  console.error('Windows MCP screenshot artifact regression failed');
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exitCode = 1;
});

async function main() {
  if (!fs.existsSync(DIST_ADAPTER_PATH)) {
    throw new Error(`Compiled adapter JS not found: ${DIST_ADAPTER_PATH}`);
  }

  const adapterModule = require(DIST_ADAPTER_PATH);
  const WindowsMcpAdapter = adapterModule.WindowsMcpAdapter || adapterModule.default;
  if (!WindowsMcpAdapter) {
    throw new Error(`Compiled adapter module did not export WindowsMcpAdapter: ${DIST_ADAPTER_PATH}`);
  }

  const results = [];
  for (const testCase of CASES) {
    results.push(await runCase(WindowsMcpAdapter, testCase));
  }

  console.log(JSON.stringify({
    ok: true,
    adapterPath: path.relative(process.cwd(), DIST_ADAPTER_PATH),
    cases: results,
  }, null, 2));
}

async function runCase(WindowsMcpAdapter, testCase) {
  const taskRoot = path.join(TASKS_ROOT, testCase.taskId);
  const screenshotPath = path.join(taskRoot, 'screenshots', testCase.expectedFilename);
  const referencePath = path.join(taskRoot, 'screenshots', 'remote-reference.txt');
  const expectedRelativePath = path.relative(process.cwd(), screenshotPath);

  await fsp.rm(taskRoot, { recursive: true, force: true });

  try {
    const adapter = new WindowsMcpAdapter({
      client: createClientStub(testCase.toolResult),
      baseUrl: 'http://127.0.0.1:8000/mcp',
    });

    await adapter.submitTask({
      id: testCase.taskId,
      kind: 'desktop',
      target: 'windows',
      intent: 'Screenshot',
      priority: 'normal',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      status: 'queued',
      input: {
        params: {},
      },
      constraints: {
        requiredCapabilities: ['screenshot'],
        interactiveSessionRequired: true,
      },
      metadata: {
        source: 'test-windows-mcp-screenshot-artifact.js',
      },
    });

    const task = await waitForTask(adapter, testCase.taskId);
    assert.equal(task.status, 'completed', `${testCase.name} should complete`);
    assert.deepEqual(
      task.artifacts && task.artifacts.screenshots,
      [expectedRelativePath],
      `${testCase.name} should persist the screenshot artifact path`,
    );
    assert.equal(fs.existsSync(screenshotPath), true, `${testCase.name} should write ${testCase.expectedFilename}`);
    assert.equal(fs.existsSync(referencePath), false, `${testCase.name} should not write remote-reference.txt`);

    const screenshotBytes = await fsp.readFile(screenshotPath);
    assert.deepEqual(screenshotBytes, testCase.expectedBytes, `${testCase.name} should persist the expected image bytes`);

    const resultPath = path.join(taskRoot, 'result.json');
    assert.equal(fs.existsSync(resultPath), true, `${testCase.name} should persist result.json`);

    const summary = {
      name: testCase.name,
      taskId: testCase.taskId,
      screenshotArtifact: expectedRelativePath,
      bytes: screenshotBytes.length,
    };

    await fsp.rm(taskRoot, { recursive: true, force: true });
    return summary;
  } catch (error) {
    throw new Error(`${testCase.name}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function createClientStub(toolResult) {
  return {
    async initialize() {
      return {
        sessionId: 'stub-session',
        protocolVersion: '2024-11-05',
      };
    },
    async listTools() {
      return [{ name: 'Screenshot' }];
    },
    async callTool(name) {
      assert.equal(name, 'Screenshot');
      return toolResult;
    },
  };
}

async function waitForTask(adapter, taskId) {
  const deadline = Date.now() + ADAPTER_POLL_TIMEOUT_MS;

  while (Date.now() < deadline) {
    const task = await adapter.getTask(taskId);
    if (task && TERMINAL_STATUSES.has(task.status)) {
      return task;
    }

    await sleep(ADAPTER_POLL_INTERVAL_MS);
  }

  const task = await adapter.getTask(taskId);
  throw new Error(`task did not reach a terminal state within ${ADAPTER_POLL_TIMEOUT_MS}ms (last status: ${task && task.status})`);
}

function resolveAdapterPath() {
  const overridePath = process.env.WINDOWS_MCP_ADAPTER_JS
    ? path.resolve(process.cwd(), process.env.WINDOWS_MCP_ADAPTER_JS)
    : null;
  return overridePath || path.resolve(__dirname, '../dist/remote/adapters/WindowsMcpAdapter.js');
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
