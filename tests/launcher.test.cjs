'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {childEnvironment, exitDescription, resolveRuntime, treeDigest} = require('../scripts/electron-runtime.cjs');

const good = () => ({status: 0, stdout: '\r\nv44.4.5\n', stderr: ''});
const breakpoint = () => ({status: 0x80000003, stdout: '', stderr: ''});
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'facet-launcher-test-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const source = path.join(root, 'project', 'dist');
  fs.mkdirSync(path.join(source, 'locales'), {recursive: true});
  fs.writeFileSync(path.join(source, 'electron.exe'), 'fake runtime');
  fs.writeFileSync(path.join(source, 'locales', 'en-US.pak'), 'locale');
  return {source, executable: path.join(source, 'electron.exe'), version: '44.4.5',
    platform: 'win32', env: {}, cacheRoot: path.join(root, 'localappdata', 'cache'), warn() {},
    integrity() { return null; }};
}

test('child environment removes Electron host flags without mutating the parent', () => {
  const parent = {ELECTRON_RUN_AS_NODE: '1', electron_run_as_node: '1',
    CHROME_CRASHPAD_PIPE_NAME: 'host-pipe', PATH: 'keep', APPDATA: 'data', ELECTRON_OVERRIDE_DIST_PATH: 'custom'};
  assert.deepEqual(childEnvironment(parent), {PATH: 'keep', APPDATA: 'data', ELECTRON_OVERRIDE_DIST_PATH: 'custom'});
  assert.equal(parent.ELECTRON_RUN_AS_NODE, '1');
});

test('non-Windows launch does not probe or relocate', () => {
  assert.equal(resolveRuntime({executable: '/runtime/electron', platform: 'linux',
    probe() { throw Error('must not probe'); }}), '/runtime/electron');
});

test('healthy Windows runtime is used in place without cache writes', t => {
  const f = fixture(t);
  assert.equal(resolveRuntime({...f, probe: good}), f.executable);
  assert.equal(fs.existsSync(f.cacheRoot), false);
});

test('breakpoint fallback copies identical bytes and reuses a verified cache', t => {
  const f = fixture(t); let warnings = 0;
  const probe = file => file === f.executable ? breakpoint() : good();
  const chosen = resolveRuntime({...f, probe, warn: () => warnings++});
  assert.notEqual(chosen, f.executable);
  assert.equal(treeDigest(path.dirname(chosen)), treeDigest(f.source));
  assert.equal(resolveRuntime({...f, probe}), chosen);
  assert.equal(fs.readFileSync(f.executable, 'utf8'), 'fake runtime');
  assert.equal(warnings, 1);
  assert.equal(fs.readdirSync(f.cacheRoot).length, 1);
});

test('signed Windows breakpoint exit codes also trigger the narrow fallback', t => {
  const f = fixture(t);
  assert.notEqual(resolveRuntime({...f, probe: file => file === f.executable ?
    {status: -2147483645, stdout: ''} : good()}), f.executable);
});

test('modified cached files are not trusted or overwritten in place', t => {
  const f = fixture(t); const probe = file => file === f.executable ? breakpoint() : good();
  const first = resolveRuntime({...f, probe});
  fs.writeFileSync(first, 'damaged');
  const repaired = resolveRuntime({...f, probe});
  assert.notEqual(first, repaired);
  assert.equal(fs.readFileSync(first, 'utf8'), 'damaged');
  assert.equal(treeDigest(path.dirname(repaired)), treeDigest(f.source));
  assert.equal(resolveRuntime({...f, probe}), repaired, 'reuse repair without another full copy');
  assert.equal(fs.readdirSync(f.cacheRoot).length, 2);
});

test('changed source resources produce a new cache identity', t => {
  const f = fixture(t); const probe = file => file === f.executable ? breakpoint() : good();
  const first = resolveRuntime({...f, probe});
  fs.writeFileSync(path.join(f.source, 'locales', 'en-US.pak'), 'new locale');
  const second = resolveRuntime({...f, probe});
  assert.notEqual(first, second);
  assert.equal(treeDigest(path.dirname(second)), treeDigest(f.source));
});

test('ordinary failures, signals, timeouts and wrong versions are not hidden', t => {
  const f = fixture(t);
  for (const result of [{status: 1}, {status: null, signal: 'SIGTERM'},
    {status: null, error: Error('timeout')}, {status: 0, stdout: 'v24.21.0'}]) {
    assert.throws(() => resolveRuntime({...f, probe: () => result}), /启动自检失败/);
  }
  assert.equal(fs.existsSync(f.cacheRoot), false);
});

test('unsuccessful fallback stops rather than weakening the sandbox', t => {
  const f = fixture(t);
  assert.throws(() => resolveRuntime({...f, probe: breakpoint}), /本地缓存自检也失败/);
  assert.equal(fs.readFileSync(f.executable, 'utf8'), 'fake runtime');
});

test('breakpoint diagnosis names a Low integrity runtime folder, without probing healthy runtimes', t => {
  const f = fixture(t); const messages = []; let probed = 0;
  const integrity = () => { probed++; return 'low'; };
  assert.equal(resolveRuntime({...f, probe: good, integrity}), f.executable);
  assert.equal(probed, 0, 'healthy runtimes are not probed for integrity');
  resolveRuntime({...f, integrity, probe: file => file === f.executable ? breakpoint() : good(), warn: m => messages.push(m)});
  assert.equal(probed, 1);
  assert.match(messages[0], /低完整性标签/);
  assert.throws(() => resolveRuntime({...f, integrity, probe: breakpoint}), /低完整性标签.*本地缓存自检也失败/);
});

test('an integrity probe failure does not change the fallback decision', t => {
  const f = fixture(t); const messages = [];
  const chosen = resolveRuntime({...f, integrity() { throw Error('probe broke'); },
    probe: file => file === f.executable ? breakpoint() : good(), warn: m => messages.push(m)});
  assert.notEqual(chosen, f.executable);
  assert.match(messages[0], /0x80000003/);
});

test('cache cannot be nested in the source runtime', t => {
  const f = fixture(t);
  assert.throws(() => resolveRuntime({...f, cacheRoot: path.join(f.source, 'cache'), probe: breakpoint}), /源运行时内部/);
});

test('error descriptions retain the full Windows exception code', () => {
  assert.match(exitDescription(breakpoint()), /0x80000003/);
  assert.equal(exitDescription({error: Error('missing')}), 'missing');
  assert.equal(exitDescription({signal: 'SIGTERM'}), 'signal SIGTERM');
});
