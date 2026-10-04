import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import { textureMemory } from '../scripts/lib/texture-memory.mjs';
import { browserOptions, loadPlaywright } from '../scripts/lib/perf-browser.mjs';

test('shared aliases, independent equal-size sources and multi-source textures in the serialized browser helper', () => {
  const shared = { width: 10, height: 20 };
  const equalSize = { width: 10, height: 20 };
  const other = { width: 2, height: 3 };
  const textures = [{ key: 'atlas', source: [shared] }, { key: 'alias', source: [shared] }, { key: 'multi', source: [equalSize, shared, other] }];
  const browserHelper = runInNewContext(`(${textureMemory.toString()})`);
  const result = JSON.parse(JSON.stringify(browserHelper(textures)));
  assert.deepEqual(result, textureMemory(textures));
  assert.deepEqual(result.map(t => t.bytes), [800, 0, 824]);
  assert.equal(result[2].dims, '10x20+10x20+2x3');
  assert.deepEqual(result[2].sources, ['multi', 'atlas', 'multi']);
});

test('browser override is optional and module override must be absolute', async () => {
  const oldChrome = process.env.CHROME_EXECUTABLE_PATH;
  const oldModule = process.env.PLAYWRIGHT_MODULE;
  try {
    delete process.env.CHROME_EXECUTABLE_PATH;
    assert.deepEqual(browserOptions(), { headless: true });
    process.env.CHROME_EXECUTABLE_PATH = '/browser/chrome';
    assert.equal(browserOptions().executablePath, '/browser/chrome');
    process.env.PLAYWRIGHT_MODULE = './index.mjs';
    await assert.rejects(loadPlaywright(), /absolute/);
    process.env.PLAYWRIGHT_MODULE = new URL('../scripts/lib/texture-memory.mjs', import.meta.url).pathname;
    assert.equal((await loadPlaywright()).textureMemory, textureMemory);
  } finally {
    for (const [key, value] of [['CHROME_EXECUTABLE_PATH', oldChrome], ['PLAYWRIGHT_MODULE', oldModule]]) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});

test('startup timeout terminates the spawned Vite process group', async () => {
  const { startVite, stopVite } = await import('../scripts/lib/perf-browser.mjs');
  const killed = [];
  let clock = 0;
  const child = { pid: 12345, stdout: { on() {} }, stderr: { on() {} }, on() {}, kill(signal) { killed.push(signal); } };
  const start = runInNewContext(`const stopVite = ${stopVite.toString()}; (${startVite.toString()})`, {
    spawn: () => child,
    process: { execPath: '/node', platform: 'linux', kill: (pid, signal) => killed.push([pid, signal]) },
    Date: { now: () => (clock += 10000) },
    fetch: async () => { throw new Error('not ready'); },
    AbortSignal, setTimeout: resolve => resolve(),
  });
  await assert.rejects(start(5185, 'http://localhost:5185'), /within 30 s/);
  assert.deepEqual(killed, [[-12345, 'SIGTERM']]);
});
