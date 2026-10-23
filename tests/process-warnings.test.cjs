'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {installWarningDedup} = require('../src/main/process-warnings.cjs');

function target() {
  const calls = [];
  return {calls, emitWarning(warning, type) { calls.push([warning instanceof Error ? warning.message : String(warning), typeof type === 'object' ? type.type : type]); }};
}
const header = id => `Warnings loading extension at C:\\data\\extensions-packages\\${id}:\n  Permission 'cookies' is unknown.`;

test('identical extension load warnings are emitted once per process run', () => {
  const t = target(); const api = installWarningDedup(t);
  for (let i = 0; i < 5; i++) t.emitWarning(header('ext-a'), 'ExtensionLoadWarning');
  assert.equal(t.calls.length, 1);
  assert.equal(api.suppressed(), 4);
});

test('different extensions or changed permission lists are still reported', () => {
  const t = target(); installWarningDedup(t);
  t.emitWarning(header('ext-a'), 'ExtensionLoadWarning');
  t.emitWarning(header('ext-b'), 'ExtensionLoadWarning');
  t.emitWarning(header('ext-a') + "\n  Permission 'sidePanel' is unknown.", 'ExtensionLoadWarning');
  assert.equal(t.calls.length, 3);
});

test('other warning types, Error objects and option objects are handled without dropping unrelated warnings', () => {
  const t = target(); installWarningDedup(t);
  for (let i = 0; i < 3; i++) t.emitWarning('buffer is deprecated', 'DeprecationWarning');
  const error = Object.assign(new Error(header('ext-c')), {name: 'ExtensionLoadWarning'});
  t.emitWarning(error); t.emitWarning(error);
  t.emitWarning(header('ext-d'), {type: 'ExtensionLoadWarning'}); t.emitWarning(header('ext-d'), {type: 'ExtensionLoadWarning'});
  assert.equal(t.calls.filter(([, type]) => type === 'DeprecationWarning').length, 3);
  assert.equal(t.calls.length, 5);
});

test('installation is idempotent and restore puts the original function back', () => {
  const t = target(); const original = t.emitWarning;
  const first = installWarningDedup(t);
  assert.equal(installWarningDedup(t), first);
  first.restore();
  assert.equal(t.emitWarning, original);
  t.emitWarning(header('ext-a'), 'ExtensionLoadWarning'); t.emitWarning(header('ext-a'), 'ExtensionLoadWarning');
  assert.equal(t.calls.length, 2);
});

test('tracking is bounded; messages beyond the limit are still emitted', () => {
  const t = target(); installWarningDedup(t, {limit: 2});
  for (const id of ['a', 'b', 'c', 'c']) t.emitWarning(header(id), 'ExtensionLoadWarning');
  assert.equal(t.calls.length, 4);
});
